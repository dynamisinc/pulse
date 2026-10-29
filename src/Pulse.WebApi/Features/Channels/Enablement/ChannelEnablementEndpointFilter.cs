namespace Pulse.WebApi.Features.Channels.Enablement;

using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The <c>RequireChannelEnabled(channelId)</c> endpoint filter (FC-7, channels-foundation 08): a participant request
/// to a route of a DISABLED channel gets the same bare <c>404</c> an unmapped route gets, so "disabled" means
/// unreachable, not merely hidden (PRT-003, D2-005). A request for an enabled channel proceeds untouched.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staff are not blocked.</b> A live staff session (console, preview-as-participant) passes whatever the enabled
/// set: planners prepare and preview content before enabling a channel. This only skips the enablement check; it
/// grants nothing else, and the wrapped handler's own scope and role gates still apply. Staff identity comes from
/// <see cref="ICurrentStaffSessionAccessor"/>, which yields a session only for a live staff-kind row, so a
/// participant or shared read-only session can never claim it.
/// </para>
/// <para>
/// <b>Indistinguishable 404 (XC-001/XC-002).</b> The result is <c>Results.NotFound()</c> with no body, what the host
/// returns for an unknown route, so a participant cannot probe which channels exist but are switched off. An
/// unresolved scope also 404s here (the enablement read fails closed).
/// </para>
/// <para>No constructor dependencies beyond the channel id: services resolve from the request scope.</para>
/// </remarks>
internal sealed class ChannelEnablementEndpointFilter : IEndpointFilter
{
    private readonly string _channelId;

    /// <summary>Creates the filter for one catalogued channel.</summary>
    /// <param name="channelId">The channel the wrapped routes belong to.</param>
    public ChannelEnablementEndpointFilter(string channelId) => _channelId = channelId;

    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var services = context.HttpContext.RequestServices;
        var cancellationToken = context.HttpContext.RequestAborted;

        var staffSession = await services.GetRequiredService<ICurrentStaffSessionAccessor>()
            .GetCurrentStaffSessionAsync(cancellationToken);
        if (staffSession is not null)
        {
            return await next(context);
        }

        var enabled = await services.GetRequiredService<IChannelEnablement>().IsEnabledAsync(_channelId, cancellationToken);
        return enabled ? await next(context) : Results.NotFound();
    }
}
