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
/// <list type="bullet">
///   <item><b>Unresolved scope — passed through.</b> There is no exercise to ask about; the endpoint already fails
///   closed with 401.</item>
///   <item><b>A live STAFF session — passed through.</b> A held world stops the fiction for participants, not the
///   controllers conducting it (a controller posting as a persona, a staff upload). Staff is detected exactly as
///   <c>ExerciseLifecycleGatingMiddleware</c> does, through <see cref="ICurrentStaffSessionAccessor"/>, and only when
///   the gate would refuse, so the common running path costs no session lookup.</item>
///   <item><b>Everyone else</b> (participant, and a read-only session if it ever got this far) is refused.</item>
/// </list>
/// Services are resolved lazily from request services, so the filter itself has no constructor dependencies.
/// </remarks>
public sealed class ParticipantWritePauseFilter : IEndpointFilter
{
    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var httpContext = context.HttpContext;
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
        return builder.AddEndpointFilter<TBuilder, ParticipantWritePauseFilter>();
    }
}
