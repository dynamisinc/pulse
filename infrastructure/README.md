# Pulse Infrastructure (Azure / Bicep)

Infrastructure-as-code for Pulse, ported from Cadence and following the shared
Dynamis (Azure CAF) resource-naming scheme used by Cadence and C5.

- **Account:** DynamisCobra (`tbull@dynamiscobra.com`)
- **Subscription:** Shared SandBox (`2a127d53-c9bf-471a-8196-3155eae6cb1b`)
- **Region:** `centralus`
- **Resource group:** `rg-pulse-uat-centralus`

## Current cost posture — Static Web App only

Pulse has **no .NET backend yet** (it's a frontend-only Vite SPA). Provisioning
App Service / Azure SQL / Storage / SignalR now would bill against nothing, so this
deployment stands up **only the Free-tier Static Web App** (`stapp-pulse-uat`, ~$0/mo).

Everything heavier is fully authored in [`main.bicep`](main.bicep) but gated behind
cost toggles (all `false` today in [`parameters/uat.bicepparam`](parameters/uat.bicepparam)):

| Toggle | Turns on | Default |
|---|---|---|
| `deployMonitoring` | Log Analytics + Application Insights | `false` |
| `deployStorage` | Storage account (blob media) | `false` |
| `deployDatabase` | Azure SQL server + database | `false` |
| `deployBackend` | App Service / Function App (per `hostingModel`) | `false` |
| `deployCommunication` | ACS + Email Service | `false` |
| `deployAi` | Azure AI Foundry account + E8 model deployments (Standard/Ambient) | `false` |

The Static Web App **always** deploys. To scale up when the backend lands: flip the
relevant toggles to `true`, set the SQL secrets, and re-deploy — no template rewrite.

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
- **Access for the measured spike (story 06):** the module's role assignment is skipped until a backend
  managed identity is supplied, so grant your own identity the data-plane role once after deploy:
  ```bash
  az role assignment create --role "Cognitive Services OpenAI User" \
    --assignee <your-object-id> \
    --scope $(az cognitiveservices account show -n aif-pulse-uat -g rg-pulse-uat-centralus --query id -o tsv)
  ```

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

- Wire the backend host's managed identity into `ai.bicep` (`backendPrincipalId`) once `deployBackend`
  is on, so the app gets `Cognitive Services OpenAI User` (and, when `deployClaude` is set,
  `Cognitive Services User`) automatically (needs `webapp.bicep` / `functionapp.bicep` to output
  `principalId`).
- Set the `AZURE_STATIC_WEB_APPS_API_TOKEN` repo secret so `deploy-frontend.yml` can publish.
- Decide the wildcard DNS + TLS strategy for per-exercise subdomains (COR-008) before
  backend hosting is finalized, then set `frontendUrl` in `uat.bicepparam`.
- Defender for Cloud (free CSPM) is authored in [`modules/defender.bicep`](modules/defender.bicep)
  and deployed separately at subscription scope (see the workflow's `deploy-defender` job).
