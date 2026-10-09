#Requires -Version 7.0

<#
.SYNOPSIS
    Pester 5 tests for Seed-DemoContent.ps1 (story S1, #443). No network: the API is an in-memory fake behind a
    mocked Invoke-WebRequest, and media range probes are mocked.

.DESCRIPTION
    Covers, per the story's Tests section:
      - the pack validation matrix (one case per rule) and the JSON Schema for pack.json;
      - the offset math (scenarioTime = anchor - minutesBeforeAnchor, posting order, anchor choice and -Resume);
      - manifest idempotency (a second run plans and issues zero uploads and zero posts; a lost manifest or
        archived posts never duplicate);
      - the run-sheet rewrite producing a pulse.runsheet.v1 file the console's importer accepts, and the
        importer's rules themselves (runSheetSchema.ts);
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
        }
        foreach ($handle in 'FulcoEM', 'Newsline7', 'mvega_fh') {
            $id = [guid]::NewGuid().ToString()
            $fake.Personas[$id] = [ordered]@{ id = $id; handle = $handle; displayName = "$handle (seeded)"; verified = $false; kind = 'organization'; avatarMediaId = $null; bannerMediaId = $null }
        }
        return $fake
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
                $request = ConvertFrom-SeedJson $bodyText
                if (-not $request.actingHumanId) { return & $reply 400 'actingHumanId is required (COR-018).' }
                $Fake.Tier = $request.tier
                return & $reply 200 ([ordered]@{ tier = $Fake.Tier; clockFrozen = $false })
            }
        }
        return & $reply 404 $null
    }

    function Invoke-FakeSeed {
        <# Runs the whole script against $script:Fake. Returns @{ Code; Text } (all output streams as text). #>
        param([hashtable] $Extra = @{})
        $arguments = @{
            PackPath = $script:FixturePath; ApiHost = 'api.fake.test'; SiteUrl = 'https://site.fake.test'; StaffUsername = 'controller1'
            ManifestDirectory = (Join-Path $TestDrive 'manifests'); RunSheetOut = (Join-Path $TestDrive 'runsheet.demo.json')
        }
        foreach ($key in $Extra.Keys) { $arguments[$key] = $Extra[$key] }
        $all = @(Invoke-DemoSeed @arguments *>&1)
        [pscustomobject]@{
            Code = [int] ($all | Where-Object { $_ -is [int] } | Select-Object -Last 1)
            Text = ($all | Where-Object { $_ -isnot [int] } | ForEach-Object { "$_" }) -join "`n"
        }
    }

    function Get-FakeCalls([string] $Method, [string] $Path) { @($script:Fake.Calls | Where-Object { $_.Method -eq $Method -and $_.Path -eq $Path }) }
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
        @{ Name = 'run sheet name blank'; Code = 'runsheet-name'; Mutate = { param($p) $p['runSheet']['name'] = ' ' } }
        @{ Name = 'run sheet beats not a list'; Code = 'runsheet-beats'; Mutate = { param($p) $p['runSheet']['beats'] = 'none' } }
        @{ Name = 'beat id with a space'; Code = 'beat-id'; Mutate = { param($p) $p['runSheet']['beats'][0]['id'] = 'beat 1' } }
        @{ Name = 'beat id over 40'; Code = 'beat-id'; Mutate = { param($p) $p['runSheet']['beats'][0]['id'] = 'b' * 41 } }
        @{ Name = 'duplicate beat id'; Code = 'beat-duplicate-id'; Mutate = { param($p) $b = Copy-Map $p['runSheet']['beats'][0]; $b['order'] = 2; $p['runSheet']['beats'] += $b } }
        @{ Name = 'beat order 0'; Code = 'beat-order'; Mutate = { param($p) $p['runSheet']['beats'][0]['order'] = 0 } }
        @{ Name = 'duplicate beat order'; Code = 'beat-duplicate-order'; Mutate = { param($p) $b = Copy-Map $p['runSheet']['beats'][0]; $b['id'] = 'beat-2'; $p['runSheet']['beats'] += $b } }
        @{ Name = 'beat title blank'; Code = 'beat-title'; Mutate = { param($p) $p['runSheet']['beats'][0]['title'] = ' ' } }
        @{ Name = 'beat scenarioMinute negative'; Code = 'beat-minute'; Mutate = { param($p) $p['runSheet']['beats'][0]['scenarioMinute'] = -5 } }
        @{ Name = 'beat handle with @'; Code = 'beat-handle'; Mutate = { param($p) $p['runSheet']['beats'][0]['persona']['handle'] = '@Newsline7' } }
        @{ Name = 'beat text over 280'; Code = 'beat-text'; Mutate = { param($p) $p['runSheet']['beats'][0]['text'] = 'x' * 281 } }
        @{ Name = 'beat media ref unknown'; Code = 'beat-media-ref'; Mutate = { param($p) $p['runSheet']['beats'][0]['media'][0]['ref'] = 'nope' } }
        @{ Name = 'beat mixes a video with an image'; Code = 'beat-media-count'; Mutate = { param($p) $p['runSheet']['beats'][0]['media'] += [ordered]@{ ref = 'river-clip' } } }
        @{ Name = 'beat alt override blank'; Code = 'beat-alt'; Mutate = { param($p) $p['runSheet']['beats'][0]['media'][0]['alt'] = ' ' } }
        @{ Name = 'beat replies to an unknown post key'; Code = 'beat-reply'; Mutate = { param($p) $p['runSheet']['beats'][0]['replyTo'] = [ordered]@{ postKey = 'p99' } } }
        @{ Name = 'beat replyTo with both forms'; Code = 'beat-reply'; Mutate = { param($p) $p['runSheet']['beats'][0]['replyTo'] = [ordered]@{ postKey = 'p01'; beatId = 'beat-1' } } }
        @{ Name = 'beats in a reply loop'; Code = 'beat-reply-cycle'; Mutate = {
                param($p)
                $b = Copy-Map $p['runSheet']['beats'][0]; $b['id'] = 'beat-2'; $b['order'] = 2; $b['replyTo'] = [ordered]@{ beatId = 'beat-1' }
                $p['runSheet']['beats'][0]['replyTo'] = [ordered]@{ beatId = 'beat-2' }
                $p['runSheet']['beats'] += $b
            }
        }
        @{ Name = 'beat baseline negative'; Code = 'beat-baseline'; Mutate = { param($p) $p['runSheet']['beats'][0]['engagementBaseline']['like'] = -1 } }
        @{ Name = 'beat notes over 500'; Code = 'beat-notes'; Mutate = { param($p) $p['runSheet']['beats'][0]['notes'] = 'n' * 501 } }
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

Describe 'End to end against the fake API' {
    BeforeEach {
        $script:Fake = New-FakePulse
        $env:PULSE_STAFF_SECRET = $script:Fake.Secret
        Mock Invoke-WebRequest { Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType }
        Mock Invoke-MediaRangeRequest { 206 }
        Mock Start-Sleep { }
        Mock Read-Host { throw 'The secret prompt must not appear when PULSE_STAFF_SECRET is set.' }
        Remove-Item -Recurse -Force (Join-Path $TestDrive 'manifests') -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $TestDrive 'runsheet.demo.json') -ErrorAction SilentlyContinue
    }
    AfterEach { $env:PULSE_STAFF_SECRET = $null }

    It 'seeds everything, then a second run issues zero uploads and zero posts' {
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

        $script:Fake.Calls.Clear()
        $second = Invoke-FakeSeed @{ ScenarioAnchor = [DateTimeOffset] '2026-10-19T14:00:00Z' }
        $second.Code | Should -Be 0 -Because $second.Text
        (Get-FakeCalls POST '/api/media').Count | Should -Be 0
        (Get-FakeCalls POST '/api/posts').Count | Should -Be 0
        @($script:Fake.Calls | Where-Object { $_.Method -eq 'PATCH' }).Count | Should -Be 0
        $script:Fake.Posts.Count | Should -Be 3
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
        $pause = Get-FakeCalls POST '/api/steering/pause-tier'
        $pause.Count | Should -Be 2   # before the posts and after seeding
        (ConvertFrom-SeedJson $pause[1].Body).tier | Should -Be 'engine'
        (ConvertFrom-SeedJson $pause[1].Body).actingHumanId | Should -Be $script:Fake.StaffId
    }

    It 'exports a run sheet the console imports: real ids, no status fields' {
        (Invoke-FakeSeed @{ ScenarioAnchor = [DateTimeOffset] '2026-10-19T14:00:00Z' }).Code | Should -Be 0
        $text = Get-Content -LiteralPath (Join-Path $TestDrive 'runsheet.demo.json') -Raw
        $file = ConvertFrom-SeedJson $text
        @(Test-RunSheetFile -File $file) | Should -BeNullOrEmpty
        $file['schema'] | Should -Be 'pulse.runsheet.v1'
        $beat = $file['beats'][0]
        $photo = $script:Fake.Assets.Values | Where-Object fileName -eq 'harbor-photo.jpg'
        $beat['media'][0]['mediaId'] | Should -Be $photo.id
        $beat['media'][0]['alt'] | Should -Be 'Test pattern standing in for a photo of standing water on a harbor road.'
        $beat['replyTo']['postId'] | Should -Be $script:Fake.Posts[1].id
        $text | Should -Not -Match '"(ref|postKey|status|firedPostId)"'
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
        @($script:Fake.Calls | ForEach-Object { "$($_.Method) $($_.Path)" }) | Should -Be @('GET /api/exercise-context')
        Test-Path (Join-Path $TestDrive 'manifests') | Should -BeFalse
        Test-Path (Join-Path $TestDrive 'runsheet.demo.json') | Should -BeFalse
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

Describe 'Secrets never leave memory' {
    BeforeEach {
        $script:Fake = New-FakePulse
        $env:PULSE_STAFF_SECRET = $script:Fake.Secret
        Mock Invoke-WebRequest { Invoke-FakePulse -Fake $script:Fake -Uri $Uri -Method $Method -Headers $Headers -Body $Body -Form $Form -ContentType $ContentType }
        Mock Invoke-MediaRangeRequest { 206 }
        Mock Start-Sleep { }
        Remove-Item -Recurse -Force (Join-Path $TestDrive 'manifests') -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $TestDrive 'runsheet.demo.json') -ErrorAction SilentlyContinue
    }
    AfterEach { $env:PULSE_STAFF_SECRET = $null }

    It 'no secret or token in any output stream, the manifest or the run sheet' {
        $first = Invoke-FakeSeed
        $second = Invoke-FakeSeed
        $resumed = Invoke-FakeSeed @{ Resume = $true }
        foreach ($text in $first.Text, $second.Text, $resumed.Text) {
            $text | Should -Not -BeNullOrEmpty
            $text.Contains($script:Fake.Secret) | Should -BeFalse
            $text.Contains($script:Fake.Token) | Should -BeFalse
            $text.Contains($script:Fake.Refresh) | Should -BeFalse
        }
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
        Test-Path (Join-Path $TestDrive 'runsheet.demo.json') | Should -BeFalse
    }

    It 'refuses plain http to anything but localhost (the token must not travel in the clear)' {
        { Resolve-SeedApiBaseUrl -ApiHost 'http://pulse.example.com' } | Should -Throw '*https*'
        Resolve-SeedApiBaseUrl -ApiHost 'http://localhost:5000' | Should -Be 'http://localhost:5000'
        Resolve-SeedApiBaseUrl -ApiHost 'app-pulse-api-uat-dynamis.azurewebsites.net' | Should -Be 'https://app-pulse-api-uat-dynamis.azurewebsites.net'
    }
}

Describe 'Run-sheet rewrite and the console importer rules (runSheetSchema.ts)' {
    BeforeAll {
        $script:Ids = @{
            Media = @{ 'harbor-photo' = '0d6e3f9a-6a4f-4c43-9d0e-6c0a1f1e2b3c'; 'river-clip' = '7c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }
            Alt = @{ 'harbor-photo' = 'Photo alt'; 'river-clip' = 'Clip alt' }
            Posts = @{ p01 = 'a1a1a1a1-0000-4000-8000-000000000001'; p02 = 'a1a1a1a1-0000-4000-8000-000000000002'; p03 = 'a1a1a1a1-0000-4000-8000-000000000003' }
        }
        function New-ValidRunSheet {
            $file = ConvertTo-RunSheetFile -RunSheet (Get-FixturePack)['runSheet'] -MediaIds $script:Ids.Media -MediaAlt $script:Ids.Alt -PostIds $script:Ids.Posts -ExportedAt '2026-10-19T14:00:00.000Z'
            ConvertFrom-SeedJson (ConvertTo-SeedJson $file)
        }
    }

    It 'rewrites pack media keys and post keys to real ids and passes the importer rules' {
        $file = New-ValidRunSheet
        @(Test-RunSheetFile -File $file) | Should -BeNullOrEmpty
        $file['beats'][0]['media'][0]['mediaId'] | Should -Be $script:Ids.Media['harbor-photo']
        $file['beats'][0]['media'][0]['alt'] | Should -Be 'Photo alt'
        $file['beats'][0]['replyTo']['postId'] | Should -Be $script:Ids.Posts['p02']
        @($file['beats'][0].Keys) | Should -Be @('id', 'order', 'title', 'scenarioMinute', 'persona', 'text', 'media', 'replyTo', 'engagementBaseline', 'notes')
        @($file.Keys) | Should -Be @('schema', 'name', 'exportedAt', 'beats')
    }

    It 'sorts beats by order and keeps beatId replies' {
        $sheet = [ordered]@{ name = 'n'; beats = @(
                [ordered]@{ id = 'b2'; order = 2; title = 't'; scenarioMinute = 1; persona = [ordered]@{ handle = 'FulcoEM' }; text = 'two'; replyTo = [ordered]@{ beatId = 'b1' } }
                [ordered]@{ id = 'b1'; order = 1; title = 't'; scenarioMinute = 0; persona = [ordered]@{ handle = 'FulcoEM' }; text = 'one' }
            ) }
        $file = ConvertFrom-SeedJson (ConvertTo-SeedJson (ConvertTo-RunSheetFile -RunSheet $sheet -MediaIds @{} -MediaAlt @{} -PostIds @{}))
        @($file['beats'] | ForEach-Object { $_['id'] }) | Should -Be @('b1', 'b2')
        $file['beats'][1]['replyTo']['beatId'] | Should -Be 'b1'
        @(Test-RunSheetFile -File $file) | Should -BeNullOrEmpty
    }

    It 'refuses what the importer refuses: <Name>' -ForEach @(
        @{ Name = 'a status field (status lives in browser storage)'; Mutate = { param($f) $f['beats'][0]['status'] = 'fired' } }
        @{ Name = 'a firedPostId field'; Mutate = { param($f) $f['beats'][0]['firedPostId'] = 'x' } }
        @{ Name = 'an exerciseId at the top'; Mutate = { param($f) $f['exerciseId'] = 'x' } }
        @{ Name = 'the wrong schema'; Mutate = { param($f) $f['schema'] = 'pulse.runsheet.v2' } }
        @{ Name = 'a blank name'; Mutate = { param($f) $f['name'] = '  ' } }
        @{ Name = 'a bad exportedAt'; Mutate = { param($f) $f['exportedAt'] = 'yesterday' } }
        @{ Name = 'an id with a space'; Mutate = { param($f) $f['beats'][0]['id'] = 'beat 1' } }
        @{ Name = 'an id of 41 characters'; Mutate = { param($f) $f['beats'][0]['id'] = 'x' * 41 } }
        @{ Name = 'order 0'; Mutate = { param($f) $f['beats'][0]['order'] = 0 } }
        @{ Name = 'a fractional scenarioMinute'; Mutate = { param($f) $f['beats'][0]['scenarioMinute'] = 1.5 } }
        @{ Name = 'a handle with @'; Mutate = { param($f) $f['beats'][0]['persona']['handle'] = '@Newsline7' } }
        @{ Name = 'text of 281 code points'; Mutate = { param($f) $f['beats'][0]['text'] = "`u{1F30A}" * 281 } }
        @{ Name = 'five media items'; Mutate = { param($f) $f['beats'][0]['media'] = @(1..5 | ForEach-Object { [ordered]@{ mediaId = "m$_"; alt = 'a' } }) } }
        @{ Name = 'the same mediaId twice'; Mutate = { param($f) $f['beats'][0]['media'] = @([ordered]@{ mediaId = 'm'; alt = 'a' }, [ordered]@{ mediaId = 'm'; alt = 'b' }) } }
        @{ Name = 'blank alt'; Mutate = { param($f) $f['beats'][0]['media'][0]['alt'] = ' ' } }
        @{ Name = 'alt over 1000'; Mutate = { param($f) $f['beats'][0]['media'][0]['alt'] = 'a' * 1001 } }
        @{ Name = 'a pack-only media ref left in'; Mutate = { param($f) $f['beats'][0]['media'][0]['ref'] = 'harbor-photo' } }
        @{ Name = 'replyTo with a pack postKey left in'; Mutate = { param($f) $f['beats'][0]['replyTo'] = [ordered]@{ postKey = 'p02' } } }
        @{ Name = 'replyTo naming a missing beat'; Mutate = { param($f) $f['beats'][0]['replyTo'] = [ordered]@{ beatId = 'nope' } } }
        @{ Name = 'replyTo pointing at itself'; Mutate = { param($f) $f['beats'][0]['replyTo'] = [ordered]@{ beatId = 'beat-1' } } }
        @{ Name = 'a baseline over 1,000,000'; Mutate = { param($f) $f['beats'][0]['engagementBaseline']['like'] = 1000001 } }
        @{ Name = 'notes over 500'; Mutate = { param($f) $f['beats'][0]['notes'] = 'n' * 501 } }
        @{ Name = 'a duplicate order'; Mutate = { param($f) $b = Copy-Map $f['beats'][0]; $b['id'] = 'beat-2'; $f['beats'] = @($f['beats'][0], $b) } }
        @{ Name = 'a reply loop'; Mutate = {
                param($f)
                $b = Copy-Map $f['beats'][0]; $b['id'] = 'beat-2'; $b['order'] = 2; $b['replyTo'] = [ordered]@{ beatId = 'beat-1' }
                $f['beats'][0]['replyTo'] = [ordered]@{ beatId = 'beat-2' }; $f['beats'] = @($f['beats'][0], $b)
            }
        }
    ) {
        $file = New-ValidRunSheet
        & $Mutate $file
        @(Test-RunSheetFile -File (ConvertFrom-SeedJson (ConvertTo-SeedJson $file))) | Should -Not -BeNullOrEmpty
    }
}

Describe 'Public APIs only' {
    BeforeAll {
        # The story's list, written out here independently of the script's own allowlist.
        $script:Allowed = @('/api/exercise-context', '/api/auth/staff/login', '/api/steering/pause-tier', '/api/staff/media', '/api/media',
            '/api/personas', '/api/staff/personas/{id}', '/api/posts', '/api/feed')
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
