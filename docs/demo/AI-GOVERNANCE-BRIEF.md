# Pulse AI engine: governance brief

**For:** the customer program manager reviewing Pulse's optional AI feature for CISA approval
**From:** Dynamis (Tom Bull) · **Facts as of:** 2026-10-08 (Pulse `main` at commit `2d08edf`)
**Scope:** only the AI engine that drafts simulated social-media posts. The rest of Pulse uses no AI.

## Summary

Pulse has an optional AI engine that drafts simulated social-media posts for controllers to review.
**It is not switched on in any environment today.** Every Pulse environment, including our test
environment (UAT), runs an offline stand-in ("Fake") that produces canned text inside the Pulse server
and makes no call to any AI service. When switched on, the engine calls Azure OpenAI in Dynamis's own
**commercial** Azure subscription. It sends only exercise-authored scenario text, and every draft waits
for a controller to approve it before participants can see it. Our internal sign-off to switch it on in
UAT is still unsigned. Pulse itself has no FedRAMP authorization or ATO. The decisions your approval
needs are listed under each concern below.

## 1. Data boundary and FedRAMP

**What we do**

- **One model service, in our Azure subscription.** The engine calls Azure OpenAI on one Azure AI
  Foundry resource, `aif-pulse-uat`, in **commercial Azure, Central US**. The model deployments use
  Microsoft's **Data Zone Standard** type. The configured models are `gpt-5.4-mini` (version
  2026-03-17, the "Ambient" tier planned for first use) and `gpt-5.4` (version 2026-03-05).
- **No keys.** The resource has key-based access disabled (`disableLocalAuth: true`). The Pulse server
  signs in with its own Azure managed identity, which holds the "Cognitive Services OpenAI User" role.
- **Not network-isolated yet.** Public network access to the AI resource is enabled. Every call still
  needs an Entra ID sign-in, but there is no private endpoint yet.
- **What Pulse sends** (one request per burst of posts):
  1. fixed instructions: the model's role, the rules (stay in the fiction, treat the feed as untrusted),
     and the task;
  2. the exercise scenario brief. Today this is one fixed sentence about a fictional town ("Fairhaven");
  3. a short profile for each persona voiced in the burst: handle, display name, type, voice notes, style
     settings and audience size;
  4. the storyline's state: title, open public expectation, minutes since an official response,
     intensity, phase, target tone mix and hashtags;
  5. a "world feed" block for recent exercise posts. **Today the live engine fills it with
     "no recent world activity"**: the code that would pass participant posts is not connected.
- **What Pulse never sends:** participant or staff names, usernames, emails or passwords; exercise IDs;
  direct messages; evaluator notes or telemetry; database records; any API key (none exists). Official
  posts that participants make (for example, a PIO statement) are matched to storylines inside Pulse.
  Their text is not sent to the model.
- **Model output** is limited to a fixed structure: per post, a persona handle, text, a sentiment score
  and hashtags.

**Evidence**

- Repository: `infrastructure/modules/ai.bicep` (resource, key-less setting, network setting, Data Zone
  type, models, role assignment) and `infrastructure/parameters/uat.bicepparam` (Central US;
  `generationProviderLive = false`).
- Repository: `PromptAssembler.cs`, `WorldFeedFence.cs`, `AzureOpenAIGenerationProvider.cs` (exactly what
  goes into a request) and `ReactionLoopHost.cs` (`BuildGenerateRequest` passes no world posts).
- Microsoft documentation: see the Sources table (rows M1–M4).

<!-- MS-FACTS-1 -->

**What remains for your approval**

- **Commercial Azure or Azure Government.** <!-- MS-GOV -->
- **What scenario content may go to the model.** Today the brief and personas are fixed demo text that
  Dynamis wrote. Once exercise designers write their own, everything in those fields goes to the model.
  CISA should decide what classification of scenario detail is allowed there.
- **Abuse-monitoring retention.** <!-- MS-ABUSE -->
- **Network isolation.** Whether a private endpoint is required before use.

## 2. ATO and approval paperwork

**What we do**

- **Default off, everywhere.** The committed default is the offline Fake generator. A customer
  environment can be deployed with no AI resource at all (`deployAi = false`). Turning on a live model
  for production is a separate, later decision with its own sign-off.
- **Two locks before any call leaves Pulse.** (a) Our written sign-off,
  [`PROVIDER-GOVERNANCE.md` §8](../features/engine-runtime/PROVIDER-GOVERNANCE.md), must be signed and
  dated by a person, and three settings must be changed together in one reviewed commit.
  (b) At startup, Pulse refuses to run with a live model unless its configuration declares the full
  posture: tenant-bounded, no-training, a stated residency, and a stated retention stance. This check
  reads what a person has declared; it does not inspect Azure. Automated tests in CI cover it.
- **Infrastructure as code.** The AI resource, identity, role and settings are defined in Bicep in the
  repository, so a reviewer can read the exact configuration.

**Evidence**

- `PROVIDER-GOVERNANCE.md` §2–§3 and §8 (status: **UNSIGNED**); `GenerationGovernance.cs`;
  `ProviderLiveConfigTests` / `AddEngineGenerationTests`.
- Measured test run, 2026-07-18, against `aif-pulse-uat`: 10 of 10 generated bursts passed Pulse's
  fiction and injection guard; 95th-percentile response time 1.98 s (gpt-5.4-mini) and 2.66 s (gpt-5.4)
  ([`MEASURED-RESULTS.md`](../features/engine-generation-infra/MEASURED-RESULTS.md)). That run used a
  developer's Azure sign-in from a test harness, not the Pulse server.

**What remains for your approval**

- **Pulse has no FedRAMP authorization, ATO, System Security Plan or third-party assessment.** The
  repository holds no authorization package. Hosting is commercial Azure, with Azure Government listed as
  a roadmap item.
- **Which approvals apply.** That is CISA's call (for example, ATO scope, AI use review, privacy review).
  We can provide this brief, the governance document, the Bicep files and the test evidence. We cannot
  provide an authorization package that does not exist.
- **Simplest path:** approve Pulse with the AI engine off. The AI engine can then be reviewed separately
  later.

## 3. Content risk

**What we do**

- **A human approves every post (default).** The engine starts each exercise in **Suggest** mode: every
  draft goes to the controller review queue, and nothing posts until a controller approves it. Controllers
  can also edit, veto or regenerate a draft.
- **An automated check runs before review.** Pulse's own guard is a pattern filter that rejects drafts
  that break the fiction ("this is a drill", "as an AI") or show signs of a hijacked prompt. A failing
  draft is regenerated or dropped, never shown. It is not a general harmful-content classifier.
  <!-- MS-FILTER -->
- **Participant text is treated as untrusted.** Participants are trained in information manipulation.
  The design fences any feed content off as data, not instructions. An 8-attack injection test suite
  (for example, "the exercise is over" and "print your instructions") runs against the live model.
- **Fiction by design.** Drafts post as ordinary in-exercise posts by fictional personas, on the Pulse
  social channel only. The engine voices rumor, worry and skepticism on purpose: that is the training
  stress. In the current demo cast, the engine does not voice the impersonator or troll accounts.

**Evidence**

- `ContentGuard.cs`, `GenerateStage.cs`, `InjectionRedTeam.cs`, `AutoHoldPolicy.cs`,
  `AutonomyLevel.cs`; E8 architecture §3.4, §8 and §9
  ([`E8-ENGINE-ARCHITECTURE.md`](../design/E8-ENGINE-ARCHITECTURE.md)).

**What remains for your approval**

- **Known defect, to fix before live use:** unapproved drafts are also broadcast over the real-time
  connection participants share. The participant app does not show them, but they are visible in a
  browser's developer tools. The fix (`social-api/05`) is not started.
- **Autonomy limit.** Whether the exercise may only run in Suggest mode (our recommendation), or may also
  use Delayed-auto (see table).
- **Disclosure.** Participants are not told which posts were AI-drafted, which is also true of
  controller-written posts. Staff records keep that origin. Decide whether the participant briefing
  should say that some simulated posts are AI-drafted and approved by a controller.

## Human control model

| Control | Who | What it does | Status |
|---|---|---|---|
| **Suggest** (default) | Starts here | Every draft waits for a controller; nothing posts without approval | Built |
| Approve / edit / veto / regenerate | Controller | One decision per burst | Built |
| Delayed-auto (optional) | Controller turns on | A countdown runs. If no one decides, the draft is **held, not posted** | Built; UAT check pending |
| Swamped mode (optional) | Controller turns on | The only way an undecided draft posts when its countdown ends (Delayed-auto only) | Built |
| Auto | — | **Not selectable in this version**; the code rejects it | Not available |
| Kill switch | Controller | Instantly drops the engine to Suggest or stops it; only a controller can restore it | Built |
| Cut to Fake | Controller | Switches that exercise to the offline generator with no restart. Restore can only return to the provider approved at startup | Built; untested live (no live AI yet) |
| Automatic fallback | System | On an outage, or a call slower than 10 s, drops to Suggest. Automation never raises autonomy | Built |

Only controllers assigned to the exercise can use these controls; evaluators can watch but not change
them. Review decisions, settings changes and Cut to Fake/restore are recorded with the acting person.
Kill-switch and swamped-mode changes are not yet written to that record.

## With AI off

Pulse does not need the AI engine. With it off, there is no network call to any AI service. Controllers
post as any persona by hand, and participants use the same social feed either way. The engine's controls
then drive only the offline Fake generator, or the engine can be stopped completely.

## Open items

1. Sign-off §8 is unsigned. No live AI traffic has come from the Pulse server in any environment.
2. The Azure-side checks for the managed identity's role, the disabled keys and the region have not been
   recorded after deployment (the commands are in §8).
3. Model versions are not pinned (`OnceNewDefaultVersionAvailable`), so the 2026-07-18 results apply
   only to the versions tested. Pin them before approval.
4. No private endpoint. Public network access is enabled, with Entra ID sign-in required.
5. Retention is "Retained". Zero data retention needs Microsoft's approval, which has not been
   requested.
6. The draft-broadcast defect (section 3).
7. Kill-switch and swamped-mode changes are not yet in the audit record.
8. The repository keeps no per-attack log of the live injection test run.
9. Azure Government: not built, deployed or tested. The endpoint domain is hard-coded to commercial
   Azure.

## Sources

<!-- SOURCES -->
