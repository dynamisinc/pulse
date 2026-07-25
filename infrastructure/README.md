# Pulse Infrastructure (Azure / Bicep)

Infrastructure-as-code for Pulse, ported from Cadence and following the shared
Dynamis (Azure CAF) resource-naming scheme used by Cadence and C5.

- **Account:** DynamisCobra (`tbull@dynamiscobra.com`)
- **Subscription:** Shared SandBox (`2a127d53-c9bf-471a-8196-3155eae6cb1b`)
- **Region:** `centralus`
- **Resource group:** `rg-pulse-uat-centralus`

## Current cost posture — toggled per environment

Everything heavier than the Free-tier Static Web App is fully authored in
[`main.bicep`](main.bicep) but gated behind cost/feature toggles, all defaulting to `false` in the
template and flipped per environment in [`parameters/uat.bicepparam`](parameters/uat.bicepparam):

| Toggle | Turns on | `main.bicep` default | UAT today |
|---|---|---|---|
| `deployMonitoring` | Log Analytics + Application Insights | `false` | `true` |
| `deployStorage` | Storage account (blob media) | `false` | `false` |
| `deployDatabase` | Azure SQL server + database | `false` | `true` |
| `deployBackend` | App Service / Function App (per `hostingModel`) | `false` | `true` |
| `deploySignalR` | Azure SignalR Service (real-time fan-out) | `false` | `false` (hub self-hosted) |
| `deployCommunication` | ACS + Email Service | `false` | `false` |
| `deployAi` | Azure AI Foundry account + E8 model deployments (Standard/Ambient) | `false` | `true` |
| `generationProviderLive` | **Routes engine generation traffic to the live model** (`Generation:Provider` → `AzureOpenAI`). Separate from `deployAi` on purpose; **Tier-2 gated** | `false` | `false` |

The Static Web App **always** deploys. To scale up: flip the relevant toggles to `true`, set the
required secrets, and re-deploy — no template rewrite.

## Naming scheme (CAF abbreviations)

| Resource | Name |
|---|---|
| Resource group | `rg-pulse-uat-centralus` |
| Static Web App | `stapp-pulse-uat` |
| App Service Plan | `asp-pulse-uat` |
| Web App (API) | `app-pulse-api-uat-dynamis` |
| SQL Server | `sql-pulse-uat` |
| Storage | `stpulseuat` (no hyphens) |
| App Insights | `appi-pulse-uat` |
| Log Analytics | `log-pulse-uat` |
| SignalR | `sigr-pulse-uat` |
| Function App | `func-pulse-uat` |
| Communication Svc | `acs-pulse-uat` |
| Email Service | `email-pulse-uat` |
| AI Foundry | `aif-pulse-uat` |

## Deploy (manual, from repo root)

```bash
# 0. Point the CLI at the right account/subscription (the DynamisCobra creds are
#    already cached; this just switches the active context away from any default).
az account set --subscription "2a127d53-c9bf-471a-8196-3155eae6cb1b"   # Shared SandBox
az account show --query "{sub:name, user:user.name}" -o json           # verify

# 1. Resource group
az group create \
  --name rg-pulse-uat-centralus --location centralus \
  --tags Environment=uat Application=pulse ManagedBy=Bicep

# 2. Preview — must list ONLY Microsoft.Web/staticSites as a create
az deployment group what-if \
  --resource-group rg-pulse-uat-centralus \
  --template-file infrastructure/main.bicep \
  --parameters infrastructure/parameters/uat.bicepparam

# 3. Deploy
az deployment group create \
  --resource-group rg-pulse-uat-centralus \
  --template-file infrastructure/main.bicep \
  --parameters infrastructure/parameters/uat.bicepparam \
  --name "pulse-uat-bootstrap"
```

### Verify

```bash
az staticwebapp show -n stapp-pulse-uat -g rg-pulse-uat-centralus --query "{name:name, host:defaultHostname, sku:sku.name}" -o json
az resource list -g rg-pulse-uat-centralus -o table   # only the Static Web App
```

### Linter config

[`bicepconfig.json`](bicepconfig.json) disables `outputs-should-not-contain-secrets`: the
storage/database/signalr/staticwebapp modules deliberately surface connection strings and the
SWA deployment token as outputs (the contract the composed template consumes). `az bicep build`
is warning-free.

## CI/CD

Two `workflow_dispatch` / event-driven workflows under [`.github/workflows/`](../.github/workflows/):

| Workflow | Trigger | Purpose | Required secrets |
|---|---|---|---|
| [`deploy-infrastructure.yml`](../.github/workflows/deploy-infrastructure.yml) | manual | Runs the Bicep deploy (same flow as the CLI above) | `AZURE_CREDENTIALS`; once backend toggles are on: `SQL_ADMIN_PASSWORD`, `JWT_SECRET_KEY`, `EMAIL_CONNECTION_STRING`, `SECURITY_CONTACT_EMAIL`; for login go-live (story login/06): `BOOTSTRAP_SECRET`, `STAFF_IDENTITY_ACCOUNTS_JSON` |
| [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml) | push to `main` (`src/frontend/**`) + manual | Lints, type-checks, tests, builds the Vite SPA, publishes to `stapp-pulse-uat` | `AZURE_STATIC_WEB_APPS_API_TOKEN` |

The security-contact email for Defender is passed to `defender.bicep` directly from the
`SECURITY_CONTACT_EMAIL` CI secret — it is not a `main.bicep` parameter.

Get the Static Web App deployment token for the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret:

```bash
az staticwebapp secrets list -n stapp-pulse-uat -g rg-pulse-uat-centralus \
  --query "properties.apiKey" -o tsv
```

## Azure AI Foundry (E8 engine)

`deployAi = true` stands up `aif-pulse-uat` (Cognitive Services, kind `AIServices`) with two Azure
OpenAI model deployments — `standard` (storyline-critical) and `ambient` (bulk chatter). It is
**independent of `deployBackend`**, so the engine's generation endpoint can exist before the app host
does (e.g. for the story-06 measured cost/latency pass).

- **No keys.** `disableLocalAuth: true` — the data plane accepts only Entra ID / managed-identity
  tokens (`DefaultAzureCredential`). Nothing to leak; matches NFR-005.
- **Residency.** Model deployments default to the `DataZoneStandard` SKU (US data zone). Override
  `modelSkuName` per the customer's approved list.
- **Access is now wired for the App Service (engine-runtime/05).** `webapp.bicep` gives
  `app-pulse-api-uat-dynamis` a **system-assigned managed identity** and outputs its `principalId`;
  `main.bicep` passes it to `ai.bicep` as `backendPrincipalId`, which grants **Cognitive Services OpenAI
  User** (plus **Cognitive Services User** when `deployClaude` is set) on `aif-pulse-uat`. The runtime
  path therefore authenticates with `DefaultAzureCredential` using **no API key and no developer
  `az login`**. The dependency is one-directional — `ai` depends on `webApp`'s identity; `webApp` never
  reads `ai`'s outputs (see the `Generation:*` note below).
- **Access for a *local* pass (developer machine / `deployBackend = false`):** the role assignment is
  skipped when there is no App Service, so grant your own identity the data-plane role once:
  ```bash
  az role assignment create --role "Cognitive Services OpenAI User" \
    --assignee <your-object-id> \
    --scope $(az cognitiveservices account show -n aif-pulse-uat -g rg-pulse-uat-centralus --query id -o tsv)
  ```

### `Generation:*` app settings and the live-traffic gate (Tier-2)

**`deployAi` provisions; `generationProviderLive` routes.** They are two separate toggles by design — if
they were one, standing the Foundry account up would itself start real LLM egress before the NFR-005
sign-off. With the committed UAT posture (`deployAi = true`, `generationProviderLive = false`) the
endpoint exists, the App Service holds the data-plane role, the full `Generation:*` config is staged —
and `Generation__Provider` is still `Fake`, so no application code can reach the model.

`main.bicep` computes every governed value as a **plain local** (the account-name pattern, `location`,
the literal model ids) and passes the *same* literal into both `ai.bicep` and `webapp.bicep`
independently. `webapp.bicep` deliberately does **not** read `ai`'s outputs: `ai` already depends on
`webApp`'s `principalId`, so the reverse edge would be a module cycle Bicep rejects. Each key maps
verbatim to its `ai.bicep` output / §2 attestation per
[`PROVIDER-GOVERNANCE.md` §4](../docs/features/engine-runtime/PROVIDER-GOVERNANCE.md):

| App setting | Value (UAT, `deployAi = true`) | Source |
|---|---|---|
| `Generation__Provider` | `Fake` (→ `AzureOpenAI` only when `generationProviderLive = true`) | the live-traffic gate |
| `Generation__Endpoint` | `https://aif-pulse-uat.cognitiveservices.azure.com/` | `ai.bicep` `endpoint` |
| `Generation__ApiVersion` | `2025-04-01-preview` | data-plane client choice (not provisioned) |
| `Generation__Tiers__Standard__Deployment` | `ambient` ⚠ **TEMPORARY alias** | `ai.bicep` `ambientDeploymentName` |
| `Generation__Tiers__Standard__Model` | `gpt-5.4-mini` ⚠ **TEMPORARY alias** | `ai.bicep` `ambientModelName` |
| `Generation__Tiers__Ambient__Deployment` | `ambient` | `ai.bicep` `ambientDeploymentName` |
| `Generation__Tiers__Ambient__Model` | `gpt-5.4-mini` | `ai.bicep` `ambientModelName` |
| `Generation__Governance__TenantBounded` | `false` (→ `true` at signing) | §2 attestation — the **`generationTenantBounded` param, typed by the §8 signer** (single-tenant account, `disableLocalAuth`) |
| `Generation__Governance__NoTrainingAttested` | `false` (→ `true` at signing) | §2 attestation — the **`generationNoTrainingAttested` param, typed by the §8 signer** (Azure OpenAI product terms) |
| `Generation__Governance__Residency` | `centralus` | `ai.bicep` `residency` |
| `Generation__Governance__Retention` | `Retained` | §2 (ZDR pending per-subscription approval) |

⚠ **The Standard→Ambient alias is temporary.** The first live run is deliberately on the **Ambient**
tier (`gpt-5.4-mini`: ~3× cheaper, same 10/10 injection + voice-diversity results), but the reaction
loop has no runtime tier selector yet, so the Standard tier *key* is pointed at the Ambient
deployment. Remove it when `autonomy-safety/05` (engine settings API — runtime autonomy + tier policy,
#353) lands the real tier seam; tracked in
[`docs/features/engine-runtime/feature.md`](../docs/features/engine-runtime/feature.md).

#### ⚠ Deploy prerequisite: the CI service principal needs role-assignment write

`deployAi = true` makes `ai.bicep`'s `Cognitive Services OpenAI User` grant the **first**
`Microsoft.Authorization/roleAssignments` resource in the `main.bicep`-reachable deploy path. That write
is **not** covered by Contributor: an `AZURE_CREDENTIALS` service principal without
`Microsoft.Authorization/roleAssignments/write` on `rg-pulse-uat-centralus` fails the **whole**
deployment with `AuthorizationFailed` (the role assignment is a template resource, not a best-effort
step). Grant the SP **User Access Administrator** (least-privilege for this) or **Owner** on the resource
group before the first `deployAi = true` run:

```bash
# Check what the deploy SP currently holds on the RG:
az role assignment list --assignee <AZURE_CREDENTIALS clientId> \
  --scope /subscriptions/2a127d53-c9bf-471a-8196-3155eae6cb1b/resourceGroups/rg-pulse-uat-centralus \
  -o table

# If it is Contributor-only, add role-assignment write (scoped to the RG, not the subscription):
az role assignment create --role "User Access Administrator" \
  --assignee <AZURE_CREDENTIALS clientId> \
  --scope /subscriptions/2a127d53-c9bf-471a-8196-3155eae6cb1b/resourceGroups/rg-pulse-uat-centralus
```

**Run `Deploy Infrastructure` with `what_if: true` first.** What-if evaluates the template and surfaces
the role-assignment write (and the new App Service `identity` + `Generation__*` settings) **without
performing them**, so a missing permission shows up as a preview failure instead of a half-applied
deployment.

**Provisioning first, then signing, then going live.** Steps 1–2 are safe to run *before* the Tier-2
sign-off — they stand the endpoint up without routing traffic — and in fact must run first, because
`PROVIDER-GOVERNANCE.md` §8 evidence (i) (the keyless identity + role assignment) is only confirmable
against Azure *after* they have been applied. Only steps 4–5 are gated on the signature.

1. **What-if.** Run **Deploy Infrastructure** with `what_if: true` on the committed params
   (`deployAi = true`, `generationProviderLive = false`) and confirm the preview shows the role
   assignment, the App Service identity, and the `Generation__*` settings — with
   `Generation__Provider = Fake`.
2. **Provision.** Re-run with `what_if: false`. This creates `aif-pulse-uat` + the model deployments,
   gives the App Service its system-assigned identity, and grants it the data-plane role. Idempotent;
   routes **no** traffic.
3. **Verify + sign.** Confirm the identity really holds the role (commands in
   [`PROVIDER-GOVERNANCE.md`](../docs/features/engine-runtime/PROVIDER-GOVERNANCE.md) §8 → "Deploy
   ordering"), check the Ambient deployment's model **version** against the measured build (§6 → "When to
   re-run"), then get §8 signed — five boxes ticked, signer + date entered. A human step; no builder or
   automation performs it.
4. **Go live.** In `parameters/uat.bicepparam` — **one atomic reviewed commit**, same discipline as
   flipping `deployAi` — the signer **sets all three** of `generationProviderLive`,
   `generationTenantBounded` and `generationNoTrainingAttested` to `true`. All three are `false` on disk
   today; the two attestations are human assertions the signer types at signing time, **not** values
   derived from `deployAi`, so flipping `generationProviderLive` on its own leaves a live provider with
   `false` attestations and **fails startup by design**
   (`GenerationConfigurationException` — that is the fail-closed backstop working, not a bug).
   Re-deploy: it changes exactly one app setting (`Generation__Provider`); the job summary's
   `generationProvider` output states which provider the deployed app resolves, and
   `generationAttestedPosture` states the effective attested posture. The App Service restarts on the app-setting change, which **de-registers
   the in-memory reaction loop** — re-call `POST /api/ops/seed-engine-content` to re-register it (engine
   state is process-memory this phase; see `engine-content-seed/feature.md`).
5. **Turn it back off after the verification pass.** ~$0.61/exercise-hour at the measured Ambient rate
   while a storyline is active — cheap, not free.

**No new secrets** anywhere in this sequence: the `Generation:*` values are non-secret config and auth is
keyless, so `deploy-infrastructure.yml` needs no new GitHub secret.

### Claude on Foundry (serverless MaaS) — the E8 provider comparison

`deployClaude = true` (with `deployAi = true`) also deploys the **Claude tiers** onto the *same*
`aif-pulse-uat` account — `claude-sonnet-5` (Standard) and `claude-haiku-4-5` (Ambient) — as
`Microsoft.CognitiveServices/accounts/deployments` with `model.format: 'Anthropic'`. They're served on
the **native Anthropic Messages API passthrough** (`https://aif-pulse-uat.services.ai.azure.com/anthropic/v1/messages`),
not the `/openai` surface. Keyless Entra, token scope **`https://ai.azure.com/.default`** (distinct from
the OpenAI surface's `cognitiveservices.azure.com`), data-plane role **`Cognitive Services User`**.

- **Marketplace.** Claude requires a Claude-eligible subscription and an accepted Azure Marketplace
  offer for Anthropic; the RP auto-accepts it from the `modelProviderData` attestation
  (`claudeOrganizationName` / `claudeCountryCode` / `claudeIndustry`) — no manual click-through. Set the
  org name to the real entity using the model.
- **Deploy (direct module, same pattern as the OpenAI pass — avoids churning the live SWA):**
  ```bash
  az deployment group create \
    --resource-group rg-pulse-uat-centralus \
    --template-file infrastructure/modules/ai.bicep \
    --parameters location=centralus aiFoundryName=aif-pulse-uat \
                 deployClaude=true claudeOrganizationName=Dynamis \
                 claudeCountryCode=US claudeIndustry=government \
    --name "pulse-uat-claude-foundry"
  ```
  (Idempotent: the account + OpenAI deployments already exist; this only adds the two Claude deployments.
  Model deployments can keep provisioning after the ARM operation returns — re-check state before rerun.)
- **Access for the measured comparison:** grant your az-login identity the Claude data-plane role once
  (you already hold `Cognitive Services OpenAI User` for the OpenAI surface):
  ```bash
  az role assignment create --role "Cognitive Services User" \
    --assignee <your-object-id> \
    --scope $(az cognitiveservices account show -n aif-pulse-uat -g rg-pulse-uat-centralus --query id -o tsv)
  ```
- **Then run the side-by-side pass** (opt-in, both providers, same bursts):
  ```bash
  PULSE_LIVE_FOUNDRY=1 dotnet test --filter ProviderComparisonTests
  ```
  See [`docs/features/engine-generation-infra/PROVIDER-COMPARISON.md`](../docs/features/engine-generation-infra/PROVIDER-COMPARISON.md).

## Follow-ups

- ~~Wire the backend host's managed identity into `ai.bicep` (`backendPrincipalId`)~~ — **done**
  (engine-runtime/05): `webapp.bicep` has a system-assigned identity + `principalId` output and
  `main.bicep` threads it into `ai.bicep`, so the App Service gets `Cognitive Services OpenAI User`
  (and `Cognitive Services User` when `deployClaude` is set) automatically. **Still open for
  `functionapp.bicep`** — that host has no identity or `principalId` output yet; wire it the same way if
  the reaction loop ever moves out-of-process (`engine-runtime/implementation.md` open question (a)).
- Set the `AZURE_STATIC_WEB_APPS_API_TOKEN` repo secret so `deploy-frontend.yml` can publish.
- Decide the wildcard DNS + TLS strategy for per-exercise subdomains (COR-008) before
  backend hosting is finalized, then set `frontendUrl` in `uat.bicepparam`.
- Defender for Cloud (free CSPM) is authored in [`modules/defender.bicep`](modules/defender.bicep)
  and deployed separately at subscription scope (see the workflow's `deploy-defender` job).
