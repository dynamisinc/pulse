#Requires -Version 7.0

<#
.SYNOPSIS
    Pester 5 tests for Seed-DemoContent.ps1 (story S1, #443). No network: the API is an in-memory fake behind a
    mocked Invoke-WebRequest, and media range probes are mocked.

.DESCRIPTION
    Covers, per the story's Tests section:
      - the pack validation matrix (one case per rule) and the JSON Schema for pack.json;
      - the offset math (scenarioTime = anchor - minutesBeforeAnchor, posting order, anchor choice and -Resume);
      - manifest idempotency (a second run plans and issues zero uploads, zero posts and zero run-sheet items; a
        lost manifest, archived posts or a deleted run-sheet item never duplicate);
      - the run-sheet load: the inject queue's rules (one case per rule), the exact POST /api/injects bodies,
        assignees, a 400's detail, 429, and uncertain creates that are adopted, never sent twice. The fake
        enforces the server's own 400 rules (InjectItemValidator) independently of the script;
      - no secret or token in any output stream or file;
      - the public-API allowlist (a grep over the script itself) and no direct database access.

.EXAMPLE
    Invoke-Pester scripts/uat/Seed-DemoContent.Tests.ps1 -Output Detailed
#>

BeforeAll {
    . "$PSScriptRoot/Seed-DemoContent.ps1"

    $script:ScriptFile = Join-Path $PSScriptRoot 'Seed-DemoContent.ps1'
    $script:FixtureRoot = Join-Path $PSScriptRoot 'test-fixtures/demo-pack'
    $script:FixturePath = Join-Path $script:FixtureRoot 'pack.json'
    $script:SchemaPath = Join-Path $PSScriptRoot '../../docs/demo/pack/schema/pack.schema.json'

    function Get-FixturePack { ConvertFrom-SeedJson (Get-Content -LiteralPath $script:FixturePath -Raw) }

    function Get-PackCodes {
        param($Pack, [string] $Root = $script:FixtureRoot, [hashtable] $Limits = (Get-SeedLimits))
        @(Test-DemoPack -Pack $Pack -PackRoot $Root -Limits $Limits | ForEach-Object Code | Sort-Object -Unique)
    }

    function Get-FixtureUnits { @(Get-PackUploadUnits -Pack (Get-FixturePack) -PackRoot $script:FixtureRoot) }

    function Copy-Map([System.Collections.IDictionary] $Map) {
        $copy = [ordered]@{}
        foreach ($key in $Map.Keys) { $copy[$key] = $Map[$key] }
        return $copy
    }

    function New-FullManifest {
        <# The manifest a complete earlier run would have left (every file uploaded by $Username, every post made). #>
        param([object[]] $Units, [string] $Username = 'controller1', [hashtable] $PostIds = @{})
        $manifest = New-SeedManifest -ExerciseId '11111111-2222-4333-8444-555555555555' -ApiHost 'fake'
        $ids = @{}
        foreach ($unit in $Units) { $ids[$unit.File] = [guid]::NewGuid().ToString() }
        foreach ($unit in $Units) {
            $entry = [ordered]@{ assetId = $ids[$unit.File]; sha256 = $unit.Sha256; kind = $unit.Kind; uploadedBy = $Username }
            if ($unit.PosterFile) {
                $entry['posterAssetId'] = $ids[$unit.PosterFile]
                $entry['posterSha256'] = ($Units | Where-Object File -eq $unit.PosterFile).Sha256
            }
            $manifest['files'][$unit.File] = $entry
        }
        foreach ($key in $PostIds.Keys) { $manifest['posts'][$key] = [ordered]@{ postId = $PostIds[$key]; scenarioTime = '2026-10-19T12:00:00.000Z' } }
        $manifest['anchor'] = '2026-10-19T14:00:00.000Z'
        return $manifest
    }

    # ── The in-memory fake of the public API surface (the request shapes the real endpoints enforce) ──────────
    function New-FakePulse {
        $fake = @{
            ExerciseId = '11111111-2222-4333-8444-555555555555'
            Token = 'TOKEN-' + [guid]::NewGuid().ToString('N')
            Refresh = 'REFRESH-' + [guid]::NewGuid().ToString('N')
            Secret = 'Sekr1t-' + [guid]::NewGuid().ToString('N')
            StaffId = 'f0000000-0000-4000-8000-00000000000f'
            Personas = [ordered]@{}; Assets = [ordered]@{}
            Posts = [System.Collections.Generic.List[object]]::new()
            Calls = [System.Collections.Generic.List[object]]::new()
            FailPostNumber = 0; PostAttempts = 0; RateLimitFirstUpload = $false; Tier = 'running'
            # The inject queue (inject-queue 06): live items in queue order, the staff roster, and per-attempt faults
            # for POST /api/injects (attempt number → 'rate-limited' | 'lost-before-write' | 'lost-after-write' |
            # '408-after-write' | '503-after-write' | 'unreadable-201').
            Injects = [System.Collections.Generic.List[object]]::new()
            InjectAttempts = 0; InjectFaults = @{}
            Roster = @(
                [ordered]@{ id = 'f0000000-0000-4000-8000-00000000000f'; displayName = 'Casey Controller'; role = 'controller' }
                [ordered]@{ id = 'e0000000-0000-4000-8000-00000000000e'; displayName = 'Eve Evaluator'; role = 'evaluator' }
            )
        }
        foreach ($handle in 'FulcoEM', 'Newsline7', 'mvega_fh') {
            $id = [guid]::NewGuid().ToString()
            $fake.Personas[$id] = [ordered]@{ id = $id; handle = $handle; displayName = "$handle (seeded)"; verified = $false; kind = 'organization'; avatarMediaId = $null; bannerMediaId = $null }
        }
        return $fake
    }

    function Test-FakeInjectWrite {
        <#
        .SYNOPSIS
            The server's 400 rules for POST /api/injects (InjectItemValidator.Parse, then CheckReferences), written
            out here independently of the script, with the server's own messages. Returns the first ProblemDetails
            detail, or $null when the body is valid.
        #>
        param($Fake, $Request)
        $runes = { param([string] $Text) @($Text.EnumerateRunes()).Count }
        $isInt = { param($Value) $Value -is [int] -or $Value -is [long] }
        if ($Request -isnot [System.Collections.IDictionary]) { return 'A JSON body is required.' }
        if (@('post', 'burst') -cnotcontains $Request['kind']) { return "kind must be 'post' or 'burst'." }
        $title = ([string] $Request['title']).Trim()
        if (-not $title -or (& $runes $title) -gt 120) { return 'title must be between 1 and 120 characters.' }
        if ($null -ne $Request['notes'] -and (& $runes ([string] $Request['notes']).Trim()) -gt 500) { return 'notes must be at most 500 characters.' }
        if ($null -ne $Request['plannedMinute'] -and (-not (& $isInt $Request['plannedMinute']) -or $Request['plannedMinute'] -lt 0)) { return 'plannedMinute must be a whole number of minutes, 0 or more.' }
        $posts = $Request['posts']
        if ($posts -isnot [System.Collections.IList] -or $posts.Count -eq 0) { return 'posts is required.' }
        if ($Request['kind'] -ceq 'post' -and $posts.Count -ne 1) { return "A 'post' item must have exactly 1 post." }
        if ($Request['kind'] -ceq 'burst') {
            if ($posts.Count -lt 2 -or $posts.Count -gt 20) { return "A 'burst' must have between 2 and 20 posts." }
            $window = if ($null -ne $Request['burstWindowSeconds']) { $Request['burstWindowSeconds'] } else { 90 }
            if (-not (& $isInt $window) -or $window -lt 30 -or $window -gt 600) { return 'burstWindowSeconds must be between 30 and 600.' }
            $needed = 3 * ($posts.Count - 1)
            if ($window -lt $needed) { return "A burst of $($posts.Count) posts needs a window of at least $needed seconds (3 s between posts)." }
        }
        for ($i = 0; $i -lt $posts.Count; $i++) {
            $post = $posts[$i]; $label = "Post $($i + 1)"
            if ($post -isnot [System.Collections.IDictionary]) { return "${label}: a post object is required." }
            $text = ([string] $post['text']).Trim()
            if (-not $text -or (& $runes $text) -gt 280) { return "${label}: text must be between 1 and 280 characters." }
            $media = @($post['media'] | Where-Object { $null -ne $_ })
            if ($media.Count -gt 4) { return "${label}: A post may carry up to 4 images or exactly 1 video, never both." }
            $seen = @{}
            foreach ($item in $media) {
                if ([string]::IsNullOrWhiteSpace([string] $item['mediaId'])) { return "${label}: every media item needs a mediaId." }
                if ($seen.Contains([string] $item['mediaId'])) { return "${label}: The same mediaId cannot be attached twice." }
                $seen[[string] $item['mediaId']] = $true
                $alt = ([string] $item['alt']).Trim()
                if (-not $alt) { return "${label}: alt text is required on every media item." }
                if ($alt.Length -gt 1000) { return "${label}: alt text must be at most 1000 characters." }
            }
            $reply = $post['replyTo']
            if ($null -ne $reply) {
                $forms = @(@($reply['injectPostId'], $reply['postId']) | Where-Object { -not [string]::IsNullOrWhiteSpace([string] $_) }).Count + $(if ($null -ne $reply['sequence']) { 1 } else { 0 })
                if ($forms -ne 1) { return "${label}: replyTo must name exactly one of injectPostId, postId or sequence." }
                if ($null -ne $reply['sequence'] -and (-not (& $isInt $reply['sequence']) -or $reply['sequence'] -lt 1 -or $reply['sequence'] -ge $i + 1)) {
                    return "${label}: replyTo.sequence must name an earlier post in this item."
                }
            }
            $baseline = $post['engagementBaseline']
            if ($baseline -is [System.Collections.IDictionary]) {
                foreach ($name in 'like', 'repost', 'reply') {
                    if ($null -ne $baseline[$name] -and ($baseline[$name] -lt 0 -or $baseline[$name] -gt 1000000)) { return "${label}: engagementBaseline counts must be between 0 and 1,000,000." }
                }
            }
        }
        # References, as the service resolves them in scope.
        $assignee = [string] $Request['assigneeId']
        if ($assignee.Trim() -and @($Fake.Roster | Where-Object { $_.id -eq $assignee }).Count -eq 0) { return 'assigneeId does not name a staff member assigned to this exercise.' }
        $children = @($Fake.Injects | ForEach-Object { $_.posts } | ForEach-Object { $_.id })
        for ($i = 0; $i -lt $posts.Count; $i++) {
            $post = $posts[$i]; $label = "Post $($i + 1)"
            if (-not $Fake.Personas.Contains([string] $post['personaId'])) { return "${label}: personaId does not name a persona in this exercise." }
            $media = @($post['media'] | Where-Object { $null -ne $_ })
            foreach ($item in $media) { if (-not $Fake.Assets.Contains([string] $item['mediaId'])) { return "${label}: One or more media items could not be found." } }
            $videos = @($media | Where-Object { $Fake.Assets[[string] $_['mediaId']].kind -eq 'video' }).Count
            if ($videos -gt 0 -and $media.Count -ne 1) { return "${label}: A post may carry up to 4 images or exactly 1 video, never both." }
            $reply = $post['replyTo']
            if ($null -ne $reply -and $reply['postId'] -and -not ($Fake.Posts | Where-Object id -eq $reply['postId'])) { return "${label}: replyTo.postId does not name a post in this exercise." }
            if ($null -ne $reply -and $reply['injectPostId'] -and $children -notcontains $reply['injectPostId']) { return "${label}: replyTo.injectPostId does not name a scripted post in this exercise." }
        }
        return $null
    }

    function New-FakeInjectItem {
        <# The item the server stores and returns (InjectItemDto): pending, at the end of the queue; a { sequence } reply is stored as { injectPostId }. #>
        param($Fake, $Request)
        $ids = @($Request['posts'] | ForEach-Object { [guid]::NewGuid().ToString() })
        $posts = for ($i = 0; $i -lt $Request['posts'].Count; $i++) {
            $source = $Request['posts'][$i]
            $post = [ordered]@{ id = $ids[$i]; sequence = $i + 1; status = 'pending'; personaId = [string] $source['personaId']; text = ([string] $source['text']).Trim() }
            if ($source['media']) { $post['media'] = @($source['media'] | ForEach-Object { [ordered]@{ mediaId = $_['mediaId']; alt = ([string] $_['alt']).Trim() } }) }
            $reply = $source['replyTo']
            if ($null -ne $reply) {
                $post['replyTo'] = if ($null -ne $reply['sequence']) { [ordered]@{ injectPostId = $ids[$reply['sequence'] - 1] } }
                elseif ($reply['injectPostId']) { [ordered]@{ injectPostId = $reply['injectPostId'] } }
                else { [ordered]@{ postId = $reply['postId'] } }
            }
            if ($source['engagementBaseline']) { $post['engagementBaseline'] = $source['engagementBaseline'] }
            $post
        }
        $item = [ordered]@{ id = [guid]::NewGuid().ToString(); kind = $Request['kind']; title = ([string] $Request['title']).Trim() }
        if ($Request['notes']) { $item['notes'] = ([string] $Request['notes']).Trim() }
        if ($null -ne $Request['plannedMinute']) { $item['plannedMinute'] = $Request['plannedMinute'] }
        if ($Request['assigneeId']) { $item['assigneeId'] = $Request['assigneeId'] }
        if ($Request['kind'] -eq 'burst') { $item['burstWindowSeconds'] = $(if ($null -ne $Request['burstWindowSeconds']) { $Request['burstWindowSeconds'] } else { 90 }) }
        $item['order'] = $Fake.Injects.Count + 1
        $item['status'] = 'pending'
        $item['posts'] = @($posts)
        $item['firedCount'] = 0; $item['total'] = @($posts).Count; $item['version'] = 1
        $item['createdByHumanId'] = $Fake.StaffId; $item['updatedAt'] = '2026-10-19T14:00:00.000Z'
        return $item
    }

    function Invoke-FakePulse {
        param($Fake, [string] $Uri, [string] $Method, [hashtable] $Headers, $Body, [System.Collections.IDictionary] $Form, [string] $ContentType)
        $uriObject = [Uri] $Uri
        $path = $uriObject.AbsolutePath
        $query = $uriObject.Query
        $bodyText = if ($Body -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Body) } elseif ($Body) { [string] $Body } else { '' }
        $authorized = $Headers -and $Headers['Authorization'] -ceq "Bearer $($Fake.Token)"
        $Fake.Calls.Add([pscustomobject]@{ Method = $Method; Path = $path; Query = $query; Uri = $Uri; Body = $bodyText; ContentType = $ContentType; Authorized = $authorized; Headers = $Headers; Form = $Form })
        $reply = { param([int] $Status, $Json, [hashtable] $ResponseHeaders = @{})
            [pscustomobject]@{ StatusCode = $Status; Content = $(if ($null -ne $Json) { ConvertTo-Json -InputObject $Json -Depth 20 } else { '' }); Headers = $ResponseHeaders } }
        $blob = { param($Id) "https://blob.fake.test/post-media/$Id`?sig=SAS" }
        $personaView = {
            param($p)
            $view = [ordered]@{ id = $p.id; handle = $p.handle; displayName = $p.displayName; verified = $p.verified; kind = $p.kind }
            foreach ($field in 'bio', 'location') { if ($p.Contains($field) -and $null -ne $p[$field]) { $view[$field] = $p[$field] } }
            if ($p.avatarMediaId) { $view['avatarUrl'] = & $blob $p.avatarMediaId }
            if ($p.bannerMediaId) { $view['bannerUrl'] = & $blob $p.bannerMediaId }
            $view
        }
        $postView = {
            param($post)
            $view = [ordered]@{ id = $post.id; authorPersonaId = $post.authorPersonaId; text = $post.text; scenarioTime = $post.scenarioTime; counts = $post.counts }
            if ($post.media.Count) {
                $view['media'] = @(foreach ($m in $post.media) {
                        $asset = $Fake.Assets[$m.mediaId]
                        $item = [ordered]@{ id = $asset.id; kind = $asset.kind; url = (& $blob $asset.id); alt = $m.alt }
                        if ($asset.poster) { $item['posterUrl'] = & $blob $asset.poster }
                        $item
                    })
            }
            if ($post.parent) {
                $parent = $Fake.Posts | Where-Object id -eq $post.parent
                $view['inReplyTo'] = [ordered]@{ postId = $parent.id; authorHandle = $Fake.Personas[$parent.authorPersonaId].handle }
            }
            $view
        }

        if ($path -eq '/api/exercise-context') { return & $reply 200 ([ordered]@{ exerciseId = $Fake.ExerciseId; exerciseName = 'Fake'; timeZone = 'America/Chicago'; status = 'live' }) }
        if ($path -eq '/api/auth/staff/login') {
            $login = ConvertFrom-SeedJson $bodyText
            if ($login.secret -cne $Fake.Secret -or $login.username -ne 'controller1') { return & $reply 401 $null }
            if ($login.exerciseId -ne $Fake.ExerciseId) { return & $reply 403 $null }
            return & $reply 200 ([ordered]@{ token = $Fake.Token; refreshToken = $Fake.Refresh; session = [ordered]@{ exerciseId = $Fake.ExerciseId; role = 'controller'; actingHumanId = $Fake.StaffId } })
        }
        if (-not $authorized) { return & $reply 401 $null }
        switch -Regex ($path) {
            '^/api/personas$' { return & $reply 200 @($Fake.Personas.Values | ForEach-Object { & $personaView $_ }) }
            '^/api/staff/personas/(?<id>[0-9a-f-]+)$' {
                if ($ContentType -notlike 'application/merge-patch+json*') { return & $reply 415 'Content-Type must be application/json or application/merge-patch+json.' }
                $persona = $Fake.Personas[$Matches.id]
                if (-not $persona) { return & $reply 404 $null }
                $patch = ConvertFrom-SeedJson $bodyText
                foreach ($key in $patch.Keys) {
                    if ($key -notin 'displayName', 'bio', 'location', 'verified', 'avatarMediaId', 'bannerMediaId') { return & $reply 400 "Unknown field '$key'." }
                    $persona[$key] = $patch[$key]
                }
                return & $reply 200 (& $personaView $persona)
            }
            '^/api/staff/media$' {
                $kind = [regex]::Match($query, 'kind=(\w+)').Groups[1].Value
                $posters = @($Fake.Assets.Values | Where-Object poster | ForEach-Object poster)
                return & $reply 200 @($Fake.Assets.Values | Where-Object { $_.kind -eq $kind -and $posters -notcontains $_.id } | ForEach-Object { [ordered]@{ id = $_.id; kind = $_.kind; url = (& $blob $_.id); fileName = $_.fileName; uploadedAtScenario = '2026-10-19T00:00:00.000Z' } })
            }
            '^/api/media$' {
                if ($Fake.RateLimitFirstUpload) { $Fake.RateLimitFirstUpload = $false; return & $reply 429 ([ordered]@{ error = 'rate-limited' }) @{ 'Retry-After' = @('7') } }
                if (-not $Form -or $Form['file'] -isnot [IO.FileInfo]) { return & $reply 400 "A 'file' part is required." }
                $sniff = Get-MediaSniff -Head (Read-FileHead -Path $Form['file'].FullName)
                if (-not $sniff) { return & $reply 415 'Unsupported file type.' }
                if ($Form.Contains('kind') -and $Form['kind'] -ne $sniff.Kind) { return & $reply 415 "The file's contents do not match the 'kind' hint." }
                $poster = $null
                if ($Form.Contains('posterMediaId')) {
                    $poster = [string] $Form['posterMediaId']
                    $posterAsset = $Fake.Assets[$poster]
                    if ($sniff.Kind -ne 'video' -or -not $posterAsset -or $posterAsset.kind -ne 'image') { return & $reply 400 'posterMediaId does not name an image you uploaded in this exercise.' }
                }
                $id = [guid]::NewGuid().ToString()
                $Fake.Assets[$id] = [ordered]@{ id = $id; kind = $sniff.Kind; poster = $poster; fileName = $Form['file'].Name }
                $view = [ordered]@{ id = $id; kind = $sniff.Kind; url = (& $blob $id) }
                if ($poster) { $view['posterUrl'] = & $blob $poster }
                return & $reply 201 $view
            }
            '^/api/posts$' {
                $Fake.PostAttempts++
                if ($Fake.FailPostNumber -and $Fake.PostAttempts -eq $Fake.FailPostNumber) { return & $reply 500 $null }
                $request = ConvertFrom-SeedJson $bodyText
                if ($request.origin -ne 'controller-as-persona') { return & $reply 400 "A staff session may only post with origin 'controller-as-persona'." }
                if (-not $Fake.Personas.Contains([string] $request.authorPersonaId)) { return & $reply 400 'authorPersonaId does not name a persona in this exercise.' }
                if (-not $request.timeZone) { return & $reply 400 'timeZone is required.' }
                if ($request.parentPostId -and -not ($Fake.Posts | Where-Object id -eq $request.parentPostId)) { return & $reply 400 'parentPostId does not name a post in this exercise.' }
                foreach ($m in @($request.media)) { if ($m -and -not $Fake.Assets.Contains([string] $m.mediaId)) { return & $reply 400 'One or more media items could not be found.' } }
                $baseline = if ($request.engagementBaseline) { $request.engagementBaseline } else { @{} }
                $post = [ordered]@{
                    id = [guid]::NewGuid().ToString(); authorPersonaId = $request.authorPersonaId; text = $request.text; scenarioTime = $request.scenarioTime
                    media = @($request.media | Where-Object { $_ }); parent = $request.parentPostId
                    counts = [ordered]@{ reply = [int] $baseline.reply; repost = [int] $baseline.repost; like = [int] $baseline.like }
                }
                $Fake.Posts.Add($post)
                return & $reply 201 (& $postView $post)
            }
            '^/api/feed$' {
                $include = $query -match 'includeReplies=true'
                $rows = @($Fake.Posts | Where-Object { $include -or -not $_.parent } | Sort-Object { $_.scenarioTime } -Descending | Select-Object -First 200)
                return & $reply 200 @($rows | ForEach-Object { & $postView $_ })
            }
            '^/api/steering/pause-tier$' {
                if ($Method -eq 'GET') { return & $reply 200 ([ordered]@{ tier = $Fake.Tier; clockFrozen = ($Fake.Tier -eq 'freeze') }) }
                $request = ConvertFrom-SeedJson $bodyText
                if (-not $request.actingHumanId) { return & $reply 400 'actingHumanId is required (COR-018).' }
                $Fake.Tier = $request.tier
                return & $reply 200 ([ordered]@{ tier = $Fake.Tier; clockFrozen = $false })
            }
            '^/api/injects/assignees$' { return & $reply 200 ([ordered]@{ me = $Fake.StaffId; assignees = @($Fake.Roster) }) }
            '^/api/injects$' {
                if ($Method -eq 'GET') { return & $reply 200 ([ordered]@{ items = @($Fake.Injects); pauseTier = $Fake.Tier }) }
                $Fake.InjectAttempts++
                $fault = $Fake.InjectFaults[$Fake.InjectAttempts]
                $problem = { param([int] $Status, [string] $Detail) & $reply $Status ([ordered]@{ type = 'https://tools.ietf.org/html/rfc9110'; title = 'Error'; status = $Status; detail = $Detail }) }
                if ($fault -eq 'rate-limited') { return & $reply 429 ([ordered]@{ title = 'Too Many Requests'; status = 429; detail = 'Slow down.' }) @{ 'Retry-After' = @('5') } }
                if ($fault -eq 'lost-before-write') { throw [System.Net.Http.HttpRequestException]::new('The response ended prematurely.') }
                $request = ConvertFrom-SeedJson $bodyText
                $detail = Test-FakeInjectWrite -Fake $Fake -Request $request
                if ($detail) { return & $problem 400 $detail }
                $item = New-FakeInjectItem -Fake $Fake -Request $request
                $Fake.Injects.Add($item)
                switch ($fault) {
                    'lost-after-write' { throw [System.Net.Http.HttpRequestException]::new('The response ended prematurely.') }
                    '408-after-write' { return & $problem 408 'Request timed out.' }
                    '503-after-write' { return & $problem 503 'The database did not answer in time.' }
                    'unreadable-201' { return [pscustomobject]@{ StatusCode = 201; Content = '<html>gateway</html>'; Headers = @{} } }
                }
                return & $reply 201 $item
            }
        }
        return & $reply 404 $null
    }

    function Invoke-FakeSeed {
        <# Runs the whole script against $script:Fake. Returns @{ Code; Text } (all output streams as text). #>
        param([hashtable] $Extra = @{})
        $arguments = @{
            PackPath = $script:FixturePath; ApiHost = 'api.fake.test'; SiteUrl = 'https://site.fake.test'; StaffUsername = 'controller1'
            ManifestDirectory = (Join-Path $TestDrive 'manifests')
        }
        foreach ($key in $Extra.Keys) { $arguments[$key] = $Extra[$key] }
        $all = @(Invoke-DemoSeed @arguments *>&1)
        [pscustomobject]@{
            Code = [int] ($all | Where-Object { $_ -is [int] } | Select-Object -Last 1)
            Text = ($all | Where-Object { $_ -isnot [int] } | ForEach-Object { "$_" }) -join "`n"
        }
    }

    function Get-FakeCalls([string] $Method, [string] $Path) { @($script:Fake.Calls | Where-Object { $_.Method -eq $Method -and $_.Path -eq $Path }) }

    # ── A REAL HTTP server (System.Net.HttpListener on localhost, in a background runspace). No mocks: the actual
    #    web cmdlet runs, so its debug stream, its error records and its redirect handling are what get tested. ──
    function Get-FreeTcpPort {
        $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
        $probe.Start(); $port = ([System.Net.IPEndPoint] $probe.LocalEndpoint).Port; $probe.Stop()
        return $port
    }

    function Start-SeedTestServer {
        param([string] $Mode = 'api')
        $port = Get-FreeTcpPort
        $listener = [System.Net.HttpListener]::new()
        $listener.Prefixes.Add("http://localhost:$port/")
        $listener.Start()
        $state = [hashtable]::Synchronized(@{
                Mode = $Mode; Port = $port
                Secret = 'Sekr1t-' + [guid]::NewGuid().ToString('N'); Token = 'TOKEN-' + [guid]::NewGuid().ToString('N')
                Refresh = 'REFRESH-' + [guid]::NewGuid().ToString('N'); StaffId = 'f0000000-0000-4000-8000-00000000000f'
                ExerciseId = '22222222-3333-4444-8555-666666666666'; Tier = 'running'
                Personas = [ordered]@{}; Assets = [ordered]@{}; Posts = [System.Collections.ArrayList]::new()
                Injects = [System.Collections.ArrayList]::new()
                Hits = [System.Collections.ArrayList]::new(); Bodies = [System.Collections.ArrayList]::new()
            })
        foreach ($handle in 'FulcoEM', 'Newsline7', 'mvega_fh') {
            $id = [guid]::NewGuid().ToString()
            $state.Personas[$id] = [ordered]@{ id = $id; handle = $handle; displayName = $handle; verified = $false; kind = 'organization' }
        }
        $loop = {
            param($Listener, $State)
            $send = {
                param($Context, [int] $Status, $Value, [hashtable] $Headers = @{}, [byte[]] $Raw)
                $response = $Context.Response
                $response.StatusCode = $Status
                foreach ($key in $Headers.Keys) { $response.Headers[$key] = $Headers[$key] }
                $bytes = if ($Raw) { $Raw } elseif ($null -ne $Value) { $response.ContentType = 'application/json; charset=utf-8'; [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 20 -Compress)) } else { [byte[]]::new(0) }
                $response.ContentLength64 = $bytes.Length
                if ($bytes.Length) { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
                $response.Close()
            }
            while ($Listener.IsListening) {
                try { $context = $Listener.GetContext() } catch { break }
                try {
                    $request = $context.Request
                    $buffer = [IO.MemoryStream]::new(); $request.InputStream.CopyTo($buffer); $bytes = $buffer.ToArray()
                    $text = [Text.Encoding]::UTF8.GetString($bytes)
                    $path = $request.Url.AbsolutePath; $method = $request.HttpMethod
                    $base = "http://localhost:$($State.Port)"
                    [void] $State.Hits.Add("$method $path"); [void] $State.Bodies.Add($text)
                    $blob = { param($Id) "$base/blob/$Id" }
                    $personaView = {
                        param($p)
                        $v = [ordered]@{ id = $p.id; handle = $p.handle; displayName = $p.displayName; verified = $p.verified; kind = $p.kind }
                        foreach ($f in 'bio', 'location') { if ($p.Contains($f) -and $null -ne $p[$f]) { $v[$f] = $p[$f] } }
                        if ($p['avatarMediaId']) { $v.avatarUrl = & $blob $p['avatarMediaId'] }
                        if ($p['bannerMediaId']) { $v.bannerUrl = & $blob $p['bannerMediaId'] }
                        $v
                    }
                    $postView = {
                        param($post)
                        $v = [ordered]@{ id = $post.id; authorPersonaId = $post.authorPersonaId; text = $post.text; scenarioTime = $post.scenarioTime; counts = [ordered]@{ reply = 0; repost = 0; like = 0 } }
                        if ($post.media.Count) {
                            $v.media = @(foreach ($m in $post.media) {
                                    $a = $State.Assets[[string] $m.mediaId]
                                    $item = [ordered]@{ id = $a.id; kind = $a.kind; url = (& $blob $a.id); alt = $m.alt }
                                    if ($a.poster) { $item.posterUrl = & $blob $a.poster }
                                    $item
                                })
                        }
                        if ($post.parent) { $v.inReplyTo = [ordered]@{ postId = $post.parent; authorHandle = 'x' } }
                        $v
                    }
                    if ($State.Mode -eq 'redirect' -and $path -notlike '/elsewhere*') { & $send $context 307 $null @{ Location = "$base/elsewhere$path" }; continue }
                    if ($path -like '/elsewhere*') { & $send $context 200 ([ordered]@{ followed = $true }); continue }
                    if ($path -like '/blob/*') {
                        if ($request.Headers['Authorization']) { & $send $context 400 'token sent to the blob host'; continue }
                        if ($request.Headers['Range'] -eq 'bytes=0-1') { & $send $context 206 $null @{ 'Content-Range' = 'bytes 0-1/2' } ([byte[]] (1, 2)) } else { & $send $context 200 $null @{} ([byte[]] (1, 2)) }
                        continue
                    }
                    if ($path -eq '/api/exercise-context') { & $send $context 200 ([ordered]@{ exerciseId = $State.ExerciseId; exerciseName = 'Listener'; timeZone = 'America/Chicago'; status = 'live' }); continue }
                    if ($path -eq '/api/auth/staff/login') {
                        $login = ConvertFrom-Json -InputObject $text -AsHashtable
                        if ($login.secret -cne $State.Secret) { & $send $context 401 $null; continue }
                        & $send $context 200 ([ordered]@{ token = $State.Token; refreshToken = $State.Refresh; session = [ordered]@{ exerciseId = $State.ExerciseId; role = 'controller'; actingHumanId = $State.StaffId } })
                        continue
                    }
                    if ($request.Headers['Authorization'] -cne "Bearer $($State.Token)") { & $send $context 401 $null; continue }
                    if ($path -eq '/api/personas') { & $send $context 200 @($State.Personas.Values | ForEach-Object { & $personaView $_ }); continue }
                    if ($path -match '^/api/staff/personas/(?<id>[0-9a-f-]+)$') {
                        $persona = $State.Personas[$Matches.id]
                        foreach ($entry in (ConvertFrom-Json -InputObject $text -AsHashtable).GetEnumerator()) { $persona[$entry.Key] = $entry.Value }
                        & $send $context 200 (& $personaView $persona); continue
                    }
                    if ($path -eq '/api/staff/media') { & $send $context 200 @(); continue }
                    if ($path -eq '/api/media') {
                        $latin = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
                        $field = { param($Name) $m = [regex]::Match($latin, "name=`"?$Name`"?\r\n(?:[^\r\n]+\r\n)*\r\n(?<v>[^\r\n]*)"); if ($m.Success) { $m.Groups['v'].Value } }
                        $id = [guid]::NewGuid().ToString()
                        $State.Assets[$id] = [ordered]@{ id = $id; kind = (& $field 'kind'); poster = (& $field 'posterMediaId') }
                        $view = [ordered]@{ id = $id; kind = $State.Assets[$id].kind; url = (& $blob $id) }
                        & $send $context 201 $view; continue
                    }
                    if ($path -eq '/api/posts') {
                        $body = ConvertFrom-Json -InputObject $text -AsHashtable
                        $post = [ordered]@{ id = [guid]::NewGuid().ToString(); authorPersonaId = $body.authorPersonaId; text = $body.text; scenarioTime = [string] $body.scenarioTime; media = @($body.media | Where-Object { $_ }); parent = $body.parentPostId }
                        [void] $State.Posts.Add($post)
                        & $send $context 201 (& $postView $post); continue
                    }
                    if ($path -eq '/api/feed') {
                        $include = $request.Url.Query -match 'includeReplies=true'
                        $rows = @($State.Posts | Where-Object { $include -or -not $_.parent } | Sort-Object { $_.scenarioTime } -Descending)
                        & $send $context 200 @($rows | ForEach-Object { & $postView $_ }); continue
                    }
                    if ($path -eq '/api/steering/pause-tier') {
                        if ($method -eq 'POST') { $State.Tier = (ConvertFrom-Json -InputObject $text -AsHashtable).tier }
                        & $send $context 200 ([ordered]@{ tier = $State.Tier; clockFrozen = $false }); continue
                    }
                    if ($path -eq '/api/injects/assignees') {
                        & $send $context 200 ([ordered]@{ me = $State.StaffId; assignees = @(
                                    [ordered]@{ id = $State.StaffId; displayName = 'Casey Controller'; role = 'controller' }
                                    [ordered]@{ id = 'e0000000-0000-4000-8000-00000000000e'; displayName = 'Eve Evaluator'; role = 'evaluator' }) })
                        continue
                    }
                    if ($path -eq '/api/injects') {
                        if ($method -eq 'POST') {
                            $body = ConvertFrom-Json -InputObject $text -AsHashtable
                            $item = [ordered]@{ id = [guid]::NewGuid().ToString(); kind = $body.kind; title = $body.title; order = $State.Injects.Count + 1; status = 'pending'
                                posts = @(for ($i = 0; $i -lt $body.posts.Count; $i++) { [ordered]@{ id = [guid]::NewGuid().ToString(); sequence = $i + 1; status = 'pending'; personaId = $body.posts[$i].personaId; text = $body.posts[$i].text } }) }
                            [void] $State.Injects.Add($item)
                            & $send $context 201 $item; continue
                        }
                        & $send $context 200 ([ordered]@{ items = @($State.Injects); pauseTier = $State.Tier }); continue
                    }
                    & $send $context 404 $null
                }
                catch { try { $context.Response.StatusCode = 500; $context.Response.Close() } catch { } }
            }
        }
        $shell = [powershell]::Create()
        [void] $shell.AddScript($loop).AddArgument($listener).AddArgument($state)
        $handle = $shell.BeginInvoke()
        [pscustomobject]@{ BaseUrl = "http://localhost:$port"; State = $state; Listener = $listener; Shell = $shell; Handle = $handle }
    }

    function Stop-SeedTestServer($Server) {
        if (-not $Server) { return }
        try { $Server.Listener.Stop(); $Server.Listener.Close() } catch { }
        try { [void] $Server.Shell.EndInvoke($Server.Handle) } catch { }
        $Server.Shell.Dispose()
    }
}

Describe 'Pack validation (implementation.md §1.10 rules, one case per rule)' {
    It 'accepts the fixture pack' {
        Get-PackCodes (Get-FixturePack) | Should -BeNullOrEmpty
    }

    It '<Name> -> <Code>' -ForEach @(
        @{ Name = 'wrong schema id'; Code = 'schema-id'; Mutate = { param($p) $p['schema'] = 'pulse.demopack.v2' } }
        @{ Name = 'unknown field (typo)'; Code = 'unknown-field'; Mutate = { param($p) $p['posts'][0]['minutesBeforeAncor'] = 5 } }
        @{ Name = 'section of the wrong type'; Code = 'type'; Mutate = { param($p) $p['personas'] = 'none' } }
        @{ Name = 'media key with a space'; Code = 'key-format'; Mutate = { param($p) $p['media'] += [ordered]@{ key = 'has space'; file = 'avatars/fulcoem.png'; kind = 'image'; alt = 'x' } } }
        @{ Name = 'duplicate media key'; Code = 'duplicate-key'; Mutate = { param($p) $p['media'] += [ordered]@{ key = 'harbor-photo'; file = 'avatars/fulcoem.png'; kind = 'image'; alt = 'x' } } }
        @{ Name = 'duplicate post key'; Code = 'duplicate-key'; Mutate = { param($p) $p['posts'] += [ordered]@{ key = 'p02'; persona = 'FulcoEM'; text = 'again'; minutesBeforeAnchor = 1 } } }
        @{ Name = 'one file declared by two media keys'; Code = 'duplicate-file'; Mutate = { param($p) $p['media'] += [ordered]@{ key = 'again'; file = 'media/harbor-photo.jpg'; kind = 'image'; alt = 'x' } } }
        @{ Name = 'handle with @'; Code = 'handle-format'; Mutate = { param($p) $p['posts'][0]['persona'] = '@Newsline7' } }
        @{ Name = 'same persona twice (case-insensitive)'; Code = 'duplicate-handle'; Mutate = { param($p) $p['personas'][1]['handle'] = 'fulcoem' } }
        @{ Name = 'display name with a bidi override'; Code = 'display-name'; Mutate = { param($p) $p['personas'][0]['displayName'] = "Fair`u{202E}haven" } }
        @{ Name = 'bio over 512'; Code = 'bio'; Mutate = { param($p) $p['personas'][0]['bio'] = 'b' * 513 } }
        @{ Name = 'location over 100'; Code = 'location'; Mutate = { param($p) $p['personas'][0]['location'] = 'l' * 101 } }
        @{ Name = 'verified not a boolean'; Code = 'verified'; Mutate = { param($p) $p['personas'][0]['verified'] = 'yes' } }
        @{ Name = 'media kind not image/video'; Code = 'media-kind'; Mutate = { param($p) $p['media'][0]['kind'] = 'gif' } }
        @{ Name = 'file missing'; Code = 'file-missing'; Mutate = { param($p) $p['media'][0]['file'] = 'media/not-here.jpg' } }
        @{ Name = 'file outside the pack folder'; Code = 'file-outside-pack'; Mutate = { param($p) $p['media'][0]['file'] = '../../Common.ps1' } }
        @{ Name = 'file that is not media (by its bytes)'; Code = 'file-type'; Mutate = { param($p) $p['media'][0]['file'] = 'pack.json' } }
        @{ Name = 'declared kind disagrees with the bytes'; Code = 'kind-mismatch'; Mutate = { param($p) $p['media'][0]['kind'] = 'video' } }
        @{ Name = 'avatar that is a video'; Code = 'kind-mismatch'; Mutate = { param($p) $p['personas'][0]['avatar'] = 'media/river-clip.mp4' } }
        @{ Name = 'width 0'; Code = 'dimension'; Mutate = { param($p) $p['media'][0]['width'] = 0 } }
        @{ Name = 'durationSec on an image'; Code = 'duration'; Mutate = { param($p) $p['media'][0]['durationSec'] = 3 } }
        @{ Name = 'durationSec over 3600'; Code = 'duration'; Mutate = { param($p) $p['media'][1]['durationSec'] = 3601 } }
        @{ Name = 'poster on an image'; Code = 'poster-not-video'; Mutate = { param($p) $p['media'][0]['poster'] = 'media/river-clip.poster.jpg' } }
        @{ Name = 'poster that is a video'; Code = 'poster-not-image'; Mutate = { param($p) $p['media'][1]['poster'] = 'media/river-clip.mp4' } }
        @{ Name = 'media alt blank'; Code = 'alt-missing'; Mutate = { param($p) $p['media'][0]['alt'] = '   ' } }
        @{ Name = 'post alt override blank'; Code = 'alt-missing'; Mutate = { param($p) $p['posts'][1]['media'][0]['alt'] = '' } }
        @{ Name = 'alt over 1000'; Code = 'alt-length'; Mutate = { param($p) $p['media'][0]['alt'] = 'a' * 1001 } }
        @{ Name = 'text missing'; Code = 'text-missing'; Mutate = { param($p) $p['posts'][2].Remove('text') } }
        @{ Name = 'text over 280 code points'; Code = 'text-length'; Mutate = { param($p) $p['posts'][0]['text'] = 't' * 281 } }
        @{ Name = 'negative minutesBeforeAnchor'; Code = 'minutes'; Mutate = { param($p) $p['posts'][1]['minutesBeforeAnchor'] = -1 } }
        @{ Name = 'fractional minutesBeforeAnchor'; Code = 'minutes'; Mutate = { param($p) $p['posts'][0]['minutesBeforeAnchor'] = 1.5 } }
        @{ Name = 'post media ref unknown'; Code = 'media-ref'; Mutate = { param($p) $p['posts'][0]['media'][0]['ref'] = 'nope' } }
        @{ Name = 'post mixes a video with an image'; Code = 'media-count'; Mutate = { param($p) $p['posts'][0]['media'] += [ordered]@{ ref = 'harbor-photo' } } }
        @{ Name = 'reply to an unknown post'; Code = 'reply-ref'; Mutate = { param($p) $p['posts'][2]['replyTo'] = 'p99' } }
        @{ Name = 'reply listed before its parent'; Code = 'reply-order'; Mutate = { param($p) $p['posts'][0]['replyTo'] = 'p02' } }
        @{ Name = 'reply earlier in time than its parent'; Code = 'reply-time'; Mutate = { param($p) $p['posts'][2]['minutesBeforeAnchor'] = 130 } }
        @{ Name = 'baseline over 1,000,000'; Code = 'baseline'; Mutate = { param($p) $p['posts'][0]['baseline']['like'] = 1000001 } }
        # Gate-1 M-2: markup the server would strip (the post would not read as written, and dedup could not match it)
        @{ Name = 'markup in post text'; Code = 'markup'; Mutate = { param($p) $p['posts'][1]['text'] = 'Harbor Road is <b>closed</b> between 3rd and 5th.' } }
        @{ Name = 'markup in media alt'; Code = 'markup'; Mutate = { param($p) $p['media'][0]['alt'] = '<img src=x>' } }
        @{ Name = 'markup in a post alt override'; Code = 'markup'; Mutate = { param($p) $p['posts'][1]['media'][0]['alt'] = 'Photo of a road </p>' } }
        @{ Name = 'markup in displayName'; Code = 'markup'; Mutate = { param($p) $p['personas'][0]['displayName'] = '<i>Fairhaven</i> EM' } }
        @{ Name = 'markup in bio (comment)'; Code = 'markup'; Mutate = { param($p) $p['personas'][0]['bio'] = 'Updates <!-- hidden -->' } }
        @{ Name = 'markup in location (processing instruction)'; Code = 'markup'; Mutate = { param($p) $p['personas'][0]['location'] = 'Fairhaven <?x?>' } }
        # Gate-1 L-2: anchor with \z, and blank = blank to JavaScript's trim() (U+FEFF included), as zod checks it
        @{ Name = 'post key with a trailing newline'; Code = 'key-format'; Mutate = { param($p) $p['posts'][0]['key'] = "p01`n"; $p['posts'][2]['replyTo'] = "p01`n" } }
        @{ Name = 'handle with a trailing newline'; Code = 'handle-format'; Mutate = { param($p) $p['posts'][0]['persona'] = "Newsline7`n" } }
        @{ Name = 'handle with a U+FEFF'; Code = 'handle-format'; Mutate = { param($p) $p['posts'][0]['persona'] = "News`u{FEFF}line7" } }
        @{ Name = 'media alt that is only U+FEFF'; Code = 'alt-missing'; Mutate = { param($p) $p['media'][0]['alt'] = "`u{FEFF}" } }
        # Gate-1 L-3: keys collide ignoring case (the manifest and the id maps are case-insensitive)
        @{ Name = 'post keys differing only in case'; Code = 'duplicate-key'; Mutate = { param($p) $p['posts'] += [ordered]@{ key = 'P01'; persona = 'FulcoEM'; text = 'A different post'; minutesBeforeAnchor = 10 } } }
        @{ Name = 'media keys differing only in case'; Code = 'duplicate-key'; Mutate = { param($p) $p['media'] += [ordered]@{ key = 'Harbor-Photo'; file = 'avatars/fulcoem.png'; kind = 'image'; alt = 'x' } } }
        # Run sheet: inject items, with the server's limits (InjectItemValidator, InjectBurstPacing; injectRules.ts)
        @{ Name = 'run sheet not an object'; Code = 'type'; Mutate = { param($p) $p['runSheet'] = @() } }
        @{ Name = 'run sheet items not a list'; Code = 'runsheet-items'; Mutate = { param($p) $p['runSheet']['items'] = 'none' } }
        @{ Name = 'the old C3 beats shape'; Code = 'unknown-field'; Mutate = { param($p) $p['runSheet']['beats'] = @() } }
        @{ Name = 'unknown field in an item'; Code = 'unknown-field'; Mutate = { param($p) $p['runSheet']['items'][0]['scenarioMinute'] = 5 } }
        @{ Name = 'unknown field in a run-sheet post (baseline, not engagementBaseline)'; Code = 'unknown-field'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['baseline'] = [ordered]@{ like = 1 } } }
        @{ Name = 'item key with a space'; Code = 'key-format'; Mutate = { param($p) $p['runSheet']['items'][1]['key'] = 'item 2' } }
        @{ Name = 'item key with a trailing newline'; Code = 'key-format'; Mutate = { param($p) $p['runSheet']['items'][1]['key'] = "i02`n" } }
        @{ Name = 'item keys differing only in case'; Code = 'duplicate-key'; Mutate = { param($p) $p['runSheet']['items'][1]['key'] = 'I01'; $p['runSheet']['items'][1]['posts'][2].Remove('replyTo') } }
        @{ Name = 'kind not post/burst'; Code = 'inject-kind'; Mutate = { param($p) $p['runSheet']['items'][0]['kind'] = 'thread' } }
        @{ Name = 'kind in the wrong case'; Code = 'inject-kind'; Mutate = { param($p) $p['runSheet']['items'][0]['kind'] = 'Post' } }
        @{ Name = 'title missing'; Code = 'inject-title'; Mutate = { param($p) $p['runSheet']['items'][0].Remove('title') } }
        @{ Name = 'title blank'; Code = 'inject-title'; Mutate = { param($p) $p['runSheet']['items'][0]['title'] = '   ' } }
        @{ Name = 'title over 120 code points'; Code = 'inject-title'; Mutate = { param($p) $p['runSheet']['items'][0]['title'] = 't' * 121 } }
        @{ Name = 'notes over 500 code points'; Code = 'inject-notes'; Mutate = { param($p) $p['runSheet']['items'][0]['notes'] = 'n' * 501 } }
        @{ Name = 'plannedMinute negative'; Code = 'inject-minute'; Mutate = { param($p) $p['runSheet']['items'][0]['plannedMinute'] = -1 } }
        @{ Name = 'plannedMinute fractional'; Code = 'inject-minute'; Mutate = { param($p) $p['runSheet']['items'][0]['plannedMinute'] = 2.5 } }
        @{ Name = 'assignee blank'; Code = 'inject-assignee'; Mutate = { param($p) $p['runSheet']['items'][0]['assignee'] = ' ' } }
        @{ Name = 'assignee not a string'; Code = 'inject-assignee'; Mutate = { param($p) $p['runSheet']['items'][0]['assignee'] = 7 } }
        @{ Name = 'posts not a list'; Code = 'inject-posts'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'] = 'one' } }
        @{ Name = 'a post item with 2 posts'; Code = 'inject-posts'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'] += [ordered]@{ persona = 'FulcoEM'; text = 'second' } } }
        @{ Name = 'a burst with 1 post'; Code = 'inject-posts'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'] = @($p['runSheet']['items'][1]['posts'][0]) } }
        @{ Name = 'a burst with 21 posts'; Code = 'inject-posts'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'] = @(1..21 | ForEach-Object { [ordered]@{ persona = 'FulcoEM'; text = "burst $_" } }) } }
        @{ Name = 'burstWindowSeconds 29'; Code = 'inject-window'; Mutate = { param($p) $p['runSheet']['items'][1]['burstWindowSeconds'] = 29 } }
        @{ Name = 'burstWindowSeconds 601'; Code = 'inject-window'; Mutate = { param($p) $p['runSheet']['items'][1]['burstWindowSeconds'] = 601 } }
        @{ Name = 'burstWindowSeconds fractional'; Code = 'inject-window'; Mutate = { param($p) $p['runSheet']['items'][1]['burstWindowSeconds'] = 45.5 } }
        @{ Name = 'a window under 3 x (posts - 1): 12 posts in 32 s'; Code = 'inject-window'; Mutate = {
                param($p)
                $p['runSheet']['items'][1]['posts'] = @(1..12 | ForEach-Object { [ordered]@{ persona = 'FulcoEM'; text = "burst $_" } }); $p['runSheet']['items'][1]['burstWindowSeconds'] = 32
            }
        }
        @{ Name = 'burstWindowSeconds on a post item'; Code = 'inject-window'; Mutate = { param($p) $p['runSheet']['items'][0]['burstWindowSeconds'] = 60 } }
        @{ Name = 'run-sheet handle with @'; Code = 'handle-format'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][0]['persona'] = '@mvega_fh' } }
        @{ Name = 'run-sheet handle with a U+FEFF'; Code = 'handle-format'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][0]['persona'] = "mvega`u{FEFF}_fh" } }
        @{ Name = 'run-sheet text missing'; Code = 'inject-text'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][0].Remove('text') } }
        @{ Name = 'run-sheet text blank (media alone is not enough)'; Code = 'inject-text'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['text'] = '  ' } }
        @{ Name = 'run-sheet text over 280 code points'; Code = 'inject-text'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][0]['text'] = "`u{1F30A}" * 281 } }
        @{ Name = 'markup in an item title'; Code = 'markup'; Mutate = { param($p) $p['runSheet']['items'][0]['title'] = 'Follow-up <b>now</b>' } }
        @{ Name = 'markup in item notes'; Code = 'markup'; Mutate = { param($p) $p['runSheet']['items'][0]['notes'] = 'Fire <!-- later -->' } }
        @{ Name = 'markup in run-sheet text'; Code = 'markup'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][0]['text'] = 'Live now <script>x</script>' } }
        @{ Name = 'markup in a run-sheet alt override'; Code = 'markup'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['media'][0]['alt'] = '<a href=x>photo</a>' } }
        @{ Name = 'run-sheet media ref unknown'; Code = 'inject-media-ref'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['media'][0]['ref'] = 'nope' } }
        @{ Name = 'run-sheet media mixes a video with an image'; Code = 'inject-media-count'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['media'] += [ordered]@{ ref = 'river-clip' } } }
        @{ Name = 'run-sheet alt override blank'; Code = 'inject-alt'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['media'][0]['alt'] = ' ' } }
        @{ Name = 'run-sheet alt override over 1000'; Code = 'inject-alt'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['media'][0]['alt'] = 'a' * 1001 } }
        @{ Name = 'replyTo with two forms'; Code = 'inject-reply'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['replyTo'] = [ordered]@{ postKey = 'p02'; sequence = 1 } } }
        @{ Name = 'replyTo with a raw postId'; Code = 'inject-reply'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['replyTo'] = [ordered]@{ postId = '0d6e3f9a-6a4f-4c43-9d0e-6c0a1f1e2b3c' } } }
        @{ Name = 'replyTo an unknown post key'; Code = 'inject-reply'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['replyTo'] = [ordered]@{ postKey = 'p99' } } }
        @{ Name = 'replyTo an unknown item'; Code = 'inject-reply'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][2]['replyTo']['item'] = 'i99' } }
        @{ Name = 'replyTo a sequence the other item does not have'; Code = 'inject-reply'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][2]['replyTo']['sequence'] = 2 } }
        @{ Name = 'sibling reply to itself'; Code = 'inject-reply-sibling'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][1]['replyTo']['sequence'] = 2 } }
        @{ Name = 'sibling reply to a later post'; Code = 'inject-reply-sibling'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][1]['replyTo']['sequence'] = 3 } }
        @{ Name = 'sibling reply with sequence 0'; Code = 'inject-reply-sibling'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][1]['replyTo']['sequence'] = 0 } }
        @{ Name = 'sibling reply from a single post'; Code = 'inject-reply-sibling'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['replyTo'] = [ordered]@{ sequence = 1 } } }
        @{ Name = 'sibling reply by the item''s own key, to a later post'; Code = 'inject-reply-sibling'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][1]['replyTo'] = [ordered]@{ item = 'i02'; sequence = 3 } } }
        @{ Name = 'reply to a post of a LATER item'; Code = 'inject-reply-order'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['replyTo'] = [ordered]@{ item = 'i02'; sequence = 1 }; $p['runSheet']['items'][1]['posts'][2].Remove('replyTo') } }
        @{ Name = 'two items replying to each other (a loop)'; Code = 'inject-reply-cycle'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['replyTo'] = [ordered]@{ item = 'i02'; sequence = 1 } } }
        @{ Name = 'run-sheet baseline over 1,000,000'; Code = 'inject-baseline'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['engagementBaseline']['like'] = 1000001 } }
        @{ Name = 'run-sheet baseline negative'; Code = 'inject-baseline'; Mutate = { param($p) $p['runSheet']['items'][1]['posts'][0]['engagementBaseline']['repost'] = -1 } }
        @{ Name = 'run-sheet baseline with an unknown count'; Code = 'inject-baseline'; Mutate = { param($p) $p['runSheet']['items'][0]['posts'][0]['engagementBaseline']['views'] = 3 } }
    ) {
        $pack = Get-FixturePack
        & $Mutate $pack
        Get-PackCodes $pack | Should -Be @($Code)
    }

    It 'file over the server limit -> file-too-large (limits mirror MediaUploadOptions)' {
        $limits = Get-SeedLimits
        $limits.ImageMaxBytes | Should -Be 5242880
        $limits.VideoMaxBytes | Should -Be 104857600
        $limits.ImageMaxBytes = 1000   # the fixture photo is ~1.5 KB
        Get-PackCodes (Get-FixturePack) -Limits $limits | Should -Be @('file-too-large')
    }

    It 'empty file -> file-empty' {
        $root = Join-Path $TestDrive 'empty-pack'
        Copy-Item -Recurse $script:FixtureRoot $root
        Set-Content -LiteralPath (Join-Path $root 'media/harbor-photo.jpg') -Value $null -NoNewline
        Get-PackCodes (Get-FixturePack) -Root $root | Should -Be @('file-empty')
    }

    It 'plain-text "<" is fine: "<3", "a < b" and "<5 min" pass' {
        $pack = Get-FixturePack
        $pack['posts'][0]['text'] = 'Stay safe <3 levels are a < b and closures last <5 min'
        $pack['media'][0]['alt'] = 'Water depth <1 m'
        Get-PackCodes $pack | Should -BeNullOrEmpty
    }

    It 'L-7: a symbolic link that resolves outside the pack folder -> file-outside-pack; one that stays inside passes' {
        $root = Join-Path $TestDrive 'link-pack'
        Copy-Item -Recurse $script:FixtureRoot $root
        $outside = Join-Path $TestDrive 'outside'; New-Item -ItemType Directory -Force $outside | Out-Null
        Copy-Item (Join-Path $root 'media/harbor-photo.jpg') (Join-Path $outside 'secret.jpg')
        try {
            Remove-Item (Join-Path $root 'media/harbor-photo.jpg')
            New-Item -ItemType SymbolicLink -Path (Join-Path $root 'media/harbor-photo.jpg') -Target (Join-Path $outside 'secret.jpg') -ErrorAction Stop | Out-Null
        }
        catch { Set-ItResult -Skipped -Because "symbolic links cannot be created here: $($_.Exception.Message)"; return }
        Get-PackCodes (Get-FixturePack) -Root $root | Should -Be @('file-outside-pack')

        # A linked DIRECTORY pointing outside is caught too.
        Remove-Item (Join-Path $root 'media/harbor-photo.jpg')
        Copy-Item (Join-Path $outside 'secret.jpg') (Join-Path $root 'media/harbor-photo.jpg')
        New-Item -ItemType SymbolicLink -Path (Join-Path $root 'avatars-link') -Target $outside | Out-Null
        $pack = Get-FixturePack; $pack['media'][0]['file'] = 'avatars-link/secret.jpg'
        Get-PackCodes $pack -Root $root | Should -Be @('file-outside-pack')

        # A link that stays inside the pack is fine.
        New-Item -ItemType SymbolicLink -Path (Join-Path $root 'media/alias.jpg') -Target (Join-Path $root 'media/harbor-photo.jpg') | Out-Null
        $pack = Get-FixturePack; $pack['media'][0]['file'] = 'media/alias.jpg'
        Get-PackCodes $pack -Root $root | Should -BeNullOrEmpty
    }

    It 'counts code points, not UTF-16 units: 280 emoji pass, 281 fail' {
        $pack = Get-FixturePack
        $pack['posts'][0]['text'] = "`u{1F30A}" * 280
        Get-PackCodes $pack | Should -BeNullOrEmpty
        $pack['posts'][0]['text'] = "`u{1F30A}" * 281
        Get-PackCodes $pack | Should -Be @('text-length')
    }

    It 'sniffs media by magic bytes like the server' {
        Get-MediaSniff -Head ([byte[]] (0xFF, 0xD8, 0xFF, 0xE0)) | ForEach-Object Type | Should -Be 'jpeg'
        (Get-MediaSniff -Head (Read-FileHead (Join-Path $script:FixtureRoot 'media/river-clip.mp4'))).Kind | Should -Be 'video'
        (Get-MediaSniff -Head (Read-FileHead (Join-Path $script:FixtureRoot 'avatars/fulcoem.png'))).Type | Should -Be 'png'
        $webm = [byte[]] (0x1A, 0x45, 0xDF, 0xA3, 0x87, 0x42, 0x82, 0x84) + [Text.Encoding]::ASCII.GetBytes('webm')
        (Get-MediaSniff -Head $webm).Type | Should -Be 'webm'
        $quickTime = [byte[]] (0, 0, 0, 0x20) + [Text.Encoding]::ASCII.GetBytes('ftypqt  ') + [byte[]]::new(20)
        Get-MediaSniff -Head $quickTime | Should -BeNullOrEmpty
    }

    It 'a valid pack also passes the JSON Schema; a broken one does not' {
        $json = Get-Content -LiteralPath $script:FixturePath -Raw
        Test-Json -Json $json -SchemaFile $script:SchemaPath | Should -BeTrue
        $bad = Get-FixturePack; $bad['posts'][0]['persona'] = '@Newsline7'
        Test-Json -Json (ConvertTo-SeedJson $bad) -SchemaFile $script:SchemaPath -ErrorAction SilentlyContinue | Should -BeFalse
        $typo = Get-FixturePack; $typo['posts'][0]['minutesBeforeAncor'] = 5
        Test-Json -Json (ConvertTo-SeedJson $typo) -SchemaFile $script:SchemaPath -ErrorAction SilentlyContinue | Should -BeFalse
        $markup = Get-FixturePack; $markup['posts'][1]['text'] = 'Harbor Road is <b>closed</b>'
        Test-Json -Json (ConvertTo-SeedJson $markup) -SchemaFile $script:SchemaPath -ErrorAction SilentlyContinue | Should -BeFalse
        $nullBio = Get-FixturePack; $nullBio['personas'][0]['bio'] = $null; $nullBio['personas'][0]['location'] = 'Fairhaven <3'
        Test-Json -Json (ConvertTo-SeedJson $nullBio) -SchemaFile $script:SchemaPath | Should -BeTrue
        # The run sheet: inject items (kind, post counts, the burst-only window, one replyTo form, no C3 beats).
        foreach ($mutate in @(
                { param($p) $p['runSheet']['items'][0]['kind'] = 'thread' }
                { param($p) $p['runSheet']['items'][0]['burstWindowSeconds'] = 60 }
                { param($p) $p['runSheet']['items'][1]['posts'] = @($p['runSheet']['items'][1]['posts'][0]) }
                { param($p) $p['runSheet']['items'][1]['posts'][1]['replyTo'] = [ordered]@{ sequence = 1; postKey = 'p01' } }
                { param($p) $p['runSheet']['items'][1]['posts'][0]['text'] = '   ' }
                { param($p) $p['runSheet']['items'][0]['posts'][0]['baseline'] = [ordered]@{ like = 1 } }
                { param($p) $p['runSheet'] = [ordered]@{ name = 'old'; beats = @() } }
            )) {
            $bad = Get-FixturePack; & $mutate $bad
            Test-Json -Json (ConvertTo-SeedJson $bad) -SchemaFile $script:SchemaPath -ErrorAction SilentlyContinue | Should -BeFalse -Because "$mutate"
        }
        $noAssignee = Get-FixturePack; $noAssignee['runSheet']['items'][0]['assignee'] = $null; $noAssignee['runSheet']['items'][1].Remove('burstWindowSeconds')
        Test-Json -Json (ConvertTo-SeedJson $noAssignee) -SchemaFile $script:SchemaPath | Should -BeTrue
    }

    It 'an invalid pack exits 1 before any request (nothing is sent)' {
        $script:Fake = New-FakePulse
        Mock Invoke-WebRequest { Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType }
        $pack = Get-FixturePack; $pack['posts'][0]['text'] = 't' * 281
        $root = Join-Path $TestDrive 'bad-pack'; Copy-Item -Recurse $script:FixtureRoot $root
        Set-Content -LiteralPath (Join-Path $root 'pack.json') -Value (ConvertTo-SeedJson $pack)
        $run = Invoke-FakeSeed @{ PackPath = (Join-Path $root 'pack.json') }
        $run.Code | Should -Be 1
        $run.Text | Should -Match 'text-length'
        $run.Text | Should -Match 'Nothing was sent'
        $script:Fake.Calls.Count | Should -Be 0
    }

    It 'malformed JSON exits 1 before any request' {
        $script:Fake = New-FakePulse
        Mock Invoke-WebRequest { Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType }
        $root = Join-Path $TestDrive 'broken-json'; Copy-Item -Recurse $script:FixtureRoot $root
        Set-Content -LiteralPath (Join-Path $root 'pack.json') -Value '{ "schema": "pulse.demopack.v1", '
        $run = Invoke-FakeSeed @{ PackPath = (Join-Path $root 'pack.json') }
        $run.Code | Should -Be 1
        $run.Text | Should -Match 'not valid JSON'
        $script:Fake.Calls.Count | Should -Be 0
    }
}

Describe 'Offset math and posting order' {
    It 'scenarioTime = anchor - minutesBeforeAnchor, as a UTC instant' {
        $anchor = [DateTimeOffset] '2026-10-19T14:00:00Z'
        Get-PostScenarioTime -Anchor $anchor -MinutesBeforeAnchor 340 | Should -Be '2026-10-19T08:20:00.000Z'
        Get-PostScenarioTime -Anchor $anchor -MinutesBeforeAnchor 0 | Should -Be '2026-10-19T14:00:00.000Z'
        Get-PostScenarioTime -Anchor $anchor -MinutesBeforeAnchor 900 | Should -Be '2026-10-18T23:00:00.000Z'
        Get-PostScenarioTime -Anchor ([DateTimeOffset] '2026-10-19T09:00:00-05:00') -MinutesBeforeAnchor 30 | Should -Be '2026-10-19T13:30:00.000Z'
    }

    It 'posts earliest first; ties keep pack order, so a parent listed first stays first' {
        $pack = [ordered]@{ posts = @(
                [ordered]@{ key = 'late'; minutesBeforeAnchor = 10 }
                [ordered]@{ key = 'early'; minutesBeforeAnchor = 300 }
                [ordered]@{ key = 'parent'; minutesBeforeAnchor = 60 }
                [ordered]@{ key = 'reply'; minutesBeforeAnchor = 60; replyTo = 'parent' }
                [ordered]@{ key = 'mid'; minutesBeforeAnchor = 120 }
            ) }
        @(Get-ChronologicalPosts -Pack $pack | ForEach-Object { $_['key'] }) | Should -Be @('early', 'mid', 'parent', 'reply', 'late')
    }

    It 'a fresh timeline anchors at now (whole seconds)' {
        $plan = Get-PostPlan -Pack (Get-FixturePack) -Manifest (New-SeedManifest) -Feed @() -PersonaIds @{}
        $result = Resolve-SeedAnchor -Manifest (New-SeedManifest) -PostPlan $plan -Now ([DateTimeOffset] '2026-10-19T14:00:07.789Z')
        $result.Error | Should -BeNullOrEmpty
        Format-SeedInstant $result.Anchor | Should -Be '2026-10-19T14:00:07.000Z'
        $result.Fresh | Should -BeTrue
    }

    It '-ScenarioAnchor wins' {
        $plan = Get-PostPlan -Pack (Get-FixturePack) -Manifest (New-SeedManifest) -Feed @() -PersonaIds @{}
        $result = Resolve-SeedAnchor -Explicit ([DateTimeOffset] '2026-10-19T09:00:00Z') -Manifest (New-SeedManifest) -PostPlan $plan -Now ([DateTimeOffset]::UtcNow)
        Format-SeedInstant $result.Anchor | Should -Be '2026-10-19T09:00:00.000Z'
    }

    It 'adding posts next to seeded ones needs -Resume, which keeps the earlier anchor' {
        $manifest = New-SeedManifest
        $manifest['anchor'] = '2026-10-16T15:00:00.000Z'
        $manifest['posts']['p01'] = [ordered]@{ postId = 'post-1'; scenarioTime = '2026-10-16T13:00:00.000Z' }
        $feed = @([ordered]@{ id = 'post-1'; authorPersonaId = 'n7'; text = 'x'; scenarioTime = '2026-10-16T13:00:00.000Z' })
        $plan = Get-PostPlan -Pack (Get-FixturePack) -Manifest $manifest -Feed $feed -PersonaIds @{}
        $plan.Done | Should -Be 1
        $plan.ToPost | Should -Be 2
        (Resolve-SeedAnchor -Manifest $manifest -PostPlan $plan -Now ([DateTimeOffset]::UtcNow)).Error | Should -Match '-Resume'
        $resumed = Resolve-SeedAnchor -Resume -Manifest $manifest -PostPlan $plan -Now ([DateTimeOffset]::UtcNow)
        Format-SeedInstant $resumed.Anchor | Should -Be '2026-10-16T15:00:00.000Z'
    }

    It '-Resume without a manifest anchor derives it from a seeded post in the feed' {
        $manifest = New-SeedManifest
        $feed = @([ordered]@{ id = 'post-1'; authorPersonaId = 'n7-id'; text = (Get-FixturePack)['posts'][0]['text']; scenarioTime = '2026-10-16T13:00:00.000Z' })
        $plan = Get-PostPlan -Pack (Get-FixturePack) -Manifest $manifest -Feed $feed -PersonaIds @{ Newsline7 = 'n7-id'; FulcoEM = 'em-id' }
        $plan.Items[0].Action | Should -Be 'adopt'
        $resumed = Resolve-SeedAnchor -Resume -Manifest $manifest -PostPlan $plan -Now ([DateTimeOffset]::UtcNow)
        Format-SeedInstant $resumed.Anchor | Should -Be '2026-10-16T15:00:00.000Z'   # 13:00 + p01's 120 minutes
    }
}

Describe 'Gate-1 folds: anchors, the feed window and the offline plan' {
    BeforeAll {
        function New-SeededPlan {
            <# p01 already seeded (in the manifest and the feed at $ParentTime); p02 and p03 (a reply to p01) still to post. #>
            param([string] $ParentTime = '2026-10-16T13:00:00.000Z', [string] $ManifestAnchor = '2026-10-16T15:00:00.000Z')
            $manifest = New-SeedManifest
            if ($ManifestAnchor) { $manifest['anchor'] = $ManifestAnchor }
            $manifest['posts']['p01'] = [ordered]@{ postId = 'post-1'; scenarioTime = $ParentTime }
            $feed = @([ordered]@{ id = 'post-1'; authorPersonaId = 'n7'; text = (Get-FixturePack)['posts'][0]['text']; scenarioTime = $ParentTime })
            $plan = Get-PostPlan -Pack (Get-FixturePack) -Manifest $manifest -Feed $feed -PersonaIds @{ Newsline7 = 'n7'; FulcoEM = 'em' }
            [pscustomobject]@{ Manifest = $manifest; Plan = $plan }
        }
    }

    It 'L-4: -ScenarioAnchor does not bypass the partial-run refusal, and the message does not suggest it' {
        $seeded = New-SeededPlan
        $result = Resolve-SeedAnchor -Explicit ([DateTimeOffset] '2026-10-19T09:00:00Z') -Manifest $seeded.Manifest -PostPlan $seeded.Plan -Now ([DateTimeOffset]::UtcNow)
        $result.Error | Should -Match 'Re-run with -Resume'
        $result.Error | Should -Not -Match 'ScenarioAnchor'
        $plain = Resolve-SeedAnchor -Manifest $seeded.Manifest -PostPlan $seeded.Plan -Now ([DateTimeOffset]::UtcNow)
        $plain.Error | Should -Not -Match 'ScenarioAnchor'
    }

    It 'L-4: with -Resume, a different -ScenarioAnchor is refused; the same one is accepted' {
        $seeded = New-SeededPlan
        (Resolve-SeedAnchor -Resume -Explicit ([DateTimeOffset] '2026-10-19T09:00:00Z') -Manifest $seeded.Manifest -PostPlan $seeded.Plan -Now ([DateTimeOffset]::UtcNow)).Error |
            Should -Match 'would move the rest of a partial run'
        $same = Resolve-SeedAnchor -Resume -Explicit ([DateTimeOffset] '2026-10-16T15:00:00Z') -Manifest $seeded.Manifest -PostPlan $seeded.Plan -Now ([DateTimeOffset]::UtcNow)
        $same.Error | Should -BeNullOrEmpty
        Format-SeedInstant $same.Anchor | Should -Be '2026-10-16T15:00:00.000Z'
    }

    It 'L-4: a reply is never posted earlier than its already-seeded parent' {
        # The parent really went out at 14:30, later than the manifest anchor suggests (e.g. it was re-posted):
        # p03 (75 min before a 15:00 anchor = 13:45) would precede it.
        $seeded = New-SeededPlan -ParentTime '2026-10-16T14:30:00.000Z'
        $anchor = (Resolve-SeedAnchor -Resume -Manifest $seeded.Manifest -PostPlan $seeded.Plan -Now ([DateTimeOffset]::UtcNow)).Anchor
        $problems = @(Test-SeedReplyTimes -PostPlan $seeded.Plan -Anchor $anchor)
        $problems.Count | Should -Be 1
        $problems[0] | Should -Match 'p03 would be posted at 2026-10-16T13:45:00.000Z, before its already-seeded parent p01'
        @(Test-SeedReplyTimes -PostPlan (New-SeededPlan).Plan -Anchor $anchor) | Should -BeNullOrEmpty
    }

    It 'M-3: no manifest + a full 200-post feed window marks every pack post unverifiable' {
        $feed = @(1..200 | ForEach-Object { [ordered]@{ id = "other-$_"; authorPersonaId = 'x'; text = 'engine chatter'; scenarioTime = '2026-10-19T13:59:00.000Z' } })
        $plan = Get-PostPlan -Pack (Get-FixturePack) -Manifest (New-SeedManifest) -Feed $feed -PersonaIds @{ Newsline7 = 'n7'; FulcoEM = 'em' }
        $plan.FeedTruncated | Should -BeTrue
        $plan.Unverifiable | Should -Be 3
        $plan.Items[0].Reason | Should -Match 'cannot be ruled out'
        # Under the cap the same empty feed proves the posts are new.
        (Get-PostPlan -Pack (Get-FixturePack) -Manifest (New-SeedManifest) -Feed @($feed | Select-Object -First 199) -PersonaIds @{}).Unverifiable | Should -Be 0
    }

    It 'L-1: the offline (-WhatIf) plan survives a changed video with an unchanged poster' {
        $units = Get-FixtureUnits
        $manifest = New-FullManifest -Units $units
        $manifest['files']['media/river-clip.mp4']['sha256'] = '0' * 64
        $plan = @(Get-UploadPlan -Units $units -Manifest $manifest -Library $null -Username 'controller1')
        ($plan | Where-Object { $_.Unit.File -eq 'media/river-clip.mp4' }).Action | Should -Be 'upload'
        ($plan | Where-Object { $_.Unit.File -eq 'media/river-clip.poster.jpg' }).Action | Should -Be 'reuse'
    }

    It 'zod-compatible trim: U+FEFF and Unicode spaces are blank, U+0085 is not' {
        Test-JsBlank "`u{FEFF} `u{3000}`t" | Should -BeTrue
        Test-JsBlank "`u{0085}" | Should -BeFalse
        Get-JsTrimmed "`u{FEFF}Title`u{00A0}" | Should -Be 'Title'
    }
}

Describe 'Manifest and idempotency' {
    It 'uploads posters first, then images, then videos' {
        $units = Get-FixtureUnits
        @($units.File) | Should -Be @('media/river-clip.poster.jpg', 'media/harbor-photo.jpg', 'avatars/fulcoem.png', 'banners/county.jpg', 'media/river-clip.mp4')
        ($units | Where-Object Kind -eq 'video').PosterFile | Should -Be 'media/river-clip.poster.jpg'
        $units | ForEach-Object { $_.Sha256 | Should -Match '^[0-9a-f]{64}$' }
    }

    It 'first run: every file is uploaded' {
        $plan = @(Get-UploadPlan -Units (Get-FixtureUnits) -Manifest (New-SeedManifest) -Library $null -Username 'controller1')
        @($plan | Where-Object Action -eq 'upload').Count | Should -Be 5
    }

    It 'second run: zero uploads and zero posts' {
        $units = Get-FixtureUnits
        $manifest = New-FullManifest -Units $units -PostIds @{ p01 = 'id-1'; p02 = 'id-2'; p03 = 'id-3' }
        $library = @{ Ids = [System.Collections.Generic.HashSet[string]]::new([string[]] @($manifest['files'].Values | ForEach-Object { $_['assetId'] })); Complete = @{ image = $true; video = $true } }
        @(Get-UploadPlan -Units $units -Manifest $manifest -Library $library -Username 'controller1' | Where-Object Action -eq 'upload').Count | Should -Be 0
        $feed = @('id-1', 'id-2', 'id-3' | ForEach-Object { [ordered]@{ id = $_; authorPersonaId = 'x'; text = 'x'; scenarioTime = '2026-10-19T12:00:00.000Z' } })
        $plan = Get-PostPlan -Pack (Get-FixturePack) -Manifest $manifest -Feed $feed -PersonaIds @{}
        $plan.ToPost | Should -Be 0
        $plan.Done | Should -Be 3
    }

    It 're-uploads a file whose bytes changed (SHA-256), and a video whose poster changed' {
        $units = Get-FixtureUnits
        $manifest = New-FullManifest -Units $units
        # The poster file was edited after the last run: both manifest entries still hold its OLD hash.
        $manifest['files']['media/river-clip.poster.jpg']['sha256'] = 'f' * 64
        $manifest['files']['media/river-clip.mp4']['posterSha256'] = 'f' * 64
        $plan = @(Get-UploadPlan -Units $units -Manifest $manifest -Library $null -Username 'controller1')
        @($plan | Where-Object Action -eq 'upload' | ForEach-Object { $_.Unit.File }) | Should -Be @('media/river-clip.poster.jpg', 'media/river-clip.mp4')
    }

    It 're-uploads an asset that is gone from a complete library listing, but trusts an incomplete one' {
        $units = Get-FixtureUnits
        $manifest = New-FullManifest -Units $units
        $empty = [System.Collections.Generic.HashSet[string]]::new()
        @(Get-UploadPlan -Units $units -Manifest $manifest -Library @{ Ids = $empty; Complete = @{ image = $true; video = $true } } -Username 'controller1' |
            Where-Object Action -eq 'upload').Count | Should -Be 5
        @(Get-UploadPlan -Units $units -Manifest $manifest -Library @{ Ids = $empty; Complete = @{ image = $false; video = $false } } -Username 'controller1' |
            Where-Object Action -eq 'upload').Count | Should -Be 0
    }

    It 'a re-uploaded video gets a poster from the same staff user (the server rule)' {
        $units = Get-FixtureUnits
        $manifest = New-FullManifest -Units $units -Username 'controller2'
        $manifest['files']['media/river-clip.mp4']['sha256'] = '0' * 64
        $plan = @(Get-UploadPlan -Units $units -Manifest $manifest -Library $null -Username 'controller1')
        ($plan | Where-Object { $_.Unit.File -eq 'media/river-clip.poster.jpg' }).Action | Should -Be 'upload'
        ($plan | Where-Object { $_.Unit.File -eq 'media/harbor-photo.jpg' }).Action | Should -Be 'reuse'
    }

    It 'posts again what was archived since (feed under its cap)' {
        $manifest = New-FullManifest -Units (Get-FixtureUnits) -PostIds @{ p01 = 'id-1'; p02 = 'id-2'; p03 = 'id-3' }
        $plan = Get-PostPlan -Pack (Get-FixturePack) -Manifest $manifest -Feed @() -PersonaIds @{ Newsline7 = 'n7'; FulcoEM = 'em' }
        $plan.ToPost | Should -Be 3
        $plan.Items[0].Reason | Should -Match 'no longer in the feed'
    }

    It 'never re-posts when the feed is at its 200 cap and cannot prove a post is gone' {
        $manifest = New-FullManifest -Units (Get-FixtureUnits) -PostIds @{ p01 = 'id-1'; p02 = 'id-2'; p03 = 'id-3' }
        $feed = @(1..200 | ForEach-Object { [ordered]@{ id = "other-$_"; authorPersonaId = 'x'; text = 'engine chatter'; scenarioTime = '2026-10-19T13:59:00.000Z' } })
        (Get-PostPlan -Pack (Get-FixturePack) -Manifest $manifest -Feed $feed -PersonaIds @{}).ToPost | Should -Be 0
    }

    It 'a lost manifest adopts the posts already in the feed (same persona, text and parent) instead of duplicating' {
        $pack = Get-FixturePack
        $feed = @(
            [ordered]@{ id = 'a'; authorPersonaId = 'n7'; text = $pack['posts'][0]['text']; scenarioTime = '2026-10-19T12:00:00.000Z' }
            [ordered]@{ id = 'b'; authorPersonaId = 'em'; text = $pack['posts'][1]['text']; scenarioTime = '2026-10-19T12:30:00.000Z' }
            [ordered]@{ id = 'c'; authorPersonaId = 'em'; text = $pack['posts'][2]['text']; scenarioTime = '2026-10-19T12:45:00.000Z'; inReplyTo = [ordered]@{ postId = 'a'; authorHandle = 'Newsline7' } }
        )
        $plan = Get-PostPlan -Pack $pack -Manifest (New-SeedManifest) -Feed $feed -PersonaIds @{ Newsline7 = 'n7'; FulcoEM = 'em' }
        @($plan.Items | ForEach-Object { "$($_.Key)=$($_.Action):$($_.PostId)" }) | Should -Be @('p01=adopt:a', 'p02=adopt:b', 'p03=adopt:c')
        # The same text under another persona, or a reply to another parent, is NOT a match.
        $feed[2]['inReplyTo']['postId'] = 'elsewhere'
        (Get-PostPlan -Pack $pack -Manifest (New-SeedManifest) -Feed $feed -PersonaIds @{ Newsline7 = 'n7'; FulcoEM = 'em' }).Items[2].Action | Should -Be 'post'
    }

    It 'persona patch sends only what differs, and nothing on a re-run' {
        $persona = (Get-FixturePack)['personas'][0]
        $current = [ordered]@{ id = 'p'; handle = 'FulcoEM'; displayName = 'Fulton County EM'; verified = $false }
        $first = Get-PersonaPatch -PackPersona $persona -Current $current -AvatarAssetId 'av-1' -BannerAssetId 'bn-1' -Applied $null
        @($first.Keys) | Should -Be @('displayName', 'bio', 'location', 'verified', 'avatarMediaId', 'bannerMediaId')
        $after = [ordered]@{ id = 'p'; handle = 'FulcoEM'; displayName = $persona['displayName']; bio = $persona['bio']; location = $persona['location']; verified = $true; avatarUrl = 'https://x/a'; bannerUrl = 'https://x/b' }
        $again = Get-PersonaPatch -PackPersona $persona -Current $after -AvatarAssetId 'av-1' -BannerAssetId 'bn-1' -Applied ([ordered]@{ avatarAssetId = 'av-1'; bannerAssetId = 'bn-1' })
        $again.Count | Should -Be 0
        $newAvatar = Get-PersonaPatch -PackPersona $persona -Current $after -AvatarAssetId 'av-2' -BannerAssetId 'bn-1' -Applied ([ordered]@{ avatarAssetId = 'av-1'; bannerAssetId = 'bn-1' })
        @($newAvatar.Keys) | Should -Be @('avatarMediaId')
        $clear = Get-PersonaPatch -PackPersona ([ordered]@{ handle = 'FulcoEM'; bio = $null; avatar = $null }) -Current $after -AvatarAssetId $null -BannerAssetId $null -Applied $null
        $clear.Contains('bio') | Should -BeTrue; $clear['bio'] | Should -BeNullOrEmpty
        $clear.Contains('avatarMediaId') | Should -BeTrue; $clear['avatarMediaId'] | Should -BeNullOrEmpty
    }

    It 'manifest lives at <dir>/<exerciseId>.json: %LOCALAPPDATA%\Pulse\demo-seed on Windows, ~/.local/share/Pulse/demo-seed otherwise' {
        $saved = $env:LOCALAPPDATA, $env:XDG_DATA_HOME
        try {
            $env:LOCALAPPDATA = Join-Path $TestDrive 'appdata'; $env:XDG_DATA_HOME = $null
            Get-SeedManifestDirectory | Should -Be (Join-Path $TestDrive 'appdata' 'Pulse' 'demo-seed')
            $env:LOCALAPPDATA = $null
            Get-SeedManifestDirectory | Should -Be (Join-Path $HOME '.local' 'share' 'Pulse' 'demo-seed')
            Get-SeedManifestPath -Directory 'd' -ExerciseId '11111111-2222-4333-8444-555555555555' | Should -Be (Join-Path 'd' '11111111-2222-4333-8444-555555555555.json')
            { Get-SeedManifestPath -Directory 'd' -ExerciseId '../../etc/passwd' } | Should -Throw
        }
        finally { $env:LOCALAPPDATA, $env:XDG_DATA_HOME = $saved }
    }
}

Describe 'Run sheet: inject items for POST /api/injects (pure)' {
    BeforeAll {
        $script:Ids = @{
            Personas = @{ Newsline7 = 'a0000000-0000-4000-8000-0000000000a7'; FulcoEM = 'a0000000-0000-4000-8000-0000000000ae'; mvega_fh = 'a0000000-0000-4000-8000-0000000000a3' }
            Media = @{ 'harbor-photo' = '5eed0000-0000-4000-8000-00000000a001'; 'river-clip' = '5eed0000-0000-4000-8000-00000000a002' }
            Alt = @{ 'harbor-photo' = 'Photo alt'; 'river-clip' = 'Clip alt' }
            Posts = @{ p01 = '5eed0000-0000-4000-8000-00000000b001'; p02 = '5eed0000-0000-4000-8000-00000000b002'; p03 = '5eed0000-0000-4000-8000-00000000b003' }
            Children = @{ i01 = @('5eed0000-0000-4000-8000-00000000c001') }
        }
        function New-QueueRow {
            <# A GET /api/injects item for a pack item, as the server would return it. #>
            param($PackItem, [string] $Id = ([guid]::NewGuid().ToString()), [string] $Status = 'pending')
            $k = 0
            [ordered]@{
                id = $Id; kind = $PackItem['kind']; title = $PackItem['title']; status = $Status
                posts = @($PackItem['posts'] | ForEach-Object { $k++; [ordered]@{ id = [guid]::NewGuid().ToString(); sequence = $k; personaId = $script:Ids.Personas[$_['persona']]; text = $_['text'] } })
            }
        }
    }

    It 'a post item: the exact body (media as { mediaId, alt }, a reply to a seeded post as { postId }, the assignee id)' {
        $item = (Get-FixturePack)['runSheet']['items'][0]
        $body = New-InjectRequestBody -Item $item -PersonaIds $script:Ids.Personas -MediaIds $script:Ids.Media -MediaAlt $script:Ids.Alt -PostIds $script:Ids.Posts -AssigneeId 'f0000000-0000-4000-8000-00000000000f'
        ConvertTo-SeedJson $body -Compress | Should -BeExactly ('{"kind":"post","title":"Newsline follows up on the road closure","notes":"Fixture only. Fire after the first participant post.",' +
            '"plannedMinute":5,"assigneeId":"f0000000-0000-4000-8000-00000000000f","posts":[{"personaId":"a0000000-0000-4000-8000-0000000000a7",' +
            '"text":"Test fixture inject: we are at the Harbor Road closure now. More shortly.","media":[{"mediaId":"5eed0000-0000-4000-8000-00000000a001","alt":"Photo alt"}],' +
            '"replyTo":{"postId":"5eed0000-0000-4000-8000-00000000b002"},"engagementBaseline":{"like":20}}]}')
    }

    It 'a burst: the exact body (a sibling reply stays { sequence }, a reply to an earlier item becomes { injectPostId })' {
        $item = (Get-FixturePack)['runSheet']['items'][1]
        $body = New-InjectRequestBody -Item $item -PersonaIds $script:Ids.Personas -MediaIds $script:Ids.Media -MediaAlt $script:Ids.Alt -PostIds $script:Ids.Posts -InjectPostIds $script:Ids.Children
        ConvertTo-SeedJson $body -Compress | Should -BeExactly ('{"kind":"burst","title":"Residents pile on about the bridge","plannedMinute":12,"burstWindowSeconds":60,"posts":[' +
            '{"personaId":"a0000000-0000-4000-8000-0000000000a3","text":"Test fixture burst: is the mill bridge really still open? Water is over the curb on my street.","engagementBaseline":{"like":15,"repost":4}},' +
            '{"personaId":"a0000000-0000-4000-8000-0000000000a7","text":"Test fixture burst reply: we are checking with the county now.","replyTo":{"sequence":1}},' +
            '{"personaId":"a0000000-0000-4000-8000-0000000000ae","text":"Test fixture burst reply: crews are at Harbor Road. Please stay clear of the closure.","replyTo":{"injectPostId":"5eed0000-0000-4000-8000-00000000c001"}}]}')
    }

    It 'sends only what the pack has (no notes, minute, window or assignee), and an alt override as written' {
        $item = [ordered]@{ key = 'x'; kind = 'burst'; title = 'Bare'; posts = @(
                [ordered]@{ persona = 'FulcoEM'; text = 'one'; media = @([ordered]@{ ref = 'river-clip'; alt = '  Override alt ' }) }
                [ordered]@{ persona = 'FulcoEM'; text = 'two'; replyTo = [ordered]@{ item = 'x'; sequence = 1 } }
            ) }
        $json = ConvertTo-SeedJson (New-InjectRequestBody -Item $item -PersonaIds $script:Ids.Personas -MediaIds $script:Ids.Media -MediaAlt $script:Ids.Alt) -Compress
        $json | Should -BeExactly ('{"kind":"burst","title":"Bare","posts":[{"personaId":"a0000000-0000-4000-8000-0000000000ae","text":"one","media":[{"mediaId":"5eed0000-0000-4000-8000-00000000a002","alt":"Override alt"}]},' +
            '{"personaId":"a0000000-0000-4000-8000-0000000000ae","text":"two","replyTo":{"sequence":1}}]}')
    }

    It 'refuses to build a body with an unresolved reference (never sends a pack key as an id)' {
        $item = (Get-FixturePack)['runSheet']['items'][1]
        { New-InjectRequestBody -Item $item -PersonaIds $script:Ids.Personas -InjectPostIds @{} } | Should -Throw "*item 'i01' has no id*"
        { New-InjectRequestBody -Item (Get-FixturePack)['runSheet']['items'][0] -PersonaIds $script:Ids.Personas -PostIds $script:Ids.Posts } | Should -Throw "*media 'harbor-photo' has no uploaded asset id*"
        { New-InjectRequestBody -Item $item -PersonaIds @{ Newsline7 = 'n' } -InjectPostIds $script:Ids.Children } | Should -Throw "*persona 'mvega_fh' has no id*"
    }

    It 'plan offline: the manifest alone decides' {
        $manifest = New-SeedManifest
        @((Get-InjectPlan -Pack (Get-FixturePack) -Manifest $manifest -Queue $null -PersonaIds $null).Items | ForEach-Object Action) | Should -Be @('create', 'create')
        $manifest['injects']['i01'] = [ordered]@{ itemId = 'item-1' }
        $plan = Get-InjectPlan -Pack (Get-FixturePack) -Manifest $manifest -Queue $null -PersonaIds $null
        @($plan.Items | ForEach-Object { "$($_.Key)=$($_.Action)" }) | Should -Be @('i01=skip', 'i02=create')
        $plan.ToCreate | Should -Be 1
        $plan.Items[1].PostCount | Should -Be 3
    }

    It 'plan online: a manifest id still in the queue is skipped (any status); a deleted one is created again; a lost manifest adopts' {
        $pack = Get-FixturePack
        $i01 = New-QueueRow $pack['runSheet']['items'][0] -Id 'item-1' -Status 'fired'
        $i02 = New-QueueRow $pack['runSheet']['items'][1] -Id 'item-2'
        $manifest = New-SeedManifest
        $manifest['injects']['i01'] = [ordered]@{ itemId = 'item-1' }
        $manifest['injects']['i02'] = [ordered]@{ itemId = 'item-gone' }
        $plan = Get-InjectPlan -Pack $pack -Manifest $manifest -Queue @($i01) -PersonaIds $script:Ids.Personas
        @($plan.Items | ForEach-Object { "$($_.Key)=$($_.Action)" }) | Should -Be @('i01=skip', 'i02=create')
        $plan.Items[0].Reason | Should -Be 'in the run sheet (fired)'
        $plan.Items[1].Reason | Should -Match 'deleted in the console'

        $lost = Get-InjectPlan -Pack $pack -Manifest (New-SeedManifest) -Queue @($i01, $i02) -PersonaIds $script:Ids.Personas
        @($lost.Items | ForEach-Object { "$($_.Key)=$($_.Action):$($_.ItemId)" }) | Should -Be @('i01=adopt:item-1', 'i02=adopt:item-2')
        $lost.ToCreate | Should -Be 0
    }

    It 'adopts only a true match (kind, title, persona and text per post), and never one item for two pack items' {
        $pack = Get-FixturePack
        $row = New-QueueRow $pack['runSheet']['items'][0] -Id 'item-1'
        Test-InjectItemMatch -PackItem $pack['runSheet']['items'][0] -Row $row -PersonaIds $script:Ids.Personas | Should -BeTrue
        foreach ($change in @(
                { param($r) $r['title'] = 'Another title' }
                { param($r) $r['kind'] = 'burst' }
                { param($r) $r['posts'][0]['text'] = 'Different text' }
                { param($r) $r['posts'][0]['personaId'] = $script:Ids.Personas['FulcoEM'] }
                { param($r) $r['posts'] = @() }
            )) {
            $other = New-QueueRow $pack['runSheet']['items'][0]
            & $change $other
            Test-InjectItemMatch -PackItem $pack['runSheet']['items'][0] -Row $other -PersonaIds $script:Ids.Personas | Should -BeFalse -Because "$change"
        }
        # Two identical pack items and one matching queue item: the first adopts it, the second is created.
        $twin = Copy-Map $pack['runSheet']['items'][0]; $twin['key'] = 'i01b'
        $pack['runSheet']['items'] = @($pack['runSheet']['items'][0], $twin)
        $plan = Get-InjectPlan -Pack $pack -Manifest (New-SeedManifest) -Queue @($row) -PersonaIds $script:Ids.Personas
        @($plan.Items | ForEach-Object Action) | Should -Be @('adopt', 'create')
    }

    It 'warns when an item already loaded differs from the pack (the queue''s version stays)' {
        $pack = Get-FixturePack
        $row = New-QueueRow $pack['runSheet']['items'][0] -Id 'item-1'; $row['title'] = 'Edited in the console'
        $manifest = New-SeedManifest; $manifest['injects']['i01'] = [ordered]@{ itemId = 'item-1' }
        $plan = Get-InjectPlan -Pack $pack -Manifest $manifest -Queue @($row) -PersonaIds $script:Ids.Personas
        $plan.Items[0].Action | Should -Be 'skip'
        $plan.Warnings | Should -Match "i01 differs from the pack"
    }

    It 'assignees: "me", a display name ignoring case, unknown and ambiguous names' {
        $roster = [ordered]@{ me = 'id-me'; assignees = @(
                [ordered]@{ id = 'id-me'; displayName = 'Casey Controller'; role = 'controller' }
                [ordered]@{ id = 'id-eve'; displayName = 'Eve Evaluator'; role = 'evaluator' }
                [ordered]@{ id = 'id-sam1'; displayName = 'Sam'; role = 'controller' }
                [ordered]@{ id = 'id-sam2'; displayName = 'sam'; role = 'controller' }
            ) }
        $items = @(
            [ordered]@{ key = 'a'; assignee = 'ME' }
            [ordered]@{ key = 'b'; assignee = ' eve evaluator ' }
            [ordered]@{ key = 'c'; assignee = 'Nobody' }
            [ordered]@{ key = 'd'; assignee = 'Sam' }
            [ordered]@{ key = 'e'; assignee = $null }
            [ordered]@{ key = 'f' }
        )
        $result = Resolve-InjectAssignees -Items $items -Roster $roster
        $result.Ids['me'] | Should -Be 'id-me'
        $result.Ids['eve evaluator'] | Should -Be 'id-eve'
        $result.Unknown | Should -Be @('Nobody')
        $result.Ambiguous | Should -Be @('Sam')
        $result.Known | Should -Be @('Casey Controller', 'Eve Evaluator', 'Sam')
    }

    It 'a ProblemDetails "detail" is the error text, and -Full keeps a long one whole' {
        $long = 'Post 2: ' + ('x' * 400)
        $response = [pscustomobject]@{ Status = 400; Json = [ordered]@{ type = 't'; title = 'Bad Request'; status = 400; detail = $long }; Text = '{}' }
        Get-ApiErrorText $response -Full | Should -BeExactly $long
        (Get-ApiErrorText $response).Length | Should -Be 301
        Get-ApiErrorText ([pscustomobject]@{ Status = 400; Json = 'plain'; Text = '"plain"' }) | Should -Be 'plain'
    }
}

Describe 'End to end against the fake API' {
    BeforeEach {
        $script:Fake = New-FakePulse
        $env:PULSE_STAFF_SECRET = $script:Fake.Secret
        Mock Invoke-WebRequest { Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType }
        Mock Invoke-MediaRangeRequest { 206 }
        Mock Start-Sleep { }
        Mock Read-Host { throw 'The secret prompt must not appear when PULSE_STAFF_SECRET is set.' }
        Remove-Item -Recurse -Force (Join-Path $TestDrive 'manifests') -ErrorAction SilentlyContinue
    }
    AfterEach { $env:PULSE_STAFF_SECRET = $null }

    It 'seeds everything, then a second run issues zero uploads, zero posts and zero run-sheet items' {
        $script:Fake.RateLimitFirstUpload = $true
        $first = Invoke-FakeSeed @{ ScenarioAnchor = [DateTimeOffset] '2026-10-19T14:00:00Z' }
        $first.Code | Should -Be 0 -Because $first.Text
        (Get-FakeCalls POST '/api/media').Count | Should -Be 6          # 5 files + the one 429
        Should -Invoke Start-Sleep -Times 1 -ParameterFilter { $Seconds -eq 7 }   # waited the Retry-After
        (Get-FakeCalls POST '/api/posts').Count | Should -Be 3
        @($script:Fake.Calls | Where-Object { $_.Method -eq 'PATCH' }).Count | Should -Be 2
        $script:Fake.Tier | Should -Be 'engine'

        $manifestPath = Join-Path $TestDrive 'manifests' "$($script:Fake.ExerciseId).json"
        $manifest = ConvertFrom-SeedJson (Get-Content -LiteralPath $manifestPath -Raw)
        @($manifest['files'].Keys).Count | Should -Be 5
        @($manifest['posts'].Keys) | Should -Be @('p01', 'p02', 'p03')
        $manifest['media']['river-clip']['posterAssetId'] | Should -Be $manifest['files']['media/river-clip.poster.jpg']['assetId']
        $manifest['completedAt'] | Should -Not -BeNullOrEmpty
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 2
        @($manifest['injects'].Keys) | Should -Be @('i01', 'i02')
        $manifest['injects']['i01']['itemId'] | Should -Be $script:Fake.Injects[0].id
        $manifest['injects']['i02']['itemId'] | Should -Be $script:Fake.Injects[1].id
        $manifest['injects']['i02']['posts'] | Should -Be 3
        $first.Text | Should -Match '✅ all 2 run-sheet item\(s\) are in the console''s queue with their posts'

        $script:Fake.Calls.Clear()
        $second = Invoke-FakeSeed @{ ScenarioAnchor = [DateTimeOffset] '2026-10-19T14:00:00Z' }
        $second.Code | Should -Be 0 -Because $second.Text
        (Get-FakeCalls POST '/api/media').Count | Should -Be 0
        (Get-FakeCalls POST '/api/posts').Count | Should -Be 0
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 0
        @($script:Fake.Calls | Where-Object { $_.Method -eq 'PATCH' }).Count | Should -Be 0
        $script:Fake.Posts.Count | Should -Be 3
        $script:Fake.Injects.Count | Should -Be 2
        $second.Text | Should -Match 'i01 — in the run sheet \(pending\)'
    }

    It 'uploads the poster first and the video with posterMediaId; posts carry the real request shape' {
        (Invoke-FakeSeed @{ ScenarioAnchor = [DateTimeOffset] '2026-10-19T14:00:00Z' }).Code | Should -Be 0
        $uploads = Get-FakeCalls POST '/api/media'
        $uploads[0].Form['file'].Name | Should -Be 'river-clip.poster.jpg'
        $video = $uploads | Where-Object { $_.Form['kind'] -eq 'video' }
        $poster = $script:Fake.Assets.Values | Where-Object fileName -eq 'river-clip.poster.jpg'
        $video.Form['posterMediaId'] | Should -Be $poster.id
        $video.Form['durationSec'] | Should -Be '1'
        $video.Form['width'] | Should -Be '96'

        $posts = @(Get-FakeCalls POST '/api/posts' | ForEach-Object { ConvertFrom-SeedJson $_.Body })
        @($posts[0].Keys | Sort-Object) | Should -Be @('authorPersonaId', 'engagementBaseline', 'media', 'origin', 'scenarioTime', 'text', 'timeZone')
        @($posts[2].Keys | Sort-Object) | Should -Be @('authorPersonaId', 'engagementBaseline', 'origin', 'parentPostId', 'scenarioTime', 'text', 'timeZone')
        $posts[0].origin | Should -Be 'controller-as-persona'
        $posts[0].timeZone | Should -Be 'America/Chicago'
        $posts[0].scenarioTime | Should -Be '2026-10-19T12:00:00.000Z'   # anchor - 120
        $posts[1].scenarioTime | Should -Be '2026-10-19T12:30:00.000Z'   # anchor - 90
        $posts[2].scenarioTime | Should -Be '2026-10-19T12:45:00.000Z'   # anchor - 75
        $posts[1].media[0].alt | Should -Be 'Test pattern standing in for a photo of the closed section of Harbor Road.'
        $posts[0].engagementBaseline.like | Should -Be 40
        $posts[2].parentPostId | Should -Be $script:Fake.Posts[0].id     # the reply, after its parent
        @($posts | ForEach-Object { $_.Contains('actingHumanId') }) | Should -Not -Contain $true

        $patch = Get-FakeCalls PATCH ($script:Fake.Calls | Where-Object Method -eq 'PATCH' | Select-Object -First 1).Path
        $patch[0].ContentType | Should -BeLike 'application/merge-patch+json*'
        # Read first, set once: before the posts it finds 'running' and sets 'engine'; after seeding it finds 'engine'.
        (Get-FakeCalls GET '/api/steering/pause-tier').Count | Should -Be 2
        $pause = @(Get-FakeCalls POST '/api/steering/pause-tier')
        $pause.Count | Should -Be 1
        (ConvertFrom-SeedJson $pause[0].Body).tier | Should -Be 'engine'
        (ConvertFrom-SeedJson $pause[0].Body).actingHumanId | Should -Be $script:Fake.StaffId
    }

    It 'an unknown handle stops before any write and lists the known handles' {
        $root = Join-Path $TestDrive 'unknown-handle'; Copy-Item -Recurse $script:FixtureRoot $root
        $pack = Get-FixturePack; $pack['posts'][1]['persona'] = 'NoSuchHandle'
        Set-Content -LiteralPath (Join-Path $root 'pack.json') -Value (ConvertTo-SeedJson $pack)
        $run = Invoke-FakeSeed @{ PackPath = (Join-Path $root 'pack.json') }
        $run.Code | Should -Be 1
        $run.Text | Should -Match 'unknown persona handle\(s\): NoSuchHandle'
        $run.Text | Should -Match 'Known handles in this exercise: FulcoEM, mvega_fh, Newsline7'
        @($script:Fake.Calls | Where-Object { $_.Method -ne 'GET' -and $_.Path -ne '/api/auth/staff/login' }).Count | Should -Be 0
    }

    It '-WhatIf prints the plan, signs in to nothing and writes nothing' {
        $run = Invoke-FakeSeed @{ WhatIf = $true }
        $run.Code | Should -Be 0
        $run.Text | Should -Match 'Media uploads   5 to upload'
        $run.Text | Should -Match 'Persona edits   2 persona\(s\) in the pack'
        $run.Text | Should -Match 'Posts           3 to post \(1 reply\)'
        # The run sheet: each item it would create, with its kind, title and post count (no export path any more).
        $run.Text | Should -Match 'Run sheet       2 item\(s\) to create \(4 scripted post\(s\)'
        $run.Text | Should -Match '\+ i01  post   "Newsline follows up on the road closure" \(1 post\)'
        $run.Text | Should -Match '\+ i02  burst  "Residents pile on about the bridge" \(3 posts\)'
        $run.Text | Should -Not -Match 'runsheet\.demo\.json'
        @($script:Fake.Calls | ForEach-Object { "$($_.Method) $($_.Path)" }) | Should -Be @('GET /api/exercise-context')
        Test-Path (Join-Path $TestDrive 'manifests') | Should -BeFalse
    }

    It '-LeaveEngineRunning never touches the pause tier' {
        (Invoke-FakeSeed @{ LeaveEngineRunning = $true }).Code | Should -Be 0
        (Get-FakeCalls POST '/api/steering/pause-tier').Count | Should -Be 0
        $script:Fake.Tier | Should -Be 'running'
    }

    It 'a failed post stops the run; a plain re-run refuses to mix anchors; -Resume finishes on the original anchor without duplicates' {
        $script:Fake.FailPostNumber = 2
        $first = Invoke-FakeSeed
        $first.Code | Should -Be 1
        $first.Text | Should -Match 'Run again with -Resume'
        $script:Fake.Posts.Count | Should -Be 1
        $manifest = ConvertFrom-SeedJson (Get-Content -LiteralPath (Join-Path $TestDrive 'manifests' "$($script:Fake.ExerciseId).json") -Raw)
        $anchor = ConvertTo-SeedInstant $manifest['anchor']

        $script:Fake.FailPostNumber = 0
        $plain = Invoke-FakeSeed
        $plain.Code | Should -Be 1
        $plain.Text | Should -Match 'Re-run with -Resume'
        $script:Fake.Posts.Count | Should -Be 1

        $script:Fake.Calls.Clear()
        $resumed = Invoke-FakeSeed @{ Resume = $true }
        $resumed.Code | Should -Be 0 -Because $resumed.Text
        (Get-FakeCalls POST '/api/media').Count | Should -Be 0
        $script:Fake.Posts.Count | Should -Be 3
        $script:Fake.Posts[1].scenarioTime | Should -Be (Get-PostScenarioTime -Anchor $anchor -MinutesBeforeAnchor 90)
        $script:Fake.Posts[2].parent | Should -Be $script:Fake.Posts[0].id
    }

    It 'self-check: a media URL that does not answer 206 fails the run (exit 1, ❌)' {
        Mock Invoke-MediaRangeRequest { 200 }
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 1
        $run.Text | Should -Match '❌ media URL\(s\) not answering 206'
        $run.Text | Should -Match 'NOT READY'
    }

    It 'self-check: probes post media, posters, avatars and banners, without the token' {
        (Invoke-FakeSeed).Code | Should -Be 0
        Should -Invoke Invoke-MediaRangeRequest -Times 5 -Exactly
        Should -Invoke Invoke-MediaRangeRequest -ParameterFilter { $Url -like 'https://blob.fake.test/*' } -Times 5 -Exactly
        (Get-Command Invoke-MediaRangeRequest).Parameters.Keys | Should -Not -Contain 'Headers'
    }
}

Describe 'Run-sheet load end to end (in-memory fake that enforces the server''s 400 rules)' {
    BeforeEach {
        $script:Fake = New-FakePulse
        $env:PULSE_STAFF_SECRET = $script:Fake.Secret
        Mock Invoke-WebRequest { Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType }
        Mock Invoke-MediaRangeRequest { 206 }
        Mock Start-Sleep { }
        Remove-Item -Recurse -Force (Join-Path $TestDrive 'manifests') -ErrorAction SilentlyContinue
    }
    AfterEach { $env:PULSE_STAFF_SECRET = $null }

    BeforeAll {
        function Get-FakePersonaId([string] $Handle) { [string] (@($script:Fake.Personas.Values) | Where-Object handle -eq $Handle).id }
        function Get-InjectManifest { (ConvertFrom-SeedJson (Get-Content -LiteralPath (Join-Path $TestDrive 'manifests' "$($script:Fake.ExerciseId).json") -Raw))['injects'] }
        function Write-VariantPack {
            <# A copy of the fixture pack with one change, in its own folder (the media files come along). #>
            param([string] $Name, [scriptblock] $Mutate)
            $root = Join-Path $TestDrive $Name
            if (-not (Test-Path $root)) { Copy-Item -Recurse $script:FixtureRoot $root }
            $pack = Get-FixturePack; & $Mutate $pack
            Set-Content -LiteralPath (Join-Path $root 'pack.json') -Value (ConvertTo-SeedJson $pack)
            return (Join-Path $root 'pack.json')
        }
    }

    It 'the fake is an honest oracle: it answers the server''s 400 for <Name>' -ForEach @(
        @{ Name = 'a bad kind'; Mutate = { param($b) $b['kind'] = 'thread' }; Detail = "kind must be 'post' or 'burst'." }
        @{ Name = 'a 121-character title'; Mutate = { param($b) $b['title'] = 't' * 121 }; Detail = 'title must be between 1 and 120 characters.' }
        @{ Name = 'a burst of one'; Mutate = { param($b) $b['posts'] = @($b['posts'][0]) }; Detail = "A 'burst' must have between 2 and 20 posts." }
        @{ Name = 'a window under 30'; Mutate = { param($b) $b['burstWindowSeconds'] = 20 }; Detail = 'burstWindowSeconds must be between 30 and 600.' }
        @{ Name = 'a sibling reply to itself'; Mutate = { param($b) $b['posts'][1]['replyTo'] = [ordered]@{ sequence = 2 } }; Detail = 'Post 2: replyTo.sequence must name an earlier post in this item.' }
        @{ Name = 'two reply forms'; Mutate = { param($b) $b['posts'][1]['replyTo'] = [ordered]@{ sequence = 1; postId = 'x' } }; Detail = 'Post 2: replyTo must name exactly one of injectPostId, postId or sequence.' }
        @{ Name = 'an unknown persona'; Mutate = { param($b) $b['posts'][0]['personaId'] = [guid]::NewGuid().ToString() }; Detail = 'Post 1: personaId does not name a persona in this exercise.' }
        @{ Name = 'an unknown assignee'; Mutate = { param($b) $b['assigneeId'] = [guid]::NewGuid().ToString() }; Detail = 'assigneeId does not name a staff member assigned to this exercise.' }
        @{ Name = 'a baseline over 1,000,000'; Mutate = { param($b) $b['posts'][0]['engagementBaseline'] = [ordered]@{ like = 1000001 } }; Detail = 'Post 1: engagementBaseline counts must be between 0 and 1,000,000.' }
    ) {
        $persona = @($script:Fake.Personas.Keys)[0]
        $body = [ordered]@{ kind = 'burst'; title = 'Oracle'; burstWindowSeconds = 60; posts = @(
                [ordered]@{ personaId = $persona; text = 'one' }
                [ordered]@{ personaId = $persona; text = 'two'; replyTo = [ordered]@{ sequence = 1 } }
            ) }
        $headers = @{ Authorization = "Bearer $($script:Fake.Token)" }
        $ok = Invoke-FakePulse -Fake $script:Fake -Uri 'https://api.fake.test/api/injects' -Method POST -Headers $headers -Body (ConvertTo-SeedJson $body -Compress)
        $ok.StatusCode | Should -Be 201
        & $Mutate $body
        $refused = Invoke-FakePulse -Fake $script:Fake -Uri 'https://api.fake.test/api/injects' -Method POST -Headers $headers -Body (ConvertTo-SeedJson $body -Compress)
        $refused.StatusCode | Should -Be 400
        (ConvertFrom-SeedJson $refused.Content)['detail'] | Should -BeExactly $Detail
    }

    It 'sends the exact InjectItemWrite bodies: a post with media and a reply to a seeded post; a burst with a sibling reply and a reply to the first item' {
        $run = Invoke-FakeSeed @{ ScenarioAnchor = [DateTimeOffset] '2026-10-19T14:00:00Z' }
        $run.Code | Should -Be 0 -Because $run.Text
        $calls = @(Get-FakeCalls POST '/api/injects')
        $calls.Count | Should -Be 2
        $photo = [string] (@($script:Fake.Assets.Values) | Where-Object fileName -eq 'harbor-photo.jpg').id
        $p02 = [string] (@($script:Fake.Posts) | Where-Object { $_.text -like 'Test fixture: Harbor Road is closed*' }).id
        $i01Post = [string] $script:Fake.Injects[0].posts[0].id
        $calls[0].Body | Should -BeExactly ('{"kind":"post","title":"Newsline follows up on the road closure","notes":"Fixture only. Fire after the first participant post.",' +
            '"plannedMinute":5,"assigneeId":"' + $script:Fake.StaffId + '","posts":[{"personaId":"' + (Get-FakePersonaId 'Newsline7') + '",' +
            '"text":"Test fixture inject: we are at the Harbor Road closure now. More shortly.","media":[{"mediaId":"' + $photo + '",' +
            '"alt":"Test pattern standing in for a photo of standing water on a harbor road."}],"replyTo":{"postId":"' + $p02 + '"},"engagementBaseline":{"like":20}}]}')
        $calls[1].Body | Should -BeExactly ('{"kind":"burst","title":"Residents pile on about the bridge","plannedMinute":12,"assigneeId":"e0000000-0000-4000-8000-00000000000e",' +
            '"burstWindowSeconds":60,"posts":[{"personaId":"' + (Get-FakePersonaId 'mvega_fh') + '","text":"Test fixture burst: is the mill bridge really still open? Water is over the curb on my street.",' +
            '"engagementBaseline":{"like":15,"repost":4}},{"personaId":"' + (Get-FakePersonaId 'Newsline7') + '","text":"Test fixture burst reply: we are checking with the county now.","replyTo":{"sequence":1}},' +
            '{"personaId":"' + (Get-FakePersonaId 'FulcoEM') + '","text":"Test fixture burst reply: crews are at Harbor Road. Please stay clear of the closure.","replyTo":{"injectPostId":"' + $i01Post + '"}}]}')
        # The server stored the sibling reply as { injectPostId } of post 1 (As built), and the items are pending, unfired.
        $script:Fake.Injects[1].posts[1].replyTo.injectPostId | Should -Be $script:Fake.Injects[1].posts[0].id
        @($script:Fake.Injects | ForEach-Object status) | Should -Be @('pending', 'pending')
        (Get-FakeCalls GET '/api/injects/assignees').Count | Should -Be 1
        $run.Text | Should -Match 'i02  burst  "Residents pile on about the bridge" \(3 posts, assigned to eve evaluator\) -> '
    }

    It 'the run sheet is loaded after the posts it replies to, and no item is fired' {
        (Invoke-FakeSeed).Code | Should -Be 0
        $order = @($script:Fake.Calls | Where-Object Method -eq 'POST' | ForEach-Object Path)
        [array]::LastIndexOf($order, '/api/posts') | Should -BeLessThan ([array]::IndexOf($order, '/api/injects'))
        @($script:Fake.Calls | Where-Object { $_.Path -like '/api/injects/*' -and $_.Path -ne '/api/injects/assignees' }).Count | Should -Be 0
    }

    It 'a run-sheet item deleted in the console is created again (only that one), and replies to the item that stayed' {
        (Invoke-FakeSeed).Code | Should -Be 0
        $kept = $script:Fake.Injects[0]; $deleted = $script:Fake.Injects[1].id
        $script:Fake.Injects.RemoveAt(1)
        $script:Fake.Calls.Clear()
        $again = Invoke-FakeSeed
        $again.Code | Should -Be 0 -Because $again.Text
        $calls = @(Get-FakeCalls POST '/api/injects')
        $calls.Count | Should -Be 1
        $body = ConvertFrom-SeedJson $calls[0].Body
        $body['title'] | Should -Be 'Residents pile on about the bridge'
        $body['posts'][2]['replyTo']['injectPostId'] | Should -Be $kept.posts[0].id
        $again.Text | Should -Match '\+ i02  burst  "Residents pile on about the bridge" \(3 posts\); loaded before, but no longer in the run sheet \(deleted in the console\)'
        $script:Fake.Injects.Count | Should -Be 2
        (Get-InjectManifest)['i02']['itemId'] | Should -Not -Be $deleted
        (Get-InjectManifest)['i02']['itemId'] | Should -Be $script:Fake.Injects[1].id
    }

    It 'warns when a loaded item still replies to a seeded post that was archived and posted again' {
        (Invoke-FakeSeed).Code | Should -Be 0
        $p02 = @($script:Fake.Posts) | Where-Object { $_.text -like 'Test fixture: Harbor Road is closed*' }
        [void] $script:Fake.Posts.Remove($p02)                       # archived (Clear-DemoContent.ps1)
        $again = Invoke-FakeSeed @{ Resume = $true }
        $again.Code | Should -Be 0 -Because $again.Text
        (Get-FakeCalls POST '/api/posts').Count | Should -Be 4        # p02 posted again
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 2      # nothing loaded twice
        $again.Text | Should -Match '\[WARN\] i01 still replies to the earlier copy of p02 \(archived and posted again since it was loaded\)'
        $again.Text | Should -Not -Match 'i02 still replies'
    }

    It 'a lost manifest adopts the items already in the run sheet instead of duplicating them' {
        (Invoke-FakeSeed).Code | Should -Be 0
        $ids = @($script:Fake.Injects | ForEach-Object id)
        Remove-Item -Recurse -Force (Join-Path $TestDrive 'manifests')
        $script:Fake.Calls.Clear()
        $again = Invoke-FakeSeed
        $again.Code | Should -Be 0 -Because $again.Text
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 0
        $script:Fake.Injects.Count | Should -Be 2
        @((Get-InjectManifest).Values | ForEach-Object { $_['itemId'] }) | Should -Be $ids
    }

    It 'an uncertain create (<Fault>) is never sent twice: the run sheet is re-read and the item adopted' -ForEach @(
        @{ Fault = 'lost-after-write' }
        @{ Fault = '408-after-write' }
        @{ Fault = '503-after-write' }
        @{ Fault = 'unreadable-201' }
    ) {
        $script:Fake.InjectFaults[1] = $Fault
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 0 -Because $run.Text
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 2           # i01 once (adopted), i02 once
        $script:Fake.Injects.Count | Should -Be 2
        $run.Text | Should -Match 'i01  post .* adopted, not sent again'
        (Get-InjectManifest)['i01']['itemId'] | Should -Be $script:Fake.Injects[0].id
        (Get-InjectManifest)['i01']['adoptedAt'] | Should -Not -BeNullOrEmpty
        # i02's reply to i01 used the adopted item's post id.
        (ConvertFrom-SeedJson (Get-FakeCalls POST '/api/injects')[1].Body)['posts'][2]['replyTo']['injectPostId'] | Should -Be $script:Fake.Injects[0].posts[0].id
    }

    It 'an uncertain create that did not land stops the run without re-sending; -Resume then creates it once' {
        $script:Fake.InjectFaults[1] = 'lost-before-write'
        $first = Invoke-FakeSeed
        $first.Code | Should -Be 1
        $first.Text | Should -Match 'i01: POST /api/injects failed: The response ended prematurely; it is not in the run sheet now\.'
        $first.Text | Should -Match 'NOT sent again'
        $first.Text | Should -Match '-Resume'
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 1
        $script:Fake.Injects.Count | Should -Be 0
        $script:Fake.Posts.Count | Should -Be 3                             # the opening feed is in

        $resumed = Invoke-FakeSeed @{ Resume = $true }
        $resumed.Code | Should -Be 0 -Because $resumed.Text
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 3
        $script:Fake.Injects.Count | Should -Be 2
        $script:Fake.Posts.Count | Should -Be 3
    }

    It 'a 429 on a create waits the Retry-After and creates the item once' {
        $script:Fake.InjectFaults[1] = 'rate-limited'
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 0 -Because $run.Text
        Should -Invoke Start-Sleep -Times 1 -Exactly -ParameterFilter { $Seconds -eq 5 }
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 3            # the refused one + i01 + i02
        $script:Fake.Injects.Count | Should -Be 2
    }

    It 'a 400 stops the run (exit 1) and prints the server''s detail as it is' {
        # The photo leaves the library between the upload and the run sheet: the server refuses i01's media.
        Mock Invoke-WebRequest {
            if ($Method -eq 'POST' -and ([Uri] $Uri).AbsolutePath -eq '/api/injects') {
                $photo = @($script:Fake.Assets.Values) | Where-Object fileName -eq 'harbor-photo.jpg'
                if ($photo) { $script:Fake.Assets.Remove($photo.id) }
            }
            Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType
        }
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 1
        $run.Text | Should -Match ([regex]::Escape('[FAIL] i01 refused (400): Post 1: One or more media items could not be found.'))
        (Get-FakeCalls POST '/api/injects').Count | Should -Be 1
        $script:Fake.Injects.Count | Should -Be 0
        $run.Text | Should -Not -MatchExactly 'SEEDED'
    }

    It 'an unknown handle in a run-sheet post stops before any write' {
        $path = Write-VariantPack 'inject-unknown-handle' { param($p) $p['runSheet']['items'][1]['posts'][0]['persona'] = 'NoSuchHandle' }
        $run = Invoke-FakeSeed @{ PackPath = $path }
        $run.Code | Should -Be 1
        $run.Text | Should -Match 'unknown persona handle\(s\): NoSuchHandle\. Nothing was written\.'
        @($script:Fake.Calls | Where-Object { $_.Method -ne 'GET' -and $_.Path -ne '/api/auth/staff/login' }).Count | Should -Be 0
    }

    It 'an unknown assignee stops before any write and lists the staff' {
        $path = Write-VariantPack 'inject-unknown-assignee' { param($p) $p['runSheet']['items'][1]['assignee'] = 'Nobody Here' }
        $run = Invoke-FakeSeed @{ PackPath = $path }
        $run.Code | Should -Be 1
        $run.Text | Should -Match 'unknown run-sheet assignee\(s\): Nobody Here\. Nothing was written\.'
        $run.Text | Should -Match 'Staff assigned to this exercise: Casey Controller, Eve Evaluator \(or "me" for controller1\)'
        @($script:Fake.Calls | Where-Object { $_.Method -ne 'GET' -and $_.Path -ne '/api/auth/staff/login' }).Count | Should -Be 0
        Test-Path (Join-Path $TestDrive 'manifests') | Should -BeFalse
    }

    It 'a server without the inject queue (404) stops before any write' {
        Mock Invoke-WebRequest {
            if (([Uri] $Uri).AbsolutePath -like '/api/injects*') { return [pscustomobject]@{ StatusCode = 404; Content = ''; Headers = @{} } }
            Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType
        }
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 1
        $run.Text | Should -Match 'GET /api/injects -> 404 \(this API has no inject queue'
        @($script:Fake.Calls | Where-Object { $_.Method -ne 'GET' -and $_.Path -ne '/api/auth/staff/login' }).Count | Should -Be 0
    }

    It 'self-check: an item missing from the run sheet, or with a post gone, fails the run (exit 1, ❌)' {
        Mock Invoke-WebRequest {
            if ($Method -eq 'GET' -and ([Uri] $Uri).AbsolutePath -eq '/api/feed' -and -not ([Uri] $Uri).Query -and $script:Fake.Injects.Count -eq 2) {
                # Between the load and the self-check: i01 is deleted and one of i02's posts is removed.
                $script:Fake.Injects[1].posts = @($script:Fake.Injects[1].posts | Select-Object -First 2)
                $script:Fake.Injects.RemoveAt(0)
            }
            Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType
        }
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 1
        $run.Text | Should -Match '❌ run-sheet items missing or changed: i01 \(not in the run sheet\), i02 \(2/3 posts\)'
        $run.Text | Should -Match 'NOT READY'
    }

    It 'a pack without a run sheet loads no items and reads no queue' {
        $path = Write-VariantPack 'no-run-sheet' { param($p) $p.Remove('runSheet') }
        $run = Invoke-FakeSeed @{ PackPath = $path }
        $run.Code | Should -Be 0 -Because $run.Text
        @($script:Fake.Calls | Where-Object { $_.Path -like '/api/injects*' }).Count | Should -Be 0
        $run.Text | Should -Match 'the pack has no run-sheet items'
    }
}

Describe 'Gate-1 folds end to end (in-memory fake)' {
    BeforeEach {
        $script:Fake = New-FakePulse
        $env:PULSE_STAFF_SECRET = $script:Fake.Secret
        Mock Invoke-WebRequest { Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType }
        Mock Invoke-MediaRangeRequest { 206 }
        Mock Start-Sleep { }
        Remove-Item -Recurse -Force (Join-Path $TestDrive 'manifests') -ErrorAction SilentlyContinue
    }
    AfterEach { $env:PULSE_STAFF_SECRET = $null }

    It 'M-3: with no manifest and a full feed window it refuses before any write; -AcceptUnverifiableFeed proceeds' {
        $persona = @($script:Fake.Personas.Keys)[2]
        foreach ($n in 1..200) {
            $script:Fake.Posts.Add([ordered]@{ id = "old-$n"; authorPersonaId = $persona; text = "older chatter $n"; scenarioTime = '2026-10-01T00:00:00.000Z'; media = @(); parent = $null; counts = [ordered]@{ reply = 0; repost = 0; like = 0 } })
        }
        $refused = Invoke-FakeSeed
        $refused.Code | Should -Be 1
        $refused.Text | Should -Match 'full 200-post window, so 3 post\(s\) cannot be checked'
        $refused.Text | Should -Match '-AcceptUnverifiableFeed'
        @($script:Fake.Calls | Where-Object { $_.Method -ne 'GET' -and $_.Path -ne '/api/auth/staff/login' }).Count | Should -Be 0

        $accepted = Invoke-FakeSeed @{ AcceptUnverifiableFeed = $true }
        $accepted.Code | Should -Be 0 -Because $accepted.Text
        (Get-FakeCalls POST '/api/posts').Count | Should -Be 3
    }

    It 'L-6: a frozen world stays frozen (the tier is read first and never downgraded)' {
        $script:Fake.Tier = 'freeze'
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 0 -Because $run.Text
        (Get-FakeCalls POST '/api/steering/pause-tier').Count | Should -Be 0
        $script:Fake.Tier | Should -Be 'freeze'
        $run.Text | Should -Match "found 'freeze' \(the engine is already paused\); left as it is"
    }

    It 'L-6: a running engine is paused once and reported' {
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 0
        $run.Text | Should -Match "set to 'engine' \(was 'running'\)"
        (Get-FakeCalls POST '/api/steering/pause-tier').Count | Should -Be 1
    }

    It 'M-1: a network failure mid-run is a clean [FAIL] line and exit 1, not a raw exception' {
        Mock Invoke-WebRequest {
            if (([Uri] $Uri).AbsolutePath -eq '/api/staff/media') { throw [System.Net.Http.HttpRequestException]::new('Connection reset by peer') }
            Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType
        }
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 1
        $run.Text | Should -Match '\[FAIL\] GET /api/staff/media failed: Connection reset by peer'
        $run.Text.Contains($script:Fake.Token) | Should -BeFalse
    }
}

Describe 'Real HTTP, no mocks: -Debug, error records and redirects (Gate-1 H-1, M-1, L-5)' {
    AfterEach {
        $env:PULSE_STAFF_SECRET = $null
        Stop-SeedTestServer $script:Server
        $script:Server = $null
    }

    It 'H-1: a full run with -Debug -Verbose and $DebugPreference=Continue never shows the secret or the token in any stream' {
        try { $script:Server = Start-SeedTestServer }
        catch { Set-ItResult -Skipped -Because "a local HttpListener cannot start here: $($_.Exception.Message)"; return }
        $env:PULSE_STAFF_SECRET = $script:Server.State.Secret
        $manifests = Join-Path $TestDrive 'real-manifests'
        $savedDebug, $savedVerbose = $DebugPreference, $VerbosePreference
        try {
            $DebugPreference = 'Continue'; $VerbosePreference = 'Continue'
            $output = & $script:ScriptFile -PackPath $script:FixturePath -ApiHost $script:Server.BaseUrl -StaffUsername controller1 `
                -ManifestDirectory $manifests -Debug -Verbose *>&1 | Out-String
            $code = $LASTEXITCODE
        }
        finally { $DebugPreference, $VerbosePreference = $savedDebug, $savedVerbose }

        $code | Should -Be 0 -Because $output
        $output | Should -Match 'SEEDED — every check passed'
        $script:Server.State.Posts.Count | Should -Be 3                          # real requests flowed end to end
        @($script:Server.State.Hits | Where-Object { $_ -like 'POST /api/media' }).Count | Should -Be 5
        $script:Server.State.Injects.Count | Should -Be 2                        # the run sheet loaded over real HTTP too
        @($script:Server.State.Hits | Where-Object { $_ -like 'GET /api/injects/assignees' }).Count | Should -Be 1
        $output.Contains($script:Server.State.Secret) | Should -BeFalse
        $output.Contains($script:Server.State.Token) | Should -BeFalse
        $output.Contains($script:Server.State.Refresh) | Should -BeFalse
        $output | Should -Not -Match 'Bearer'
        foreach ($file in Get-ChildItem -Recurse -File $manifests) {
            $content = Get-Content -LiteralPath $file.FullName -Raw
            $content.Contains($script:Server.State.Secret) -or $content.Contains($script:Server.State.Token) | Should -BeFalse -Because $file.FullName
        }
        # The secret went to the server exactly once, in the login body.
        @($script:Server.State.Bodies | Where-Object { $_.Contains($script:Server.State.Secret) }).Count | Should -Be 1
    }

    It 'M-1: after a connection failure neither $Error nor Get-Error holds the token' {
        $port = Get-FreeTcpPort   # nothing listens there
        $token = 'TOKEN-' + [guid]::NewGuid().ToString('N')
        $Error.Clear()
        { Invoke-PulseApi -Context @{ BaseUrl = "http://localhost:$port"; Token = $token } -Method GET -Path '/api/personas' -TimeoutSec 5 } |
            Should -Throw "GET /api/personas failed: *"
        $everything = (@($Error) | ForEach-Object { ($_ | Out-String) + ($_ | Get-Error | Out-String) + ($_ | Format-List * -Force | Out-String) + [string] $_.TargetObject }) -join "`n"
        $everything.Contains($token) | Should -BeFalse
        (Get-Error | Out-String).Contains($token) | Should -BeFalse
        @($Error | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] -and $_.TargetObject -is [System.Net.Http.HttpRequestMessage] }).Count | Should -Be 0
    }

    It 'L-5: a redirect is never followed (a POST body is not re-sent) and fails clearly' {
        try { $script:Server = Start-SeedTestServer -Mode redirect }
        catch { Set-ItResult -Skipped -Because "a local HttpListener cannot start here: $($_.Exception.Message)"; return }
        $context = @{ BaseUrl = $script:Server.BaseUrl; Token = $null }
        { Invoke-PulseApi -Context $context -Method POST -Path '/api/auth/staff/login' -Anonymous -Body ([ordered]@{ username = 'u'; secret = 'SECRET-REDIRECT'; exerciseId = 'e' }) } |
            Should -Throw '*answered a redirect (307)*not followed*'
        @($script:Server.State.Hits | Where-Object { $_ -like '*/elsewhere*' }).Count | Should -Be 0
        @($script:Server.State.Bodies | Where-Object { $_.Contains('SECRET-REDIRECT') }).Count | Should -Be 1   # only the original request
        Invoke-MediaRangeRequest -Url "$($script:Server.BaseUrl)/blob/x" | Should -Be 307
    }
}

Describe 'Secrets never leave memory' {
    BeforeEach {
        $script:Fake = New-FakePulse
        $env:PULSE_STAFF_SECRET = $script:Fake.Secret
        Mock Invoke-WebRequest { Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType }
        Mock Invoke-MediaRangeRequest { 206 }
        Mock Start-Sleep { }
        Remove-Item -Recurse -Force (Join-Path $TestDrive 'manifests') -ErrorAction SilentlyContinue
    }
    AfterEach { $env:PULSE_STAFF_SECRET = $null }

    It 'no secret or token in any output stream, the manifest or a run-sheet request (created, adopted, stopped and resumed)' {
        $script:Fake.InjectFaults[1] = 'lost-after-write'       # i01: an uncertain create, adopted on re-read
        $first = Invoke-FakeSeed
        $second = Invoke-FakeSeed
        $script:Fake.Injects.RemoveAt(1)                         # i02 deleted in the console...
        $script:Fake.InjectFaults[3] = 'lost-before-write'      # ...and its re-create gets no response: the run stops
        $stopped = Invoke-FakeSeed
        $resumed = Invoke-FakeSeed @{ Resume = $true }
        $first.Code, $second.Code, $stopped.Code, $resumed.Code | Should -Be @(0, 0, 1, 0)
        $first.Text | Should -Match 'adopted, not sent again'
        $stopped.Text | Should -Match 'NOT sent again'
        $script:Fake.Injects.Count | Should -Be 2
        foreach ($text in $first.Text, $second.Text, $stopped.Text, $resumed.Text) {
            $text | Should -Not -BeNullOrEmpty
            $text.Contains($script:Fake.Secret) | Should -BeFalse
            $text.Contains($script:Fake.Token) | Should -BeFalse
            $text.Contains($script:Fake.Refresh) | Should -BeFalse
        }
        $injectCalls = @($script:Fake.Calls | Where-Object { $_.Path -like '/api/injects*' })
        @($injectCalls | Where-Object Method -eq 'POST').Count | Should -Be 4
        foreach ($call in $injectCalls) {
            $call.Body.Contains($script:Fake.Secret) -or $call.Body.Contains($script:Fake.Token) | Should -BeFalse -Because "$($call.Method) $($call.Path)"
            $call.Authorized | Should -BeTrue
        }
        $manifest = Get-Content -LiteralPath (Join-Path $TestDrive 'manifests' "$($script:Fake.ExerciseId).json") -Raw
        $manifest | Should -Match '"injects"'
        foreach ($file in Get-ChildItem -Recurse -File $TestDrive) {
            $content = Get-Content -LiteralPath $file.FullName -Raw
            if (-not $content) { continue }
            $content.Contains($script:Fake.Secret) | Should -BeFalse -Because $file.FullName
            $content.Contains($script:Fake.Token) | Should -BeFalse -Because $file.FullName
        }
    }

    It 'the secret is sent only in the login body, and the token only as the Authorization header to the API host' {
        (Invoke-FakeSeed).Code | Should -Be 0
        @($script:Fake.Calls | Where-Object { $_.Body.Contains($script:Fake.Secret) } | ForEach-Object Path) | Should -Be @('/api/auth/staff/login')
        @($script:Fake.Calls | Where-Object { $_.Body.Contains($script:Fake.Token) }).Count | Should -Be 0
        @($script:Fake.Calls | Where-Object { ([Uri] $_.Uri).Host -ne 'api.fake.test' }).Count | Should -Be 0
        @($script:Fake.Calls | Where-Object { $_.Path -in '/api/exercise-context', '/api/auth/staff/login' -and $_.Headers['Authorization'] }).Count | Should -Be 0
    }

    It 'a rejected secret exits 1 without echoing it' {
        $env:PULSE_STAFF_SECRET = 'wrong-' + $script:Fake.Secret
        $run = Invoke-FakeSeed
        $run.Code | Should -Be 1
        $run.Text | Should -Match "401: 'controller1' or the secret was rejected"
        $run.Text.Contains('wrong-') | Should -BeFalse
        @($script:Fake.Calls | Where-Object { $_.Path -like '/api/injects*' }).Count | Should -Be 0
    }

    It 'refuses plain http to anything but localhost (the token must not travel in the clear)' {
        { Resolve-SeedApiBaseUrl -ApiHost 'http://pulse.example.com' } | Should -Throw '*https*'
        Resolve-SeedApiBaseUrl -ApiHost 'http://localhost:5000' | Should -Be 'http://localhost:5000'
        Resolve-SeedApiBaseUrl -ApiHost 'app-pulse-api-uat-dynamis.azurewebsites.net' | Should -Be 'https://app-pulse-api-uat-dynamis.azurewebsites.net'
    }
}

Describe 'Public APIs only' {
    BeforeAll {
        # The story's list, written out here independently of the script's own allowlist.
        $script:Allowed = @('/api/exercise-context', '/api/auth/staff/login', '/api/steering/pause-tier', '/api/staff/media', '/api/media',
            '/api/personas', '/api/staff/personas/{id}', '/api/posts', '/api/feed', '/api/injects', '/api/injects/assignees')
        function Get-ApiPathsIn([string] $Text) {
            [regex]::Matches($Text, '/api/[A-Za-z0-9_\-/{}.]*') | ForEach-Object {
                $path = $_.Value.TrimEnd('/', '.')
                if ($path -ceq '/api/staff/personas') { $path = '/api/staff/personas/{id}' }   # "/api/staff/personas/$($id)" in code
                $path
            } | Sort-Object -Unique
        }
        function Get-ForbiddenPaths([string] $Text) { @(Get-ApiPathsIn $Text | Where-Object { $script:Allowed -cnotcontains $_ }) }
        $script:ScriptText = Get-Content -LiteralPath $script:ScriptFile -Raw
    }

    It 'the grep catches a forbidden path (the check is not vacuous)' {
        Get-ForbiddenPaths 'Invoke-PulseApi -Path "/api/ops/bootstrap-exercise" ... /api/threads/x' | Should -Be @('/api/ops/bootstrap-exercise', '/api/threads/x')
    }

    It 'the script names no API path outside the allowlist' {
        @(Get-ApiPathsIn $script:ScriptText).Count | Should -BeGreaterThan 5
        Get-ForbiddenPaths $script:ScriptText | Should -BeNullOrEmpty
    }

    It 'the script has no database client, sqlcmd or SQL' {
        $script:ScriptText | Should -Not -Match '(?i)sqlcmd|SqlClient|SqlConnection|database\.windows\.net|\bsql\b'
        $script:ScriptText | Should -Not -MatchExactly '\bSELECT\b[^\n]*\bFROM\b|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+\w+\s+SET\b'
    }

    It 'the script does not use the az CLI either (no app-settings or token reads)' {
        $script:ScriptText | Should -Not -Match 'Invoke-Az\b|\baz\s+(webapp|account)'
    }

    It 'its own allowlist matches the story' {
        Get-SeedApiAllowlist | Should -Be $script:Allowed
    }

    It 'refuses a non-allowlisted path at runtime too' {
        Test-SeedApiPath '/api/ops/seed-engine-content' | Should -BeFalse
        Test-SeedApiPath '/api/staff/personas/11111111-2222-4333-8444-555555555555' | Should -BeTrue
        Test-SeedApiPath '/api/staff/personas/../../ops' | Should -BeFalse
        Test-SeedApiPath '/api/feed?includeReplies=true' | Should -BeTrue
        Test-SeedApiPath '/api/injects' | Should -BeTrue
        Test-SeedApiPath '/api/injects/assignees' | Should -BeTrue
        Test-SeedApiPath '/api/injects/11111111-2222-4333-8444-555555555555/fire' | Should -BeFalse   # the seed never fires
        Test-SeedApiPath '/api/injects/reorder' | Should -BeFalse
        { Invoke-PulseApi -Context @{ BaseUrl = 'https://x.test'; Token = 't' } -Method GET -Path '/api/threads/1' } | Should -Throw '*allowlist*'
    }
}

Describe 'Retry-After' {
    It 'parses <Value> as <Expected> s' -ForEach @(
        @{ Value = '7'; Expected = 7 }
        @{ Value = '0'; Expected = 1 }
        @{ Value = '99999'; Expected = 300 }
        @{ Value = 'nonsense'; Expected = 60 }
        @{ Value = $null; Expected = 60 }
    ) {
        Get-RetryAfterSeconds -Value $Value | Should -Be $Expected
    }

    It 'takes the first header value and HTTP dates' {
        Get-RetryAfterSeconds -Value ([string[]] @('12')) | Should -Be 12
        $now = [DateTimeOffset] '2026-10-19T14:00:00Z'
        Get-RetryAfterSeconds -Value 'Mon, 19 Oct 2026 14:00:30 GMT' -Now $now | Should -Be 30
    }

    It 'waits and retries on 429, then returns the real answer' {
        $script:Answers = [System.Collections.Generic.Queue[object]]::new()
        $script:Answers.Enqueue([pscustomobject]@{ StatusCode = 429; Content = '{"error":"rate-limited"}'; Headers = @{ 'Retry-After' = @('3') } })
        $script:Answers.Enqueue([pscustomobject]@{ StatusCode = 201; Content = '{"id":"a"}'; Headers = @{} })
        Mock Invoke-WebRequest { $script:Answers.Dequeue() }
        Mock Start-Sleep { }
        $response = Invoke-PulseApi -Context @{ BaseUrl = 'https://x.test'; Token = 't' } -Method POST -Path '/api/media' -Form ([ordered]@{ kind = 'image' }) 6>$null
        $response.Status | Should -Be 201
        $response.Json['id'] | Should -Be 'a'
        Should -Invoke Start-Sleep -Times 1 -Exactly -ParameterFilter { $Seconds -eq 3 }
    }
}
