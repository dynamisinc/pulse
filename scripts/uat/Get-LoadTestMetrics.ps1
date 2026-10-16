#Requires -Version 7.4

<#
.SYNOPSIS
    Pulls Azure Monitor metrics for the load-test window (post-demo-feedback/01, #547) into one CSV: the App Service
    plan's CPU and memory, the web app's HTTP 5xx, requests, connections and response time, and the SQL database's
    CPU, workers and data IO.

.DESCRIPTION
    Read-only: `az monitor metrics list` through YOUR az login (Reader on the resource group is enough). One az call per
    metric, so a metric a resource does not offer is a WARN, not a failed run. Writes one row per metric, resource and
    time grain:

        timestamp,resource,metric,unit,average,maximum,total

    to -OutFile (default scripts/uat/logs/loadtest-metrics-<start>.csv, git-ignored). Nothing secret is read or
    written.

    The harness's summary.json has the window (startedAt / endedAt); pass it with -SummaryPath, or give -Start / -End.

.PARAMETER Start
    Window start (any DateTimeOffset text; local time unless it carries an offset).

.PARAMETER End
    Window end. Default: now.

.PARAMETER SummaryPath
    A harness summary.json: its startedAt / endedAt become the window (padded by -PadMinutes on each side).

.PARAMETER Interval
    The time grain (ISO 8601). Default PT1M.

.EXAMPLE
    pwsh scripts/uat/Get-LoadTestMetrics.ps1 -SummaryPath loadtest-results/run-20261017-083000/summary.json

.EXAMPLE
    pwsh scripts/uat/Get-LoadTestMetrics.ps1 -Start '2026-10-17 08:30' -End '2026-10-17 09:20'
#>
[CmdletBinding()]
param(
    # -Start (with an optional -End) or -SummaryPath. Checked in the run, so the Pester tests can dot-source the script.
    [string] $Start,
    [string] $End,
    [string] $SummaryPath,
    [ValidateRange(0, 60)] [int] $PadMinutes = 5,
    [ValidateSet('PT1M', 'PT5M', 'PT15M', 'PT1H')] [string] $Interval = 'PT1M',
    [string] $OutFile,
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $AppServicePlan = 'asp-pulse-uat',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis',
    [string] $SqlServer = 'sql-pulse-uat',
    [string] $SqlDatabase = 'sqldb-pulse-uat'
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues = @{}
. "$PSScriptRoot/Common.ps1"

function Get-MetricPlan {
    <# Which metrics to pull from which resource (names as Azure Monitor defines them for each resource type). #>
    param([string] $Subscription, [string] $ResourceGroup, [string] $AppServicePlan, [string] $WebAppName, [string] $SqlServer, [string] $SqlDatabase)
    $base = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers"
    $plan = "$base/Microsoft.Web/serverfarms/$AppServicePlan"
    $site = "$base/Microsoft.Web/sites/$WebAppName"
    $sql = "$base/Microsoft.Sql/servers/$SqlServer/databases/$SqlDatabase"
    @(
        [pscustomobject]@{ Resource = $AppServicePlan; Id = $plan; Metric = 'CpuPercentage' }
        [pscustomobject]@{ Resource = $AppServicePlan; Id = $plan; Metric = 'MemoryPercentage' }
        [pscustomobject]@{ Resource = $WebAppName; Id = $site; Metric = 'Http5xx' }
        [pscustomobject]@{ Resource = $WebAppName; Id = $site; Metric = 'Requests' }
        [pscustomobject]@{ Resource = $WebAppName; Id = $site; Metric = 'AppConnections' }
        [pscustomobject]@{ Resource = $WebAppName; Id = $site; Metric = 'HttpResponseTime' }
        [pscustomobject]@{ Resource = $WebAppName; Id = $site; Metric = 'MemoryWorkingSet' }
        [pscustomobject]@{ Resource = $SqlDatabase; Id = $sql; Metric = 'cpu_percent' }
        [pscustomobject]@{ Resource = $SqlDatabase; Id = $sql; Metric = 'workers_percent' }
        [pscustomobject]@{ Resource = $SqlDatabase; Id = $sql; Metric = 'physical_data_read_percent' }
        [pscustomobject]@{ Resource = $SqlDatabase; Id = $sql; Metric = 'log_write_percent' }
        [pscustomobject]@{ Resource = $SqlDatabase; Id = $sql; Metric = 'sessions_percent' }
    )
}

function Resolve-MetricWindow {
    <# The window as UTC DateTimeOffsets: from -SummaryPath (padded) or -Start/-End. Throws a readable error. #>
    param([string] $Start, [string] $End, [string] $SummaryPath, [int] $PadMinutes)
    $parse = {
        param([string] $Text, [string] $What)
        $value = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse($Text, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal, [ref] $value)) { throw "$What '$Text' is not a date and time." }
        $value.ToUniversalTime()
    }
    if ($SummaryPath -and $Start) { throw 'Give -SummaryPath or -Start, not both.' }
    if (-not $SummaryPath -and -not $Start) { throw 'Give -Start (and -End), or -SummaryPath with a harness summary.json.' }
    if ($SummaryPath) {
        if (-not (Test-Path -LiteralPath $SummaryPath -PathType Leaf)) { throw "No summary at '$SummaryPath'." }
        $summary = Get-Content -LiteralPath $SummaryPath -Raw | ConvertFrom-Json -AsHashtable
        $from = (& $parse ([string] $summary['startedAt']) 'startedAt').AddMinutes(-$PadMinutes)
        $to = (& $parse ([string] $summary['endedAt']) 'endedAt').AddMinutes($PadMinutes)
    }
    else {
        $from = & $parse $Start '-Start'
        $to = if ($End) { & $parse $End '-End' } else { [DateTimeOffset]::UtcNow }
    }
    if ($to -le $from) { throw "The window ends ($($to.ToString('u'))) before it starts ($($from.ToString('u')))." }
    if (($to - $from).TotalDays -gt 30) { throw 'The window is longer than 30 days; Azure Monitor keeps 93 days but one load test is an hour.' }
    return [pscustomobject]@{ From = $from; To = $to }
}

function ConvertTo-MetricRows {
    <# az monitor metrics list JSON → rows. #>
    param([Parameter(Mandatory)] [string] $Json, [Parameter(Mandatory)] [string] $Resource)
    $doc = $Json | ConvertFrom-Json -AsHashtable
    foreach ($metric in @($doc['value'])) {
        if ($metric -isnot [System.Collections.IDictionary]) { continue }
        $name = [string] $metric['name']['value']
        foreach ($series in @($metric['timeseries'])) {
            foreach ($point in @($series['data'])) {
                if ($point -isnot [System.Collections.IDictionary]) { continue }
                [pscustomobject][ordered]@{
                    timestamp = ([DateTimeOffset] $point['timeStamp']).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
                    resource  = $Resource
                    metric    = $name
                    unit      = [string] $metric['unit']
                    average   = $point['average']
                    maximum   = $point['maximum']
                    total     = $point['total']
                }
            }
        }
    }
}

function Invoke-LoadTestMetrics {
    [CmdletBinding()]
    param([string] $Start, [string] $End, [string] $SummaryPath, [int] $PadMinutes = 5, [string] $Interval = 'PT1M', [string] $OutFile,
        [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b', [string] $ResourceGroup = 'rg-pulse-uat-centralus',
        [string] $AppServicePlan = 'asp-pulse-uat', [string] $WebAppName = 'app-pulse-api-uat-dynamis',
        [string] $SqlServer = 'sql-pulse-uat', [string] $SqlDatabase = 'sqldb-pulse-uat')
    try { $window = Resolve-MetricWindow -Start $Start -End $End -SummaryPath $SummaryPath -PadMinutes $PadMinutes }
    catch { Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red; return 1 }

    $path = if ($OutFile) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile) }
    else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'logs' ('loadtest-metrics-{0}.csv' -f $window.From.ToString('yyyyMMdd-HHmm')))) }
    Write-Host "Azure Monitor metrics $($window.From.ToString('u')) → $($window.To.ToString('u')), grain $Interval" -ForegroundColor Cyan

    $rows = [System.Collections.Generic.List[object]]::new()
    $failed = 0
    $planArgs = @{ Subscription = $Subscription; ResourceGroup = $ResourceGroup; AppServicePlan = $AppServicePlan; WebAppName = $WebAppName; SqlServer = $SqlServer; SqlDatabase = $SqlDatabase }
    foreach ($item in Get-MetricPlan @planArgs) {
        try {
            $json = Invoke-Az monitor metrics list --resource $item.Id --metrics $item.Metric `
                --start-time $window.From.ToString('yyyy-MM-ddTHH:mm:ssZ') --end-time $window.To.ToString('yyyy-MM-ddTHH:mm:ssZ') `
                --interval $Interval --aggregation Average Maximum Total -o json
            $new = @(ConvertTo-MetricRows -Json $json -Resource $item.Resource)
            $rows.AddRange([object[]] $new)
            Write-Host "  [PASS] $($item.Resource) $($item.Metric): $($new.Count) points" -ForegroundColor Green
        }
        catch {
            $failed++
            Write-Host "  [WARN] $($item.Resource) $($item.Metric): $((($_.Exception.Message) -replace '[\r\n]+', ' ').Substring(0, [Math]::Min(200, $_.Exception.Message.Length)))" -ForegroundColor Yellow
        }
    }

    $folder = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
    $rows | Export-Csv -LiteralPath $path -NoTypeInformation -Encoding utf8 -UseQuotes AsNeeded
    Write-Host "Wrote $($rows.Count) rows to $path." -ForegroundColor Cyan
    if ($rows.Count -eq 0) { Write-Host '  [FAIL] No metric came back: check az login and access to the resource group.' -ForegroundColor Red; return 1 }
    if ($failed -gt 0) { Write-Host "  $failed metric(s) could not be read (above)." -ForegroundColor Yellow }
    return 0
}

# Dot-sourcing (the Pester tests) loads the functions above and stops here.
if ($MyInvocation.InvocationName -eq '.') { return }

$runArguments = @{
    Start = $Start; End = $End; SummaryPath = $SummaryPath; PadMinutes = $PadMinutes; Interval = $Interval; OutFile = $OutFile
    Subscription = $Subscription; ResourceGroup = $ResourceGroup; AppServicePlan = $AppServicePlan; WebAppName = $WebAppName
    SqlServer = $SqlServer; SqlDatabase = $SqlDatabase
}
$exitCode = Invoke-LoadTestMetrics @runArguments | Select-Object -Last 1
exit ([int] $exitCode)
