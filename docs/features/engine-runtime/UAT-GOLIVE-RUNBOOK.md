# UAT go-live runbook: live generation provider (Sunday, 10/18)

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
| Optional: provider alerts | If you want alerts on in the same run, first create the `PULSE_ALERT_OWNER_EMAIL` secret and merge the one-line `deployProviderAlerts = true` change (issue #590). Otherwise skip it; alerts stay off. |

## 1. Deploy Infrastructure: what-if first

GitHub, then **Actions**, then **Deploy Infrastructure**, then **Run workflow**: `environment = uat`, **`what_if = true`**.

Read the job summary. Expect **only** these changes:

| Resource | Change | Why |
|---|---|---|
| App Service `app-pulse-api-uat-dynamis`, app settings | `Generation__Provider`: `Fake` → `AzureOpenAI` | #571 (`generationProviderLive = true`) |
| | `Generation__Governance__TenantBounded`: `false` → `true` | #571, the §8 attestation |
| | `Generation__Governance__NoTrainingAttested`: `false` → `true` | #571, the §8 attestation |
| | A1a's forwarded-headers / trusted-proxy settings (#480) | Session A. **Confirm the exact keys against A1a's PR before running.** |
| Action group and four `scheduledQueryRules` (`ag-…-provider`, errors / latency / timeouts / spend) | **Create**, only if you enabled alerts | #585 / #590 |

**Stop and ask before deploying if the what-if shows anything else**, especially:
- any delete;
- a change to the SQL server or database;
- a change to `aif-pulse-uat`'s model deployments.

## 2. Deploy Infrastructure: for real

Run it again with **`what_if = false`**. When it finishes, the job summary should show `generationProvider = AzureOpenAI` and the attested posture as `true`/`true`.

The app-setting change **restarts the App Service**. That clears the engine's in-memory state, including any per-exercise cut-to-Fake.

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
   - The swamped banner, if swamped mode is on, reads **TIMEOUT AUTO-SEND IS SUSPENDED**.
   - Restore afterwards (lead controller).
5. **The kill switch works.** Engage FullStop.
   - Nothing new publishes.
   - Restore afterwards (lead controller).

Session C then runs the formal #349/#401/#402 checks and the #177 latency and cost measurement that evening.

## 5. Rollback (if the demo needs `Fake` back)

| Need | Do this | Notes |
|---|---|---|
| **Instant, one exercise** | Console ENGINE flyout, then **Cut generation to Fake** (any controller). | Takes effect on the next burst. Pending auto-sends hold. A burst already publishing finishes. **This lives in memory: any restart or redeploy reverts every exercise to live**, so cut again after one. |
| **Immediate stop of all engine output** | **Kill switch, FullStop** (any controller). | Stops every later publish. It does not interrupt a burst already handed to the publisher. |
| **Durable, all exercises** | In `infrastructure/parameters/uat.bicepparam` set `generationProviderLive = false` (leave the two attestations), merge, then **Deploy Infrastructure** (what-if, then deploy). Then re-run step 3. | The App Service restarts on `Fake`. This is the clean way back for the demo if live behaves badly. |

## 6. After the verification pass

If UAT will sit idle with no exercise running, either:
- leave it, since cost is incurred only while a storyline is active; or
- use the durable rollback to stop all egress until the demo.
