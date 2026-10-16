#Requires -Version 7.4

<#
.SYNOPSIS
    Pester 5 tests for Get-LoadTestMetrics.ps1 (post-demo-feedback/01, #547). No Azure: az is mocked through Invoke-Az.

.DESCRIPTION
    The window from -Start/-End or a harness summary.json (padded); one az call per metric with the right resource ids
    (App Service plan CPU/memory, web app Http5xx/connections, SQL cpu/workers/data IO); az output to CSV rows; a metric az
    cannot read is a WARN, not a failed run.

.EXAMPLE
    Invoke-Pester scripts/uat/Get-LoadTestMetrics.Tests.ps1 -Output Detailed
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'Get-LoadTestMetrics.ps1')
}

Describe 'Get-LoadTestMetrics.ps1' {
    BeforeAll {
        $script:AzJson = ConvertTo-Json -Depth 10 -InputObject ([ordered]@{ value = @([ordered]@{
                        name = [ordered]@{ value = 'CpuPercentage' }; unit = 'Percent'
                        timeseries = @([ordered]@{ data = @(
                                    [ordered]@{ timeStamp = '2026-10-17T08:30:00Z'; average = 41.5; maximum = 77 }
                                    [ordered]@{ timeStamp = '2026-10-17T08:31:00Z'; average = 55; maximum = 91.2 }
                                ) })
                    }) })
    }

    BeforeEach {
        $script:AzCalls = [System.Collections.Generic.List[string]]::new()
        Mock Invoke-Az { $script:AzCalls.Add($args -join ' '); return $script:AzJson }
    }

    It 'pulls every metric for the window, one az call each, and writes CSV rows' {
        $out = Join-Path $TestDrive 'm.csv'
        $code = Invoke-LoadTestMetrics -Start '2026-10-17T08:30:00Z' -End '2026-10-17T09:20:00Z' -OutFile $out -Subscription 's' -ResourceGroup 'rg' `
            -AppServicePlan 'asp' -WebAppName 'app' -SqlServer 'sql' -SqlDatabase 'db' 6>$null
        $code | Should -Be 0
        $script:AzCalls.Count | Should -Be 12
        $script:AzCalls[0] | Should -Match '^monitor metrics list --resource /subscriptions/s/resourceGroups/rg/providers/Microsoft.Web/serverfarms/asp --metrics CpuPercentage --start-time 2026-10-17T08:30:00Z --end-time 2026-10-17T09:20:00Z --interval PT1M'
        @($script:AzCalls | Where-Object { $_ -match 'Microsoft.Sql/servers/sql/databases/db --metrics (cpu_percent|workers_percent|physical_data_read_percent) ' }).Count | Should -Be 3
        @($script:AzCalls | Where-Object { $_ -match 'Microsoft.Web/sites/app --metrics (Http5xx|AppConnections) ' }).Count | Should -Be 2
        $rows = Import-Csv -LiteralPath $out
        $rows.Count | Should -Be 24
        $rows[0].timestamp | Should -Be '2026-10-17T08:30:00Z'
        $rows[0].metric | Should -Be 'CpuPercentage'
        $rows[1].maximum | Should -Be '91.2'
    }

    It 'takes the window from a harness summary.json, padded' {
        $summary = Join-Path $TestDrive 'summary.json'
        '{ "startedAt": "2026-10-17T08:30:00+00:00", "endedAt": "2026-10-17T09:10:00+00:00" }' | Set-Content -LiteralPath $summary
        $window = Resolve-MetricWindow -SummaryPath $summary -PadMinutes 5
        $window.From | Should -Be ([DateTimeOffset] '2026-10-17T08:25:00Z')
        $window.To | Should -Be ([DateTimeOffset] '2026-10-17T09:15:00Z')
    }

    It 'reads summary timestamps with their own offset (no local-time shift)' {
        $summary = Join-Path $TestDrive 'summary-offset.json'
        '{ "startedAt": "2026-10-17T03:30:00.5-05:00", "endedAt": "2026-10-17T11:10:00+02:00" }' | Set-Content -LiteralPath $summary
        $stamps = Get-SummaryTimestamps -Path $summary
        $stamps.StartedAt | Should -BeOfType [string]
        $stamps.StartedAt | Should -Be '2026-10-17T03:30:00.5-05:00'
        $window = Resolve-MetricWindow -SummaryPath $summary -PadMinutes 0
        $window.From | Should -Be ([DateTimeOffset]::Parse('2026-10-17T08:30:00.5Z', [Globalization.CultureInfo]::InvariantCulture))
        $window.To | Should -Be ([DateTimeOffset]::Parse('2026-10-17T09:10:00Z', [Globalization.CultureInfo]::InvariantCulture))
        $window.From.Offset | Should -Be ([TimeSpan]::Zero)
    }

    It 'converts az timestamps as UTC whether they arrive as strings or DateTime values' {
        (ConvertTo-UtcInstant '2026-10-17T08:30:00Z').ToString('o') | Should -Be '2026-10-17T08:30:00.0000000+00:00'
        (ConvertTo-UtcInstant '2026-10-17T08:30:00').ToString('o') | Should -Be '2026-10-17T08:30:00.0000000+00:00'
        $utc = [datetime]::SpecifyKind([datetime]::new(2026, 10, 17, 8, 30, 0), [DateTimeKind]::Utc)
        (ConvertTo-UtcInstant $utc).ToString('o') | Should -Be '2026-10-17T08:30:00.0000000+00:00'
        (ConvertTo-UtcInstant $utc.ToLocalTime()).ToString('o') | Should -Be '2026-10-17T08:30:00.0000000+00:00'
    }

    It 'a metric az cannot read is a WARN; the rest are written' {
        Mock Invoke-Az { if ("$args" -match 'sessions_percent') { throw 'az monitor failed: metric not supported' }; return $script:AzJson }
        $text = (& { $script:code = Invoke-LoadTestMetrics -Start '2026-10-17T08:30:00Z' -End '2026-10-17T09:00:00Z' -OutFile (Join-Path $TestDrive 'w.csv') } *>&1 | Out-String)
        $script:code | Should -Be 0
        $text | Should -Match '\[WARN\] .*sessions_percent'
    }

    It 'refuses a window that ends before it starts, or no window at all' {
        { Resolve-MetricWindow -Start '2026-10-17T09:00:00Z' -End '2026-10-17T08:00:00Z' } | Should -Throw '*before it starts*'
        { Resolve-MetricWindow } | Should -Throw '*-Start*'
    }
}
