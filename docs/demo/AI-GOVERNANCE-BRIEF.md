# Pulse AI engine: governance brief

**For:** the customer program manager reviewing Pulse's optional AI feature for CISA approval ·
**From:** Dynamis (Tom Bull) · **Facts as of:** 2026-10-08 (Pulse `main` at `2d08edf`; Microsoft pages
retrieved the same day). References such as [R1] and [M1] point to the sources at the end.

## Summary

Pulse has an optional AI engine that drafts simulated social-media posts for controllers to review. **It
is switched off in every environment today.** Each one, including our test environment (UAT), runs an
offline stand-in ("Fake") that writes canned text inside Pulse and calls no AI service. When switched on,
the engine calls Azure OpenAI in Dynamis's **commercial** Azure subscription. Microsoft lists that service
within commercial Azure's FedRAMP High authorization [M6], but **Pulse itself has no FedRAMP authorization or ATO**. The
engine sends scenario text only, never participant identities. By default, nothing it drafts posts until a
controller approves it. Our internal sign-off to switch it on is still unsigned [R1]. Pulse works fully
without it.

## 1. Data boundary and FedRAMP

**What we do**

- **Where the AI runs.** One Azure AI Foundry resource in commercial Azure, Central US. Our
  infrastructure code requests `gpt-5.4-mini` (2026-03-17) and `gpt-5.4` (2026-03-05) [R2][R3][M5].
  Auto-upgrade is on, so the live versions may differ (Open item 3). All of Pulse is hosted in
  commercial Azure [R3].
- **US-only processing.** We use Microsoft's "Data Zone Standard" deployment type. For a US resource,
  "prompts and responses may be processed anywhere within the United States", and stored data stays in
  the resource's geography [M1][M4]. Microsoft may add regions to the US zone without notice [M4].
- **No training.** Microsoft states prompts and completions are "NOT available to OpenAI" and "NOT used to
  train any generative AI foundation models without your permission or instruction" [M1][M13].
- **Key sign-in disabled; no private network.** Key-based access to the resource is disabled
  (`disableLocalAuth`), so calls must use Entra ID. Pulse signs in with its own Azure managed identity
  ("Cognitive Services OpenAI User" role) and holds no API key. Public network access is enabled (Entra ID sign-in is
  still required), and there is no private endpoint [R2].
- **What goes to the model** [R4][R5]:
  - fixed instructions;
  - the scenario brief, which today is one sentence about a fictional town;
  - profiles of the personas being voiced: handle, name, type, voice notes, style;
  - the storyline's state: title, the unanswered public concern, minutes since an official response,
    intensity, tone, hashtags.

  A slot exists for recent exercise posts. **Today it is always sent as "no recent world activity"**.
- **What never goes to the model** [R4][R5]: participant or staff names, usernames, emails or passwords;
  exercise IDs; direct messages; evaluator data; telemetry; API keys (Pulse holds none). Pulse matches official responses (for
  example, a PIO's post) to storylines itself, without sending them to the model.

**What remains for your approval**

- **Commercial Azure or Azure Government.**
  - **Coverage.** Microsoft lists Azure OpenAI as FedRAMP High in commercial Azure, and as FedRAMP High
    plus DoD IL2, IL4 and IL5 in Azure Government [M6]. The listing is per service; it does not name model
    versions.
  - **Azure Government's extra control.** Access to systems processing customer data is limited to
    "screened US persons" [M7][M8].
  - **Pulse's own authorization.** Microsoft says customers "need to achieve your own authorizations for
    components outside these services" [M7]. That means Pulse.
  - **If CISA requires Azure Government**, none of the following is built or estimated:
    - host in US Gov Arizona or Virginia [M9][M10];
    - switch models: `gpt-5.4` and `gpt-5.4-mini` are **not** on Microsoft's Azure Government list (it
      includes gpt-5.6, gpt-5.1, gpt-4.1, gpt-4.1-mini and gpt-4o) [M9], then re-run our evaluation [R1];
    - change Pulse's endpoint configuration, because the commercial domain is hard-coded [R3][M8];
    - take on detecting misuse ourselves, because "not all features of Abuse Monitoring are enabled"
      there [M10].
- **Microsoft abuse monitoring.** If Microsoft's systems detect signs of misuse, a sample of prompts and
  outputs may be stored in the resource's geography for review by authorized Microsoft employees [M1].
  Microsoft's current pages state neither how long this data is kept nor where US reviewers sit. Only
  customers "managed by a Microsoft account team or under an eligible program" can apply to opt out
  [M2][M3]. We have not applied [R1].
- **Scenario content.** Today the brief and personas are fixed demo text that Dynamis wrote. Once your
  designers write their own, CISA should set what detail may go in those fields.
- **Network.** Decide whether a private endpoint is required.

## 2. ATO and approval paperwork

**What we do**

- **Off by default.** The default everywhere, including automated tests, is the offline generator. A
  customer environment can be deployed with no AI resource at all. A live model in production needs its
  own sign-off [R3][R11].
- **Two locks.** First, a person must sign our governance sign-off, and three settings then change
  together in one reviewed commit [R1]. Second, Pulse will not start with a live model unless its
  configuration declares the posture: tenant-bounded, no-training, residency and retention. This check
  reads what a person declared; it does not inspect Azure [R1][R6].
- **Readable configuration.** The resource, identity, role and settings are defined as code in the
  repository [R2][R3].
- **Test evidence.** On 2026-07-18, 10 of 10 bursts generated by the UAT models passed Pulse's guard.
  The 95th-percentile response time was 1.98 s for `gpt-5.4-mini` and 2.66 s for `gpt-5.4`. That run
  used a developer's sign-in from a test harness, not the Pulse server [R7].

**What remains for your approval**

- **No authorization package.** Pulse has no ATO, System Security Plan or third-party assessment, and the
  repository contains no authorization package. Azure Government is a roadmap item [R11].
- **Which reviews apply** (for example ATO scope, AI use review, privacy review) is CISA's call. We can
  supply this brief, the governance document, the infrastructure code and the test evidence.
- **Simplest path.** Approve Pulse with the engine off, and review the engine separately later.

## 3. Content risk

**What we do**

- **A person decides on each burst.** Exercises start in **Suggest** mode. Each draft burst (a few posts
  from different personas) waits in the review queue. A controller approves, vetoes or regenerates it as
  a unit, or rewrites its lead post and publishes it in the same action [R8].
- **Two automated checks first.**
  - **Microsoft's default safety policy** applies, because Pulse sets no custom one. It screens prompts and
    outputs for hate, violence, sexual and self-harm content at "Medium" severity, and lists jailbreak
    detection on prompts [M11].
  - **Pulse's own pattern filter** catches broken fiction ("this is a drill", "as an AI") and signs of a
    hijacked prompt. It regenerates or drops a failing draft before anyone sees it [R9].

  Neither check is the last line of defense. If Microsoft's filter is unavailable, a request "still
  completes without content filtering" [M12], and Pulse does not detect that case.
- **Participant text is untrusted.** The design fences feed content off as data, not instructions. An
  8-attack injection test set, including "the exercise is over", can be run against the live model
  [R9].
- **Fiction by design.** Approved drafts post as fictional personas on the social channel only. Rumor and
  worry are intended, because they are the training stress. In the current demo cast, the engine does
  not voice the impersonator or the rumor outlet [R5].

**What remains for your approval**

- **A known defect to fix before live use.** Unapproved drafts are also sent over the real-time
  connection participants share. The app does not show them, but browser developer tools do. The fix is
  not started [R10].
- **Autonomy.** Allow Suggest only (our recommendation), or also Delayed-auto.
- **Disclosure.** Participants cannot tell AI-drafted posts from controller-written ones; staff records
  can. Decide whether the participant briefing should say so.

## Human control model

| Control | Who | Effect | Status [R8] |
|---|---|---|---|
| **Suggest** (default) | Starts here | Nothing posts without a controller's approval | Built |
| Approve / edit / veto / regenerate | Controller | One decision per burst | Built |
| Delayed-auto | Controller opts in | A countdown runs; if nobody decides, the draft is **held, not posted** | Built; UAT check pending |
| Swamped mode | Controller opts in | The only way an undecided draft posts when its countdown ends | Built |
| Auto | n/a | **Cannot be selected in this version** | Not available |
| Kill switch | Controller | Drops to Suggest or stops at once; only a controller can lift it | Built |
| Cut to Fake | Controller | Switches the exercise to the offline generator with no restart; restore returns only to the approved model | Built; untested with a live model |
| Automatic fallback | System | Drops to Suggest when at least half of 10 or more calls fail or take over 10 s; never raises autonomy | Built |

Only controllers assigned to the exercise can use these controls. Review decisions, settings changes and
cut/restore are logged with the acting person.

## With AI off

Pulse does not need the engine. With it off, Pulse makes no AI calls. Controllers post as any persona by
hand, and participants use the same feed. The engine can run on the offline generator or be stopped
[R3][R8][R10].

## Open items (beyond those above)

1. The Pulse server has never sent live AI traffic, because the sign-off is unsigned [R1][R11].
2. The repository has no record of the post-deployment Azure check: key-based access disabled, role
   assigned, region correct and live model versions as tested ([R1] §6, §8).
3. Model versions can auto-upgrade, so the July results apply only to the versions tested. Pin them
   before approval [R1][R2].
4. Kill-switch and swamped-mode changes are not logged yet. Settings and cut/restore log entries are
   best-effort: if the write fails, the change still applies [R8].
5. No per-attack log of the live injection test run is kept [R7].

---

## Sources

**Pulse repository** (`dynamisinc/pulse`, `main` at `2d08edf`)

| Ref | Source |
|---|---|
| R1 | `docs/features/engine-runtime/PROVIDER-GOVERNANCE.md` (§2 contract, §3 startup gate, §6 re-run triggers, §8 sign-off: **UNSIGNED**) |
| R2 | `infrastructure/modules/ai.bicep` (`disableLocalAuth: true`, `publicNetworkAccess: 'Enabled'`, `DataZoneStandard`, models and versions, `versionUpgradeOption`, role assignment) |
| R3 | `infrastructure/parameters/uat.bicepparam` (`location = 'centralus'`, `deployAi = true`, `generationProviderLive = false`); `infrastructure/main.bicep` (Fake unless both toggles are set; commercial endpoint domain) |
| R4 | `src/Pulse.Core/Features/Generation/Services/PromptAssembler.cs`, `WorldFeedFence.cs`, `AzureOpenAIGenerationProvider.cs` |
| R5 | `src/Pulse.WebApi/Features/EngineRuntime/ReactionLoopHost.cs` (`BuildGenerateRequest` passes no world posts; official posts matched locally); `Ops/EngineContentSeed/EngineContentSeedService.cs`, `PersonaCastSeeder.cs` |
| R6 | `src/Pulse.Core/Features/Generation/Services/GenerationGovernance.cs`; `ProviderLiveConfigTests`, `AddEngineGenerationTests` |
| R7 | `docs/features/engine-generation-infra/MEASURED-RESULTS.md` (run of 2026-07-18) |
| R8 | `AutonomyLevel.cs`, `AutoHoldPolicy.cs`, `EngineReviewService.cs`, `EngineCockpitControllerRoleFilter.cs`; `docs/features/autonomy-safety/03-kill-switch.md`, `07-cut-to-fake-provider.md` (#402); `engine-generation-infra/05-degraded-mode-fallback.md` |
| R9 | `ContentGuard.cs`, `GenerateStage.cs`, `InjectionRedTeam.cs`, `LiveInjectionRedTeamTests.cs`; `docs/design/E8-ENGINE-ARCHITECTURE.md` §3.4, §8, §9 |
| R10 | `docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md` (scorecard); `docs/features/social-api/05-realtime-role-scoped-groups.md` (Not Started); `EngineReviewBroadcaster.cs` |
| R11 | `docs/00-MASTER-PRD.md` NFR-005, NFR-006; `docs/features/engine-runtime/05-live-provider-uat-golive.md` (no live traffic yet; production out of scope) |

**Microsoft documentation** (all retrieved 2026-10-08; "page date" is the page's own `ms.date`)

| Ref | Page | Page date |
|---|---|---|
| M1 | [Data, privacy, and security for Models sold by Azure](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy) | 2026-05-18 |
| M2 | [Abuse monitoring](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/abuse-monitoring) | 2026-05-13 |
| M3 | [Limited access](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/limited-access) | 2023-11-03 |
| M4 | [Deployment types](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types) | 2026-08-06 |
| M5 | [Model region availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability) (gpt-5.4 and gpt-5.4-mini under Data Zone Standard in centralus) | 2026-09-03 |
| M6 | [Azure services in FedRAMP and DoD audit scope](https://learn.microsoft.com/en-us/azure/azure-government/compliance/azure-services-in-fedramp-auditscope) | 2026-09-21 |
| M7 | [FedRAMP compliance offering](https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-fedramp) | 2023-04-04 |
| M8 | [Compare Azure Government and global Azure](https://learn.microsoft.com/en-us/azure/azure-government/compare-azure-government-global-azure) | 2025-08-21 |
| M9 | [Models sold by Azure in Azure Government](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-gov) | 2026-09-01 |
| M10 | [Deployment types in Azure Government](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types-gov) | 2026-04-03 |
| M11 | [Default Guardrail policies for Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/default-safety-policies) | 2026-05-31 |
| M12 | [Content filtering (classic)](https://learn.microsoft.com/en-us/azure/foundry-classic/foundry-models/concepts/content-filter) | 2026-08-04 |
| M13 | [Microsoft Product Terms, Universal License Terms for Online Services](https://www.microsoft.com/licensing/terms/product/ForOnlineServices/EAEAS) | none shown |

## Not verified

These items are deliberately not stated as fact in this brief:

- **How long Microsoft keeps abuse-monitoring data.** The current pages [M1][M2] give no period. Older
  guidance cited 30 days; it is not repeated here.
- **Where Microsoft's human reviewers sit for US commercial deployments, and whether they are US
  persons.** [M1] specifies location only for the European Economic Area.
- **Whether FedRAMP High coverage is stated for specific models** (gpt-5.4, gpt-5.4-mini) or deployment
  types. [M6] lists services only.
- **The current FedRAMP Marketplace listing.** fedramp.gov was not checked. Microsoft's pages still refer
  to a JAB-issued P-ATO.
- **Azure Government onboarding and eligibility**, and whether the abuse-monitoring opt-out exists there.
- **Whether Microsoft's jailbreak detection blocks a request or only flags it by default.** [M11] lists
  it; Microsoft's classic content-filter page [M12] calls it optional.
- **The live Azure state of `aif-pulse-uat`:** role assignment, key-based access setting, region and
  current model versions. There was no Azure access from the session that wrote this brief (see Open item 2).
- **Per-attack results of the live injection test** (Open item 5).
- **Whether any Dynamis-level security documents** (for example, from COBRA) apply to Pulse. Tom to
  confirm.
