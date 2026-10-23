namespace Pulse.WebApi.Tests;

using System;
using System.Runtime.CompilerServices;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Process-wide defaults applied to EVERY <c>WebApplicationFactory&lt;Program&gt;</c> host this assembly builds, set before
/// any test runs. ASP.NET Core hosts read environment variables as configuration, so one place covers all ~56 test hosts.
/// </summary>
/// <remarks>
/// <b>Staff sign-in wall-clock floors are 0 in tests (#602 W1).</b> The production floors are
/// <see cref="StaffSignInTimingOptions"/>'s own non-zero defaults (750 ms org, 350 ms exercise-bound). Leaving them on
/// would add up to 0.75 s to every staff login in a suite of thousands of tests. The floor itself is proven
/// deterministically by <c>StaffSignInFloorTests</c> on an injected <see cref="TimeProvider"/>. The default-bound
/// production values are pinned by <c>StaffSignInTimingOptionsTests</c>. Funnels a test builds directly take
/// <c>TestSignInTiming.NoFloor</c>.
/// </remarks>
internal static class TestHostDefaults
{
    /// <summary>The environment variable form of <c>Authentication:StaffSignInTiming:OrgSignInFloorMilliseconds</c>.</summary>
    internal const string OrgFloorVariable = "Authentication__StaffSignInTiming__OrgSignInFloorMilliseconds";

    /// <summary>The environment variable form of <c>Authentication:StaffSignInTiming:ExerciseBoundSignInFloorMilliseconds</c>.</summary>
    internal const string ExerciseBoundFloorVariable = "Authentication__StaffSignInTiming__ExerciseBoundSignInFloorMilliseconds";

#pragma warning disable CA2255 // A test assembly is the entry point here, not a library consumed by others: this is the one hook every host shares.
    [ModuleInitializer]
#pragma warning restore CA2255
    internal static void Initialize()
    {
        Environment.SetEnvironmentVariable(OrgFloorVariable, "0");
        Environment.SetEnvironmentVariable(ExerciseBoundFloorVariable, "0");
    }
}
