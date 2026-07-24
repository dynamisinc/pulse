# xUnit v2 → v3 migration plan

> **Tracking issue:** #334 · **Status:** Planned (not started) · **Owner:** TBD
>
> A deliberate, isolated migration of the .NET test projects from xUnit **v2** to **v3**, to be done
> **while the backend test suite is still small** — the blast radius only grows. This doc is the scope;
> the work is a separate PR (or a short series) that follows it.

## Why now

- The test surface is **150 files / 920 test attributes** today. A v3 cutover is mostly mechanical, but
  every `IAsyncLifetime` and `ITestOutputHelper` touchpoint changes — doing it later means many more.
- It removes a concrete wart: `RequiresDockerFactAttribute` is a discovery-time skip hack that exists
  **only because xUnit v2 has no runtime `Assert.Skip(...)`** (v3 adds it). v3 lets us delete it.
- xUnit v2 is in maintenance; v3 is the supported line (modern **Microsoft.Testing.Platform** execution
  model, better isolation/parallelism controls).

## Current state (measured)

| | Value |
|---|---|
| Test projects | `src/Pulse.WebApi.Tests`, `src/Pulse.Core.Tests` |
| `xunit` | **2.9.3** (latest v2) — both projects |
| `xunit.runner.visualstudio` | 3.1.4 (independent versioning; 3.x already supports v2 **and** v3) |
| `Microsoft.NET.Test.Sdk` | 17.14.1 (VSTest host) |
| `coverlet.collector` | 6.0.4 |
| Other (WebApi.Tests) | `Testcontainers.MsSql` 4.13.0, `Microsoft.AspNetCore.Mvc.Testing` 10.0.10, `Microsoft.AspNetCore.SignalR.Client` 10.0.10, `Microsoft.EntityFrameworkCore.InMemory` 10.0.10, Moq 4.20.72, FluentAssertions 6.12.0 |
| SDK (`global.json`) | 10.0.100, `rollForward: latestFeature` |
| CI test step | `dotnet test pulse.slnx --configuration Release --no-build` (`.github/workflows/ci.yml`), ubuntu-latest |

**v2-specific API surface to migrate (measured across both projects):**

| Surface | Count | v3 impact |
|---|---:|---|
| `IAsyncLifetime` implementers | 17 files | `InitializeAsync`/`DisposeAsync` return **`ValueTask`** (was `Task`); the interface now extends `IAsyncDisposable`. Mechanical signature change. Includes `MsSqlContainerFixture`. |
| `ITestOutputHelper` users | 21 files | Namespace moves **`Xunit.Abstractions` → `Xunit`**. Import change (`Xunit.Abstractions` is largely gone in v3). |
| `IClassFixture` / `ICollectionFixture` / `[CollectionDefinition]` | 32 files | Largely source-compatible; verify collection/assembly-fixture behavior after the swap. |
| Custom `FactAttribute` subclass | 1 (`RequiresDockerFactAttribute`) | v3's attribute/discovery model changed; this is the **cleanup opportunity** (see below). |
| Source use of `Xunit.Sdk` | 0 (only in `bin/`) | No deep SDK extensions to port — good. |

## Recommended approach: keep the VSTest bridge (minimize blast radius)

xUnit v3 runs natively on **Microsoft.Testing.Platform (MTP)**, but `xunit.runner.visualstudio` 3.x
(already referenced) **bridges v3 to VSTest**, so `dotnet test` and `coverlet.collector` keep working
**unchanged**. Recommend a **two-step** migration so the risky runner/coverage change is optional and
separate:

- **Step 1 (this migration):** swap packages to v3, keep the VSTest bridge + `Microsoft.NET.Test.Sdk` +
  `coverlet.collector`, keep the CI `dotnet test` invocation **byte-for-byte**. Port the API deltas.
- **Step 2 (optional, later):** adopt MTP natively — drop `Microsoft.NET.Test.Sdk`, switch coverage to
  `Microsoft.Testing.Extensions.CodeCoverage` (or coverlet's MTP integration), and update the CI step.
  Deliberately **out of scope** here; only do it if MTP's runner/perf is worth the CI change.

## Migration steps (Step 1)

1. **Packages** (both `.csproj`): replace `xunit` 2.9.3 → **`xunit.v3`** (latest). Keep
   `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk`, `coverlet.collector`. The `xunit.v3` package
   makes the test project an executable — verify no `OutputType`/entry-point conflict (the meta package
   handles it; `Pulse.WebApi.Tests` also references `Pulse.WebApi`, which is fine).
2. **`ITestOutputHelper` (21 files):** change `using Xunit.Abstractions;` → `using Xunit;` (or remove the
   using where `Xunit` is already imported). No behavioral change.
3. **`IAsyncLifetime` (17 files):** change `async Task InitializeAsync()` → `async ValueTask
   InitializeAsync()` and `async Task DisposeAsync()` → `async ValueTask DisposeAsync()`. Specifically
   includes `src/Pulse.WebApi.Tests/Data/MsSqlContainerFixture.cs` (both methods) and every
   `WebApplicationFactory`-adjacent fixture that implements the interface.
4. **`RequiresDockerFactAttribute` (the payoff):** replace the discovery-time `Skip`-in-constructor hack
   with either
   - v3's declarative conditional skip: `[Fact(SkipUnless = nameof(SqlTargetAvailable))]` referencing a
     `public static bool SqlTargetAvailable` (Docker probe **or** `PULSE_TEST_SQL_CONNECTION`, preserving
     the local-SQL path from #333), **or**
   - a runtime `Assert.Skip("no SQL target")` guard.
   Keep the W-001 guarantee: a missing SQL target must still report **Skipped**, never a false Passed.
   (Left as its own follow-up if we want to land the package swap first with the attribute untouched —
   the `Skip` property still works in v3, so the hack keeps functioning until we choose to remove it.)
5. **Fixtures / collections (32 files):** build, then run; fix any collection/assembly-fixture ordering
   or `IAsyncLifetime`-on-fixture fallout surfaced by the compiler or a failed run.
6. **`xunit.runner.json`** (if present) / parallelization attributes: verify they carry over; v3 changed
   some defaults (e.g. assembly-level parallelism).
7. **Third-party:** Moq, FluentAssertions, Testcontainers, `Mvc.Testing`, EF InMemory are runner-agnostic
   — no changes expected; confirm by running.

## Risks & mitigations

- **Testcontainers + `WebApplicationFactory<Program>` under v3** — the highest-value integration path.
  Mitigation: run the full `[RequiresDockerFact]` suite (locally via the #333 LocalDB path, and in CI via
  Docker) before merge; it's the exact code that would break.
- **Coverage output shape changes** if the runner changes — avoided by keeping the VSTest bridge in Step 1.
- **`ValueTask` reuse pitfalls** — don't await a `ValueTask` twice; the fixture methods are single-await, so
  low risk. Spot-check any helper that stores a lifecycle task.
- **Rollback:** Step 1 is a package + mechanical-edit change on one branch; revert the branch if the v3
  suite isn't green. No product code is touched.

## Acceptance

- [ ] Both test projects reference `xunit.v3`; solution builds `--configuration Release`.
- [ ] `dotnet test pulse.slnx` green locally (with `PULSE_TEST_SQL_CONNECTION` set) **and** in CI (Docker),
      with the **same skipped/passed counts** as today modulo the intended `RequiresDockerFact` change.
- [ ] Coverage still collected (coverlet via the VSTest bridge).
- [ ] CI `ci.yml` backend job unchanged (or its diff limited to the runner if Step 2 is folded in).
- [ ] `RequiresDockerFactAttribute` simplified to runtime/declarative skip (or explicitly deferred with a note).

## Effort

Roughly **M** — ~150 files, but the per-file edits are mechanical (import swap, `Task`→`ValueTask`) and
grep-drivable. The real time is in verifying the Testcontainers integration path and the runner/coverage
wiring, not in the edits. Best done as **one focused PR** (Step 1), with Step 2 (native MTP) as a separate
optional follow-up.
