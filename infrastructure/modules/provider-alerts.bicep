// ============================================================================
// Provider alert rules (engine-telemetry-tuning/04, NFR-009 monitoring/alerting)
// ----------------------------------------------------------------------------
// PUSH alerts on the live E8 generation provider: errors, latency and spend, emailed to the owner.
// READ-ONLY by construction: an action group plus scheduled log-query rules over the EXISTING Application
// Insights component. Nothing here changes an app setting, adds telemetry, or can reach a provider
// endpoint (NFR-005 posture unchanged) — aiFoundryName is used only as a text filter in KQL.
//
// The signal: Microsoft.ApplicationInsights.AspNetCore auto-collects every outbound HTTP attempt as a
// `dependencies` row. The engine's model calls run through the typed HttpClient with the
// `engine-generation` Polly pipeline (Pulse.Core/Core/Extensions/ServiceCollectionExtensions.cs), so each
// ATTEMPT (retries included) is one row whose `target` is the Foundry host —
// <aiFoundryName>.cognitiveservices.azure.com (Azure OpenAI) or <aiFoundryName>.services.ai.azure.com
// (Claude passthrough). `target has aiFoundryName` matches both and nothing else (SQL, Storage, the
// managed-identity token endpoint all have other hosts).
//
// Severity map: Sev-2 = act now (errors / breaker, attempts timing out at the degraded-mode trip); Sev-3 = look soon
// (latency warning, call-volume spend proxy).
// ============================================================================

@description('Azure region for the scheduled query rules (the App Insights component region).')
param location string

@description('Resource id of the Application Insights component the rules query (scope of every rule).')
param appInsightsId string

@description('AI Foundry account name (e.g. aif-pulse-uat). Used ONLY as the KQL `target has` filter that scopes every query to the Foundry host; never called.')
param aiFoundryName string

@description('Resource naming suffix, e.g. pulse-uat (ag-<suffix>-provider, alert-<suffix>-provider-*).')
param resourceSuffix string

@description('The single email receiver on the action group (the provider owner). REQUIRED — an alert nobody receives is worse than none. @secure so it is not recorded in the deployment parameters/history; it is still visible on the action group resource itself (an email receiver is not a secret property).')
@secure()
@minLength(3)
param alertOwnerEmail string

// --- Thresholds ---------------------------------------------------------------

@description('Error alert: failed-attempt percentage over the 15-minute window above which the Sev-2 alert fires.')
@minValue(1)
@maxValue(100)
param errorRatePercentThreshold int = 20

@description('Error alert: minimum Foundry-host attempts in the window before the failure ratio is evaluated (keeps one failed call in a quiet window from paging).')
@minValue(1)
param errorMinimumCalls int = 5

// Latency thresholds — keep these tied to their sources:
//   * 5 s warning (p95)  ≈ 2x the measured Standard p95 of 2.7 s
//     (docs/features/engine-generation-infra/MEASURED-RESULTS.md).
//   * 10 s trip          = the per-attempt degraded-mode trip, Generation:Resilience:AttemptTimeoutSeconds = 10
//     (src/Pulse.WebApi/appsettings.Generation.Example.json, asserted by
//     src/Pulse.WebApi.Tests/ProviderLiveConfigTests.cs).
// If the trip threshold moves, move latencyAlertMs with it.
//
// Why the Sev-2 latency alert is a TIMEOUT RATIO, not a p95: the Polly per-attempt timeout cancels an attempt
// at AttemptTimeoutSeconds, so a timed-out attempt is recorded with a duration of ~latencyAlertMs and never
// much above it. A "p95 > 10 s" test would sit exactly on that edge. Instead the rule counts attempts whose
// duration is >= 95 % of latencyAlertMs (i.e. timed out, or about to) and fires when their share of all
// attempts exceeds timeoutRatioPercentThreshold. ASSUMPTION to confirm on UAT (story AC7): timed-out attempts
// appear as `dependencies` rows with a ~10 s duration.
@description('Latency warning (Sev-3): 15-minute p95 of Foundry-host dependency duration, in ms. Default 5000 ≈ 2x the measured Standard p95 (MEASURED-RESULTS.md).')
@minValue(1)
param latencyWarningMs int = 5000

@description('Latency trip (Sev-2): the per-attempt timeout in ms. Attempts with duration >= 95 % of this count as timed out. Default 10000 = Generation:Resilience:AttemptTimeoutSeconds (the degraded-mode trip, ProviderLiveConfigTests). Move with that setting.')
@minValue(1)
param latencyAlertMs int = 10000

@description('Latency trip (Sev-2): percentage of attempts in the 15-minute window that timed out (duration >= 95 % of latencyAlertMs) above which the alert fires. Default 5.')
@minValue(1)
@maxValue(100)
param timeoutRatioPercentThreshold int = 5

@description('Latency rules: minimum Foundry-host attempts in the window before either latency rule is evaluated (one slow call in a quiet window must not alert).')
@minValue(1)
param latencyMinimumCalls int = 5

// Spend proxy sizing (MEASURED-RESULTS.md): a nominal active-storyline hour is ~375 four-post bursts
// (one model call each) at ~$0.0016/burst on the Ambient tier (~$0.61/h). 750 calls/h is ~2x nominal,
// ~$1.20/h at the Ambient rate. Retries count as calls here, so a retry storm also trips it.
@description('Spend proxy (Sev-3): Foundry-host model calls per hour above which the alert fires. Default 750 ≈ 2x the nominal active-storyline hour (375 bursts, MEASURED-RESULTS.md) ≈ $1.20/h at the Ambient rate.')
@minValue(1)
param callsPerHourThreshold int = 750

param tags object = {}

// --- KQL ----------------------------------------------------------------------
// Each query returns a row ONLY when its condition holds; every rule fires on "result rows > 0". The rule's
// windowSize is the query time range, so the queries carry no timestamp filter of their own (in the portal,
// set the time range to match when running one by hand).
//
// SAMPLING: Program.cs uses AddApplicationInsightsTelemetry() with default ADAPTIVE SAMPLING, so a stored row
// can stand for several real calls. Every COUNT here is therefore sum(itemCount), never count(). The p95 in
// the latency warning is WEIGHTED too — percentilew(duration, itemCount, 95): adaptive sampling changes its
// rate within a window (it samples harder under load, which is exactly when latency rises), so an unweighted
// percentile over the retained rows would under-represent the high-volume, high-latency periods.

var providerCalls = 'dependencies\n| where target has "${aiFoundryName}"'

// Breaker-open signature. RELIES ON: Polly's BrokenCircuitException propagating (directly or as an inner
// exception) up to ReactionLoopHost.LogTickFailed, which logs it at Error -> an `exceptions` row. The
// breaker's OnOpened hook does not log and an open breaker makes no HTTP call (so no dependency row). If a
// future change catches and swallows the generation failure before the tick logs it, this branch goes BLIND
// (the ratio branch still works); keep an Error-level log with the exception attached on that path.
var errorQuery = join([
  '// Breaker-open signature: Polly BrokenCircuitException anywhere in a logged exception chain.'
  'let breakerHits = toscalar(exceptions'
  '    | where type has "BrokenCircuitException" or tostring(details) has "BrokenCircuitException"'
  '    | count);'
  providerCalls
  '| summarize calls = sum(itemCount), failed = sumif(itemCount, success == false)'
  '| extend failedPercent = iff(calls == 0, 0.0, 100.0 * failed / calls), breakerHits = breakerHits'
  '| where (calls >= ${errorMinimumCalls} and failedPercent > ${errorRatePercentThreshold}) or breakerHits > 0'
], '\n')

var latencyWarningQuery = join([
  providerCalls
  '// p95 weighted by itemCount (adaptive sampling; see the SAMPLING note in provider-alerts.bicep).'
  '| summarize calls = sum(itemCount), p95DurationMs = percentilew(duration, itemCount, 95)'
  '| where calls >= ${latencyMinimumCalls} and p95DurationMs > ${latencyWarningMs}'
], '\n')

// 95 % of the per-attempt timeout, as an integer ms bound.
var timedOutAtMs = latencyAlertMs * 95 / 100

var timeoutRatioQuery = join([
  providerCalls
  '| summarize calls = sum(itemCount), timedOut = sumif(itemCount, duration >= ${timedOutAtMs})'
  '| extend timedOutPercent = iff(calls == 0, 0.0, 100.0 * timedOut / calls)'
  '| where calls >= ${latencyMinimumCalls} and timedOutPercent > ${timeoutRatioPercentThreshold}'
], '\n')

var spendQuery = join([
  providerCalls
  '| summarize calls = sum(itemCount)'
  '| where calls > ${callsPerHourThreshold}'
], '\n')

// --- Action group ---------------------------------------------------------------

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${resourceSuffix}-provider'
  location: 'Global'
  properties: {
    groupShortName: 'PulseProv'
    enabled: true
    emailReceivers: [
      {
        name: 'provider-owner'
        emailAddress: alertOwnerEmail
        useCommonAlertSchema: true
      }
    ]
  }
  tags: tags
}

// --- Rules ----------------------------------------------------------------------

var actions = {
  actionGroups: [
    actionGroup.id
  ]
}

var oneOfOne = {
  numberOfEvaluationPeriods: 1
  minFailingPeriodsToAlert: 1
}

resource errorRule 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${resourceSuffix}-provider-errors'
  location: location
  properties: {
    displayName: 'Pulse provider: generation errors / breaker open (${aiFoundryName})'
    description: 'Sev-2. Fires when more than ${errorRatePercentThreshold}% of model-call attempts to ${aiFoundryName} failed over 15 minutes (with at least ${errorMinimumCalls} attempts), or when a Polly BrokenCircuitException was logged (the engine-generation breaker is open and the engine has degraded to Suggest). First response: docs/guide/troubleshooting.md "I got a provider alert".'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [
      appInsightsId
    ]
    skipQueryValidation: false
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: errorQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: oneOfOne
        }
      ]
    }
    actions: actions
  }
  tags: tags
}

resource latencyWarningRule 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${resourceSuffix}-provider-latency-warning'
  location: location
  properties: {
    displayName: 'Pulse provider: latency warning, p95 > ${latencyWarningMs} ms (${aiFoundryName})'
    description: 'Sev-3. With at least ${latencyMinimumCalls} attempts in 15 minutes, the p95 of model-call attempt duration to ${aiFoundryName} exceeded ${latencyWarningMs} ms (~2x the measured Standard p95 of 2.7 s, engine-generation-infra/MEASURED-RESULTS.md). Not yet degrading; watch for the Sev-2 latency alert.'
    severity: 3
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [
      appInsightsId
    ]
    skipQueryValidation: false
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: latencyWarningQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: oneOfOne
        }
      ]
    }
    actions: actions
  }
  tags: tags
}

resource latencyAlertRule 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${resourceSuffix}-provider-latency'
  location: location
  properties: {
    displayName: 'Pulse provider: attempts timing out, > ${timeoutRatioPercentThreshold}% at the ${latencyAlertMs} ms trip (${aiFoundryName})'
    description: 'Sev-2. With at least ${latencyMinimumCalls} attempts in 15 minutes, more than ${timeoutRatioPercentThreshold}% of model-call attempts to ${aiFoundryName} ran to >= 95% of ${latencyAlertMs} ms, the per-attempt degraded-mode trip (Generation:Resilience:AttemptTimeoutSeconds, ProviderLiveConfigTests). Attempts are timing out and feeding the circuit breaker. First response: docs/guide/troubleshooting.md "I got a provider alert".'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [
      appInsightsId
    ]
    skipQueryValidation: false
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: timeoutRatioQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: oneOfOne
        }
      ]
    }
    actions: actions
  }
  tags: tags
}

resource spendRule 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${resourceSuffix}-provider-spend'
  location: location
  properties: {
    displayName: 'Pulse provider: call-volume spend proxy, > ${callsPerHourThreshold} calls/h (${aiFoundryName})'
    description: 'Sev-3. CALL-VOLUME PROXY, NOT A DOLLAR FIGURE: more than ${callsPerHourThreshold} model-call attempts to ${aiFoundryName} in the last hour (~2x a nominal active-storyline hour of 375 bursts; ~$1.20/h at the Ambient rate of $0.0016/burst, engine-generation-infra/MEASURED-RESULTS.md). Retries count as calls. For token-accurate cost open the AI generation usage panel (GET /api/engine/usage, engine-telemetry-tuning/03).'
    severity: 3
    enabled: true
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    scopes: [
      appInsightsId
    ]
    skipQueryValidation: false
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: spendQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: oneOfOne
        }
      ]
    }
    actions: actions
  }
  tags: tags
}

output actionGroupId string = actionGroup.id
output ruleNames array = [
  errorRule.name
  latencyWarningRule.name
  latencyAlertRule.name
  spendRule.name
]
