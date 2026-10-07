#Requires -Version 7.0
<#
.SYNOPSIS
    Creates a UAT participant login with a password you choose, bound to a posting persona.

.DESCRIPTION
    Participant passwords are stored only as a slow hash, so a forgotten one can't be recovered. Make a new
    login instead. This calls the secret-gated POST /api/ops/bootstrap-exercise for the existing UAT
    exercise with a NEW username. The bootstrap never overwrites an existing account (an existing username
    is reported and left untouched), so it can't reset or clobber anyone else's login.

    It prompts for the password twice, hidden. The bootstrap secret comes from $env:PULSE_BOOTSTRAP_SECRET
    if set, otherwise from the API's App Service settings through YOUR az login. Neither the password nor
    the secret is printed, logged or written to disk.

.PARAMETER Username
    The new login name. It must not already exist in the exercise.

.PARAMETER DisplayName
    The name staff see for this account.

.PARAMETER PersonaHandle
    The persona the participant posts as. The default is FulcoEM (Fulton County EM): the starter storyline's
    silence test waits for "an official statement from Fulton County Emergency Management", so a PIO
    participant posting as @FulcoEM is what can satisfy it. Avoid the citizen personas (mvega_fh,
    tbrandt41, kwardFH, dreyes_fh): the engine writes as them, so the participant would see the engine
    posting under their own name. To change an existing login's persona, use
    Reset-DemoState.ps1 -ParticipantUsername <name> -PersonaHandle <handle>.

.EXAMPLE
    pwsh scripts/uat/New-DemoParticipant.ps1 -Username pio1 -DisplayName 'PIO (demo)'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Username,
    [string] $DisplayName = 'Demo Participant',
    [string] $PersonaHandle = 'FulcoEM',
    [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $SiteUrl = 'https://pulse-uat.cobrasoftware.com',
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"

$first = Read-Host "Password for '$Username'" -AsSecureString
$second = Read-Host 'Type it again' -AsSecureString
$password = [System.Net.NetworkCredential]::new('', $first).Password
$confirm = [System.Net.NetworkCredential]::new('', $second).Password
$first = $null; $second = $null
if ($password -cne $confirm) { $password = $null; $confirm = $null; throw 'The two passwords did not match. Nothing was created.' }
$confirm = $null
if ([string]::IsNullOrWhiteSpace($password)) { throw 'The password is empty. Nothing was created.' }

$secret = $null
$body = $null
try {
    $secret = $env:PULSE_BOOTSTRAP_SECRET
    if (-not $secret) {
        $secret = Invoke-Az webapp config appsettings list --resource-group $ResourceGroup --name $WebAppName `
            --subscription $Subscription --query "[?name=='Authentication__Bootstrap__Secret'].value | [0]" -o tsv
        if ([string]::IsNullOrWhiteSpace($secret)) {
            throw "$WebAppName has no Authentication__Bootstrap__Secret setting. Set PULSE_BOOTSTRAP_SECRET instead."
        }
        $secret = $secret.Trim()
    }

    $body = @{
        hostname           = $ApiHost
        participantAccount = @{
            username      = $Username
            displayName   = $DisplayName
            role          = 'participant'
            password      = $password
            personaHandle = $PersonaHandle
        }
    } | ConvertTo-Json -Compress

    $response = Invoke-WebRequest -Uri "https://$ApiHost/api/ops/bootstrap-exercise" -Method POST `
        -Headers @{ 'X-Bootstrap-Secret' = $secret } -Body $body -ContentType 'application/json' `
        -SkipHttpErrorCheck -TimeoutSec 90
}
finally {
    $password = $null
    $secret = $null
    $body = $null
}

switch ([int] $response.StatusCode) {
    200 {
        $account = ($response.Content | ConvertFrom-Json).participantAccount
        if ($account.created) {
            $persona = if ($account.personaBound) { "posting as @$($account.personaHandle)" } else { 'NOT bound to a persona (no composer)' }
            Write-Host "Created participant '$($account.username)', $persona." -ForegroundColor Green
            Write-Host "Sign in at $SiteUrl/login with that username and the password you just typed."
        }
        else {
            Write-Host "'$($account.username)' already exists and was NOT changed. Its old password still applies; pick a new username." -ForegroundColor Yellow
            exit 1
        }
    }
    400 { Write-Host "Rejected: $($response.Content)" -ForegroundColor Red; exit 1 }
    404 { Write-Host "404: the bootstrap secret was rejected, or no exercise is bound to $ApiHost." -ForegroundColor Red; exit 1 }
    default { Write-Host "Failed: $($response.StatusCode) $($response.Content)" -ForegroundColor Red; exit 1 }
}
