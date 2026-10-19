namespace Pulse.WebApi.Features.Identity.SharedAccess;

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Refuses a PARTICIPANT sim write while the exercise is held (#379): lifecycle <c>paused</c> (or any state that does
/// not accept participant writes) or the <see cref="PauseTier.Freeze"/> tier, per <see cref="ParticipantWriteGate"/>.
/// It short-circuits with <c>409 {"reason":"frozen"}</c> BEFORE the handler runs, so nothing is persisted, emitted or
/// broadcast. Applied with <see cref="ParticipantWritePauseExtensions.RefuseWhenWritesPaused{TBuilder}"/>, next to
/// <see cref="ReadOnlyWriteDenialExtensions.DenyReadOnlySessions{TBuilder}"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Freeze semantics: "participants held" (ruling, Tom, 2026-10-19; CTL-023).</b> A Freeze holds PARTICIPANTS: their
/// sim writes are refused. Staff conduct is not held: a controller's post as a persona still publishes and reaches
/// the held world (it is fanned out like any other post), and staff uploads still land.
/// </para>
/// <list type="bullet">
///   <item><b>Unresolved scope — passed through.</b> There is no exercise to ask about; the endpoint already fails
///   closed with 401.</item>
///   <item><b>A live STAFF session — passed through.</b> A held world stops the fiction for participants, not the
///   controllers conducting it (a controller posting as a persona, a staff upload). Staff is detected exactly as
///   <c>ExerciseLifecycleGatingMiddleware</c> does, through <see cref="ICurrentStaffSessionAccessor"/>, and only when
///   the gate would refuse, so the common running path costs no session lookup.</item>
///   <item><b>Everyone else</b> (participant, and a read-only session if it ever got this far) is refused.</item>
///   <item><b>An unknown / unreadable exercise — refused, on purpose.</b> The gate fails closed when the exercise row
///   cannot be read. That is deliberately STRICTER than <c>ExerciseLifecycleGatingMiddleware</c>, which passes a
///   <c>null</c> state through; do not "align" the two: a write gate must deny when it cannot tell.</item>
///   <item><b>A route-declared exemption — passed through.</b> A slice may name requests the hold does not cover
///   (the <c>isExempt</c> overload of
///   <see cref="ParticipantWritePauseExtensions.RefuseWhenWritesPaused{TBuilder}(TBuilder, Func{HttpContext, bool})"/>).
///   The only one today is the personal pin, a private bookmark (ruling, Tom, 2026-10-19: "Allow pins").</item>
/// </list>
/// Services are resolved lazily from request services, so the filter itself has no constructor dependencies.
/// </remarks>
public sealed class ParticipantWritePauseFilter : IEndpointFilter
{
    private readonly Func<HttpContext, bool>? _isExempt;

    /// <summary>Creates the filter.</summary>
    /// <param name="isExempt">
    /// Optional: requests the hold does not cover (checked first, before any read). <c>null</c> exempts nothing.
    /// </param>
    public ParticipantWritePauseFilter(Func<HttpContext, bool>? isExempt = null) => _isExempt = isExempt;

    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var httpContext = context.HttpContext;
        if (_isExempt?.Invoke(httpContext) == true)
        {
            return await next(context);
        }

        var services = httpContext.RequestServices;
        var cancellationToken = httpContext.RequestAborted;

        var scope = services.GetRequiredService<IExerciseContext>().CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return await next(context);
        }

        var gate = services.GetRequiredService<ParticipantWriteGate>();
        if (!await gate.IsRefusedAsync(scope.Value, cancellationToken))
        {
            return await next(context);
        }

        var staff = await services.GetRequiredService<ICurrentStaffSessionAccessor>()
            .GetCurrentStaffSessionAsync(cancellationToken);
        if (staff is not null)
        {
            return await next(context);
        }

        return Results.Json(
            new ParticipantWriteRefusalDto { Reason = ParticipantWriteGate.FrozenReason },
            statusCode: StatusCodes.Status409Conflict);
    }
}

/// <summary>The body of a held-world refusal: <c>{"reason":"frozen"}</c> (the same shape as an edit refusal).</summary>
public sealed class ParticipantWriteRefusalDto
{
    /// <summary>Why the write was refused (<see cref="ParticipantWriteGate.FrozenReason"/>).</summary>
    [JsonPropertyName("reason")]
    public required string Reason { get; init; }
}

/// <summary>Applies <see cref="ParticipantWritePauseFilter"/> to a participant write endpoint or group.</summary>
public static class ParticipantWritePauseExtensions
{
    /// <summary>
    /// Refuses participant writes (409 <c>frozen</c>) on the endpoint(s) built by <paramref name="builder"/> while the
    /// exercise is paused or frozen. Staff sessions and unresolved scopes pass through. The slice must also register
    /// the gate (<see cref="ParticipantWriteGateServiceCollectionExtensions.TryAddParticipantWriteGate"/>).
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder type (route handler or route group).</typeparam>
    /// <param name="builder">The endpoint / group builder to guard.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static TBuilder RefuseWhenWritesPaused<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.AddEndpointFilter(new ParticipantWritePauseFilter());
    }

    /// <summary>
    /// As <see cref="RefuseWhenWritesPaused{TBuilder}(TBuilder)"/>, but requests matching <paramref name="isExempt"/>
    /// pass through. Keep the predicate exact (e.g. an ordinal match on a route value), so it can only ever widen
    /// for what it names.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder type (route handler or route group).</typeparam>
    /// <param name="builder">The endpoint / group builder to guard.</param>
    /// <param name="isExempt">The requests the hold does not cover.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static TBuilder RefuseWhenWritesPaused<TBuilder>(this TBuilder builder, Func<HttpContext, bool> isExempt)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentNullException.ThrowIfNull(isExempt);
        return builder.AddEndpointFilter(new ParticipantWritePauseFilter(isExempt));
    }
}
