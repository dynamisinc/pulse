namespace Pulse.WebApi.Features.Identity.Accounts;

using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// The account slice HTTP surface + composition-root seams (story 02, COR-011): the participant credential login
/// (<c>POST /api/auth/login</c>) and the STAFF-only provisioning endpoints (<c>POST /api/staff/accounts</c>,
/// <c>POST /api/staff/accounts/import</c>). Exposes the extension methods the orchestrator wires into
/// <c>Program.cs</c> (<see cref="AddParticipantAccounts"/> / <see cref="MapAccountEndpoints"/>); this feature
/// never edits <c>Program.cs</c> itself. Follows the <c>Features/Identity/Staff/*</c> minimal-API
/// endpoint-extension pattern; route base <c>/api</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned, documented for the serial Wave-3 edit):</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddParticipantAccounts()</c>. This slice DEPENDS on
///   <c>AddStaffIdentity(...)</c> + <c>AddSessions(...)</c> already being registered (for
///   <c>ICurrentStaffSessionAccessor</c> and <c>ISessionIssuer</c>), which they are by Wave 2 — DI registration
///   order does not matter, only that all three are registered before the provider is built.</description></item>
///   <item><description>Pipeline: NO new middleware. <c>app.UseRateLimiter()</c> is already wired (for the staff
///   / session policies); this slice only ADDS the <c>participant-login</c> policy to the shared limiter.</description></item>
///   <item><description>Endpoints: <c>app.MapAccountEndpoints()</c>.</description></item>
/// </list>
/// </para>
/// </remarks>
public static class AccountEndpoints
{
    /// <summary>
    /// The per-IP rate-limit policy name for <c>POST /api/auth/login</c> (NFR-009). DISTINCT from
    /// <c>staff-login</c> / <c>session-endpoints</c> / the shared-credential policy so participant login has its
    /// own budget. Enforcement needs <c>app.UseRateLimiter()</c> in the pipeline (orchestrator-owned, already wired).
    /// </summary>
    public const string ParticipantLoginRateLimitPolicy = "participant-login";

    /// <summary>The maximum accepted import file size in bytes (a size guard, NFR-004). Larger uploads are rejected (400).</summary>
    public const int MaxImportFileBytes = 1024 * 1024;

    /// <summary>Registers the account slice services + the per-IP participant-login rate-limit policy.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddParticipantAccounts(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Stateless, thread-safe slow-KDF hasher → singleton.
        services.AddSingleton<ParticipantPasswordHasher>();

        // Scoped to match the PulseDbContext unit of work.
        services.AddScoped<ParticipantLoginService>();
        services.AddScoped<AccountProvisioningService>();

        // Per-IP fixed-window limiter on the internet-facing participant login (NFR-009). Enforcement needs
        // app.UseRateLimiter() (orchestrator-owned, already wired for the staff/session policies). AddRateLimiter
        // is additive across features — this only adds a new named policy to the shared limiter.
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(ParticipantLoginRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 10,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    }));
        });

        return services;
    }

    /// <summary>Maps the participant login + staff account-provisioning endpoints onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPost("/api/auth/login", ParticipantLoginAsync)
            .RequireRateLimiting(ParticipantLoginRateLimitPolicy);
        endpoints.MapPost("/api/staff/accounts", CreateAccountAsync);

        // The CSV upload is multipart/form-data (field name "file"). DisableAntiforgery: this is a bearer-token
        // API (the staff session token is carried in the Authorization header, not a cookie), so CSRF — which
        // antiforgery defends — does not apply; the staff-session gate is the real authorization.
        endpoints.MapPost("/api/staff/accounts/import", ImportAccountsAsync)
            .DisableAntiforgery();

        return endpoints;
    }

    /// <summary>
    /// Authenticates a participant login and, on success, returns the issued token + frozen session projection.
    /// Fails closed: 400 on invalid input, 401 on a rejected credential OR an unresolved host scope (never a
    /// default session).
    /// </summary>
    private static async Task<IResult> ParticipantLoginAsync(
        ParticipantLoginRequest? request,
        ParticipantLoginService loginService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON login body is required.");
        }

        var result = await loginService.LoginAsync(request, cancellationToken);

        return result.Outcome switch
        {
            ParticipantLoginOutcome.Authenticated when result.Issued is { } issued =>
                Results.Ok(ParticipantLoginResponseDto.From(issued)),
            ParticipantLoginOutcome.Invalid => Results.BadRequest(result.ValidationError),
            ParticipantLoginOutcome.RejectedCredential => Results.Unauthorized(),
            ParticipantLoginOutcome.ScopeUnresolved => Results.Unauthorized(),
            // Unreachable: an Authenticated outcome always carries an issued session. Fail closed.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Creates one account in the staff caller's active exercise. Fails closed: 401 unauthenticated, 400 invalid
    /// input / no active exercise, 409 duplicate handle; 201 with the account projection on success.
    /// </summary>
    private static async Task<IResult> CreateAccountAsync(
        CreateAccountRequest? request,
        AccountProvisioningService provisioningService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON account body is required.");
        }

        var result = await provisioningService.CreateAsync(request, cancellationToken);

        return result.Outcome switch
        {
            CreateAccountOutcome.Created when result.Account is { } account =>
                Results.Created($"/api/staff/accounts/{account.Id}", account),
            CreateAccountOutcome.Invalid => Results.BadRequest(result.Error),
            CreateAccountOutcome.Duplicate => Results.Conflict(result.Error),
            CreateAccountOutcome.NoActiveExercise => Results.BadRequest(result.Error),
            CreateAccountOutcome.Unauthenticated => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Bulk-imports accounts from an uploaded CSV file into the staff caller's active exercise. Validates
    /// MIME/size at the boundary, then returns a per-row summary. Fails closed: 401 unauthenticated, 400 on a
    /// missing/oversized/wrong-type file or a malformed CSV.
    /// </summary>
    private static async Task<IResult> ImportAccountsAsync(
        IFormFile? file,
        AccountProvisioningService provisioningService,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return Results.BadRequest("A non-empty CSV file (multipart/form-data field 'file') is required.");
        }

        if (file.Length > MaxImportFileBytes)
        {
            return Results.BadRequest($"the CSV file exceeds the maximum size of {MaxImportFileBytes} bytes.");
        }

        if (!IsCsvUpload(file))
        {
            return Results.BadRequest("the uploaded file must be a CSV (text/csv or a .csv file).");
        }

        string csvContent;
        await using (var stream = file.OpenReadStream())
        using (var reader = new StreamReader(stream, Encoding.UTF8))
        {
            csvContent = await reader.ReadToEndAsync(cancellationToken);
        }

        var result = await provisioningService.ImportAsync(csvContent, cancellationToken);

        return result.Outcome switch
        {
            ImportAccountsOutcome.Ok => Results.Ok(result.Summary),
            ImportAccountsOutcome.Malformed => Results.BadRequest(result.Error),
            ImportAccountsOutcome.NoActiveExercise => Results.BadRequest(result.Error ?? "no active exercise is selected for this staff session."),
            ImportAccountsOutcome.Unauthenticated => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Accepts the upload as CSV when the content type names CSV/plain text, OR the filename ends in
    /// <c>.csv</c> (browsers vary in the content type they attach to a chosen <c>.csv</c> file), while rejecting
    /// an obviously-wrong binary type (e.g. an image) sent without a <c>.csv</c> name.
    /// </summary>
    private static bool IsCsvUpload(IFormFile file)
    {
        if (!string.IsNullOrEmpty(file.FileName) &&
            file.FileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var contentType = file.ContentType;
        return !string.IsNullOrEmpty(contentType) && (
            contentType.Contains("csv", StringComparison.OrdinalIgnoreCase) ||
            contentType.Equals("text/plain", StringComparison.OrdinalIgnoreCase) ||
            contentType.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase) ||
            contentType.Equals("application/vnd.ms-excel", StringComparison.OrdinalIgnoreCase));
    }
}
