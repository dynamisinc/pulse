namespace Pulse.WebApi.Features.Identity.LinkEmail;

using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Media;

/// <summary>
/// The email-links endpoint of easy participant login (story 13, EL-18): <c>POST /api/staff/roster/email-links</c>,
/// which emails each selected participant their own personal join link through Azure Communication Services, keyless.
/// Staff world: the roster's "Email links (N)" button calls it. Thin handler: refuse when dark, read the body strictly,
/// call <see cref="LinkEmailService"/>, map the result.
/// </summary>
/// <remarks>
/// <para>
/// <b>Dark until configured.</b> With <c>Email:Endpoint</c> unset the host starts normally and quietly, the mailer is
/// the fail-closed <see cref="NullParticipantLinkMailer"/>, this route answers <c>503</c> ProblemDetails ("Email
/// delivery is not configured") and sends nothing, and the roster reports <c>capabilities.emailLinks: false</c> from
/// the same key. No migration, nothing else depends on it.
/// </para>
/// <para>
/// <b>Who may call it (EL-13).</b> <see cref="EngineCockpitStaffAuthorizationFilter"/> then
/// <see cref="RosterStaffRoleFilter"/>, both BEFORE the handler: <c>401</c> with no staff session or no resolved
/// exercise, <c>403</c> for a staff user not assigned there as controller or planner. So an unauthorized caller learns
/// nothing, not even whether email is configured.
/// </para>
/// <para>
/// <b>Status contract.</b> <c>200</c> <see cref="RosterEmailResultDto"/>; <c>400</c> ProblemDetails for a body that is
/// not JSON, is malformed, has an unknown or repeated property, an explicit <c>null</c>, an empty or non-string
/// <c>participantIds</c>, more than 100 ids, or (ids omitted) more than 100 eligible; <c>413</c> over
/// <see cref="MaxRequestBodyBytes"/>; <c>503</c> when email or join links are not configured. Every response the
/// handler writes carries <c>Cache-Control: no-store</c>.
/// </para>
/// </remarks>
public static class LinkEmailEndpoints
{
    /// <summary>The email-links route.</summary>
    public const string EmailLinksRoute = "/api/staff/roster/email-links";

    /// <summary>The largest request body accepted (16 KiB; 100 GUIDs are about 4 KB). Larger is a <c>413</c>.</summary>
    public const long MaxRequestBodyBytes = 16 * 1024;

    /// <summary>The <c>Cache-Control</c> value on every handler response.</summary>
    public const string NoStore = "no-store";

    /// <summary>The <c>detail</c> of a 400 for a body that is not the strict JSON shape (fixed text: no echo of the input).</summary>
    public const string MalformedBodyMessage =
        "The body must be JSON: {} for every eligible participant, or exactly { \"participantIds\": [ \"…\" ] }, with no other property.";

    /// <summary>
    /// Registers link emailing: the easy-login kernel it reads through (idempotent), the pacing options, the keyless
    /// client settings (managed identity in Azure, <c>DefaultAzureCredential</c> in Development: the
    /// <see cref="MediaEndpoints.CreateCredential"/> selection), the mailer (ACS when <c>Email:*</c> is usable,
    /// otherwise the fail-closed null mailer), the service, and a startup check that names a misconfigured key once.
    /// Every registration is <c>TryAdd</c>, so a test host's fake mailer wins. Prerequisites the host wires:
    /// persistence and exercise scoping, <c>AddExerciseClock()</c> and <c>AddStaffIdentity()</c>. Idempotent.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddLinkEmail(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddEasyLoginFoundation();
        services.TryAddSingleton(TimeProvider.System);
        services.AddOptions<LinkEmailPacing>();

        // Keyless: a token credential only. Constructing it performs no I/O, and it is only resolved when Email:* is usable.
        services.TryAddSingleton(provider =>
            new LinkEmailClientSettings(MediaEndpoints.CreateCredential(provider.GetRequiredService<IHostEnvironment>())));
        services.TryAddSingleton<IParticipantLinkMailer>(CreateMailer);
        services.TryAddScoped<LinkEmailService>();
        services.AddHostedService<LinkEmailStartupCheck>();

        return services;
    }

    /// <summary>
    /// Maps <c>POST /api/staff/roster/email-links</c> behind the staff gate and the controller-or-planner gate, with the
    /// 16 KiB body limit.
    /// </summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapLinkEmailEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPost(EmailLinksRoute, PostEmailLinksAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .AddEndpointFilter<RosterStaffRoleFilter>()
            .WithMetadata(new RequestSizeLimitAttribute(MaxRequestBodyBytes));

        return endpoints;
    }

    /// <summary>
    /// The mailer for this host: <see cref="AcsParticipantLinkMailer"/> when <c>Email:Endpoint</c> and
    /// <c>Email:SenderAddress</c> are usable, otherwise <see cref="NullParticipantLinkMailer"/>. Decided once, when the
    /// singleton is first resolved (an App Service app-setting change restarts the app).
    /// </summary>
    private static IParticipantLinkMailer CreateMailer(IServiceProvider provider)
    {
        var settings = LinkEmailSettings.TryRead(provider.GetRequiredService<IConfiguration>(), out _);
        if (settings is null)
        {
            return new NullParticipantLinkMailer();
        }

        return new AcsParticipantLinkMailer(
            settings,
            provider.GetRequiredService<LinkEmailClientSettings>(),
            provider.GetRequiredService<ILogger<AcsParticipantLinkMailer>>());
    }

    /// <summary>
    /// Emails the links. The mailer and service are <c>[FromServices]</c> explicitly so a host missing
    /// <c>AddLinkEmail()</c> fails loudly instead of binding them from the request. The body is read here, not by
    /// parameter binding, so that every malformed shape is a 400 ProblemDetails with a fixed, readable detail.
    /// </summary>
    private static async Task<IResult> PostEmailLinksAsync(
        HttpRequest request,
        [FromServices] IParticipantLinkMailer mailer,
        [FromServices] LinkEmailService service,
        CancellationToken cancellationToken)
    {
        // The answer names who was emailed a credential: no cache, browser or proxy may keep it.
        request.HttpContext.Response.Headers[HeaderNames.CacheControl] = NoStore;

        // Dark until configured: answered before the body is read, so nothing is parsed, read or sent.
        if (!mailer.IsConfigured)
        {
            return Results.Problem(detail: LinkEmailResult.NotConfiguredMessage, statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var (body, refusal) = await ReadBodyAsync(request, cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        var result = await service.SendAsync(body, cancellationToken);

        return result.Outcome switch
        {
            LinkEmailOutcome.Ok when result.Body is { } resultBody => Results.Json(resultBody),
            LinkEmailOutcome.Invalid or LinkEmailOutcome.TooMany =>
                Results.Problem(detail: result.Message, statusCode: StatusCodes.Status400BadRequest),
            LinkEmailOutcome.NotConfigured or LinkEmailOutcome.JoinLinksUnavailable =>
                Results.Problem(detail: result.Message, statusCode: StatusCodes.Status503ServiceUnavailable),
            LinkEmailOutcome.Unauthenticated => Results.Unauthorized(),
            LinkEmailOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),

            // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Reads the body as the frozen <see cref="RosterEmailLinksBody"/> with <see cref="LinkEmailRequestJson.Strict"/>. A
    /// JSON <c>null</c> comes back as a <c>null</c> body (the service refuses it with a readable 400); anything that is
    /// not JSON of the shape is a 400 here; a body over the route's limit is the server's 413.
    /// </summary>
    private static async Task<(RosterEmailLinksBody? Body, IResult? Refusal)> ReadBodyAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        if (!request.HasJsonContentType())
        {
            return (null, Results.Problem(detail: MalformedBodyMessage, statusCode: StatusCodes.Status400BadRequest));
        }

        try
        {
            var body = await JsonSerializer.DeserializeAsync<RosterEmailLinksBody>(
                request.Body, LinkEmailRequestJson.Strict, cancellationToken);
            return (body, null);
        }
        catch (JsonException)
        {
            // The exception text is not echoed: a fixed detail cannot carry anything the caller sent.
            return (null, Results.Problem(detail: MalformedBodyMessage, statusCode: StatusCodes.Status400BadRequest));
        }
        catch (BadHttpRequestException exception)
        {
            var tooLarge = exception.StatusCode == StatusCodes.Status413PayloadTooLarge;
            return (null, Results.Problem(
                detail: tooLarge
                    ? $"The request body is larger than {MaxRequestBodyBytes / 1024} KiB."
                    : "The request body could not be read.",
                statusCode: tooLarge ? StatusCodes.Status413PayloadTooLarge : StatusCodes.Status400BadRequest));
        }
    }
}

/// <summary>
/// Logs ONCE at startup when <c>Email:Endpoint</c> is set but the email settings are unusable, naming the key(s),
/// never a value. Silent when email is simply not configured (the normal dark state, EL-18) and when it is usable.
/// Never stops the host.
/// </summary>
internal sealed partial class LinkEmailStartupCheck : IHostedService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<LinkEmailStartupCheck> _logger;

    public LinkEmailStartupCheck(IConfiguration configuration, ILogger<LinkEmailStartupCheck> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        LinkEmailSettings.TryRead(_configuration, out var problemKeys);
        if (problemKeys.Count > 0)
        {
            LogMisconfigured(_logger, string.Join(", ", problemKeys));
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Link email is requested but not usable: check {Keys}. The email-links endpoint answers 503 until it is fixed.")]
    private static partial void LogMisconfigured(ILogger logger, string keys);
}
