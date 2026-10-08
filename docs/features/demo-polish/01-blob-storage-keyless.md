# Story: Keyless Blob storage for media

**Feature:** Demo polish  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** XC-009, COR-002, NFR-004  ·  **Design decisions:** none  ·  **Issue:** #420
**Story ID:** I1  ·  **Stack:** infra  ·  **Priority:** Must  ·  **Effort:** S  ·  **Wave:** 1  ·  **Review:** Tier-2 (Tom)
**Home story:** — (no existing backlog story; the plan creates it). Related: [`posts/01`](../posts/01-post-composition.md) (video AC).

## Context
**As** the platform owner, **I want** a private Blob container that only the API's managed identity can write
and sign read links for, **so that** photos and videos can be stored and shown in the demo with no account key
anywhere (keyless, like the AI resources).

Blobs live in a **private** container. The API (BM) mints short-lived, read-only, single-blob user-delegation
SAS URLs because `<img>`/`<video>` cannot send the `Authorization` header (plan §4 "Why read SAS"). This story
provisions the storage and the identity permission; BM writes the code. Today `storage.bicep` is not deployed in
UAT (`deployStorage=false`) and emits an **account-key connection string** via `listKeys()` that `webapp.bicep`
copies into an app setting — both go away.

## Acceptance Criteria
- [ ] **Keyless.** Given `storage.bicep`, then `allowSharedKeyAccess: false`, `allowBlobPublicAccess: false`,
      `minimumTlsVersion: 'TLS1_2'` and `supportsHttpsTrafficOnly: true`; the `listKeys()` `connectionString`
      output is deleted and no module output or app setting contains `AccountKey`.
- [ ] **Private container.** `post-media` is declared as a `blobServices/default/containers` child with
      `publicAccess: 'None'`; an anonymous GET of any blob URL is refused.
- [ ] **Identity permission.** Given a non-empty `backendPrincipalId`, then a
      `Microsoft.Authorization/roleAssignments` for **Storage Blob Data Contributor**
      (`ba92f5b4-2d11-453d-a403-e96b0029c9fe`) is created at **storage-account scope** (the user-delegation-key
      action is an account-level blob-service action; a container-scoped assignment cannot request it),
      `principalType: 'ServicePrincipal'`, name `guid(storageAccount.id, backendPrincipalId, roleId)`, `if
      (backendPrincipalId != '')` — the same shape as `ai.bicep`'s `openAiUserAssignment`. Re-running the deploy
      neither fails nor duplicates it.
- [ ] **App settings.** `webapp.bicep` emits `Azure__BlobStorage__Provider=Azure`,
      `Azure__BlobStorage__ServiceUri`, `Azure__BlobStorage__ContainerName=post-media`, and **no longer** emits
      `Azure__BlobStorage__ConnectionString` or `__PhotoContainerName`; `storageConnectionString` is removed
      from the module's params.
- [ ] **CORS.** The blob service allows `GET, HEAD, OPTIONS` from `corsAllowedOrigins` (param, default `[]`),
      exposes `Content-Length, Content-Range, Accept-Ranges`, `maxAgeInSeconds: 3600` (video range requests and
      future WebVTT).
- [ ] **UAT toggle.** `parameters/uat.bicepparam` sets `deployStorage = true`. Each touched module passes `az
      bicep build --file <module>`; after the orchestrator's `main.bicep` plumbing commit (implementation.md
      §4.2) `az bicep build --file infrastructure/main.bicep` and `build-params` (the `ci.yml` steps) pass with
      no new linter warning.
- [ ] **Verified in Azure (🧑 Tom runs *Deploy Infrastructure*).** `az storage account show` →
      `allowSharedKeyAccess=false`; `az role assignment list --assignee <webAppPrincipalId> --scope <storage
      id>` shows Data Contributor; the container exists and is private. Note RBAC can take minutes to propagate
      — the BM smoke test must not run in the first ~10 minutes.

## Out of Scope
Microsoft Defender for Storage / malware scanning (post-demo), private endpoints, lifecycle/retention policy,
CDN, Function App identity-based storage, the Plan-B SWA media store (plan §7), any application code (BM). No
change to `functionapp.bicep`: UAT `hostingModel` is `webapi`, so it is not deployed — but note
`functionapp.bicep` still builds `AzureWebJobsStorage` from `listKeys()`, so enabling `functions`/`both` later
needs identity-based storage (add to the follow-up list).

## Technical Notes
- Staff-infra story; no UI. Files: `infrastructure/modules/storage.bicep`, `modules/webapp.bicep`,
  `parameters/uat.bicepparam`, `infrastructure/README.md` (flip the `deployStorage` row). **Do not edit
  `main.bicep`** — the orchestrator owns the plumbing (add local `blobServiceUri`, pass it plus the container
  name to `webApp`, delete the `storageConnectionString:` argument, pass `backendPrincipalId` and
  `corsAllowedOrigins` to `storage`). Use a plain local for the service URI, **not** `storage.outputs…`,
  otherwise webApp ↔ storage forms a cycle (the same reason the `ai` module is wired the way it is).
- Reuse: `modules/ai.bicep` role-assignment pattern; `webapp.bicep` already exposes `principalId` and defaults
  `blobStorageContainerName = 'post-media'`.
- `infrastructure/main.json` is a stale committed artifact; do not hand-edit it. See implementation.md §1.7 for
  the app-setting names BM binds.

## Dependencies
P2. 🧑 Tom runs *Deploy Infrastructure* Fri 10/9; BM needs storage live only for UAT (it builds against the Local
provider). Smoke test Sat 10/10.

## Tests
- `az bicep build` (module-level and, post-plumbing, `main.bicep` + `build-params`) in CI
  (`.github/workflows/ci.yml`).
- Manual post-deploy checklist above (recorded in the PR). Isolation/security class: **key access disabled,
  container private, role scope = account** are the Tier-2 review points.
