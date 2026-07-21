namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The real <see cref="ICurrentStaffSessionAccessor"/> (story 03, Wave 2) fulfilling the fail-closed seam story
/// 05 defined: it reads the request's presented opaque token, resolves the persisted <c>Session</c> row, and
/// yields a <see cref="CurrentStaffSession"/> ONLY for a live (non-revoked, unexpired) <c>staff</c>-kind session
/// bound to a <c>StaffUser</c>. A participant / read-only session — or any invalid, expired, or revoked session
/// — yields <c>null</c>, so <c>GET /api/staff/assignments</c> and <c>POST /api/staff/active-exercise</c> are
/// staff-only by construction (XC-002) and fail closed (401).
/// </summary>
/// <remarks>
/// <para>
/// The orchestrator wires <c>AddSessions()</c> so this registration takes precedence over story 05's
/// <c>NullCurrentStaffSessionAccessor</c> (see <c>SessionEndpoints.AddSessions</c>, which <c>Replace</c>s the
/// fail-closed default). It runs at endpoint time (the request-scoped <see cref="PulseDbContext"/> is already
/// constructed), and <c>Session</c> is not <c>IExerciseScoped</c>, so the token lookup is not scope-filtered.
/// No token material is ever logged (NFR-009).
/// </para>
/// </remarks>
public sealed class CurrentStaffSessionAccessor : ICurrentStaffSessionAccessor
{
    private const string StaffKind = "staff";

    private readonly PulseDbContext _dbContext;
    private readonly IHttpContextAccessor _httpContextAccessor;

    /// <summary>Creates the accessor over its persistence context and the current-request accessor.</summary>
    /// <param name="dbContext">The request-scoped persistence context the token lookup runs through.</param>
    /// <param name="httpContextAccessor">Provides the current request whose <c>Authorization</c> header carries the token.</param>
    public CurrentStaffSessionAccessor(PulseDbContext dbContext, IHttpContextAccessor httpContextAccessor)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(httpContextAccessor);

        _dbContext = dbContext;
        _httpContextAccessor = httpContextAccessor;
    }

    /// <inheritdoc />
    public async Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default)
    {
        var httpContext = _httpContextAccessor.HttpContext;
        if (httpContext is null || !SessionTokenExtractor.TryGetBearerToken(httpContext.Request, out var rawToken))
        {
            return null;
        }

        var tokenHash = SessionTokens.Hash(rawToken);
        var now = DateTimeOffset.UtcNow;

        var session = await _dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync(s => s.TokenHash == tokenHash, cancellationToken);

        // Fail closed on anything that is not a live staff session bound to a StaffUser.
        if (session is null ||
            !session.IsLive(now) ||
            !string.Equals(session.Kind, StaffKind, StringComparison.Ordinal) ||
            session.StaffUserId is not { } staffUserId)
        {
            return null;
        }

        return new CurrentStaffSession
        {
            SessionId = session.Id,
            StaffUserId = staffUserId,
        };
    }
}
