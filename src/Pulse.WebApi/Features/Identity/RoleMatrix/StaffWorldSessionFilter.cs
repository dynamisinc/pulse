namespace Pulse.WebApi.Features.Identity.RoleMatrix;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The self-service STAFF-WORLD gate (identity-auth-roles/17, Copilot review 6 fold; ADMIN-IDENTITY-MODEL §8.2): the
/// route is open to every live staff-kind session — evaluators and org-scope org admins included — and to nothing
/// else. A participant (link or day-word) or shared read-only session is refused with <c>401</c> BEFORE the body is
/// validated, so a non-staff session can never probe or switch into staff privileges, even when the same person
/// holds a staff enrollment elsewhere.
/// </summary>
public sealed class StaffWorldSessionFilter : IEndpointFilter
{
    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var staff = await context.HttpContext.RequestServices.GetRequiredService<ICurrentStaffSessionAccessor>()
            .GetCurrentStaffSessionAsync(context.HttpContext.RequestAborted);

        return staff is null ? Results.Unauthorized() : await next(context);
    }
}
