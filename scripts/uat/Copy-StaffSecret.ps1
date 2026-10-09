#Requires -Version 7.0

<#
.SYNOPSIS
    Copies a UAT staff login's secret to the clipboard, so you can sign in without it ever being shown.

.DESCRIPTION
    Staff logins (e.g. controller1) are allowlist entries in the API's App Service settings:
    Authentication__StaffIdentity__Accounts__N__Username / __DisplayName / __Secret. With no -Username,
    this lists the staff usernames and does not read any secret. With -Username, it reads that entry's
    secret through YOUR az login and puts it on the clipboard; it never prints it.

    Paste it into the staff sign-in page. Clear the clipboard afterwards (Set-Clipboard -Value $null) if
    anyone else uses this machine. Per the UAT runbook, never paste it into an agent session.

.EXAMPLE
    pwsh scripts/uat/Copy-StaffSecret.ps1

.EXAMPLE
    pwsh scripts/uat/Copy-StaffSecret.ps1 controller1
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string] $Username,
    [string] $SiteUrl = 'https://pulse-uat.cobrasoftware.com',
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"

function Get-Settings([string] $Query) {
    $json = Invoke-Az webapp config appsettings list --resource-group $ResourceGroup --name $WebAppName `
        --subscription $Subscription --query $Query -o json
    return @($json | ConvertFrom-Json)
}

# Names and display names only — no secret is read unless one is being copied.
$public = Get-Settings "[?starts_with(name, 'Authentication__StaffIdentity__Accounts__') && (ends_with(name, '__Username') || ends_with(name, '__DisplayName'))]"
$staff = foreach ($setting in $public | Where-Object { $_.name -like '*__Username' }) {
    $index = [regex]::Match($setting.name, '__Accounts__(\d+)__').Groups[1].Value
    [pscustomobject]@{
        Index       = $index
        Username    = $setting.value
        DisplayName = ($public | Where-Object name -eq "Authentication__StaffIdentity__Accounts__${index}__DisplayName").value
    }
}

if (-not $staff) { throw "No staff logins are configured on $WebAppName." }

if (-not $Username) {
    Write-Host 'Staff logins (sign in at ' -NoNewline; Write-Host "$SiteUrl/staff/login" -NoNewline -ForegroundColor Cyan; Write-Host '):'
    $staff | Sort-Object Index | Format-Table Username, DisplayName -AutoSize
    Write-Host "Copy one's secret with:  pwsh $PSCommandPath <username>"
    return
}

$entry = $staff | Where-Object { $_.Username -ieq $Username } | Select-Object -First 1
if (-not $entry) { throw "No staff login '$Username'. Available: $(@($staff.Username) -join ', ')" }

$secret = (Get-Settings "[?name == 'Authentication__StaffIdentity__Accounts__$($entry.Index)__Secret'] | [0]").value
try {
    if ([string]::IsNullOrEmpty($secret)) { throw "'$($entry.Username)' has no secret configured." }
    Set-Clipboard -Value $secret
}
finally {
    $secret = $null
}

Write-Host "Copied the secret for '$($entry.Username)' ($($entry.DisplayName)) to the clipboard." -ForegroundColor Green
Write-Host "Sign in at $SiteUrl/staff/login, paste it, then clear the clipboard: Set-Clipboard -Value `$null"
