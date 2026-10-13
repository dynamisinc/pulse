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
| `deployStorage` | Storage account (keyless blob media, private `post-media` container) | `false` | `true` |
| `deployDatabase` | Azure SQL server + database | `false` | `true` |
| `deployBackend` | App Service / Function App (per `hostingModel`) | `false` | `true` |
| `deploySignalR` | Azure SignalR Service (real-time fan-out) | `false` | `false` (hub self-hosted) |
| `deployCommunication` | ACS + Email Service, **keyless** (`disableLocalAuth`), Azure-managed sender; grants the App Service identity **Communication and Email Service Owner** (easy-login/13, [below](#email-keyless-acs--easy-login-story-13)) | `false` | `true` |
| `deployAi` | Azure AI Foundry account + E8 model deployments (Standard/Ambient) | `false` | `true` |
| `generationProviderLive` | **Routes engine generation traffic to the live model** (`Generation:Provider` → `AzureOpenAI`). Separate from `deployAi` on purpose; **Tier-2 gated** | `false` | `false` |
| `generationTenantBounded` | **§2 governance assertion, typed by a human** (`Generation:Governance:TenantBounded`) — not derived from `deployAi` | `false` | `false` |
| `generationNoTrainingAttested` | **§2 governance assertion, typed by a human** (`Generation:Governance:NoTrainingAttested`) — not derived from `deployAi` | `false` | `false` |

The Static Web App **always** deploys. To scale up: flip the relevant toggles to `true`, set the
required secrets, and re-deploy — no template rewrite.

⚠ **The last three go together.** The `PROVIDER-GOVERNANCE.md` §8 signer sets
`generationProviderLive` + both attestations to `true` in **one atomic reviewed commit** — the
attestations are deliberately human assertions rather than values derived from `deployAi`, so flipping
`generationProviderLive` on its own leaves a live provider with `false` attestations and **fails startup
by design** (`GenerationConfigurationException`). See
"[`Generation:*` app settings and the live-traffic gate](#generation-app-settings-and-the-live-traffic-gate-tier-2)"
below and [`docs/features/engine-runtime/PROVIDER-GOVERNANCE.md`](../docs/features/engine-runtime/PROVIDER-GOVERNANCE.md) §8.

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
database/signalr/staticwebapp modules deliberately surface connection strings and the
SWA deployment token as outputs (the contract the composed template consumes). The storage module
no longer does — it is keyless and has no connection-string output (see
"[Blob storage for post media](#blob-storage-for-post-media-keyless)"). `az bicep build` is warning-free.

## CI/CD

Two `workflow_dispatch` / event-driven workflows under [`.github/workflows/`](../.github/workflows/):

| Workflow | Trigger | Purpose | Required secrets |
|---|---|---|---|
| [`deploy-infrastructure.yml`](../.github/workflows/deploy-infrastructure.yml) | manual | Runs the Bicep deploy (same flow as the CLI above) | `AZURE_CREDENTIALS`; once backend toggles are on: `SQL_ADMIN_PASSWORD`, `JWT_SECRET_KEY`, `SECURITY_CONTACT_EMAIL` (email is keyless: `EMAIL_CONNECTION_STRING` is no longer mapped and can be deleted); for login go-live (story login/06): `BOOTSTRAP_SECRET`, `STAFF_IDENTITY_ACCOUNTS_JSON` |
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
   Re-deploy: that signing commit changes **three** app settings — `Generation__Provider`
   `Fake`→`AzureOpenAI` plus the two `Generation__Governance__*` attestations `false`→`true`.
   (Flipping `generationProviderLive` *alone* would be the single-setting change, and it is exactly
   what the fail-closed backstop rejects at startup.) The job summary's
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

## Blob storage for post media (keyless)

`deployStorage = true` (UAT, demo-polish/01) stands up `stpulseuat` for post photos, videos and posters.

- **No keys.** `allowSharedKeyAccess: false`, so the data plane rejects account keys and account-key
  SAS. The module has **no** connection-string output and the App Service has **no**
  `Azure__BlobStorage__ConnectionString` setting. `allowBlobPublicAccess: false`, TLS 1.2 minimum,
  HTTPS only.
- **One private container**, `post-media` (`publicAccess: 'None'`). The API mints short-lived,
  read-only, single-blob **user-delegation SAS** URLs for in-scope media, because `<img>`/`<video>`
  cannot send an `Authorization` header (plan §4 "Why read SAS").
- **Access.** `main.bicep` passes the App Service's `principalId` to `storage.bicep` as
  `backendPrincipalId`, which grants **Storage Blob Data Contributor** at **storage-account scope**.
  The user-delegation-key action is account-level, so a container-scoped grant could not sign. Same
  deterministic-name pattern as `ai.bicep`, so a re-run never duplicates the grant.
- **CORS.** The blob service allows `GET`/`HEAD`/`OPTIONS` from `frontendUrl` only, exposing
  `Content-Length`, `Content-Range`, `Accept-Ranges` (video range requests; future WebVTT).
- **App settings** (`webapp.bicep`): `Azure__BlobStorage__Provider = Azure`,
  `Azure__BlobStorage__ServiceUri = https://stpulseuat.blob.core.windows.net`,
  `Azure__BlobStorage__ContainerName = post-media`. The URI is a plain `main.bicep` local, not a
  storage-module output (that would be a webApp↔storage cycle, as with `ai`). With
  `deployStorage = false` the app fails closed instead: `Provider = None` (uploads answer 503, the rest
  of the API is unaffected) and an empty `ServiceUri`.
- **Deploy prerequisite.** The grant is a `roleAssignments` write, so the deploy SP needs
  role-assignment write on the RG. This is the same prerequisite `deployAi` already has (see the
  `deployAi` section above).
- **Propagation.** RBAC can take several minutes to apply. Do **not** run the media smoke test in the
  first ~10 minutes after the deploy; a `403 AuthorizationPermissionMismatch` in that window is
  propagation, not a bug.

Post-deploy check (Tom, after **Deploy Infrastructure**):

```bash
RG=rg-pulse-uat-centralus
az storage account show -n stpulseuat -g $RG \
  --query "{sharedKey:allowSharedKeyAccess, publicBlob:allowBlobPublicAccess, tls:minimumTlsVersion, httpsOnly:enableHttpsTrafficOnly}" -o json
# expect sharedKey=false, publicBlob=false, tls=TLS1_2, httpsOnly=true

PRINCIPAL=$(az webapp identity show -n app-pulse-api-uat-dynamis -g $RG --query principalId -o tsv)
az role assignment list --assignee "$PRINCIPAL" \
  --scope $(az storage account show -n stpulseuat -g $RG --query id -o tsv) -o table
# expect Storage Blob Data Contributor at the account scope

# Control-plane read (needs no data-plane role and no key):
az storage container-rm show --storage-account stpulseuat -g $RG -n post-media --query publicAccess -o tsv
# expect None

curl -s -o /dev/null -w '%{http_code}\n' https://stpulseuat.blob.core.windows.net/post-media/probe
# expect a 4xx (409 PublicAccessNotPermitted), never 200
```

## Email (keyless ACS) — easy-login story 13

`deployCommunication = true` (UAT) stands up `acs-pulse-uat` (Communication Service) and `email-pulse-uat`
(Email Service) with the **Azure-managed domain**, and turns on "Email links" on the staff roster: the API
emails each selected participant their own personal sign-in link.

- **No keys.** `communication.bicep` sets `disableLocalAuth: true` (API version `2025-05-01`), so the data
  plane rejects access keys and connection strings. The module has **no** key or connection-string output,
  the App Service has **no** `Email__ConnectionString` setting, and the `emailConnectionString` parameter is
  gone from `main.bicep` and `uat.bicepparam`. `deploy-infrastructure.yml` no longer maps
  `EMAIL_CONNECTION_STRING`, so the **`EMAIL_CONNECTION_STRING` repo/environment secret can be deleted**.
- **App settings** (`webapp.bicep`): `Email__Endpoint = https://acs-pulse-uat.<geo>.communication.azure.com`
  (from the Communication Service host name) and `Email__SenderAddress = DoNotReply@<guid>.azurecomm.net`
  (the managed-domain sender). With `deployCommunication = false` both are empty and email is **dark**: the
  endpoint answers `503`, the roster reports `capabilities.emailLinks: false`, and the button is not shown.
  The roster's capability is the mailer's own switch, so a set-but-unusable value also hides the button.
  User-engagement (open/click) tracking is disabled on the domain and on every message.
- **Sender display name: not set (managed-domain limit).** Microsoft Learn ("How to add multiple sender
  addresses") states that sender usernames, the `Microsoft.Communication/emailServices/domains/senderUsernames`
  resource that carries `displayName`, *cannot be enabled for Azure Managed Domains*, and that managed-domain
  sender usernames can't be personalized. So mail shows the default `DoNotReply` sender, and the unused
  `Email__DefaultSenderName` app setting is gone. On a verified custom domain with raised limits, a
  `senderUsernames` child (`username: 'DoNotReply'`, `displayName: 'Pulse'`) would set it.
- **Deploy prerequisite.** The grant below is a `roleAssignments` write: the same deploy-SP prerequisite as
  `deployAi` / `deployStorage` (see above).
- **Propagation.** RBAC takes minutes to apply. In the first ~10 minutes after the deploy a send can fail
  (`failed` / `sendFailed` in the roster; `acs-email-send -> 401`/`403`/`credential`/`timeout` in the API log).
  Wait, then use "Send again to the N not sent".
- **Rate limits.** Azure-managed domains are capped at **5 emails a minute and 10 an hour per subscription**,
  and the cap cannot be raised. Fine for UAT testers. The API stops at the provider's first `429` and reports
  everyone left as `failed` / `rateLimited` ("email limit reached; send again to just these people later"),
  and the result offers "Send again to the N not sent". A real StartEx needs a verified custom domain
  (`emailCustomDomain`, DNS records at the registrar) and a quota increase request.
- **Deliverability.** Managed-domain mail often lands in **junk**. Test with a mailbox you control and check
  the junk folder before calling it broken.

### Access: the role (UAT) and the narrower custom role (before production)

`modules/communication-sender-role.bicep` grants the App Service's system-assigned identity the built-in
**Communication and Email Service Owner** role (`09976791-48a7-449e-bb21-39d1a415f350`) on the Communication
Service. Microsoft Learn's "Create credentials for SMTP authentication" page names this as the built-in role for
Entra-authenticated ACS email; it is the narrowest *built-in* role that can send (the others are Contributor and
Owner). It uses the same pattern as `storage.bicep` (deterministic `guid()` name, skipped without a principal). It
is a sibling module rather than part of `communication.bicep` because `webApp` reads `communication`'s outputs
(the managed sender's domain is a service-generated GUID, so it cannot be a `main.bicep` local the way the storage
URI is), and a grant inside `communication.bicep` would make the two modules a cycle.

**Keep the built-in role for UAT.** Before production, replace it with the narrower **custom role** the same Learn
page documents, assignable at the Communication Service:

| Action | Why |
|---|---|
| `Microsoft.Communication/CommunicationServices/Read` | read the resource |
| `Microsoft.Communication/CommunicationServices/Write` | required by the send path, per Learn |
| `Microsoft.Communication/EmailServices/write` | required by the send path, per Learn |

Creating it needs role-*definition* write rights on the subscription or resource group (a `roleDefinitions`
resource in Bicep, or `az role definition create`), which the deploy SP does not hold today.

⚠ **Caveat: `CommunicationServices/Write` is a control-plane write.** Both the built-in role and the custom role
allow the identity to update the Communication Service itself, which includes setting `disableLocalAuth` back to
`false` (re-enabling keys). Bicep re-asserts `true` on every deploy, but between deploys only a policy stops it.
Optional hardening: assign the built-in Azure Policy **"Communication services resource should have local
authentication methods disabled"** (`fc264132-db9c-4302-bb7d-3994c36461fe`, effects Audit / **Deny** / Disabled)
with effect `Deny`, scoped to the resource group, so a write that sets `disableLocalAuth: false` is refused.

### Service lifecycle: ACS Email is retiring

From Microsoft Learn, "Retirement and breaking changes guide for Azure Communication Services":

- **ACS Email retires on September 30, 2028.** Microsoft announced it in September 2026; until then ACS Email is
  in **maintenance mode**, with security and critical fixes only.
- "You can currently onboard workloads to new ACS Email resources. However, this availability is **subject to
  change at any time**." Microsoft recommends using the retirement period to migrate existing workloads rather
  than to onboard new solutions. (The guide's dated October 23, 2026 onboarding restriction is stated for phone
  numbers, PSTN and SMS, not explicitly for email.)
- Migration options the guide names: **Microsoft 365 High Volume Email** (internal send only), **Exchange
  Online**, or **Marketplace partners**.
- Pulse's send path sits behind `IParticipantLinkMailer`, so swapping providers is a new implementation of that
  interface (plus its settings and infrastructure), not a change to the roster, the endpoint or the UI.

### Steps (Tom, by hand)

1. **What-if.** Run **Deploy Infrastructure** with `what_if: true` (or `az deployment group what-if` as in
   "Deploy" above). Expect creates for `acs-pulse-uat`, `email-pulse-uat`, `email-pulse-uat/AzureManagedDomain`
   and one `Microsoft.Authorization/roleAssignments` on `acs-pulse-uat`; on `app-pulse-api-uat-dynamis`, the
   app settings `Email__Endpoint` and `Email__SenderAddress` added and `Email__ConnectionString`,
   `Email__DefaultSenderAddress` and `Email__DefaultSenderName` removed. Nothing else should change.
2. **Deploy.** Re-run with `what_if: false`. The app-setting change restarts the App Service.
3. **Wait ~10 minutes** for the role to propagate, then verify:

```bash
RG=rg-pulse-uat-centralus
az resource show -g $RG -n acs-pulse-uat --resource-type Microsoft.Communication/CommunicationServices \
  --query "{host:properties.hostName, localAuthDisabled:properties.disableLocalAuth}" -o json
# expect localAuthDisabled=true

PRINCIPAL=$(az webapp identity show -n app-pulse-api-uat-dynamis -g $RG --query principalId -o tsv)
az role assignment list --assignee "$PRINCIPAL" \
  --scope $(az resource show -g $RG -n acs-pulse-uat --resource-type Microsoft.Communication/CommunicationServices --query id -o tsv) \
  --query "[].roleDefinitionName" -o tsv
# expect Communication and Email Service Owner

az webapp config appsettings list -n app-pulse-api-uat-dynamis -g $RG \
  --query "[?starts_with(name,'Email__')].{name:name,value:value}" -o table
# expect Email__Endpoint (https://...communication.azure.com) and Email__SenderAddress (DoNotReply@...azurecomm.net)
```

4. **Send one** from the roster to a participant whose email is a mailbox you control (walk-through step 9),
   check the junk folder, and tap the link.
5. **Delete the `EMAIL_CONNECTION_STRING` secret** from the repo / `uat` environment (nothing reads it now).

## Follow-ups

- **`functionapp.bicep` is not keyless-compatible.** It still builds `AzureWebJobsStorage` and
  `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING` from `listKeys()` against `stpulse{env}`. With
  `allowSharedKeyAccess: false` that key is rejected, so the Functions host could not start. This is
  harmless while `hostingModel = 'webapi'` (no Function App deploys). Before `functions`/`both`, move it
  to identity-based storage (`AzureWebJobsStorage__accountName` plus the Function App's identity and
  data roles) or give it its own storage account.
- ~~Wire the backend host's managed identity into `ai.bicep` (`backendPrincipalId`)~~ — **done**
  (engine-runtime/05): `webapp.bicep` has a system-assigned identity + `principalId` output and
  `main.bicep` threads it into `ai.bicep`, so the App Service gets `Cognitive Services OpenAI User`
  (and `Cognitive Services User` when `deployClaude` is set) automatically. **Still open for
  `functionapp.bicep`** — that host has no identity or `principalId` output yet; wire it the same way if
  the reaction loop ever moves out-of-process (`engine-runtime/implementation.md` open question (a)).
- **Email (easy-login/13), before production:** replace the built-in role with the narrower custom role and
  consider the `disableLocalAuth` deny policy (see "[Access](#access-the-role-uat-and-the-narrower-custom-role-before-production)");
  a verified custom sender domain before any real StartEx (managed-domain limits); and plan the move off ACS Email
  before its September 30, 2028 retirement (see "[Service lifecycle](#service-lifecycle-acs-email-is-retiring)").
- Set the `AZURE_STATIC_WEB_APPS_API_TOKEN` repo secret so `deploy-frontend.yml` can publish.
- Decide the wildcard DNS + TLS strategy for per-exercise subdomains (COR-008) before
  backend hosting is finalized, then set `frontendUrl` in `uat.bicepparam`.
- Defender for Cloud (free CSPM) is authored in [`modules/defender.bicep`](modules/defender.bicep)
  and deployed separately at subscription scope (see the workflow's `deploy-defender` job).
