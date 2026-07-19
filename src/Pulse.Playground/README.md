# Pulse.Playground

A **developer harness** for poking at backend domain logic by hand — not a shipped artifact
(`IsPackable=false`, not referenced by any host).

There's no runtime yet (no reaction-loop, no E7 cockpit, no E2 publish), so this drives the pure
domain model directly to make its behavior tangible.

## Run it

```bash
dotnet run --project src/Pulse.Playground
```

## What it shows (E8 storyline model)

A narrated scenario timeline over a fake scenario clock (`IScenarioClock`):

- **Silence → escalation → resolution:** a storyline seeded, its silence window elapsing into
  `ESCALATING`, amplification bending intensity up to `PEAK`, the `StorylineBrief` the generation
  prompt would receive, then a matched official response bending it down through `DECAYING` to
  `RESOLVED`.
- **The dial (CTL-022):** a controller lowering then raising the target intensity, with the engine
  driving `actual → target` (never overshooting, never past a lowered target) and the decide-stage
  `IntentModulation` (raise/lower/hold).
- **Governance:** exercise-wide intensity-weighted sentiment, plus the rate cap and quiet floor.

Edit `Program.cs` to change curves, windows, amplification, or dial targets and re-run. The same
behavior is guarded in CI by `StorylineScenarioWalkthroughTests` in `Pulse.Core.Tests`.
