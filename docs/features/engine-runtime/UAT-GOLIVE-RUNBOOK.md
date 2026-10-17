# UAT go-live runbook: live generation provider (Saturday, 10/17; Sunday is buffer)

> **For:** Tom (the operator). **When:** after Session A's A1 (including #573, the lead gate) and PR #571 are on `main`.
> **What it does:** switches UAT's AI engine from the offline `Fake` provider to the governed live provider
> (Azure OpenAI `gpt-5.4-mini`, Ambient tier), as signed in [`PROVIDER-GOVERNANCE.md`](PROVIDER-GOVERNANCE.md) §8.
> **Time:** about 20 minutes, plus the verification pass.
> **Cost while live:** about $0.61 per exercise-hour while a storyline is active.

## 0. Before you start

| Check | How |
|---|---|
| A1 (with #573) and #571 are merged | Both PRs show *Merged*. #571's merge auto-deploys the backend and frontend; wait for **Deploy Backend** and **Deploy Frontend** to go green. |
| UAT is healthy on `Fake` | `https://app-pulse-api-uat-dynamis.azurewebsites.net/health` returns 200. |
| You can reach the bootstrap secret | The `uat` environment secret `BOOTSTRAP_SECRET`, which step 3 needs. |
| Provider alerts are ON in this run | #571 sets `deployProviderAlerts = true`; the `PULSE_ALERT_OWNER_EMAIL` secret exists on `uat` (Tom, 10/17). If the secret were missing, the deploy fails with a clear message rather than deploying silently. |

## 0b. Capture the current app settings (before any deploy)

The infra run **replaces the App Service's whole app-settings list** (`siteConfig.appSettings`). Any setting that
exists only in the portal, and not in the bicep, is **deleted** by the deploy. This was already true before the
go-live; it matters now because this go-live run is the first big settings change.

In Cloud Shell, after `az account set` to the Pulse subscription (the one you used for the §8 checks):

```bash
az webapp config appsettings list \
  -n app-pulse-api-uat-dynamis -g rg-pulse-uat-centralus \
  --query "[].name" -o tsv | sort > uat-appsettings-before.txt
```

Keep the file for step 1. Do not paste values anywhere; the names are enough.

## 1. Deploy Infrastructure: what-if first

GitHub, then **Actions**, then **Deploy Infrastructure**, then **Run workflow**: `environment = uat`, **`what_if = true`**.

Read the job summary. Expect **only** these changes:

| Resource | Change | Why |
|---|---|---|
| App Service `app-pulse-api-uat-dynamis`, app settings | `Generation__Provider`: `Fake` → `AzureOpenAI` | #571 (`generationProviderLive = true`) |
| | `Generation__Governance__TenantBounded`: `false` → `true` | #571, the §8 attestation |
| | `Generation__Governance__NoTrainingAttested`: `false` → `true` | #571, the §8 attestation |
| | **Add** `ForwardedHeaders__KnownNetworks__0 = 10.0.0.0/8` | A1a (#480): trusted-proxy ranges, so the per-IP login limiter sees the real client IP |
| | **Add** `ForwardedHeaders__KnownNetworks__1 = 172.16.0.0/12` | A1a (#480) |
| | **Add** `ForwardedHeaders__KnownNetworks__2 = 192.168.0.0/16` | A1a (#480). No `KnownProxies`; `ForwardLimit` stays at the code default of 1 |
| | **Add** the four limiter permits from step 1b (`SessionPerMinute = 120`, `WordPermitPerMinute = 30`, `ParticipantLoginPerMinute = 30`, `SharedLoginPerMinute = 20`) | A1a (#480): single-venue permits |
| | **Add** `Generation__Governance__TimeoutAutoSendAuthorized = false` | Phase 1 (PROVIDER-GOVERNANCE §8): timeout auto-send (swamped mode) stays off until the lead-controller gate is on main |
| Action group and four `scheduledQueryRules` (`ag-…-provider`, errors / latency / timeouts / spend) | **Create** | #585 / #590 (alerts on in #571) |

> ⚠ **Never set `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`.** It trusts forwarded headers from *any* client, so anyone
> could spoof their IP past the login limiter. The three `KnownNetworks` entries above are the only forwarded-headers settings.

**Compare with step 0b.** Every name in `uat-appsettings-before.txt` must appear in the what-if, either unchanged or
as a listed change. A name that is in the file but **missing or shown as removed** in the what-if is a portal-only
setting the deploy would wipe. **Do not deploy** until it is resolved (added to the bicep by its owner, or confirmed
as safe to drop).

**Stop and ask before deploying if the what-if shows anything else**, especially:
- any delete;
- a change to the SQL server or database;
- a change to `aif-pulse-uat`'s model deployments.

### 1b. Login and join limiter permits (set automatically; you only verify them)

A1a (#480) makes the per-IP limiters key on the real client IP. Players on one venue's Wi-Fi share a single public
IP behind its NAT, so they share **one** limiter bucket, and a room full of players joining at once could hit
`429`. A1a's `webapp.bicep` raises these permits for UAT. **You do not set them by hand:** the Deploy Infrastructure
run sets them, and the next infra run would overwrite any manual value anyway. They appear in the step-1 what-if as
**added** app settings:

| App setting | UAT value |
|---|---|
| `Authentication__RateLimits__SessionPerMinute` | **120** |
| `Authentication__EasyLogin__WordPermitPerMinute` | **30** |
| `Authentication__RateLimits__ParticipantLoginPerMinute` | **30** |
| `Authentication__RateLimits__SharedLoginPerMinute` | **20** |
| `Authentication__EasyLogin__JoinPermitPerMinute` | not set; stays at the default of 30 |
| Staff login | not set; stays at the default of 10 (smoke check 5 relies on this) |

> These values are **demo-sized** (one room, a few dozen players). A 100-person StartEx on one venue's NAT needs the
> larger set, which Session A can supply. Raise them before that exercise, not for this go-live.

## 2. Deploy Infrastructure: for real

Run it again with **`what_if = false`**. When it finishes, the job summary should show `generationProvider = AzureOpenAI` and the attested posture as `true`/`true`.

**Verify step 1b:** in the Azure portal, open `app-pulse-api-uat-dynamis`, then **Settings → Environment variables**
(**Configuration → Application settings** on older portal views). Confirm the four limiter settings from step 1b are present
with those values. If any is missing, stop and tell Session A; do not add it by hand.

The app-setting change **restarts the App Service**. That clears the engine's in-memory state, including any per-exercise cut-to-Fake.

> ⚠ **After ANY restart or deploy, re-check the engine state panel** (console ENGINE flyout) for every active exercise, and
> **re-apply cut-to-Fake or the kill switch if it was set before.** Neither survives a restart today, so live output silently
> comes back. This applies to every Deploy Infrastructure run and every backend deploy (any merge that touches `src/`),
> not just this one. (Ambient chatter is the safe exception: it resets to Off.) Persisting this state is wave C3.

## 3. Re-register the engine loop

The restart drops the in-memory reaction loop, so re-seed it. Use the demo exercise's hostname:

```bash
curl -sS -X POST "https://app-pulse-api-uat-dynamis.azurewebsites.net/api/ops/seed-engine-content" \
  -H "Content-Type: application/json" \
  -H "X-Bootstrap-Secret: $BOOTSTRAP_SECRET" \
  -d '{"hostname": "<demo exercise hostname>"}'
```

Expect a 200 response carrying the `exerciseId` and persona counts. A 404 means the secret or hostname is wrong.

## 4. Smoke checks (about 10 minutes)

1. **The app starts on the live provider.** `/health` returns 200.
   - If startup fails with `GenerationConfigurationException`, the attestations didn't land. Roll back (section 5) and tell Session C.
2. **The engine generates live.** In the controller console, with Suggest autonomy, let one storyline tick.
   - A draft appears in the review queue.
   - Approve it, and it publishes to the participant feed.
3. **The usage panel moves (#401).** The ENGINE flyout's AI usage panel goes from "0 calls, $0" to "N calls, $Y" on `gpt-5.4-mini`.
4. **The cut-to-Fake lever works (#402).** Cut generation to Fake.
   - The next burst uses Fake (no new calls in the usage panel).
   - Restore afterwards.
4b. **Timeout auto-send is refused on the server (Phase 1).**
   - In the engine bar, the **Swamped mode** ON control is disabled, with the note "Timeout auto-send is off until
     the lead-controller role ships." (The console toggle does not call the server, so this only shows the console
     read the flag.)
   - Prove the server refuses it. With a staff session cookie (browser dev tools → Network → copy a request as cURL):
     - `GET /api/engine/settings` shows `"timeoutAutoSendAuthorized": false`;
     - `POST /api/engine/autonomy/swamped-mode` with body `{"actingHumanId":"<your id>","enabled":true}` returns
       `400` "timeout auto-send (swamped mode) is not authorized on this environment until the lead-controller
       gate lands (PROVIDER-GOVERNANCE §8, Phase 1)".
5. **The login limiter keys on the real client IP (A1a).** Make 11 rapid bad staff logins from one machine.
   - That machine gets `429`.
   - A second machine can still log in.
   - Before this infra run A1a's code is a no-op; after it, the limiter keys on the real client IP.
   - **If both machines are throttled together**, the App Service front end's peer IP is outside the three
     `KnownNetworks` ranges, so forwarded headers are ignored. This fails safe (it is the pre-A1a behaviour) but
     means #480 is not working. It does not block the go-live. Note it and report it to Session A. To find the
     real peer, optionally set `Logging__LogLevel__Microsoft.AspNetCore.HttpOverrides = Debug` in the portal for a
     few minutes, repeat one login, and look for an "Unknown proxy" line in the log stream; then remove the setting
     (the next infra run would wipe it anyway, see step 0b).
6. **The kill switch works.** Engage FullStop.
   - Nothing new publishes.
   - Restore afterwards (lead controller).

7. **Provider alerts reach the owner (AC7, closes #590).** The infra run creates the action group and four alert rules.
   - Azure portal, then **Monitor → Alerts → Action groups**, then `ag-…-provider`, then **Test**. Choose the email
     action and confirm the test email reaches the `PULSE_ALERT_OWNER_EMAIL` inbox.
   - Optional: in **Alert rules**, confirm all four rules are **Enabled** (errors, latency, timeouts, spend).
   - Record the date and result in `engine-telemetry-tuning/04` (Tests section). Session C closes #590.

Session C then runs the formal #349/#401/#402 checks and the #177 latency and cost measurement that evening.

## 5. Rollback (if the demo needs `Fake` back)

| Need | Do this | Notes |
|---|---|---|
| **Instant, one exercise** | Console ENGINE flyout, then **Cut generation to Fake** (any controller). | Takes effect on the next burst. Pending auto-sends hold. A burst already publishing finishes. **This lives in memory: any restart or redeploy reverts every exercise to live**, so cut again after one. |
| **Immediate stop of all engine output** | **Kill switch, FullStop** (any controller). | Stops every later publish. It does not interrupt a burst already handed to the publisher. |
| **Durable, all exercises** | In `infrastructure/parameters/uat.bicepparam` set `generationProviderLive = false` (leave the two attestations), merge, then **Deploy Infrastructure** (what-if, then deploy). Then re-run step 3. | The App Service restarts on `Fake`. This is the clean way back for the demo if live behaves badly. |

> ⚠ **A restart undoes a cut and a kill switch.** The first two rows live in memory only. After ANY restart or deploy, re-check
> the engine state panel and re-apply cut-to-Fake or the kill switch if it was set. Only the durable row survives a restart.

## 6. Amendment 2: autonomous ambient (only after Tom signs #593)

Prerequisites on `main`: #603, #607, and Session A's A1c with the ambient-policy route lead-gated. Then:

1. Tom ticks and signs amendment 2 in `PROVIDER-GOVERNANCE.md` (#593), and #593 merges.
2. The flag commit, a separate reviewed PR: `infrastructure/parameters/uat.bicepparam` sets
   `generationAmbientAutonomyAuthorized = true`. Nothing else changes.
3. **Deploy Infrastructure**, what-if first. Expect **only** `Generation__Governance__AmbientAutonomyAuthorized`: `false` → `true`.
   Stop if anything else changes.
4. Deploy for real. **This restarts the App Service:** re-run step 3 (re-seed), then re-check the engine state panel and
   re-apply any cut-to-Fake or kill switch (see the warning under step 2).
5. Smoke check: in the ENGINE flyout's **Ambient chatter** section, **Autonomous** is no longer greyed out. As the **lead**
   controller, set it with small caps and two everyday topics, then confirm the warning step and save. Within a quiet period:
   - an ambient post appears in the feed with no review click;
   - a non-lead controller gets 403 when trying to raise the caps;
   - the kill switch turns ambient back to Off.

## 7. After the verification pass

If UAT will sit idle with no exercise running, either:
- leave it, since cost is incurred only while a storyline is active; or
- use the durable rollback to stop all egress until the demo.
