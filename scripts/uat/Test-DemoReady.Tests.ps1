#Requires -Version 7.0

<#
.SYNOPSIS
    Pester 5 tests for Test-DemoReady.ps1 (demo-feedback story 26, #544). No network: the API and the media host are
    an in-memory fake behind a mocked Invoke-WebRequest, and Start-Sleep is mocked.

.DESCRIPTION
    Covers:
      - a healthy exercise: every check PASSES, exit 0, and the run is read-only (only GETs, apart from the sign-in
        and the sign-out, which always runs);
      - each check's PASS / WARN / FAIL with mocked responses (checks 1 to 10), each message naming the expected
        value; a 404 on GET /api/posts/{id}/edits is a WARN until Wave 4, not a FAIL;
      - the exit code of the real script: 1 on any FAIL, 0 with warnings only;
      - -Json writes the results (and nothing is written without it);
      - no secret, token or SAS link in any output stream or in the -Json file; the token never goes to the media
        host.

.EXAMPLE
    Invoke-Pester scripts/uat/Test-DemoReady.Tests.ps1 -Output Detailed
#>

BeforeAll {
    $script:ScriptFile = Join-Path $PSScriptRoot 'Test-DemoReady.ps1'
    . $script:ScriptFile

    $script:Secret = 'Sekr1t-' + [guid]::NewGuid().ToString('N')
    $script:SavedSecret = $env:PULSE_STAFF_SECRET
    $env:PULSE_STAFF_SECRET = $script:Secret

    # A small pack: p09 and p10 pinned; rs02 and rs03 seeded; rs01 left for the MSEL import (msel '4').
    $script:PackPath = Join-Path $TestDrive 'pack.json'
    [ordered]@{
        pins     = @('p09', 'p10')
        posts    = @(
            [ordered]@{ key = 'p01'; persona = 'mvega_fh'; text = 'Opening post one'; minutesBeforeAnchor = 355 }
            [ordered]@{ key = 'p09'; persona = 'KestrelCoEM'; text = 'Pinned advisory p09'; minutesBeforeAnchor = 270 }
            [ordered]@{ key = 'p10'; persona = 'FairhavenWater'; text = 'Pinned distribution p10'; minutesBeforeAnchor = 262 }
        )
        media    = @([ordered]@{ key = 'photo'; file = 'media/photo.jpg'; kind = 'image'; alt = 'The pack photo' })
        runSheet = [ordered]@{ items = @(
                [ordered]@{ key = 'rs01'; kind = 'post'; msel = '4'; title = 'Beat 2 · BREAKING video'; plannedMinute = 3 }
                [ordered]@{ key = 'rs02'; kind = 'burst'; title = 'Beat 2 · Residents react'; plannedMinute = 4 }
                [ordered]@{ key = 'rs03'; kind = 'post'; title = 'Beat 3 · Impersonator post'; plannedMinute = 6 }
            )
        }
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $script:PackPath

    function New-ReadyFake {
        <# The healthy exercise: every check passes. Tests change one part. #>
        $now = [DateTimeOffset]::UtcNow
        # The seed anchored 30 minutes ago: each pack post at anchor - minutesBeforeAnchor.
        $anchor = $now.AddMinutes(-30)
        $post = { param($Id, $Text, $Before, $Media) [ordered]@{ id = $Id; text = $Text; scenarioTime = $anchor.AddMinutes(-$Before).ToString('o'); media = @($Media); pinnedForAll = $false } }
        $fake = @{
            ExerciseId = '7e1c2f00-1111-4222-8333-444455556666'
            Token      = 'TOKEN-' + [guid]::NewGuid().ToString('N')
            Sas        = 'sig=SAS' + [guid]::NewGuid().ToString('N')
            Calls      = [System.Collections.Generic.List[object]]::new()
            Routes     = @{}
        }
        $p01 = 'aaaaaaaa-0000-4000-8000-000000000001'
        $p09 = 'aaaaaaaa-0000-4000-8000-000000000009'
        $p10 = 'aaaaaaaa-0000-4000-8000-000000000010'
        $fake.Routes['GET /health'] = @{ Status = 200; Body = 'Healthy'; Raw = $true }
        $fake.Routes['GET /health/ready'] = @{ Status = 200; Body = 'Healthy'; Raw = $true }
        $fake.Routes['GET /api/exercise-context'] = @{ Status = 200; Body = [ordered]@{ exerciseId = $fake.ExerciseId; exerciseName = 'Kestrel Demo'; timeZone = 'America/Chicago'; status = 'live' } }
        $fake.Routes['POST /api/auth/staff/login'] = @{ Status = 200; Body = [ordered]@{ token = $fake.Token; refreshToken = 'REFRESH-x'; session = [ordered]@{ actingHumanId = 'human-1' } } }
        $fake.Routes['POST /api/auth/logout'] = @{ Status = 204; Body = $null }
        $fake.Routes['GET /api/steering/pause-tier'] = @{ Status = 200; Body = [ordered]@{ tier = 'engine'; clockFrozen = $false; persisted = $true } }
        $fake.Routes['GET /api/engine/review-queue'] = @{ Status = 200; Body = @() }
        $fake.Routes['GET /api/staff/exercise-lifecycle'] = @{ Status = 200; Body = [ordered]@{ exerciseId = $fake.ExerciseId; state = 'live'; storedStatus = 'live' } }
        $fake.Routes['GET /api/engine/settings'] = @{ Status = 200; Body = [ordered]@{ provider = 'Fake'; effectiveProvider = 'Fake'; providerCutToFake = $false; alreadyFake = $true } }
        $fake.Routes['GET /api/staff/noise'] = @{ Status = 200; Body = [ordered]@{ level = 'off'; poolSize = 40; running = $false } }
        $fake.Routes['GET /api/staff/chrome-settings'] = @{ Status = 200; Body = [ordered]@{ watermarkEnabled = $true; brandName = 'Kestrel' } }
        $fake.Routes['GET /api/feed/pinned'] = @{ Status = 200; Body = [ordered]@{ items = @(
                    [ordered]@{ reason = 'exercise'; post = [ordered]@{ id = $p10; text = 'Pinned distribution p10'; pinnedForAll = $true } }
                    [ordered]@{ reason = 'exercise'; post = [ordered]@{ id = $p09; text = 'Pinned advisory p09'; pinnedForAll = $true } }
                )
            }
        }
        $fake.Routes['GET /api/injects'] = @{ Status = 200; Body = [ordered]@{ pauseTier = 'engine'; items = @(
                    [ordered]@{ id = [guid]::NewGuid().ToString(); kind = 'burst'; title = 'Beat 2 · Residents react'; status = 'pending' }
                    [ordered]@{ id = [guid]::NewGuid().ToString(); kind = 'post'; title = 'Beat 3 · Impersonator post'; status = 'pending' }
                )
            }
        }
        $fake.Routes['GET /api/feed'] = @{ Status = 200; Body = @(
                (& $post $p10 'Pinned distribution p10' 262 ([ordered]@{ id = 'm1'; kind = 'image'; url = "https://media.fake.test/c/photo.jpg?$($fake.Sas)"; alt = 'a' }))
                (& $post $p09 'Pinned advisory p09' 270 ([ordered]@{ id = 'm2'; kind = 'video'; url = "https://media.fake.test/c/clip.mp4?$($fake.Sas)"; alt = 'b' }))
                (& $post $p01 'Opening post one' 355 $null)
            )
        }
        $fake.Routes["GET /api/posts/$p10/edits"] = @{ Status = 200; Body = [ordered]@{ postId = $p10; versions = @() } }
        $fake.Routes['GET /c/photo.jpg'] = @{ Status = 206; Body = 'xx'; Raw = $true; ContentType = 'image/jpeg' }
        $fake.Routes['GET /c/clip.mp4'] = @{ Status = 206; Body = 'xx'; Raw = $true; ContentType = 'video/mp4' }
        return $fake
    }

    function Invoke-FakeWeb {
        param($Uri, $Method, $Headers, $Body)
        $fake = $global:ReadyFake
        $u = [Uri] [string] $Uri
        $m = if ($Method) { ([string] $Method).ToUpperInvariant() } else { 'GET' }
        $h = @{}
        if ($Headers) { foreach ($k in $Headers.Keys) { $h[$k] = [string] $Headers[$k] } }
        $text = if ($Body -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Body) } elseif ($Body) { [string] $Body } else { '' }
        $fake.Calls.Add([pscustomobject]@{ Method = $m; Host = $u.Host; Path = $u.AbsolutePath; Headers = $h; Body = $text })
        $route = $fake.Routes["$m $($u.AbsolutePath)"]
        if (-not $route) { return [pscustomobject]@{ StatusCode = 404; Content = ''; Headers = @{} } }
        if ($u.Host -ne 'media.fake.test' -and $u.AbsolutePath -notlike '/health*' -and $u.AbsolutePath -notin '/api/exercise-context', '/api/auth/staff/login' -and $h['Authorization'] -cne "Bearer $($fake.Token)") {
            return [pscustomobject]@{ StatusCode = 401; Content = ''; Headers = @{} }
        }
        $content = if ($route.Raw) { [string] $route.Body } elseif ($null -eq $route.Body) { '' } else { ConvertTo-Json -InputObject $route.Body -Depth 10 -Compress }
        $type = if ($route.ContentType) { $route.ContentType } else { 'application/json; charset=utf-8' }
        return [pscustomobject]@{ StatusCode = $route.Status; Content = $content; Headers = @{ 'Content-Type' = @($type) } }
    }

    function Invoke-Ready {
        <# Runs the check (the function, as the script's last lines do); returns { Code; Text; Results }. #>
        param([hashtable] $Extra = @{})
        $arguments = @{ ApiHost = 'api.fake.test'; SiteUrl = 'https://site.fake.test'; StaffUsername = 'controller1'; PackPath = $script:PackPath }
        foreach ($key in $Extra.Keys) { $arguments[$key] = $Extra[$key] }
        $code = $null
        $text = (& { $script:code = Invoke-DemoReadyCheck @arguments } *>&1 | Out-String)
        return [pscustomobject]@{ Code = $script:code; Text = $text; Results = @($script:ReadyResults) }
    }

    function Get-Result([object] $Run, [string] $Number, [string] $Check) {
        @($Run.Results | Where-Object { $_.number -eq $Number -and $_.check -like $Check })
    }
}

AfterAll {
    $env:PULSE_STAFF_SECRET = $script:SavedSecret
    Remove-Variable -Name ReadyFake -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Test-DemoReady.ps1' {
    BeforeEach {
        $global:ReadyFake = New-ReadyFake
        Mock Invoke-WebRequest { Invoke-FakeWeb -Uri $Uri -Method $Method -Headers $Headers -Body $Body }
        Mock Start-Sleep { }
        Mock Invoke-Az { throw 'az must not be called while PULSE_STAFF_SECRET is set' }
    }

    Describe 'A demo-ready exercise' {
        It 'passes every check (1 to 10), each naming its expected value, and returns 0' {
            $run = Invoke-Ready
            $run.Code | Should -Be 0
            @($run.Results | Where-Object { $_.status -ne 'PASS' -and $_.check -ne 'Noise posts in the opening feed' }) | Should -BeNullOrEmpty
            @($run.Results.number | Sort-Object -Unique { [int] $_ }) | Should -Be @('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11')
            foreach ($result in $run.Results) { $result.detail | Should -Match 'expected' }
            $run.Text | Should -Match 'READY — '
        }

        It 'is read-only: every request is a GET apart from the sign-in and the sign-out' {
            Invoke-Ready | Out-Null
            $writes = @($global:ReadyFake.Calls | Where-Object Method -ne 'GET' | ForEach-Object { "$($_.Method) $($_.Path)" })
            $writes | Should -Be @('POST /api/auth/staff/login', 'POST /api/auth/logout')
            $global:ReadyFake.Calls[-1].Path | Should -Be '/api/auth/logout'
        }

        It 'signs in as Import-Roster does: { username, secret, exerciseId } for the host''s exercise; -ExerciseId overrides it' {
            Invoke-Ready | Out-Null
            $login = $global:ReadyFake.Calls | Where-Object Path -eq '/api/auth/staff/login'
            $body = $login.Body | ConvertFrom-Json
            $body.username | Should -Be 'controller1'
            $body.secret | Should -Be $script:Secret
            $body.exerciseId | Should -Be $global:ReadyFake.ExerciseId

            $global:ReadyFake.Calls.Clear()
            $other = '11111111-2222-4333-8444-555555555555'
            Invoke-Ready -Extra @{ ExerciseId = $other } | Out-Null
            (($global:ReadyFake.Calls | Where-Object Path -eq '/api/auth/staff/login').Body | ConvertFrom-Json).exerciseId | Should -Be $other
        }

        It 'signs out even when a check throws (no answer from the API)' {
            Mock Invoke-WebRequest {
                if (([Uri] [string] $Uri).AbsolutePath -eq '/api/engine/settings') { throw [System.Net.Http.HttpRequestException]::new('connection reset') }
                Invoke-FakeWeb -Uri $Uri -Method $Method -Headers $Headers -Body $Body
            }
            $run = Invoke-Ready
            (Get-Result $run 4 'Generation provider').status | Should -Be 'FAIL'
            (Get-Result $run 4 'Generation provider').detail | Should -Match 'No answer from the API to GET /api/engine/settings'
            $run.Code | Should -Be 1
            $global:ReadyFake.Calls[-1].Path | Should -Be '/api/auth/logout'
            # The other checks still ran.
            (Get-Result $run 10 'Route /api/posts*').status | Should -Be 'PASS'
        }
    }

    Describe 'Check 1: health, wake time and schema' {
        It 'reports the serverless SQL wake time' {
            $run = Invoke-Ready
            (Get-Result $run 1 'API health').detail | Should -Match 'database answering after \d+ s .*wakes serverless SQL'
        }

        It '/health down: FAIL, no sign-in, exit 1' {
            $global:ReadyFake.Routes['GET /health'] = @{ Status = 503; Body = ''; Raw = $true }
            $run = Invoke-Ready
            (Get-Result $run 1 'API health').status | Should -Be 'FAIL'
            (Get-Result $run 1 'API health').detail | Should -Match 'expected /health 200; got 503'
            @($global:ReadyFake.Calls | Where-Object Path -eq '/api/auth/staff/login') | Should -BeNullOrEmpty
            $run.Code | Should -Be 1
        }

        It '/health/ready slow to wake: retried, then PASS' {
            $script:readyCalls = 0
            Mock Invoke-WebRequest {
                if (([Uri] [string] $Uri).AbsolutePath -eq '/health/ready' -and $script:readyCalls++ -lt 2) { return [pscustomobject]@{ StatusCode = 503; Content = ''; Headers = @{} } }
                Invoke-FakeWeb -Uri $Uri -Method $Method -Headers $Headers -Body $Body
            }
            $run = Invoke-Ready
            (Get-Result $run 1 'API health').status | Should -Be 'PASS'
            Should -Invoke Start-Sleep -Times 2 -Exactly
        }

        It 'a 5xx from exercise-context (code and schema disagree): FAIL' {
            $global:ReadyFake.Routes['GET /api/exercise-context'] = @{ Status = 500; Body = ''; Raw = $true }
            $run = Invoke-Ready
            (Get-Result $run 1 'Schema matches code').status | Should -Be 'FAIL'
            (Get-Result $run 1 'Schema matches code').detail | Should -Match 'expected /api/exercise-context 200; got 500'
            $run.Code | Should -Be 1
        }

        It 'Wave 4 schema: <Name>' -ForEach @(
            @{ Name = 'persisted true (17 deployed) is PASS'; Persisted = $true; Status = 'PASS'; Pattern = 'DemoFeedbackWave4RuntimeAndEdits.*deployed' }
            @{ Name = 'no persisted field (before 17) is WARN'; Persisted = 'absent'; Status = 'WARN'; Pattern = 'DemoFeedbackWave4RuntimeAndEdits.*not deployed yet' }
            @{ Name = 'persisted false (write-through failed) is WARN'; Persisted = $false; Status = 'WARN'; Pattern = 'persisted = false' }
        ) {
            $tier = [ordered]@{ tier = 'engine'; clockFrozen = $false }
            if ('absent' -ne $Persisted) { $tier['persisted'] = $Persisted }
            $global:ReadyFake.Routes['GET /api/steering/pause-tier'] = @{ Status = 200; Body = $tier }
            $run = Invoke-Ready
            (Get-Result $run 1 'Wave 4 schema').status | Should -Be $Status
            (Get-Result $run 1 'Wave 4 schema').detail | Should -Match $Pattern
            $run.Code | Should -Be 0
        }
    }

    Describe 'Check 2: pause tier' {
        It '<Tier> is <Status>' -ForEach @(
            @{ Tier = 'engine'; Status = 'PASS'; Pattern = 'expected engine \(DF-38\); got engine' }
            @{ Tier = 'running'; Status = 'FAIL'; Pattern = 'expected engine; got running' }
            @{ Tier = 'injects'; Status = 'FAIL'; Pattern = 'expected engine; got injects' }
            @{ Tier = 'freeze'; Status = 'FAIL'; Pattern = 'expected engine; got freeze\. Never leave FROZEN' }
        ) {
            $global:ReadyFake.Routes['GET /api/steering/pause-tier'] = @{ Status = 200; Body = [ordered]@{ tier = $Tier; clockFrozen = ($Tier -eq 'freeze'); persisted = $true } }
            $run = Invoke-Ready
            (Get-Result $run 2 'Pause tier').status | Should -Be $Status
            (Get-Result $run 2 'Pause tier').detail | Should -Match $Pattern
            $run.Code | Should -Be ([int] ($Status -eq 'FAIL'))
        }
    }

    Describe 'Check 3: engine review queue' {
        It 'a response that is not a JSON array is FAIL "unexpected shape" (L-2)' {
            $global:ReadyFake.Routes['GET /api/engine/review-queue'] = @{ Status = 200; Body = [ordered]@{ items = @() } }
            $run = Invoke-Ready
            (Get-Result $run 3 'Engine review queue').status | Should -Be 'FAIL'
            (Get-Result $run 3 'Engine review queue').detail | Should -Match 'unexpected shape'
        }

        It '<Count> pending draft(s) is <Status>' -ForEach @(
            @{ Count = 0; Status = 'PASS' }
            @{ Count = 1; Status = 'WARN' }
            @{ Count = 5; Status = 'WARN' }
            @{ Count = 6; Status = 'FAIL' }
        ) {
            $dispositions = 'queued', 'counting-down', 'held'
            $items = @(for ($i = 0; $i -lt $Count; $i++) { [ordered]@{ draftId = [guid]::NewGuid().ToString(); disposition = $dispositions[$i % 3] } })
            $global:ReadyFake.Routes['GET /api/engine/review-queue'] = @{ Status = 200; Body = $items }
            $run = Invoke-Ready
            (Get-Result $run 3 'Engine review queue').status | Should -Be $Status
            (Get-Result $run 3 'Engine review queue').detail | Should -Match "expected 0 pending drafts; got $Count"
            $run.Code | Should -Be ([int] ($Status -eq 'FAIL'))
        }
    }

    Describe 'Check 4: generation provider (DF-38)' {
        It 'the effective provider decides: <Name>' -ForEach @(
            @{ Name = 'Fake is PASS'; Provider = 'Fake'; Effective = 'Fake'; Status = 'PASS' }
            @{ Name = 'AzureOpenAI is FAIL'; Provider = 'AzureOpenAI'; Effective = 'AzureOpenAI'; Status = 'FAIL' }
            @{ Name = 'AzureOpenAI cut to Fake is PASS'; Provider = 'AzureOpenAI'; Effective = 'Fake'; Status = 'PASS' }
        ) {
            $global:ReadyFake.Routes['GET /api/engine/settings'] = @{ Status = 200; Body = [ordered]@{ provider = $Provider; effectiveProvider = $Effective } }
            $run = Invoke-Ready
            (Get-Result $run 4 'Generation provider').status | Should -Be $Status
            (Get-Result $run 4 'Generation provider').detail | Should -Match "expected Fake \(DF-38\); got $Effective"
        }
    }

    Describe 'Check 5: white noise and media marking' {
        It 'noise not off is FAIL' {
            $global:ReadyFake.Routes['GET /api/staff/noise'] = @{ Status = 200; Body = [ordered]@{ level = 'low'; poolSize = 40 } }
            $run = Invoke-Ready
            (Get-Result $run 5 'White noise').status | Should -Be 'FAIL'
            (Get-Result $run 5 'White noise').detail | Should -Match 'expected off; got low'
            $run.Code | Should -Be 1
        }

        It 'noise posts in the opening feed: SKIP (the feed has no origin field), with the noise count and last time; no effect on the exit code' {
            $global:ReadyFake.Routes['GET /api/staff/noise'] = @{ Status = 200; Body = [ordered]@{ level = 'off'; poolSize = 40; postedCount = 7; lastPostedAt = '2026-10-20T13:55:00.0000000+00:00'; running = $false } }
            $run = Invoke-Ready
            $result = Get-Result $run 5 'Noise posts in the opening feed'
            $result.status | Should -Be 'SKIP'
            $result.detail | Should -Match 'does not expose a post''s origin'
            $result.detail | Should -Match 'published 7 post\(s\), the last at scenario time 2026-10-20 13:55 UTC'
            $run.Code | Should -Be 0
        }

        It 'media marking off is FAIL' {
            $global:ReadyFake.Routes['GET /api/staff/chrome-settings'] = @{ Status = 200; Body = [ordered]@{ watermarkEnabled = $false } }
            $run = Invoke-Ready
            (Get-Result $run 5 'Media marking').status | Should -Be 'FAIL'
            (Get-Result $run 5 'Media marking').detail | Should -Match 'expected watermarkEnabled on; got off'
        }
    }

    Describe 'Check 6: exercise pins' {
        It 'a pack pin missing from the pinned feed is FAIL, naming it' {
            $global:ReadyFake.Routes['GET /api/feed/pinned'].Body.items = @($global:ReadyFake.Routes['GET /api/feed/pinned'].Body.items[1])
            $run = Invoke-Ready
            (Get-Result $run 6 'Exercise pins').status | Should -Be 'FAIL'
            (Get-Result $run 6 'Exercise pins').detail | Should -Match 'expected p09, p10 pinned for everyone; missing p10'
        }

        It 'a personal pin (reason "own") does not count' {
            $global:ReadyFake.Routes['GET /api/feed/pinned'].Body.items[0].reason = 'own'
            (Get-Result (Invoke-Ready) 6 'Exercise pins').status | Should -Be 'FAIL'
        }
    }

    Describe 'Check 7: run sheet (DF-16)' {
        It 'two pending copies of one seeded item is WARN, naming it (L-6)' {
            $global:ReadyFake.Routes['GET /api/injects'].Body.items += [ordered]@{ id = 'dup'; kind = 'burst'; title = 'Beat 2 · Residents react'; status = 'pending' }
            $run = Invoke-Ready
            (Get-Result $run 7 'Run sheet').status | Should -Be 'WARN'
            (Get-Result $run 7 'Run sheet').detail | Should -Match 'duplicate pending copies of a seeded item: rs02 \(2 pending\)'
            $run.Code | Should -Be 0
        }

        It 'a seeded item that is not pending is FAIL' {
            $global:ReadyFake.Routes['GET /api/injects'].Body.items[0].status = 'fired'
            $run = Invoke-Ready
            (Get-Result $run 7 'Run sheet').status | Should -Be 'FAIL'
            (Get-Result $run 7 'Run sheet').detail | Should -Match 'expected the 2 seeded items pending.*rs02 \(fired\)'
        }

        It 'a seeded item missing is FAIL' {
            $global:ReadyFake.Routes['GET /api/injects'].Body.items = @($global:ReadyFake.Routes['GET /api/injects'].Body.items[0])
            (Get-Result (Invoke-Ready) 7 'Run sheet').detail | Should -Match 'rs03 \(not in the queue\)'
        }

        It 'a pending item the seed did not load (an MSEL import) is FAIL' {
            $global:ReadyFake.Routes['GET /api/injects'].Body.items += [ordered]@{ id = 'x'; kind = 'post'; title = 'Metro Desk 9 breaking video: second main break on Mill Road'; status = 'pending' }
            $run = Invoke-Ready
            (Get-Result $run 7 'Run sheet').status | Should -Be 'FAIL'
            (Get-Result $run 7 'Run sheet').detail | Should -Match 'an MSEL import or a console item.*Clear-DemoContent'
        }

        It 'an armable seeded copy of an msel item is FAIL (the import would add a second one)' {
            $global:ReadyFake.Routes['GET /api/injects'].Body.items += [ordered]@{ id = 'y'; kind = 'post'; title = 'Beat 2 · BREAKING video'; status = 'held' }
            (Get-Result (Invoke-Ready) 7 'Run sheet').detail | Should -Match 'seeded copy of an msel item still armable'
        }

        It 'a spent item the seed did not load is WARN, not FAIL' {
            $global:ReadyFake.Routes['GET /api/injects'].Body.items += [ordered]@{ id = 'z'; kind = 'post'; title = 'Utility crew reports a second leak'; status = 'fired' }
            $run = Invoke-Ready
            (Get-Result $run 7 'Run sheet').status | Should -Be 'WARN'
            $run.Code | Should -Be 0
        }

        It 'spent earlier copies of seeded items are fine while a pending copy exists' {
            $global:ReadyFake.Routes['GET /api/injects'].Body.items += [ordered]@{ id = 'old'; kind = 'burst'; title = 'Beat 2 · Residents react'; status = 'fired' }
            (Get-Result (Invoke-Ready) 7 'Run sheet').status | Should -Be 'PASS'
        }
    }

    Describe 'Check 11: exercise lifecycle' {
        It '<State> is <Status>' -ForEach @(
            @{ State = 'live'; Status = 'PASS'; Pattern = 'expected live; got live' }
            @{ State = 'staged'; Status = 'WARN'; Pattern = 'participants see the pre-start page until StartEx' }
            @{ State = 'paused'; Status = 'FAIL'; Pattern = 'expected live \(or staged\); got paused' }
            @{ State = 'completed'; Status = 'FAIL'; Pattern = 'got completed' }
            @{ State = 'build'; Status = 'FAIL'; Pattern = 'got build' }
        ) {
            $global:ReadyFake.Routes['GET /api/staff/exercise-lifecycle'].Body.state = $State
            $run = Invoke-Ready
            (Get-Result $run 11 'Exercise lifecycle').status | Should -Be $Status
            (Get-Result $run 11 'Exercise lifecycle').detail | Should -Match $Pattern
            $run.Code | Should -Be ([int] ($Status -eq 'FAIL'))
        }

        It 'is read with the signed-in session (so -ExerciseId is honoured)' {
            Invoke-Ready | Out-Null
            ($global:ReadyFake.Calls | Where-Object Path -eq '/api/staff/exercise-lifecycle').Headers['Authorization'] | Should -Be "Bearer $($global:ReadyFake.Token)"
        }
    }

    Describe '-ApiHost is normalized before any request (PR #548 review)' {
        It '<Value> is read as the bare host api.fake.test' -ForEach @(
            @{ Value = 'https://api.fake.test' }
            @{ Value = 'https://api.fake.test/' }
            @{ Value = 'api.fake.test/' }
            @{ Value = 'https://API.fake.test/swagger/index.html?x=1' }
        ) {
            $path = Join-Path $TestDrive "host-$([guid]::NewGuid().ToString('N')).json"
            $run = Invoke-Ready -Extra @{ ApiHost = $Value; Json = $true; JsonPath = $path }
            $run.Code | Should -Be 0
            @($global:ReadyFake.Calls | Where-Object Host -ne 'media.fake.test' | ForEach-Object Host | Select-Object -Unique) | Should -Be 'api.fake.test'
            (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json).apiHost | Should -Be 'api.fake.test'
        }

        It '<Value> is refused before anything is sent' -ForEach @(
            @{ Value = 'ftp://api.fake.test' }
            @{ Value = 'not a host' }
            @{ Value = 'https://user:pw@api.fake.test' }
            @{ Value = 'http://api.fake.test' }
            @{ Value = '   ' }
        ) {
            $run = Invoke-Ready -Extra @{ ApiHost = $Value }
            $run.Code | Should -Be 1
            $global:ReadyFake.Calls | Should -BeNullOrEmpty
            $run.Text | Should -Match 'Nothing was sent'
        }
    }

    Describe 'Check 8: media (SAS reachable)' {
        It 'prefers a pack image (by file name or alt) over a newer non-pack one, and falls back to any (L-6)' {
            $other = [ordered]@{ id = 'bbbbbbbb-0000-4000-8000-000000000001'; text = 'A participant photo'; scenarioTime = [DateTimeOffset]::UtcNow.ToString('o'); media = @([ordered]@{ id = 'm9'; kind = 'image'; url = "https://media.fake.test/c/other.jpg?$($global:ReadyFake.Sas)"; alt = 'x' }) }
            $global:ReadyFake.Routes['GET /api/feed'].Body = @($other) + @($global:ReadyFake.Routes['GET /api/feed'].Body)
            $global:ReadyFake.Routes['GET /c/other.jpg'] = @{ Status = 206; Body = 'xx'; Raw = $true; ContentType = 'image/jpeg' }
            Invoke-Ready | Out-Null
            @($global:ReadyFake.Calls | Where-Object { $_.Host -eq 'media.fake.test' -and $_.Path -like '*.jpg' }).Path | Should -Be '/c/photo.jpg'

            # Matched by alt alone too.
            $global:ReadyFake.Calls.Clear()
            $global:ReadyFake.Routes['GET /api/feed'].Body[1].media[0].url = "https://media.fake.test/c/renamed.jpg?$($global:ReadyFake.Sas)"
            $global:ReadyFake.Routes['GET /api/feed'].Body[1].media[0].alt = 'The pack photo'
            $global:ReadyFake.Routes['GET /c/renamed.jpg'] = @{ Status = 206; Body = 'xx'; Raw = $true; ContentType = 'image/jpeg' }
            Invoke-Ready | Out-Null
            @($global:ReadyFake.Calls | Where-Object { $_.Host -eq 'media.fake.test' -and $_.Path -like '*.jpg' }).Path | Should -Be '/c/renamed.jpg'

            # No pack image in the feed: the first image of any kind.
            $global:ReadyFake.Calls.Clear()
            $global:ReadyFake.Routes['GET /api/feed'].Body[1].media[0].alt = 'not the pack'
            $run = Invoke-Ready
            @($global:ReadyFake.Calls | Where-Object { $_.Host -eq 'media.fake.test' -and $_.Path -like '*.jpg' }).Path | Should -Be '/c/other.jpg'
            (Get-Result $run 8 'Media (image)').status | Should -Be 'PASS'
        }

        It 'probes one image and one video with a ranged GET and WITHOUT the session token' {
            Invoke-Ready | Out-Null
            $media = @($global:ReadyFake.Calls | Where-Object Host -eq 'media.fake.test')
            $media.Path | Should -Be @('/c/photo.jpg', '/c/clip.mp4')
            foreach ($call in $media) {
                $call.Headers['Range'] | Should -Be 'bytes=0-1'
                $call.Headers.ContainsKey('Authorization') | Should -BeFalse
            }
        }

        It '<Name> is FAIL' -ForEach @(
            @{ Name = 'a 403 (expired SAS)'; Status = 403; Type = 'application/xml' }
            @{ Name = 'a wrong content type'; Status = 200; Type = 'text/html' }
        ) {
            $global:ReadyFake.Routes['GET /c/photo.jpg'] = @{ Status = $Status; Body = 'x'; Raw = $true; ContentType = $Type }
            $run = Invoke-Ready
            (Get-Result $run 8 'Media (image)').status | Should -Be 'FAIL'
            (Get-Result $run 8 'Media (image)').detail | Should -Match "expected 200 with image/\*; got $Status"
            (Get-Result $run 8 'Media (video)').status | Should -Be 'PASS'
        }

        It 'a feed without a video is FAIL' {
            $global:ReadyFake.Routes['GET /api/feed'].Body[1].media = @()
            (Get-Result (Invoke-Ready) 8 'Media (video)').detail | Should -Match 'the feed has no video'
        }
    }

    Describe 'Check 9: scenario clock' {
        It 'a minute inside the pack''s window is PASS, and says the server clock has no read route' {
            $result = Get-Result (Invoke-Ready) 9 'Scenario clock'
            $result.status | Should -Be 'PASS'
            $result.detail | Should -Match 'got minute 30 '
            $result.detail | Should -Match 'no read route'
        }

        It 'prints the anchor in UTC (L-5)' {
            $p10 = $global:ReadyFake.Routes['GET /api/feed'].Body[0]
            $anchor = ([DateTimeOffset] $p10.scenarioTime).AddMinutes(262).UtcDateTime.ToString('yyyy-MM-dd HH:mm')
            (Get-Result (Invoke-Ready) 9 'Scenario clock').detail | Should -Match ([regex]::Escape("seed anchor $anchor UTC"))
        }

        It 'a seed older than the window (13 h) is WARN' {
            foreach ($post in $global:ReadyFake.Routes['GET /api/feed'].Body) { $post.scenarioTime = ([DateTimeOffset] $post.scenarioTime).AddHours(-13).ToString('o') }
            $run = Invoke-Ready
            (Get-Result $run 9 'Scenario clock').status | Should -Be 'WARN'
            (Get-Result $run 9 'Scenario clock').detail | Should -Match 'expected a minute inside the pack''s window \(0 to 720'
            $run.Code | Should -Be 0
        }

        It 'a frozen server clock is WARN' {
            $global:ReadyFake.Routes['GET /api/steering/pause-tier'].Body.clockFrozen = $true
            (Get-Result (Invoke-Ready) 9 'Scenario clock').detail | Should -Match 'FROZEN'
        }
    }

    Describe 'Check 10: Wave 3/4 routes' {
        It 'a pinned read that threw (no status) is FAIL, never PASS (L-1)' {
            Mock Invoke-WebRequest {
                if (([Uri] [string] $Uri).AbsolutePath -eq '/api/feed/pinned') { throw [System.Net.Http.HttpRequestException]::new('connection reset') }
                Invoke-FakeWeb -Uri $Uri -Method $Method -Headers $Headers -Body $Body
            }
            $run = Invoke-Ready
            (Get-Result $run 10 'Route /api/feed/pinned').status | Should -Be 'FAIL'
            (Get-Result $run 10 'Route /api/feed/pinned').detail | Should -Match 'no answer'
        }

        It 'GET /api/posts/{id}/edits 404 is a WARN until Wave 4 deploys, not a FAIL' {
            $global:ReadyFake.Routes.Remove(($global:ReadyFake.Routes.Keys | Where-Object { $_ -like '*/edits' }))
            $run = Invoke-Ready
            (Get-Result $run 10 'Route /api/posts*').status | Should -Be 'WARN'
            (Get-Result $run 10 'Route /api/posts*').detail | Should -Match 'Wave 4 \(story 19\) is not deployed yet'
            $run.Code | Should -Be 0
        }

        It 'asks about a seeded post (the pack post nearest the anchor)' {
            Invoke-Ready | Out-Null
            @($global:ReadyFake.Calls | Where-Object Path -like '/api/posts/*/edits').Path | Should -Be '/api/posts/aaaaaaaa-0000-4000-8000-000000000010/edits'
        }

        It 'GET /api/feed/pinned 404 is FAIL' {
            $global:ReadyFake.Routes.Remove('GET /api/feed/pinned')
            $run = Invoke-Ready
            (Get-Result $run 10 'Route /api/feed/pinned').status | Should -Be 'FAIL'
            $run.Code | Should -Be 1
        }
    }

    Describe 'Exit code, -Json and secrets (the real script)' {
        It 'exits 1 on any FAIL and 0 with warnings only' {
            $global:ReadyFake.Routes['GET /api/steering/pause-tier'].Body.tier = 'running'
            & $script:ScriptFile -ApiHost api.fake.test -PackPath $script:PackPath *>&1 | Out-Null
            $LASTEXITCODE | Should -Be 1

            $global:ReadyFake = New-ReadyFake
            $global:ReadyFake.Routes['GET /api/engine/review-queue'].Body = @([ordered]@{ draftId = 'd'; disposition = 'queued' })
            & $script:ScriptFile -ApiHost api.fake.test -PackPath $script:PackPath *>&1 | Out-Null
            $LASTEXITCODE | Should -Be 0
        }

        It '-Json writes every result, the counts and ready; without -Json nothing is written' {
            $path = Join-Path $TestDrive 'logs/ready.json'
            & $script:ScriptFile -ApiHost api.fake.test -PackPath $script:PackPath -Json -JsonPath $path *>&1 | Out-Null
            $doc = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
            $doc.ready | Should -BeTrue
            $doc.exerciseId | Should -Be $global:ReadyFake.ExerciseId
            $doc.counts.fail | Should -Be 0
            @($doc.results).Count | Should -BeGreaterThan 10
            @($doc.results | Where-Object { $_.status -ne 'PASS' -and $_.check -ne 'Noise posts in the opening feed' }) | Should -BeNullOrEmpty

            Mock Write-ReadyJson { }
            Invoke-Ready | Out-Null
            Should -Invoke Write-ReadyJson -Times 0 -Exactly
        }

        It 'never shows the secret, the token or a SAS link, in any stream or the -Json file (with -Verbose -Debug)' {
            $path = Join-Path $TestDrive 'secret-check.json'
            $global:ReadyFake.Routes['GET /api/engine/settings'] = @{ Status = 500; Body = ''; Raw = $true }
            $text = & $script:ScriptFile -ApiHost api.fake.test -PackPath $script:PackPath -Json -JsonPath $path -Verbose -Debug *>&1 | Out-String
            $file = Get-Content -LiteralPath $path -Raw
            foreach ($needle in $script:Secret, $global:ReadyFake.Token, $global:ReadyFake.Sas) {
                $text | Should -Not -Match ([regex]::Escape($needle))
                $file | Should -Not -Match ([regex]::Escape($needle))
                ($global:Error | Out-String) | Should -Not -Match ([regex]::Escape($needle))
            }
            # The secret goes only in the sign-in body; the token only to the API host.
            @($global:ReadyFake.Calls | Where-Object { $_.Body -match [regex]::Escape($script:Secret) }).Path | Should -Be '/api/auth/staff/login'
            @($global:ReadyFake.Calls | Where-Object { $_.Headers['Authorization'] } | Where-Object Host -ne 'api.fake.test') | Should -BeNullOrEmpty
        }
    }
}
