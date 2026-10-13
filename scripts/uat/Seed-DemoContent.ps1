#Requires -Version 7.0

<#
.SYNOPSIS
    Loads the demo's opening content into Pulse UAT through the public product APIs: media, persona profiles,
    backdated posts, replies and engagement baselines. It also loads the run sheet: the pack's scripted posts
    become inject items in the console's server-side queue.

.DESCRIPTION
    Reads a pulse.demopack.v1 pack (docs/demo/pack/pack.json, implementation.md section 1.10) and:

      1. Validates the WHOLE pack before any request. Keys are unique and every reference resolves. Replies
         come after their parents. Text is at most 280 characters, with no markup (the server strips tags).
         Every media item has alt text. Every file exists inside the pack folder (symbolic links resolved), is a
         type the server accepts (judged by its first bytes, as the server does) and is within the server's
         size limits. The run-sheet items (runSheet.items) are checked against the inject queue's own rules
         (InjectItemValidator): kind, title, notes, planned minute, post counts, the burst window, text, media,
         alt, replies and baselines. If anything fails, every problem is listed, nothing is sent and the script
         exits 1.
      2. Reads GET /api/exercise-context (anonymous): the host's exerciseId and the timeZone every post needs.
      3. With -WhatIf it stops here. It prints the plan (counts per step, and each run-sheet item it would
         create with its kind, title and post count) and exits 0: no sign-in, no writes.
      4. Signs in as a staff controller: POST /api/auth/staff/login with {username, secret, exerciseId}.
      5. Checks every handle the pack names (posts and run-sheet posts) against GET /api/personas, and every
         run-sheet assignee against GET /api/injects/assignees ("me", or a staff display name, ignoring case).
         An unknown handle or assignee stops the run before any write, and the known ones are listed. It also
         reads the current run sheet (GET /api/injects).
      6. Pauses the engine (pause tier "engine") so it does not react to the seeded posts. It reads the tier
         first and never loosens a stricter one: a frozen world stays frozen. Skip this with -LeaveEngineRunning.
      7. Uploads each media file once (POST /api/media): poster images first, then each video with its
         posterMediaId. On a 429 it waits the Retry-After and retries.
      8. Edits persona profiles: PATCH /api/staff/personas/{id} as a JSON merge-patch, covering display name,
         bio, location, verified, avatar and banner. Only the fields that differ are sent.
      9. Posts the opening feed as controller-as-persona (POST /api/posts) in scenario-time order, with
         scenarioTime = anchor - minutesBeforeAnchor. Replies go after their parents. Engagement baselines
         are included.
     10. Loads the run sheet: one POST /api/injects per run-sheet item, in pack order (each lands at the end
         of the console's queue, pending; nothing is fired). Handles become persona ids, media keys become
         the uploaded asset ids, a reply to a seeded post becomes { postId }, a reply to an earlier post of
         the same item stays { sequence }, and a reply to a post of an earlier item becomes { injectPostId }.
         A 201 is recorded in the manifest at once. On a 429 it waits the Retry-After and retries. A 400
         stops the run and prints the server's reason as it is. A create is not idempotent, so after an
         uncertain outcome (no response, 408, a 5xx or an unreadable 2xx) it never simply sends it again:
         it re-reads GET /api/injects and adopts an item with the same kind, title and posts, or stops and
         says so (run again with -Resume).
     11. Checks the pause tier again (same rule) and reports what it found or set. The tier lives in
         memory, and every reset or restart sets it back to "running". After any reset, run this script
         again or pause from the console.
     12. Self-check. GET /api/feed must show at least the seeded top-level posts. Every media URL (post
         media, posters, avatars, banners) must answer a ranged GET (Range: bytes=0-1) with 206. Every
         run-sheet item must be in GET /api/injects with the pack's post count. It prints a ✅/❌ summary
         and exits 1 if any check failed.

    RE-RUNNING IS SAFE. A manifest records what has been seeded, at
    %LOCALAPPDATA%\Pulse\demo-seed\<exerciseId>.json on Windows or $HOME/.local/share/Pulse/demo-seed on
    Linux and macOS. It maps pack files and media keys to asset ids, with each file's SHA-256, post keys
    to post ids, and run-sheet item keys to inject item ids. It holds no secret.
      - A re-run uploads nothing whose bytes are unchanged and posts nothing already in the feed.
      - Before posting, the feed is also matched by persona, text and parent. A lost manifest therefore does
        not duplicate posts either.
      - Posts archived since the last run (for example by Clear-DemoContent.ps1) are posted again, on a fresh
        timeline anchored at now.
      - The feed only returns its 200 newest posts. When it is full and this machine's manifest does not know a
        post, an earlier copy could be hidden beyond the window, so the run stops before writing anything
        unless -AcceptUnverifiableFeed is passed. Run from the machine that holds the manifest instead.
      - A run-sheet item whose id is still in the queue is skipped, whatever its status (an item fired in a
        rehearsal is not loaded again). One that was deleted in the console is created again. An item the
        manifest does not know is first matched against the queue by kind, title and posts (persona and
        text), so a lost manifest does not duplicate the run sheet either.

    -Resume continues a partial run on its ORIGINAL scenario anchor. Without it, the script refuses to add
    posts next to ones already seeded, because their times would not line up. It says so and writes nothing.
    -ScenarioAnchor cannot move a partial run either, and a reply is never posted earlier than its parent.

    PUBLIC APIs ONLY. There are no ops endpoints and no direct database access: nothing the product's own
    console could not do. The script also refuses, at runtime, any API path outside its allowlist.

    SECRETS. The staff secret comes from $env:PULSE_STAFF_SECRET if set. Otherwise the script asks for it
    with a hidden prompt; Copy-StaffSecret.ps1 puts it on the clipboard. The secret and the session token
    stay in memory only. They are never printed, logged, or written to the manifest or any other file, and
    never sent in a request body other than the sign-in. The token goes only to the API host, never to the
    media URLs the self-check probes. This holds with -Debug and -Verbose too (the web requests' own debug
    output is switched off), redirects are never followed, and a failed request leaves no record of its
    headers in $Error.

    Run-of-show: Clear-DemoContent.ps1 (optional), then Reset-DemoState.ps1, then this script.

.PARAMETER PackPath
    The pack to load. Default: docs/demo/pack/pack.json. Media paths in it are relative to its folder.

.PARAMETER ApiHost
    The API host. The exercise is resolved from this host name. A full origin (https://host) is accepted.
    Plain http is accepted for localhost only.

.PARAMETER SiteUrl
    The participant site, printed at the end so you can open it.

.PARAMETER StaffUsername
    The staff login to seed as. It must be a CONTROLLER assigned to the exercise.

.PARAMETER ScenarioAnchor
    The scenario instant the pack's minutesBeforeAnchor offsets count back from. The default is now (UTC):
    the frontend's scenario clock currently tracks wall-clock time, so the opening feed then sits 0 to N
    scenario minutes in the past. Use ISO-8601 with an offset, for example 2026-10-19T14:00:00Z.

.PARAMETER WhatIf
    Validate the pack, read the exercise context and print the plan, including each run-sheet item it would
    create (kind, title, post count). No sign-in and no writes.

.PARAMETER Resume
    Continue a partial run (or add posts to an earlier one) on the earlier run's scenario anchor. It also
    finishes loading a run sheet that stopped part-way: items already in the queue are skipped or adopted,
    never created twice.

.PARAMETER LeaveEngineRunning
    Do not touch the pause tier (the engine stays as it is, normally "running").

.PARAMETER AcceptUnverifiableFeed
    Post even when the feed is at its 200-post cap and this machine's manifest does not know some pack posts,
    so an earlier copy of them cannot be ruled out. They may duplicate an earlier seed.

.PARAMETER ManifestDirectory
    Keep the manifest somewhere other than the default folder.

.EXAMPLE
    pwsh scripts/uat/Seed-DemoContent.ps1 -WhatIf

.EXAMPLE
    pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1

.EXAMPLE
    pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -Resume

.EXAMPLE
    pwsh scripts/uat/Seed-DemoContent.ps1 -PackPath scripts/uat/test-fixtures/demo-pack/pack.json -WhatIf
#>
[CmdletBinding()]
param(
    [string] $PackPath = (Join-Path $PSScriptRoot '../../docs/demo/pack/pack.json'),
    [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $SiteUrl = 'https://pulse-uat.cobrasoftware.com',
    [string] $StaffUsername = 'controller1',
    [DateTimeOffset] $ScenarioAnchor,
    [switch] $WhatIf,
    [switch] $Resume,
    [switch] $LeaveEngineRunning,
    [switch] $AcceptUnverifiableFeed,
    [string] $ManifestDirectory
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Limits and the API allowlist. These mirror the SERVER: where docs and code disagree, the code wins.
#   media    Features/Media/MediaOptions.cs, MediaUploadService.cs, MediaSniffer.cs (BM)
#   posts    Features/Social/PostIngestService.cs, PostWireDtos.cs (BP)
#   personas Features/Social/PersonaAdmin/PersonaProfilePatchParser.cs (PE-BE)
#   injects  Features/Injects/InjectItemValidator.cs + InjectBurstPacing.cs (inject-queue 06); the console's
#            mirror is src/frontend/src/features/controller/runSheet/injectRules.ts INJECT_LIMITS (07)
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-SeedLimits {
    @{
        ImageMaxBytes = 5MB; VideoMaxBytes = 100MB; MaxDimension = 16384; MaxDurationSec = 3600
        TextMax = 280; AltMax = 1000; MaxMediaPerPost = 4; BaselineMax = 1000000; KeyMax = 64
        DisplayNameMax = 100; BioMax = 512; LocationMax = 100; HandleMax = 50
        InjectTitleMax = 120; InjectNotesMax = 500; PlannedMinuteMax = [int]::MaxValue
        BurstMinPosts = 2; BurstMaxPosts = 20; BurstWindowMin = 30; BurstWindowMax = 600; BurstWindowDefault = 90
        BurstMinGapSeconds = 3
        FeedTake = 200; LibraryTake = 200
    }
}

function Get-SeedApiAllowlist {
    # The ONLY API paths this script may call (story S1 "Public APIs only"). Seed-DemoContent.Tests.ps1 greps
    # this file for any other API path, and Invoke-PulseApi refuses one at runtime.
    @(
        '/api/exercise-context'
        '/api/auth/staff/login'
        '/api/steering/pause-tier'
        '/api/staff/media'
        '/api/media'
        '/api/personas'
        '/api/staff/personas/{id}'
        '/api/posts'
        '/api/feed'
        '/api/injects'
        '/api/injects/assignees'
    )
}

function Test-SeedApiPath {
    param([Parameter(Mandatory)] [string] $Path)
    $bare = ($Path -split '\?', 2)[0]
    if ($bare -cmatch '^/api/staff/personas/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { return $true }
    return (Get-SeedApiAllowlist) -ccontains $bare
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Pure helpers: JSON, text, time. No I/O.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function ConvertFrom-SeedJson {
    <# JSON → ordered hashtables. A top-level array is ENUMERATED (wrap the call in @() when you expect one). #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Json)
    $options = @{ InputObject = $Json; AsHashtable = $true; Depth = 64; ErrorAction = 'Stop' }
    # PowerShell 7.5+ can keep ISO-8601 strings as strings. Older versions turn them into DateTime; see
    # ConvertTo-SeedInstant and Get-JsonKind, which accept both.
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { $options.DateKind = 'String' }
    ConvertFrom-Json @options
}

function ConvertTo-SeedJson {
    param([Parameter(Mandatory)] [AllowNull()] [object] $Value, [switch] $Compress)
    (ConvertTo-Json -InputObject $Value -Depth 32 -Compress:$Compress) -replace "`r`n", "`n"
}

function Get-JsonKind {
    param([AllowNull()] [object] $Value)
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string] -or $Value -is [datetime] -or $Value -is [DateTimeOffset]) { return 'string' }
    if ($Value -is [bool]) { return 'boolean' }
    if ($Value -is [System.Collections.IDictionary]) { return 'object' }
    if ($Value -is [System.Collections.IList]) { return 'array' }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [int16] -or $Value -is [byte] -or $Value -is [System.Numerics.BigInteger]) {
        return 'integer'
    }
    if ($Value -is [double] -or $Value -is [decimal] -or $Value -is [single]) {
        $number = [double] $Value
        if ([double]::IsFinite($number) -and [math]::Floor($number) -eq $number) { return 'integer' }
        return 'number'
    }
    return 'unknown'
}

function Get-CodePointCount {
    <# Unicode code points, as the console counts them ([...text].length): a surrogate pair counts once. #>
    param([AllowNull()] [string] $Text)
    if ([string]::IsNullOrEmpty($Text)) { return 0 }
    $count = 0
    for ($i = 0; $i -lt $Text.Length; $i++) {
        if ([char]::IsHighSurrogate($Text[$i]) -and $i + 1 -lt $Text.Length -and [char]::IsLowSurrogate($Text[$i + 1])) { $i++ }
        $count++
    }
    return $count
}

function Test-ForbiddenCharacter {
    <# Control characters (line breaks and tabs optional) and bidirectional overrides, as PE-BE refuses them. #>
    param([AllowNull()] [string] $Text, [switch] $AllowLineBreaks)
    if ([string]::IsNullOrEmpty($Text)) { return $false }
    foreach ($c in $Text.ToCharArray()) {
        if ([char]::IsControl($c)) {
            if ($AllowLineBreaks -and ($c -eq "`n" -or $c -eq "`r" -or $c -eq "`t")) { continue }
            return $true
        }
        $code = [int] $c
        if (($code -ge 0x202A -and $code -le 0x202E) -or ($code -ge 0x2066 -and $code -le 0x2069)) { return $true }
    }
    return $false
}

function Test-HasVisibleCharacter {
    <# PE-BE's rule for displayName: at least one rune that is not a separator, control, format or mark. #>
    param([AllowNull()] [string] $Text)
    if ([string]::IsNullOrEmpty($Text)) { return $false }
    $blank = @(0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800)
    $invisible = @('SpaceSeparator', 'LineSeparator', 'ParagraphSeparator', 'Control', 'Format', 'NonSpacingMark',
        'SpacingCombiningMark', 'EnclosingMark', 'Surrogate', 'OtherNotAssigned')
    foreach ($rune in $Text.EnumerateRunes()) {
        if ($blank -contains $rune.Value) { continue }
        if ($invisible -contains [string] [System.Text.Rune]::GetUnicodeCategory($rune)) { continue }
        return $true
    }
    return $false
}

function Get-JsTrimmed {
    <#
    .SYNOPSIS
        String.prototype.trim(), as zod's .trim() checks it in the console importer: it also removes U+FEFF and
        the Unicode spaces, but NOT U+0085 (which .NET's Trim() removes). Gate-1 L-2.
    #>
    param([AllowNull()] [string] $Text)
    if ($null -eq $Text) { return '' }
    $js = [char[]] @(0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
        0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF)
    return $Text.Trim($js)
}

function Test-JsBlank {
    <# True when the text is empty after a JavaScript trim (blank to the console importer). #>
    param([AllowNull()] [string] $Text)
    return (Get-JsTrimmed $Text).Length -eq 0
}

function Find-SeedMarkup {
    <#
    .SYNOPSIS
        The first markup-like fragment ('<' then a letter, '/', '!' or '?'), or $null. The server strips tags
        (PostSanitizer), so such text would not read as written, and a re-run could not recognise the post it
        made. The pack refuses it up front (Gate-1 M-2). '<' before a space or a digit ("<3", "a < b") is fine.
    #>
    param([AllowNull()] [string] $Text)
    if ([string]::IsNullOrEmpty($Text)) { return $null }
    $match = [regex]::Match($Text, '<[A-Za-z/!?][^\s<>]{0,12}')
    if ($match.Success) { return $match.Value }
    return $null
}

function Format-SeedInstant {
    <# A round-trip UTC instant with milliseconds, e.g. 2026-10-19T14:00:00.000Z (what JS toISOString writes). #>
    param([Parameter(Mandatory)] [DateTimeOffset] $Instant)
    $Instant.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-SeedInstant {
    param([AllowNull()] [object] $Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [DateTimeOffset]) { return $Value }
    if ($Value -is [datetime]) {
        $dateTime = if ($Value.Kind -eq [DateTimeKind]::Unspecified) { [datetime]::SpecifyKind($Value, [DateTimeKind]::Utc) } else { $Value }
        return [DateTimeOffset]::new($dateTime)
    }
    $parsed = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse([string] $Value, [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal, [ref] $parsed)) { return $parsed }
    return $null
}

function Get-PostScenarioTime {
    <# scenarioTime = anchor − minutesBeforeAnchor, as a round-trip UTC instant. #>
    param([Parameter(Mandatory)] [DateTimeOffset] $Anchor, [Parameter(Mandatory)] [long] $MinutesBeforeAnchor)
    Format-SeedInstant -Instant $Anchor.AddMinutes(-$MinutesBeforeAnchor)
}

function Get-RetryAfterSeconds {
    <# A Retry-After header (delta-seconds or an HTTP date) → seconds to wait, clamped to 1..Max. #>
    param([AllowNull()] [object] $Value, [DateTimeOffset] $Now = [DateTimeOffset]::UtcNow, [int] $Default = 60, [int] $Max = 300)
    $text = if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) { [string] (@($Value) | Select-Object -First 1) } else { [string] $Value }
    $text = $text.Trim()
    $seconds = 0
    if (-not [int]::TryParse($text, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref] $seconds)) {
        $date = [DateTimeOffset]::MinValue
        $seconds = if ($text -and [DateTimeOffset]::TryParse($text, [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::AssumeUniversal, [ref] $date)) {
            [int] [math]::Ceiling(($date - $Now).TotalSeconds)
        }
        else { $Default }
    }
    return [int] [math]::Min($Max, [math]::Max(1, $seconds))
}

function Get-SeedList {
    <# A list-valued member's ELEMENTS (absent or null → nothing). Always call it as @(Get-SeedList …). #>
    param([AllowNull()] [object] $Object, [Parameter(Mandatory)] [string] $Name)
    if ($null -eq $Object -or $Object -isnot [System.Collections.IDictionary] -or -not $Object.Contains($Name)) { return }
    $value = $Object[$Name]
    if ($null -eq $value) { return }
    if ($value -is [System.Collections.IList]) { foreach ($element in $value) { $element } }
    else { $value }
}

function Get-NormalizedPackFile {
    param([Parameter(Mandatory)] [string] $Relative)
    $value = $Relative -replace '\\', '/'
    while ($value.StartsWith('./')) { $value = $value.Substring(2) }
    return $value
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Media sniffing: the same allowlist the server applies to the first bytes (MediaSniffer.cs).
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Test-WebMHead {
    param([byte[]] $Head)
    if ($Head.Length -lt 4 -or $Head[0] -ne 0x1A -or $Head[1] -ne 0x45 -or $Head[2] -ne 0xDF -or $Head[3] -ne 0xA3) { return $false }

    $readVint = {
        param([int] $Position)
        if ($Position -ge $Head.Length) { return $null }
        $first = [int] $Head[$Position]
        if ($first -eq 0) { return $null }
        $length = 1; $mask = 0x80
        while (($first -band $mask) -eq 0) { $mask = $mask -shr 1; $length++ }
        if ($Position + $length -gt $Head.Length) { return $null }
        [long] $value = $first -band ($mask - 1)
        $allOnes = $value -eq ($mask - 1)
        for ($i = 1; $i -lt $length; $i++) {
            $next = [int] $Head[$Position + $i]
            $allOnes = $allOnes -and $next -eq 0xFF
            $value = ($value -shl 8) -bor $next
        }
        if ($allOnes -or $value -gt 4096) { return $null }
        return @{ Value = [int] $value; Length = $length }
    }
    $readId = {
        param([int] $Position)
        if ($Position -ge $Head.Length) { return $null }
        $first = [int] $Head[$Position]
        $length = if ($first -ge 0x80) { 1 } elseif ($first -ge 0x40) { 2 } elseif ($first -ge 0x20) { 3 } elseif ($first -ge 0x10) { 4 } else { 0 }
        if ($length -eq 0 -or $Position + $length -gt $Head.Length) { return $null }
        [long] $id = 0
        for ($i = 0; $i -lt $length; $i++) { $id = ($id -shl 8) -bor [int] $Head[$Position + $i] }
        return @{ Value = $id; Length = $length }
    }

    $header = & $readVint 4
    if (-not $header) { return $false }
    $position = 4 + $header.Length
    $end = $position + $header.Value
    while ($position -lt $end -and $position -lt $Head.Length) {
        $id = & $readId $position
        if (-not $id) { return $false }
        $position += $id.Length
        $size = & $readVint $position
        if (-not $size) { return $false }
        $position += $size.Length
        if ($id.Value -eq 0x4282) {
            if ($position + $size.Value -gt $Head.Length) { return $false }
            return ([Text.Encoding]::ASCII.GetString($Head, $position, $size.Value).TrimEnd([char] 0)) -ceq 'webm'
        }
        $position += $size.Value
    }
    return $false
}

function Get-MediaSniff {
    <# The file's first bytes → @{ Kind = image|video; Type = jpeg|png|gif|webp|mp4|webm }, or $null if the server would refuse it. #>
    param([AllowNull()] [byte[]] $Head)
    if ($null -eq $Head -or $Head.Length -eq 0) { return $null }
    $ascii = { param([int] $Offset, [int] $Length) if ($Head.Length -lt $Offset + $Length) { '' } else { [Text.Encoding]::ASCII.GetString($Head, $Offset, $Length) } }
    $hex = [BitConverter]::ToString($Head, 0, [math]::Min(8, $Head.Length)) -replace '-', ''

    if ($hex.StartsWith('FFD8FF')) { return @{ Kind = 'image'; Type = 'jpeg' } }
    if ($hex.StartsWith('89504E470D0A1A0A')) { return @{ Kind = 'image'; Type = 'png' } }
    $six = & $ascii 0 6
    if ($six -ceq 'GIF87a' -or $six -ceq 'GIF89a') { return @{ Kind = 'image'; Type = 'gif' } }
    if ($Head.Length -ge 16 -and (& $ascii 0 4) -ceq 'RIFF' -and (& $ascii 8 4) -ceq 'WEBP' -and @('VP8 ', 'VP8L', 'VP8X') -ccontains (& $ascii 12 4)) {
        return @{ Kind = 'image'; Type = 'webp' }
    }
    if ($Head.Length -ge 16 -and (& $ascii 4 4) -ceq 'ftyp') {
        $boxSize = ([long] $Head[0] -shl 24) -bor ([long] $Head[1] -shl 16) -bor ([long] $Head[2] -shl 8) -bor [long] $Head[3]
        $brands = @('isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'dash', 'mmp4', 'MSNV')
        if ($boxSize -ge 16 -and $boxSize -le 4096 -and $brands -ccontains (& $ascii 8 4)) { return @{ Kind = 'video'; Type = 'mp4' } }
        return $null
    }
    if (Test-WebMHead -Head $Head) { return @{ Kind = 'video'; Type = 'webm' } }
    return $null
}

function Read-FileHead {
    param([Parameter(Mandatory)] [string] $Path, [int] $Count = 64)
    $stream = [IO.File]::OpenRead($Path)
    try {
        $buffer = [byte[]]::new($Count)
        $read = 0
        while ($read -lt $Count) {
            $n = $stream.Read($buffer, $read, $Count - $read)
            if ($n -le 0) { break }
            $read += $n
        }
        [Array]::Resize([ref] $buffer, $read)
        return , $buffer
    }
    finally { $stream.Dispose() }
}

function Resolve-SeedRealPath {
    <#
    .SYNOPSIS
        The path with every symbolic link (or junction) along it resolved, component by component, so a link
        inside the pack folder cannot reach outside it (Gate-1 L-7). Components that do not exist are appended
        as they are. Throws on a link loop.
    #>
    param([Parameter(Mandatory)] [string] $Path)
    $full = [IO.Path]::GetFullPath($Path)
    $current = [IO.Path]::GetPathRoot($full)
    $pending = [System.Collections.Generic.List[string]]::new()
    $pending.AddRange([string[]] $full.Substring($current.Length).Split([char[]] @('/', '\'), [StringSplitOptions]::RemoveEmptyEntries))
    $hops = 0
    while ($pending.Count -gt 0) {
        $segment = $pending[0]; $pending.RemoveAt(0)
        $next = [IO.Path]::Combine($current, $segment)
        $item = Get-Item -LiteralPath $next -Force -ErrorAction SilentlyContinue
        $target = $null
        if ($item -and $item.LinkType -in 'SymbolicLink', 'Junction') {
            $target = if ($item.PSObject.Properties['LinkTarget'] -and $item.LinkTarget) { [string] $item.LinkTarget } else { [string] @($item.Target)[0] }
        }
        if (-not $target) { $current = $next; continue }
        if (++$hops -gt 40) { throw "Too many symbolic links resolving '$Path'." }
        $resolved = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($target)) { $target } else { [IO.Path]::Combine($current, $target) }))
        $root = [IO.Path]::GetPathRoot($resolved)
        $pending.InsertRange(0, [string[]] $resolved.Substring($root.Length).Split([char[]] @('/', '\'), [StringSplitOptions]::RemoveEmptyEntries))
        $current = $root
    }
    return $current
}

function Get-PackFileInfo {
    <#
    .SYNOPSIS
        Resolves a pack-relative path and reads its size and first bytes. The path must stay inside the pack folder
        both as written and after resolving symbolic links.
    #>
    param([Parameter(Mandatory)] [string] $PackRoot, [Parameter(Mandatory)] [AllowEmptyString()] [string] $Relative, [hashtable] $Cache)
    if ($Cache -and $Cache.Contains($Relative)) { return $Cache[$Relative] }
    $info = @{ Relative = $Relative; Path = $null; Exists = $false; Outside = $false; Bytes = [long] 0; Sniff = $null }
    if ([string]::IsNullOrWhiteSpace($Relative) -or [IO.Path]::IsPathRooted($Relative) -or $Relative -match '^[A-Za-z]:') {
        $info.Outside = $true
    }
    else {
        $separators = [char[]] @([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        $comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
        $root = [IO.Path]::GetFullPath($PackRoot).TrimEnd($separators) + [IO.Path]::DirectorySeparatorChar
        $full = [IO.Path]::GetFullPath([IO.Path]::Combine($root, ($Relative -replace '[\\/]', [IO.Path]::DirectorySeparatorChar)))
        $realRoot = (Resolve-SeedRealPath -Path $root).TrimEnd($separators) + [IO.Path]::DirectorySeparatorChar
        $realFull = Resolve-SeedRealPath -Path $full
        if (-not $full.StartsWith($root, $comparison) -or -not $realFull.StartsWith($realRoot, $comparison)) {
            $info.Outside = $true
        }
        else {
            $info.Path = $realFull
            if (Test-Path -LiteralPath $realFull -PathType Leaf) {
                $info.Exists = $true
                $info.Bytes = [long] (Get-Item -LiteralPath $realFull).Length
                $info.Sniff = Get-MediaSniff -Head (Read-FileHead -Path $realFull)
            }
        }
    }
    if ($Cache) { $Cache[$Relative] = $info }
    return $info
}

function Get-FileSha256 {
    param([Parameter(Mandatory)] [string] $Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Pack validation (pure apart from reading the pack's own files). Every rule has its own Code, so the tests
# can check one case per rule. Nothing here talks to the API.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Test-DemoPack {
    <#
    .SYNOPSIS
        Validates a parsed pulse.demopack.v1 pack. Emits one [pscustomobject] { Code, Where, Message } per
        problem; emits nothing when the pack is valid.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowNull()] [object] $Pack,
        [Parameter(Mandatory)] [string] $PackRoot,
        [hashtable] $Limits = (Get-SeedLimits)
    )

    $errors = [System.Collections.Generic.List[object]]::new()
    $add = { param($Code, $Where, $Message) $errors.Add([pscustomobject]@{ Code = $Code; Where = $Where; Message = $Message }) }
    $cache = @{}
    # \z, not $: .NET's $ also matches before a final newline, so "p01`n" would pass (Gate-1 L-2).
    $keyPattern = '^[A-Za-z0-9_-]{1,' + $Limits.KeyMax + '}\z'
    $markupMessage = { param($Found) "contains markup ('$Found'): the server strips HTML-like tags, so it would not read as written and a re-run could not recognise it. Use plain text ('<' before a space or a digit is fine)." }

    $checkKeys = {
        param($Object, [string[]] $Allowed, [string] $Where)
        foreach ($key in @($Object.Keys)) {
            if ($Allowed -cnotcontains $key) { & $add 'unknown-field' $Where "has a field this format does not allow: '$key' (allowed: $($Allowed -join ', '))." }
        }
    }
    $checkHandle = {
        param($Value, [string] $Where, [string] $Code)
        if ((Get-JsonKind $Value) -ne 'string' -or $Value.Length -lt 1 -or $Value.Length -gt $Limits.HandleMax -or $Value -notmatch '^[^@\s\uFEFF]+\z') {
            & $add $Code $Where "must be a persona handle without '@' or spaces, 1 to $($Limits.HandleMax) characters (e.g. FulcoEM)."
            return $false
        }
        return $true
    }
    $checkFile = {
        param($Relative, [string] $ExpectedKind, [string] $Where, [string] $MismatchCode)
        if ((Get-JsonKind $Relative) -ne 'string' -or [string]::IsNullOrWhiteSpace($Relative)) {
            & $add 'type' $Where 'must be a file path relative to the pack folder.'
            return $null
        }
        $info = Get-PackFileInfo -PackRoot $PackRoot -Relative $Relative -Cache $cache
        if ($info.Outside) { & $add 'file-outside-pack' $Where "'$Relative' is not inside the pack folder."; return $null }
        if (-not $info.Exists) { & $add 'file-missing' $Where "file not found: '$Relative' (relative to $PackRoot)."; return $null }
        if ($info.Bytes -eq 0) { & $add 'file-empty' $Where "'$Relative' is empty."; return $null }
        if (-not $info.Sniff) {
            & $add 'file-type' $Where "'$Relative' is not a JPEG, PNG, GIF or WebP image or an MP4 or WebM video (judged by its first bytes, as the server does)."
            return $null
        }
        if ($ExpectedKind -and $info.Sniff.Kind -ne $ExpectedKind) {
            & $add $MismatchCode $Where "'$Relative' is a $($info.Sniff.Type) $($info.Sniff.Kind), but this must be an $ExpectedKind."
            return $null
        }
        $max = if ($info.Sniff.Kind -eq 'video') { $Limits.VideoMaxBytes } else { $Limits.ImageMaxBytes }
        if ($info.Bytes -gt $max) {
            & $add 'file-too-large' $Where ("'{0}' is {1:N0} bytes; the server takes {2} files up to {3:N0} bytes." -f $Relative, $info.Bytes, $info.Sniff.Kind, $max)
            return $null
        }
        return $info
    }
    $checkAlt = {
        param($Value, [string] $Where, [string] $MissingCode, [string] $LengthCode)
        if ((Get-JsonKind $Value) -ne 'string' -or (Test-JsBlank $Value)) {
            & $add $MissingCode $Where 'alt text is required on every media item (NFR-001).'
            return
        }
        if ($Value.Length -gt $Limits.AltMax) { & $add $LengthCode $Where "alt text must be at most $($Limits.AltMax) characters." }
        $found = Find-SeedMarkup $Value
        if ($found) { & $add 'markup' $Where "alt text $(& $markupMessage $found)" }
    }
    $checkBaseline = {
        param($Value, [string] $Where, [string] $Code)
        if ((Get-JsonKind $Value) -ne 'object') { & $add $Code $Where 'must be an object like { "like": 120, "repost": 40, "reply": 8 }.'; return }
        foreach ($key in @($Value.Keys)) {
            if (@('like', 'repost', 'reply') -cnotcontains $key) { & $add $Code "$Where.$key" "is not a baseline field (like, repost, reply)."; continue }
            $count = $Value[$key]
            if ((Get-JsonKind $count) -ne 'integer' -or $count -lt 0 -or $count -gt $Limits.BaselineMax) {
                & $add $Code "$Where.$key" "must be a whole number from 0 to $($Limits.BaselineMax)."
            }
        }
    }
    $checkMediaList = {
        # Shared by posts and run-sheet posts: refs resolve, no repeats, <= 4 images or exactly 1 video.
        param($List, [string] $Where, [string] $RefCode, [string] $CountCode, [string] $AltMissingCode, [string] $AltLengthCode, $MediaByKey)
        if ((Get-JsonKind $List) -ne 'array') { & $add 'type' $Where 'must be a list of { "ref": "<media key>" }.'; return }
        if ($List.Count -gt $Limits.MaxMediaPerPost) { & $add $CountCode $Where "has $($List.Count) items; a post carries up to $($Limits.MaxMediaPerPost) images or exactly 1 video." }
        $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        $videos = 0; $images = 0
        for ($k = 0; $k -lt $List.Count; $k++) {
            $item = $List[$k]; $itemWhere = "$Where[$k]"
            if ((Get-JsonKind $item) -ne 'object') { & $add 'type' $itemWhere 'must be an object like { "ref": "<media key>" }.'; continue }
            & $checkKeys $item @('ref', 'alt') $itemWhere
            $ref = $item['ref']
            if ((Get-JsonKind $ref) -ne 'string' -or -not $MediaByKey.Contains($ref)) { & $add $RefCode "$itemWhere.ref" "names no media key in this pack: '$ref'."; continue }
            if (-not $seen.Add($ref)) { & $add $RefCode "$itemWhere.ref" "attaches '$ref' twice." }
            if ($item.Contains('alt')) { & $checkAlt $item['alt'] "$itemWhere.alt" $AltMissingCode $AltLengthCode }
            if ($MediaByKey[$ref]['kind'] -eq 'video') { $videos++ } else { $images++ }
        }
        if ($videos -gt 0 -and ($videos + $images) -ne 1) { & $add $CountCode $Where 'mixes a video with other media; a post carries up to 4 images or exactly 1 video, never both.' }
    }

    if ((Get-JsonKind $Pack) -ne 'object') {
        & $add 'type' 'pack' 'The pack must be a JSON object.'
        return $errors.ToArray()
    }
    & $checkKeys $Pack @('$schema', 'schema', 'county', 'personas', 'media', 'posts', 'runSheet') 'pack'
    if ($Pack['schema'] -cne 'pulse.demopack.v1') { & $add 'schema-id' 'pack.schema' "must be ""pulse.demopack.v1"" (found ""$($Pack['schema'])"")." }
    if ($Pack.Contains('county') -and (Get-JsonKind $Pack['county']) -ne 'string') { & $add 'type' 'pack.county' 'must be a string.' }
    foreach ($section in 'personas', 'media', 'posts') {
        if ((Get-JsonKind $Pack[$section]) -ne 'array') { & $add 'type' "pack.$section" 'must be a list (use [] for none).' }
    }

    # ── personas ───────────────────────────────────────────────────────────────────────────────────────────
    $handles = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $personas = @(Get-SeedList $Pack 'personas')
    for ($i = 0; $i -lt $personas.Count; $i++) {
        $persona = $personas[$i]; $where = "personas[$i]"
        if ((Get-JsonKind $persona) -ne 'object') { & $add 'type' $where 'must be an object.'; continue }
        & $checkKeys $persona @('handle', 'displayName', 'bio', 'location', 'verified', 'avatar', 'banner') $where
        if (& $checkHandle $persona['handle'] "$where.handle" 'handle-format') {
            if (-not $handles.Add($persona['handle'])) { & $add 'duplicate-handle' "$where.handle" "'$($persona['handle'])' appears twice (handles are case-insensitive)." }
        }
        if ($persona.Contains('displayName')) {
            $name = $persona['displayName']
            if ((Get-JsonKind $name) -ne 'string' -or $name.Trim().Length -lt 1 -or $name.Trim().Length -gt $Limits.DisplayNameMax -or
                (Test-ForbiddenCharacter $name.Trim()) -or -not (Test-HasVisibleCharacter $name.Trim())) {
                & $add 'display-name' "$where.displayName" "must be 1 to $($Limits.DisplayNameMax) characters with at least one visible character and no control or bidirectional-override characters."
            }
            elseif (Find-SeedMarkup $name) { & $add 'markup' "$where.displayName" "displayName $(& $markupMessage (Find-SeedMarkup $name))" }
        }
        foreach ($rule in @(@('bio', $Limits.BioMax, $true), @('location', $Limits.LocationMax, $false))) {
            $field = $rule[0]; $max = $rule[1]; $allowBreaks = [bool] $rule[2]
            if (-not $persona.Contains($field) -or $null -eq $persona[$field]) { continue }
            $value = $persona[$field]
            if ((Get-JsonKind $value) -ne 'string' -or $value.Trim().Length -gt $max -or (Test-ForbiddenCharacter $value.Trim() -AllowLineBreaks:$allowBreaks)) {
                $breaks = if ($allowBreaks) { ' (line breaks and tabs are fine)' } else { '' }
                & $add $field "$where.$field" "must be null or at most $max characters with no control or bidirectional-override characters$breaks."
            }
            elseif (Find-SeedMarkup $value) { & $add 'markup' "$where.$field" "$field $(& $markupMessage (Find-SeedMarkup $value))" }
        }
        if ($persona.Contains('verified') -and (Get-JsonKind $persona['verified']) -ne 'boolean') { & $add 'verified' "$where.verified" 'must be true or false.' }
        foreach ($field in 'avatar', 'banner') {
            if ($persona.Contains($field) -and $null -ne $persona[$field]) { [void] (& $checkFile $persona[$field] 'image' "$where.$field" 'kind-mismatch') }
        }
    }

    # ── media ──────────────────────────────────────────────────────────────────────────────────────────────
    $mediaByKey = [hashtable]::new([StringComparer]::Ordinal)
    $mediaKeysSeen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $mediaFiles = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $media = @(Get-SeedList $Pack 'media')
    for ($i = 0; $i -lt $media.Count; $i++) {
        $item = $media[$i]; $where = "media[$i]"
        if ((Get-JsonKind $item) -ne 'object') { & $add 'type' $where 'must be an object.'; continue }
        & $checkKeys $item @('key', 'file', 'kind', 'poster', 'width', 'height', 'durationSec', 'alt') $where
        $key = $item['key']
        if ((Get-JsonKind $key) -ne 'string' -or $key -cnotmatch $keyPattern) {
            & $add 'key-format' "$where.key" "must be 1 to $($Limits.KeyMax) letters, digits, '_' or '-'."
        }
        elseif (-not $mediaKeysSeen.Add($key)) { & $add 'duplicate-key' "$where.key" "'$key' is already used by another media item (keys are compared ignoring case)." }
        else { $mediaByKey[$key] = $item }

        $kind = $item['kind']
        if (@('image', 'video') -cnotcontains $kind) { & $add 'media-kind' "$where.kind" 'must be "image" or "video".'; $kind = $null }
        if ($kind) { [void] (& $checkFile $item['file'] $kind "$where.file" 'kind-mismatch') }
        if ((Get-JsonKind $item['file']) -eq 'string' -and -not $mediaFiles.Add((Get-NormalizedPackFile $item['file']))) {
            & $add 'duplicate-file' "$where.file" "'$($item['file'])' is already declared by another media item; give each file one media key."
        }
        foreach ($dimension in 'width', 'height') {
            if (-not $item.Contains($dimension)) { continue }
            $value = $item[$dimension]
            if ((Get-JsonKind $value) -ne 'integer' -or $value -lt 1 -or $value -gt $Limits.MaxDimension) {
                & $add 'dimension' "$where.$dimension" "must be a whole number from 1 to $($Limits.MaxDimension)."
            }
        }
        if ($item.Contains('durationSec')) {
            $duration = $item['durationSec']
            if ($kind -ne 'video') { & $add 'duration' "$where.durationSec" 'applies to videos only.' }
            elseif (@('integer', 'number') -notcontains (Get-JsonKind $duration) -or $duration -le 0 -or $duration -gt $Limits.MaxDurationSec) {
                & $add 'duration' "$where.durationSec" "must be greater than 0 and at most $($Limits.MaxDurationSec)."
            }
        }
        if ($item.Contains('poster')) {
            if ($kind -ne 'video') { & $add 'poster-not-video' "$where.poster" 'a poster applies to videos only.' }
            else { [void] (& $checkFile $item['poster'] 'image' "$where.poster" 'poster-not-image') }
        }
        & $checkAlt $item['alt'] "$where.alt" 'alt-missing' 'alt-length'
    }

    # ── posts ──────────────────────────────────────────────────────────────────────────────────────────────
    $posts = @(Get-SeedList $Pack 'posts')
    $postIndex = [hashtable]::new([StringComparer]::Ordinal)
    for ($i = 0; $i -lt $posts.Count; $i++) {
        $post = $posts[$i]
        if ((Get-JsonKind $post) -eq 'object' -and (Get-JsonKind $post['key']) -eq 'string' -and -not $postIndex.Contains($post['key'])) { $postIndex[$post['key']] = $i }
    }
    $seenPostKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    for ($i = 0; $i -lt $posts.Count; $i++) {
        $post = $posts[$i]; $where = "posts[$i]"
        if ((Get-JsonKind $post) -ne 'object') { & $add 'type' $where 'must be an object.'; continue }
        & $checkKeys $post @('key', 'persona', 'text', 'minutesBeforeAnchor', 'media', 'replyTo', 'baseline') $where
        $key = $post['key']
        if ((Get-JsonKind $key) -ne 'string' -or $key -cnotmatch $keyPattern) { & $add 'key-format' "$where.key" "must be 1 to $($Limits.KeyMax) letters, digits, '_' or '-'." }
        elseif (-not $seenPostKeys.Add($key)) { & $add 'duplicate-key' "$where.key" "'$key' is already used by another post (keys are compared ignoring case)." }
        [void] (& $checkHandle $post['persona'] "$where.persona" 'handle-format')

        $text = $post['text']
        $hasMedia = (Get-JsonKind $post['media']) -eq 'array' -and $post['media'].Count -gt 0
        if ((Get-JsonKind $text) -ne 'string') { & $add 'text-missing' "$where.text" 'is required (a string).' }
        elseif ((Test-JsBlank $text) -and -not $hasMedia) { & $add 'text-missing' "$where.text" 'is empty and the post has no media.' }
        elseif ((Get-CodePointCount $text) -gt $Limits.TextMax) { & $add 'text-length' "$where.text" "is $(Get-CodePointCount $text) characters; the limit is $($Limits.TextMax)." }
        elseif (Find-SeedMarkup $text) { & $add 'markup' "$where.text" "text $(& $markupMessage (Find-SeedMarkup $text))" }

        $minutes = $post['minutesBeforeAnchor']
        if ((Get-JsonKind $minutes) -ne 'integer' -or $minutes -lt 0) { & $add 'minutes' "$where.minutesBeforeAnchor" 'must be a whole number of minutes, 0 or more.' }

        if ($post.Contains('media')) { & $checkMediaList $post['media'] "$where.media" 'media-ref' 'media-count' 'alt-missing' 'alt-length' $mediaByKey }

        if ($post.Contains('replyTo')) {
            $parent = $post['replyTo']
            if ((Get-JsonKind $parent) -ne 'string' -or -not $postIndex.Contains($parent)) { & $add 'reply-ref' "$where.replyTo" "names no post key in this pack: '$parent'." }
            elseif ($parent -ceq $key) { & $add 'reply-ref' "$where.replyTo" 'a post cannot reply to itself.' }
            elseif ($postIndex[$parent] -gt $i) { & $add 'reply-order' "$where.replyTo" "'$parent' must appear earlier in the posts list than its reply." }
            else {
                $parentMinutes = $posts[$postIndex[$parent]]['minutesBeforeAnchor']
                if ((Get-JsonKind $minutes) -eq 'integer' -and (Get-JsonKind $parentMinutes) -eq 'integer' -and $minutes -gt $parentMinutes) {
                    & $add 'reply-time' "$where.minutesBeforeAnchor" "the reply ($minutes min before the anchor) would be earlier than its parent '$parent' ($parentMinutes min)."
                }
            }
        }
        if ($post.Contains('baseline')) { & $checkBaseline $post['baseline'] "$where.baseline" 'baseline' }
    }

    # ── run sheet (optional): inject items for POST /api/injects ─────────────────────────────────────────────
    # Each item maps 1:1 onto the frozen InjectItemWrite (inject-queue implementation.md "Wire contract"), with
    # pack references where the wire has ids: persona (a handle) for personaId, assignee for assigneeId,
    # media[].ref for mediaId, and replyTo naming a pack post or a run-sheet post. The limits are the server's
    # (InjectItemValidator: lengths are code points of the trimmed text, alt is UTF-16 units).
    if ($Pack.Contains('runSheet')) {
        $sheet = $Pack['runSheet']
        $items = @()
        if ((Get-JsonKind $sheet) -ne 'object') { & $add 'type' 'runSheet' 'must be an object like { "items": [ ... ] }.' }
        else {
            & $checkKeys $sheet @('items') 'runSheet'
            if ((Get-JsonKind $sheet['items']) -ne 'array') { & $add 'runsheet-items' 'runSheet.items' 'must be a list of run-sheet items (use [] for none).' }
            else { $items = $sheet['items'] }
        }

        # Item keys → index, and each item's post count, so a reply can name any item.
        $itemIndex = [hashtable]::new([StringComparer]::Ordinal)
        for ($j = 0; $j -lt $items.Count; $j++) {
            $item = $items[$j]
            if ((Get-JsonKind $item) -eq 'object' -and (Get-JsonKind $item['key']) -eq 'string' -and -not $itemIndex.Contains($item['key'])) { $itemIndex[$item['key']] = $j }
        }
        $postCountOf = { param([int] $Index) if ((Get-JsonKind $items[$Index]['posts']) -eq 'array') { $items[$Index]['posts'].Count } else { 0 } }
        $seenItemKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $itemEdges = @{}                                                    # item index → item indexes its posts reply to
        $forward = [System.Collections.Generic.List[object]]::new()        # replies naming a LATER item
        $replyForms = 'must be exactly one of { "postKey": "<pack post key>" }, { "sequence": <n> } (an earlier post of this item) or { "item": "<run-sheet item key>", "sequence": <n> }.'

        for ($j = 0; $j -lt $items.Count; $j++) {
            $item = $items[$j]; $where = "runSheet.items[$j]"
            if ((Get-JsonKind $item) -ne 'object') { & $add 'type' $where 'must be an object.'; continue }
            & $checkKeys $item @('key', 'kind', 'title', 'notes', 'plannedMinute', 'assignee', 'burstWindowSeconds', 'posts') $where
            $key = $item['key']
            if ((Get-JsonKind $key) -ne 'string' -or $key -cnotmatch $keyPattern) { & $add 'key-format' "$where.key" "must be 1 to $($Limits.KeyMax) letters, digits, '_' or '-'." }
            elseif (-not $seenItemKeys.Add($key)) { & $add 'duplicate-key' "$where.key" "'$key' is already used by another run-sheet item (keys are compared ignoring case)." }

            $kind = $item['kind']
            if (@('post', 'burst') -cnotcontains $kind) { & $add 'inject-kind' "$where.kind" 'must be "post" (one post) or "burst" (2 to 20 posts released across a window).'; $kind = $null }

            $title = $item['title']
            if ((Get-JsonKind $title) -ne 'string' -or $title.Trim().Length -eq 0 -or (Get-CodePointCount $title.Trim()) -gt $Limits.InjectTitleMax) {
                & $add 'inject-title' "$where.title" "must be 1 to $($Limits.InjectTitleMax) characters, not blank."
            }
            elseif (Find-SeedMarkup $title) { & $add 'markup' "$where.title" "title $(& $markupMessage (Find-SeedMarkup $title))" }

            if ($item.Contains('notes')) {
                $notes = $item['notes']
                if ((Get-JsonKind $notes) -ne 'string' -or (Get-CodePointCount $notes.Trim()) -gt $Limits.InjectNotesMax) {
                    & $add 'inject-notes' "$where.notes" "must be at most $($Limits.InjectNotesMax) characters."
                }
                elseif (Find-SeedMarkup $notes) { & $add 'markup' "$where.notes" "notes $(& $markupMessage (Find-SeedMarkup $notes))" }
            }
            if ($item.Contains('plannedMinute')) {
                $minute = $item['plannedMinute']
                if ((Get-JsonKind $minute) -ne 'integer' -or $minute -lt 0 -or $minute -gt $Limits.PlannedMinuteMax) {
                    & $add 'inject-minute' "$where.plannedMinute" 'must be a whole number of minutes, 0 or more (a display and sort hint: nothing fires on its own).'
                }
            }
            if ($item.Contains('assignee') -and $null -ne $item['assignee']) {
                $assignee = $item['assignee']
                if ((Get-JsonKind $assignee) -ne 'string' -or $assignee.Trim().Length -eq 0) {
                    & $add 'inject-assignee' "$where.assignee" 'must be "me" or the display name of a staff member assigned to the exercise (or null for none).'
                }
            }

            $posts = @()
            if ((Get-JsonKind $item['posts']) -ne 'array') { & $add 'inject-posts' "$where.posts" 'must be a list of posts.' }
            else { $posts = $item['posts'] }
            $countOk = $false
            if ($kind -ceq 'post') {
                if ($posts.Count -ne 1) { & $add 'inject-posts' "$where.posts" "a ""post"" item has exactly 1 post (found $($posts.Count))." } else { $countOk = $true }
            }
            elseif ($kind -ceq 'burst') {
                if ($posts.Count -lt $Limits.BurstMinPosts -or $posts.Count -gt $Limits.BurstMaxPosts) {
                    & $add 'inject-posts' "$where.posts" "a ""burst"" has $($Limits.BurstMinPosts) to $($Limits.BurstMaxPosts) posts (found $($posts.Count))."
                }
                else { $countOk = $true }
            }

            $windowOk = $true
            if ($item.Contains('burstWindowSeconds')) {
                $window = $item['burstWindowSeconds']
                if ($kind -cne 'burst') { & $add 'inject-window' "$where.burstWindowSeconds" 'applies to a "burst" only.'; $windowOk = $false }
                elseif ((Get-JsonKind $window) -ne 'integer' -or $window -lt $Limits.BurstWindowMin -or $window -gt $Limits.BurstWindowMax) {
                    & $add 'inject-window' "$where.burstWindowSeconds" "must be a whole number of seconds from $($Limits.BurstWindowMin) to $($Limits.BurstWindowMax)."
                    $windowOk = $false
                }
            }
            if ($kind -ceq 'burst' -and $countOk -and $windowOk) {
                # IQ-4: no two burst posts less than 3 s apart, so the window must hold every gap (server default 90).
                $effective = if ($item.Contains('burstWindowSeconds')) { [long] $item['burstWindowSeconds'] } else { $Limits.BurstWindowDefault }
                $needed = $Limits.BurstMinGapSeconds * ($posts.Count - 1)
                if ($effective -lt $needed) {
                    & $add 'inject-window' "$where.burstWindowSeconds" "a burst of $($posts.Count) posts needs a window of at least $needed seconds ($($Limits.BurstMinGapSeconds) s between posts)."
                }
            }

            for ($k = 0; $k -lt $posts.Count; $k++) {
                $post = $posts[$k]; $postWhere = "$where.posts[$k]"; $position = $k + 1
                if ((Get-JsonKind $post) -ne 'object') { & $add 'type' $postWhere 'must be an object.'; continue }
                & $checkKeys $post @('persona', 'text', 'media', 'replyTo', 'engagementBaseline') $postWhere
                [void] (& $checkHandle $post['persona'] "$postWhere.persona" 'handle-format')

                $text = $post['text']
                if ((Get-JsonKind $text) -ne 'string') { & $add 'inject-text' "$postWhere.text" 'is required (a string).' }
                elseif ($text.Trim().Length -eq 0) { & $add 'inject-text' "$postWhere.text" 'is empty; a scripted post needs text (media alone is not enough).' }
                elseif ((Get-CodePointCount $text.Trim()) -gt $Limits.TextMax) { & $add 'inject-text' "$postWhere.text" "is $(Get-CodePointCount $text.Trim()) characters; the limit is $($Limits.TextMax)." }
                elseif (Find-SeedMarkup $text) { & $add 'markup' "$postWhere.text" "text $(& $markupMessage (Find-SeedMarkup $text))" }

                if ($post.Contains('media')) { & $checkMediaList $post['media'] "$postWhere.media" 'inject-media-ref' 'inject-media-count' 'inject-alt' 'inject-alt' $mediaByKey }

                if ($post.Contains('replyTo')) {
                    $replyTo = $post['replyTo']; $replyWhere = "$postWhere.replyTo"
                    $replyKeys = @(if ((Get-JsonKind $replyTo) -eq 'object') { @($replyTo.Keys) | Sort-Object })
                    $checkSibling = {
                        param($Sequence)
                        if ((Get-JsonKind $Sequence) -ne 'integer' -or $Sequence -lt 1 -or $Sequence -ge $position) {
                            $range = if ($position -gt 1) { "1 to $($position - 1)" } else { 'none: it is the first post' }
                            & $add 'inject-reply-sibling' "$replyWhere.sequence" "must name an EARLIER post of this item ($range); a post cannot reply to itself or to a later post."
                        }
                    }
                    if (($replyKeys -join ',') -ceq 'postKey') {
                        if ((Get-JsonKind $replyTo['postKey']) -ne 'string' -or -not $postIndex.Contains($replyTo['postKey'])) {
                            & $add 'inject-reply' "$replyWhere.postKey" "names no post key in this pack: '$($replyTo['postKey'])'."
                        }
                    }
                    elseif (($replyKeys -join ',') -ceq 'sequence') { & $checkSibling $replyTo['sequence'] }
                    elseif (($replyKeys -join ',') -ceq 'item,sequence') {
                        $target = $replyTo['item']
                        if ((Get-JsonKind $target) -ne 'string' -or -not $itemIndex.Contains($target)) { & $add 'inject-reply' "$replyWhere.item" "names no run-sheet item in this pack: '$target'." }
                        elseif ($itemIndex[$target] -eq $j) { & $checkSibling $replyTo['sequence'] }   # this item, by its own key: a sibling
                        else {
                            $targetIndex = $itemIndex[$target]
                            $targetCount = & $postCountOf $targetIndex
                            $sequence = $replyTo['sequence']
                            if ((Get-JsonKind $sequence) -ne 'integer' -or $sequence -lt 1 -or $sequence -gt $targetCount) {
                                & $add 'inject-reply' "$replyWhere.sequence" "must name a post of item '$target', which has $targetCount post(s) (1 to $targetCount)."
                            }
                            if (-not $itemEdges.Contains($j)) { $itemEdges[$j] = [System.Collections.Generic.List[int]]::new() }
                            if (-not $itemEdges[$j].Contains($targetIndex)) { $itemEdges[$j].Add($targetIndex) }
                            if ($targetIndex -gt $j) { $forward.Add([pscustomobject]@{ From = $j; To = $targetIndex; Where = "$replyWhere.item"; Target = $target }) }
                        }
                    }
                    else { & $add 'inject-reply' $replyWhere $replyForms }
                }
                if ($post.Contains('engagementBaseline')) { & $checkBaseline $post['engagementBaseline'] "$postWhere.engagementBaseline" 'inject-baseline' }
            }
        }

        # A reply to another item's post becomes { injectPostId }, so that item must already exist: it must come
        # EARLIER in runSheet.items (items are created in order). Two items replying to each other can never load.
        foreach ($reference in $forward) {
            $reachable = [System.Collections.Generic.HashSet[int]]::new()
            $stack = [System.Collections.Generic.Stack[int]]::new()
            $stack.Push($reference.To)
            $loop = $false
            while ($stack.Count -gt 0) {
                $cursor = $stack.Pop()
                if ($cursor -eq $reference.From) { $loop = $true; break }
                if (-not $reachable.Add($cursor) -or -not $itemEdges.Contains($cursor)) { continue }
                foreach ($next in $itemEdges[$cursor]) { $stack.Push($next) }
            }
            if ($loop) {
                & $add 'inject-reply-cycle' $reference.Where "item '$($items[$reference.From]['key'])' and item '$($reference.Target)' reply to each other (a loop): neither could be created first."
            }
            else {
                & $add 'inject-reply-order' $reference.Where "item '$($reference.Target)' comes later in runSheet.items. A reply can only name a post of an EARLIER item, which is created first so its post ids exist; move '$($reference.Target)' up."
            }
        }
    }

    return $errors.ToArray()
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Planning (pure): upload units, the upload plan, post order and plan, the scenario anchor, persona patches,
# request bodies.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-PackUploadUnits {
    <#
    .SYNOPSIS
        One upload per distinct file the pack names (media, posters, avatars, banners), in upload order:
        posters, then the other images, then videos (each video's poster is uploaded before it).
    #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Pack, [Parameter(Mandatory)] [string] $PackRoot)
    $units = [System.Collections.Specialized.OrderedDictionary]::new([StringComparer]::Ordinal)
    $touch = {
        param([string] $Relative, [string] $Role, [System.Collections.IDictionary] $Hints)
        $file = Get-NormalizedPackFile $Relative
        if (-not $units.Contains($file)) {
            $info = Get-PackFileInfo -PackRoot $PackRoot -Relative $file
            if (-not $info.Exists) { throw "Pack file '$file' is missing (validate the pack first)." }
            $units[$file] = [pscustomobject]@{
                File = $file; Path = $info.Path; Kind = $info.Sniff.Kind; Bytes = $info.Bytes; Sha256 = (Get-FileSha256 -Path $info.Path)
                Roles = [System.Collections.Generic.List[string]]::new(); Width = $null; Height = $null; DurationSec = $null; PosterFile = $null
            }
        }
        $unit = $units[$file]
        if (-not $unit.Roles.Contains($Role)) { $unit.Roles.Add($Role) }
        if ($Hints) {
            foreach ($name in 'width', 'height', 'durationSec') {
                $property = $name.Substring(0, 1).ToUpperInvariant() + $name.Substring(1)
                if ($Hints.Contains($name) -and $null -eq $unit.$property) { $unit.$property = $Hints[$name] }
            }
        }
        return $unit
    }
    foreach ($item in @(Get-SeedList $Pack 'media')) {
        if ($item['kind'] -eq 'video' -and $item['poster']) {
            [void] (& $touch $item['poster'] 'poster' $null)
            $video = & $touch $item['file'] 'media' $item
            $video.PosterFile = Get-NormalizedPackFile $item['poster']
        }
        else { [void] (& $touch $item['file'] 'media' $item) }
    }
    foreach ($persona in @(Get-SeedList $Pack 'personas')) {
        foreach ($field in 'avatar', 'banner') {
            if ($persona.Contains($field) -and $persona[$field] -is [string]) { [void] (& $touch $persona[$field] $field $null) }
        }
    }
    $all = @($units.Values)
    @($all | Where-Object { $_.Roles.Contains('poster') }) +
    @($all | Where-Object { $_.Kind -eq 'image' -and -not $_.Roles.Contains('poster') }) +
    @($all | Where-Object { $_.Kind -eq 'video' })
}

function Get-UploadPlan {
    <#
    .SYNOPSIS
        Decides, per upload unit, 'reuse' (the manifest has its asset, the bytes are unchanged and the asset still
        exists) or 'upload'.
    .PARAMETER Library
        $null when offline (-WhatIf); else @{ Ids = HashSet of asset ids; Complete = @{ image = bool; video = bool } }
        from GET /api/staff/media. An id missing from a COMPLETE (under-cap) list no longer exists.
        The library hides an image while it is some video's poster, so a poster is verified either directly
        (not yet attached) or through the library row of the video it was uploaded with.
    #>
    param(
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Units,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Manifest,
        [AllowNull()] [object] $Library,
        [Parameter(Mandatory)] [string] $Username
    )
    $files = $Manifest['files']
    $entryFor = { param($File) if ($files -is [System.Collections.IDictionary] -and $files.Contains($File)) { $files[$File] } else { $null } }
    $exists = {
        param([string] $AssetId, [string] $Kind)
        if ($null -eq $Library -or $Library.Ids.Contains($AssetId)) { return $true }
        return -not $Library.Complete[$Kind]
    }
    $byFile = @{}
    foreach ($unit in $Units) { $byFile[$unit.File] = $unit }
    $decision = @{}
    $decide = { param($Unit, [string] $Action, $AssetId, [string] $Reason) $decision[$Unit.File] = @{ Action = $Action; AssetId = $AssetId; Reason = $Reason } }

    # 1. Everything that is not a poster: videos, post images, avatars, banners.
    foreach ($unit in @($Units | Where-Object { -not $_.Roles.Contains('poster') })) {
        $entry = & $entryFor $unit.File
        if (-not $entry -or -not $entry['assetId']) { & $decide $unit 'upload' $null 'new file'; continue }
        $posterSha = if ($unit.PosterFile) { $byFile[$unit.PosterFile].Sha256 } else { $null }
        if ($entry['sha256'] -cne $unit.Sha256) { & $decide $unit 'upload' $null 'the file changed since it was uploaded' }
        elseif ($unit.Kind -eq 'video' -and [string] $entry['posterSha256'] -cne [string] $posterSha) { & $decide $unit 'upload' $null 'its poster changed' }
        elseif (-not (& $exists ([string] $entry['assetId']) $unit.Kind)) { & $decide $unit 'upload' $null 'no longer in the media library' }
        else { & $decide $unit 'reuse' ([string] $entry['assetId']) 'already uploaded' }
    }

    # 2. Posters. A reused video carries its poster with it. A video being uploaded needs a poster that still
    #    exists AND was uploaded by the same staff user (the server's posterMediaId rule).
    foreach ($unit in @($Units | Where-Object { $_.Roles.Contains('poster') })) {
        $entry = & $entryFor $unit.File
        $videos = @($Units | Where-Object { $_.PosterFile -ceq $unit.File })
        $neededByUpload = @($videos | Where-Object { $decision[$_.File].Action -eq 'upload' }).Count -gt 0
        if (-not $entry -or -not $entry['assetId']) { & $decide $unit 'upload' $null 'new file'; continue }
        $posterId = [string] $entry['assetId']
        if ($entry['sha256'] -cne $unit.Sha256) { & $decide $unit 'upload' $null 'the file changed since it was uploaded'; continue }
        if (-not $neededByUpload) { & $decide $unit 'reuse' $posterId 'already uploaded'; continue }
        if ([string] $entry['uploadedBy'] -ine $Username) {
            & $decide $unit 'upload' $null "a video's poster must be uploaded by the same staff user (this one was uploaded by '$($entry['uploadedBy'])')"
            continue
        }
        $verified = $null -eq $Library -or $Library.Ids.Contains($posterId) -or -not $Library.Complete['image']
        foreach ($video in $videos) {
            $videoEntry = & $entryFor $video.File
            # Gate-1 L-1: offline (-WhatIf) there is no library; $verified is already true then.
            if ($null -ne $Library -and $videoEntry -and [string] $videoEntry['posterAssetId'] -eq $posterId -and $Library.Ids.Contains([string] $videoEntry['assetId'])) { $verified = $true }
        }
        if ($verified) { & $decide $unit 'reuse' $posterId 'already uploaded' }
        else { & $decide $unit 'upload' $null 'no longer in the media library' }
    }

    foreach ($unit in $Units) {
        [pscustomobject]@{ Unit = $unit; Action = $decision[$unit.File].Action; AssetId = $decision[$unit.File].AssetId; Reason = $decision[$unit.File].Reason }
    }
}

function Get-ChronologicalPosts {
    <# Earliest first (most minutes before the anchor first). Ties keep pack order, so a parent listed first stays first. #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Pack)
    $posts = @(Get-SeedList $Pack 'posts')
    $indexed = for ($i = 0; $i -lt $posts.Count; $i++) { [pscustomobject]@{ Index = $i; Minutes = [long] $posts[$i]['minutesBeforeAnchor']; Post = $posts[$i] } }
    @($indexed | Sort-Object -Property @{ Expression = 'Minutes'; Descending = $true }, @{ Expression = 'Index'; Descending = $false }) | ForEach-Object { $_.Post }
}

function Get-PostPlan {
    <#
    .SYNOPSIS
        Per pack post, in posting order: 'skip' (seeded and still visible), 'adopt' (already in the feed with
        the same persona, text and parent: recorded, not re-posted), or 'post'.
    .PARAMETER Feed
        GET /api/feed?includeReplies=true, or $null offline (then the manifest alone decides).
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Pack,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Manifest,
        [AllowNull()] [object[]] $Feed,
        [AllowNull()] [hashtable] $PersonaIds,
        [int] $FeedTake = 200
    )
    $manifestPosts = $Manifest['posts']
    $entryFor = { param($Key) if ($manifestPosts -is [System.Collections.IDictionary] -and $manifestPosts.Contains($Key)) { $manifestPosts[$Key] } else { $null } }
    $online = $null -ne $Feed
    $feedById = @{}
    if ($online) { foreach ($row in $Feed) { $feedById[[string] $row['id']] = $row } }
    $truncated = $online -and $Feed.Count -ge $FeedTake
    $claimed = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    if ($online -and $manifestPosts -is [System.Collections.IDictionary]) {
        foreach ($key in @($manifestPosts.Keys)) {
            $id = [string] $manifestPosts[$key]['postId']
            if ($id -and $feedById.Contains($id)) { [void] $claimed.Add($id) }
        }
    }
    $resolved = [hashtable]::new([StringComparer]::Ordinal)
    $items = [System.Collections.Generic.List[object]]::new()
    $warnings = [System.Collections.Generic.List[string]]::new()

    foreach ($post in (Get-ChronologicalPosts -Pack $Pack)) {
        $key = [string] $post['key']
        $entry = & $entryFor $key
        $manifestId = if ($entry) { [string] $entry['postId'] } else { '' }
        $action = 'post'; $postId = $null; $reason = 'new'; $scenarioTime = $null; $unverifiable = $false
        $isReply = -not [string]::IsNullOrEmpty([string] $post['replyTo'])

        if (-not $online) {
            if ($manifestId) { $action = 'skip'; $postId = $manifestId; $reason = 'in the manifest'; $scenarioTime = $entry['scenarioTime'] }
        }
        elseif ($manifestId -and $feedById.Contains($manifestId)) {
            $row = $feedById[$manifestId]
            $action = 'skip'; $postId = $manifestId; $reason = 'in the feed'; $scenarioTime = $row['scenarioTime']
            if (([string] $row['text']).Trim() -cne ([string] $post['text']).Trim()) {
                $warnings.Add("$key changed in the pack after it was posted; the posted text stays. To re-post it, take the post down from the console and re-run with -Resume.")
            }
        }
        elseif ($manifestId -and $truncated) {
            $action = 'skip'; $postId = $manifestId; $reason = "in the manifest (the feed is at its $FeedTake-post cap, so it cannot be verified)"; $scenarioTime = $entry['scenarioTime']
        }
        else {
            $parentId = if ($isReply) { $resolved[[string] $post['replyTo']] } else { $null }
            $personaId = if ($PersonaIds) { [string] $PersonaIds[[string] $post['persona']] } else { '' }
            $match = $null
            if ($personaId -and (-not $isReply -or $parentId)) {
                foreach ($row in $Feed) {
                    $rowId = [string] $row['id']
                    if ($claimed.Contains($rowId) -or [string] $row['authorPersonaId'] -ne $personaId) { continue }
                    if (([string] $row['text']).Trim() -cne ([string] $post['text']).Trim()) { continue }
                    $rowParent = if ($row['inReplyTo'] -is [System.Collections.IDictionary]) { [string] $row['inReplyTo']['postId'] } else { '' }
                    if ($isReply) { if ($rowParent -ne $parentId) { continue } } elseif ($rowParent) { continue }
                    $match = $row; break
                }
            }
            if ($match) {
                $action = 'adopt'; $postId = [string] $match['id']; [void] $claimed.Add($postId)
                $reason = 'already in the feed (same persona, text and parent)'; $scenarioTime = $match['scenarioTime']
            }
            elseif ($manifestId) { $reason = 'seeded before, but no longer in the feed (archived or taken down)' }
            elseif ($truncated) {
                # Gate-1 M-3: the feed is a 200-post window of the LATEST scenario times. A post this machine has
                # no record of may have been seeded earlier (another machine, a lost manifest) and pushed out of
                # the window by newer activity, so its absence proves nothing.
                $unverifiable = $true
                $reason = "not in the manifest, and the feed is at its $FeedTake-post cap, so an earlier copy cannot be ruled out"
            }
        }
        if ($postId) { $resolved[$key] = $postId }
        $items.Add([pscustomobject]@{
                Key = $key; Post = $post; Action = $action; PostId = $postId; Reason = $reason; IsReply = $isReply
                MinutesBeforeAnchor = [long] $post['minutesBeforeAnchor']; ScenarioTime = $scenarioTime; Unverifiable = $unverifiable
            })
    }
    [pscustomobject]@{
        Items = $items.ToArray(); Warnings = $warnings.ToArray(); Online = $online; FeedTruncated = $truncated
        Done = @($items | Where-Object Action -ne 'post').Count; ToPost = @($items | Where-Object Action -eq 'post').Count
        Unverifiable = @($items | Where-Object Unverifiable).Count
    }
}

function Resolve-SeedAnchor {
    <#
    .SYNOPSIS
        Picks the scenario anchor posts count back from, or refuses (Error) when new posts would not line up
        with ones already seeded.
    #>
    param(
        [Nullable[DateTimeOffset]] $Explicit,
        [switch] $Resume,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Manifest,
        [Parameter(Mandatory)] [object] $PostPlan,
        [Parameter(Mandatory)] [DateTimeOffset] $Now
    )
    $result = { param($Anchor, $Source, $Fresh, $Problem) [pscustomobject]@{ Anchor = $Anchor; Source = $Source; Fresh = $Fresh; Error = $Problem } }
    $nowSeconds = [DateTimeOffset]::FromUnixTimeSeconds($Now.ToUnixTimeSeconds())
    $manifestAnchor = ConvertTo-SeedInstant $Manifest['anchor']
    $derived = $null
    foreach ($item in $PostPlan.Items | Where-Object { $_.Action -ne 'post' -and $_.ScenarioTime }) {
        $time = ConvertTo-SeedInstant $item.ScenarioTime
        if ($time) { $derived = $time.AddMinutes($item.MinutesBeforeAnchor); break }
    }
    $earlier = if ($manifestAnchor) { $manifestAnchor } else { $derived }

    if ($PostPlan.ToPost -eq 0) {
        $anchor = if ($null -ne $Explicit) { [DateTimeOffset] $Explicit } elseif ($earlier) { $earlier } else { $nowSeconds }
        return & $result $anchor 'nothing to post' $false $null
    }
    if ($PostPlan.Done -eq 0) {
        # PowerShell unwraps Nullable[T]: $Explicit holds the DateTimeOffset itself (there is no .Value).
        if ($null -ne $Explicit) { return & $result ([DateTimeOffset] $Explicit) '-ScenarioAnchor' $true $null }
        return & $result $nowSeconds 'now (a fresh timeline)' $true $null
    }

    # Some posts are already seeded and some are not: the rest must land on the SAME timeline (Gate-1 L-4), so
    # neither a plain re-run nor -ScenarioAnchor may pick a new anchor here.
    $earlierText = if ($earlier) { " ($(Format-SeedInstant $earlier))" } else { '' }
    if (-not $Resume) {
        $message = "$($PostPlan.Done) of the pack's posts are already seeded and $($PostPlan.ToPost) are not. " +
            "Re-run with -Resume to post the rest on the earlier run's scenario anchor$earlierText."
        return & $result $null $null $false $message
    }
    if ($earlier) {
        if ($null -ne $Explicit -and ([DateTimeOffset] $Explicit) -ne $earlier) {
            $message = "-ScenarioAnchor $(Format-SeedInstant ([DateTimeOffset] $Explicit)) would move the rest of a partial run off its original anchor$earlierText. " +
                'Drop -ScenarioAnchor to continue it, or archive the seeded posts (Clear-DemoContent.ps1) and seed again.'
            return & $result $null $null $false $message
        }
        $source = if ($manifestAnchor) { 'resumed (the anchor in the manifest)' } else { 'resumed (derived from the posts already in the feed)' }
        return & $result $earlier $source $false $null
    }
    if ($null -ne $Explicit) { return & $result ([DateTimeOffset] $Explicit) '-ScenarioAnchor (the earlier anchor could not be recovered)' $false $null }
    return & $result $null $null $false 'The earlier run''s scenario anchor cannot be recovered (no manifest anchor and no seeded post in the feed). Pass -ScenarioAnchor with -Resume.'
}

function Test-SeedReplyTimes {
    <#
    .SYNOPSIS
        Emits one message per reply about to be posted that would land EARLIER in scenario time than its parent.
        A parent posted in this run shares the anchor (and validation already orders the minutes); a parent that
        is already seeded is checked against its REAL scenario time (from the feed or the manifest).
    #>
    param([Parameter(Mandatory)] [object] $PostPlan, [Parameter(Mandatory)] [DateTimeOffset] $Anchor)
    $byKey = @{}
    foreach ($item in $PostPlan.Items) { $byKey[$item.Key] = $item }
    foreach ($item in @($PostPlan.Items | Where-Object { $_.Action -eq 'post' -and $_.IsReply })) {
        $parent = $byKey[[string] $item.Post['replyTo']]
        if (-not $parent -or $parent.Action -eq 'post') { continue }
        $parentTime = ConvertTo-SeedInstant $parent.ScenarioTime
        if (-not $parentTime) { continue }
        $replyTime = $Anchor.AddMinutes(-$item.MinutesBeforeAnchor)
        if ($replyTime -lt $parentTime) {
            "$($item.Key) would be posted at $(Format-SeedInstant $replyTime), before its already-seeded parent $($parent.Key) ($(Format-SeedInstant $parentTime)). A reply must never precede its parent."
        }
    }
}

function Get-PersonaPatch {
    <#
    .SYNOPSIS
        The JSON merge-patch for one pack persona: only the fields that differ from the server's current row.
        Avatar and banner ids are not on the persona read, so they are compared with what the manifest says
        was applied last time, and re-sent when the server shows no image.
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackPersona,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Current,
        [AllowNull()] [string] $AvatarAssetId,
        [AllowNull()] [string] $BannerAssetId,
        [AllowNull()] [System.Collections.IDictionary] $Applied
    )
    $patch = [ordered]@{}
    if ($PackPersona.Contains('displayName')) {
        $want = ([string] $PackPersona['displayName']).Trim()
        if ($want -cne [string] $Current['displayName']) { $patch['displayName'] = $want }
    }
    foreach ($field in 'bio', 'location') {
        if (-not $PackPersona.Contains($field)) { continue }
        $want = $PackPersona[$field]
        if ($null -ne $want) { $want = ([string] $want).Trim(); if ($want -eq '') { $want = $null } }
        $have = $Current[$field]
        if ($have -eq '') { $have = $null }
        if ($want -cne $have) { $patch[$field] = $want }
    }
    if ($PackPersona.Contains('verified') -and [bool] $PackPersona['verified'] -ne [bool] $Current['verified']) { $patch['verified'] = [bool] $PackPersona['verified'] }
    foreach ($image in @(
            @{ Field = 'avatar'; Patch = 'avatarMediaId'; Url = 'avatarUrl'; AssetId = $AvatarAssetId; Applied = 'avatarAssetId' },
            @{ Field = 'banner'; Patch = 'bannerMediaId'; Url = 'bannerUrl'; AssetId = $BannerAssetId; Applied = 'bannerAssetId' })) {
        if (-not $PackPersona.Contains($image.Field)) { continue }
        $hasImage = -not [string]::IsNullOrEmpty([string] $Current[$image.Url])
        if ($null -eq $PackPersona[$image.Field]) {
            if ($hasImage) { $patch[$image.Patch] = $null }
            continue
        }
        $last = if ($Applied) { [string] $Applied[$image.Applied] } else { '' }
        if ($last -cne $image.AssetId -or -not $hasImage) { $patch[$image.Patch] = $image.AssetId }
    }
    return $patch
}

function New-PostRequestBody {
    <# The POST /api/posts body (CreatePostRequest in PostWriteEndpoints.cs; staff post as the chosen persona). #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Post,
        [Parameter(Mandatory)] [string] $AuthorPersonaId,
        [Parameter(Mandatory)] [string] $ScenarioTime,
        [Parameter(Mandatory)] [string] $TimeZone,
        [hashtable] $MediaIds = @{},
        [hashtable] $MediaAlt = @{},
        [AllowNull()] [string] $ParentPostId
    )
    $body = [ordered]@{
        authorPersonaId = $AuthorPersonaId
        text            = [string] $Post['text']
        scenarioTime    = $ScenarioTime
        timeZone        = $TimeZone
        origin          = 'controller-as-persona'
    }
    $media = @(Get-SeedList $Post 'media')
    if ($media.Count -gt 0) {
        $body['media'] = @(foreach ($item in $media) {
                $alt = if ($item.Contains('alt') -and $item['alt']) { Get-JsTrimmed $item['alt'] } else { $MediaAlt[$item['ref']] }
                [ordered]@{ mediaId = $MediaIds[$item['ref']]; alt = $alt }
            })
    }
    if ($ParentPostId) { $body['parentPostId'] = $ParentPostId }
    if ($Post['baseline'] -is [System.Collections.IDictionary]) {
        $baseline = [ordered]@{}
        foreach ($name in 'like', 'repost', 'reply') { if ($Post['baseline'].Contains($name)) { $baseline[$name] = [long] $Post['baseline'][$name] } }
        $body['engagementBaseline'] = $baseline
    }
    return $body
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Run sheet (pure): the pack's run-sheet items → inject items for POST /api/injects (inject-queue 06's frozen
# InjectItemWrite), the plan (skip / adopt / create) and the assignee lookup. No I/O.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-RunSheetItems {
    <# The pack's run-sheet items (nothing when the pack has no runSheet). Always call it as @(Get-RunSheetItems …). #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Pack)
    if ($Pack['runSheet'] -is [System.Collections.IDictionary]) { Get-SeedList $Pack['runSheet'] 'items' }
}

function Get-InjectChildIds {
    <# A queue item's post ids in sequence order (the first is sequence 1). Always call it as @(Get-InjectChildIds …). #>
    param([AllowNull()] [System.Collections.IDictionary] $Row)
    if (-not $Row) { return }
    @(Get-SeedList $Row 'posts') | Sort-Object { [long] $_['sequence'] } | ForEach-Object { [string] $_['id'] }
}

function Test-InjectItemMatch {
    <#
    .SYNOPSIS
        True when a queue item (GET /api/injects) is this run-sheet item: the same kind, title and posts (persona
        and text, in order). The server trims and strips markup; the pack refuses markup, so comparing trimmed
        text is exact. Media and replies are not compared: their ids depend on the run.
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Row,
        [AllowNull()] [hashtable] $PersonaIds
    )
    if (-not $PersonaIds) { return $false }
    if ([string] $Row['kind'] -cne [string] $PackItem['kind']) { return $false }
    if (([string] $Row['title']).Trim() -cne ([string] $PackItem['title']).Trim()) { return $false }
    $want = @(Get-SeedList $PackItem 'posts')
    $have = @(@(Get-SeedList $Row 'posts') | Sort-Object { [long] $_['sequence'] })
    if ($want.Count -ne $have.Count) { return $false }
    for ($k = 0; $k -lt $want.Count; $k++) {
        $personaId = [string] $PersonaIds[[string] $want[$k]['persona']]
        if (-not $personaId -or [string] $have[$k]['personaId'] -ne $personaId) { return $false }
        if (([string] $have[$k]['text']).Trim() -cne ([string] $want[$k]['text']).Trim()) { return $false }
    }
    return $true
}

function Find-InjectItemMatch {
    <# The first queue item that matches the run-sheet item and no other pack item has claimed, or $null. #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Rows,
        [AllowNull()] [hashtable] $PersonaIds,
        [AllowNull()] [System.Collections.Generic.HashSet[string]] $Claimed
    )
    foreach ($row in @($Rows)) {
        if ($row -isnot [System.Collections.IDictionary]) { continue }
        $id = [string] $row['id']
        if (-not $id -or ($Claimed -and $Claimed.Contains($id))) { continue }
        if (Test-InjectItemMatch -PackItem $PackItem -Row $row -PersonaIds $PersonaIds) { return $row }
    }
    return $null
}

function Get-InjectPlan {
    <#
    .SYNOPSIS
        Per run-sheet item, in pack order: 'skip' (its id from the manifest is still in the queue, whatever its
        status), 'adopt' (an unclaimed queue item with the same kind, title and posts: recorded, not created
        again) or 'create' (new, or deleted in the console since it was loaded).
    .PARAMETER Queue
        The items of GET /api/injects, or $null offline (-WhatIf: then the manifest alone decides).
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Pack,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Manifest,
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Queue,
        [AllowNull()] [hashtable] $PersonaIds
    )
    $manifestItems = $Manifest['injects']
    $entryFor = { param($Key) if ($manifestItems -is [System.Collections.IDictionary] -and $manifestItems.Contains($Key)) { $manifestItems[$Key] } else { $null } }
    $online = $null -ne $Queue
    $rowsById = [hashtable]::new([StringComparer]::OrdinalIgnoreCase)
    if ($online) { foreach ($row in $Queue) { if ($row -is [System.Collections.IDictionary]) { $rowsById[[string] $row['id']] = $row } } }
    # Ids the manifest already accounts for can never be adopted by another pack item.
    $claimed = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    if ($online -and $manifestItems -is [System.Collections.IDictionary]) {
        foreach ($key in @($manifestItems.Keys)) {
            $id = [string] $manifestItems[$key]['itemId']
            if ($id -and $rowsById.Contains($id)) { [void] $claimed.Add($id) }
        }
    }
    $items = [System.Collections.Generic.List[object]]::new()
    $warnings = [System.Collections.Generic.List[string]]::new()

    foreach ($item in @(Get-RunSheetItems -Pack $Pack)) {
        $key = [string] $item['key']
        $entry = & $entryFor $key
        $manifestId = if ($entry) { [string] $entry['itemId'] } else { '' }
        $action = 'create'; $itemId = $null; $row = $null; $reason = 'new'

        if (-not $online) {
            if ($manifestId) { $action = 'skip'; $itemId = $manifestId; $reason = 'in the manifest' }
        }
        elseif ($manifestId -and $rowsById.Contains($manifestId)) {
            $row = $rowsById[$manifestId]
            $action = 'skip'; $itemId = $manifestId; $reason = "in the run sheet ($([string] $row['status']))"
            if (-not (Test-InjectItemMatch -PackItem $item -Row $row -PersonaIds $PersonaIds)) {
                $warnings.Add("$key differs from the pack (edited in the console, or the pack changed after it was loaded); the queue's version stays. To load the pack's version, delete the item in the console and run again.")
            }
        }
        else {
            $match = Find-InjectItemMatch -PackItem $item -Rows $Queue -PersonaIds $PersonaIds -Claimed $claimed
            if ($match) {
                $action = 'adopt'; $row = $match; $itemId = [string] $match['id']; [void] $claimed.Add($itemId)
                $reason = 'already in the run sheet (same kind, title and posts)'
            }
            elseif ($manifestId) { $reason = 'loaded before, but no longer in the run sheet (deleted in the console)' }
        }
        $items.Add([pscustomobject]@{
                Key = $key; Item = $item; Action = $action; ItemId = $itemId; Row = $row; Reason = $reason
                Kind = [string] $item['kind']; Title = [string] $item['title']; PostCount = @(Get-SeedList $item 'posts').Count
            })
    }
    [pscustomobject]@{
        Items = $items.ToArray(); Warnings = $warnings.ToArray(); Online = $online
        ToCreate = @($items | Where-Object Action -eq 'create').Count; Done = @($items | Where-Object Action -ne 'create').Count
    }
}

function Get-InjectStaleReplies {
    <#
    .SYNOPSIS
        The pack post keys a queue item still replies to by an OLD post id: the post was archived (for example by
        Clear-DemoContent.ps1) and posted again since the item was loaded, so the item would fail at fire.
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [AllowNull()] [System.Collections.IDictionary] $Row,
        [Parameter(Mandatory)] [hashtable] $PostIds
    )
    if (-not $Row) { return }
    $want = @(Get-SeedList $PackItem 'posts')
    $have = @(@(Get-SeedList $Row 'posts') | Sort-Object { [long] $_['sequence'] })
    for ($k = 0; $k -lt [math]::Min($want.Count, $have.Count); $k++) {
        $reply = $want[$k]['replyTo']
        if ($reply -isnot [System.Collections.IDictionary] -or -not $reply.Contains('postKey')) { continue }
        $current = [string] $PostIds[[string] $reply['postKey']]
        $loaded = if ($have[$k]['replyTo'] -is [System.Collections.IDictionary]) { [string] $have[$k]['replyTo']['postId'] } else { '' }
        if ($current -and $loaded -and $loaded -ne $current) { [string] $reply['postKey'] }
    }
}

function Resolve-InjectAssignees {
    <#
    .SYNOPSIS
        Pack assignees → staff ids, from GET /api/injects/assignees: "me" is the signed-in staff user; anything
        else must be exactly one assignee's displayName, ignoring case. Returns @{ Ids (assignee → id);
        Unknown; Ambiguous; Known (the display names) }.
    #>
    param(
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Items,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Roster
    )
    $byName = [hashtable]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($row in @(Get-SeedList $Roster 'assignees')) {
        $name = ([string] $row['displayName']).Trim()
        $id = [string] $row['id']
        if (-not $name -or -not $id) { continue }
        if (-not $byName.Contains($name)) { $byName[$name] = [System.Collections.Generic.List[string]]::new() }
        if (-not $byName[$name].Contains($id)) { $byName[$name].Add($id) }
    }
    $ids = [hashtable]::new([StringComparer]::OrdinalIgnoreCase)
    $unknown = [System.Collections.Generic.List[string]]::new()
    $ambiguous = [System.Collections.Generic.List[string]]::new()
    foreach ($item in $Items) {
        if ($item -isnot [System.Collections.IDictionary] -or $item['assignee'] -isnot [string]) { continue }
        $want = $item['assignee'].Trim()
        if ($ids.Contains($want) -or $unknown -contains $want -or $ambiguous -contains $want) { continue }
        if ($want -ieq 'me') {
            if ($Roster['me']) { $ids[$want] = [string] $Roster['me'] } else { $unknown.Add($want) }
        }
        elseif ($byName.Contains($want) -and $byName[$want].Count -eq 1) { $ids[$want] = $byName[$want][0] }
        elseif ($byName.Contains($want)) { $ambiguous.Add($want) }
        else { $unknown.Add($want) }
    }
    [pscustomobject]@{ Ids = $ids; Unknown = $unknown.ToArray(); Ambiguous = $ambiguous.ToArray(); Known = @($byName.Keys | Sort-Object) }
}

function New-InjectRequestBody {
    <#
    .SYNOPSIS
        The POST /api/injects body: the frozen InjectItemWrite (inject-queue implementation.md "Wire contract")
        with the pack's references rewritten to real ids. Optional fields are sent only when the pack has them.
          persona          → personaId (GET /api/personas)
          media[].ref      → { mediaId, alt } (the uploaded asset; alt defaults to the media item's)
          replyTo.postKey  → { postId } (the seeded post)
          replyTo.sequence → { sequence } (an earlier post of this item; the server stores it as injectPostId)
          replyTo.item     → { injectPostId } (that post of an earlier run-sheet item)
          assignee         → assigneeId (GET /api/injects/assignees)
    .PARAMETER InjectPostIds
        Run-sheet item key → the ids of its posts in sequence order (the first is sequence 1).
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Item,
        [Parameter(Mandatory)] [hashtable] $PersonaIds,
        [hashtable] $MediaIds = @{},
        [hashtable] $MediaAlt = @{},
        [hashtable] $PostIds = @{},
        [hashtable] $InjectPostIds = @{},
        [AllowNull()] [string] $AssigneeId
    )
    $key = [string] $Item['key']
    $body = [ordered]@{ kind = [string] $Item['kind']; title = [string] $Item['title'] }
    if ($Item.Contains('notes')) { $body['notes'] = [string] $Item['notes'] }
    if ($Item.Contains('plannedMinute')) { $body['plannedMinute'] = [long] $Item['plannedMinute'] }
    if ($AssigneeId) { $body['assigneeId'] = $AssigneeId }
    if ($Item.Contains('burstWindowSeconds')) { $body['burstWindowSeconds'] = [long] $Item['burstWindowSeconds'] }
    $body['posts'] = @(foreach ($post in @(Get-SeedList $Item 'posts')) {
            $handle = [string] $post['persona']
            $personaId = [string] $PersonaIds[$handle]
            if (-not $personaId) { throw "Run-sheet item '$key': persona '$handle' has no id." }
            $out = [ordered]@{ personaId = $personaId; text = [string] $post['text'] }
            $media = @(Get-SeedList $post 'media')
            if ($media.Count -gt 0) {
                $out['media'] = @(foreach ($attachment in $media) {
                        $ref = [string] $attachment['ref']
                        if (-not $MediaIds.Contains($ref) -or -not $MediaIds[$ref]) { throw "Run-sheet item '$key': media '$ref' has no uploaded asset id." }
                        $alt = if ($attachment.Contains('alt') -and $attachment['alt']) { Get-JsTrimmed $attachment['alt'] } else { [string] $MediaAlt[$ref] }
                        [ordered]@{ mediaId = [string] $MediaIds[$ref]; alt = $alt }
                    })
            }
            $reply = $post['replyTo']
            if ($reply -is [System.Collections.IDictionary]) {
                if ($reply.Contains('postKey')) {
                    $postKey = [string] $reply['postKey']
                    if (-not $PostIds.Contains($postKey) -or -not $PostIds[$postKey]) { throw "Run-sheet item '$key': post '$postKey' has no post id." }
                    $out['replyTo'] = [ordered]@{ postId = [string] $PostIds[$postKey] }
                }
                elseif (-not $reply.Contains('item') -or [string] $reply['item'] -ceq $key) {
                    $out['replyTo'] = [ordered]@{ sequence = [long] $reply['sequence'] }
                }
                else {
                    $target = [string] $reply['item']
                    $children = @($InjectPostIds[$target])
                    $index = [long] $reply['sequence'] - 1
                    if ($index -lt 0 -or $index -ge $children.Count -or -not $children[$index]) {
                        throw "Run-sheet item '$key': post $($reply['sequence']) of item '$target' has no id (that item must be loaded first)."
                    }
                    $out['replyTo'] = [ordered]@{ injectPostId = [string] $children[$index] }
                }
            }
            if ($post['engagementBaseline'] -is [System.Collections.IDictionary]) {
                $baseline = [ordered]@{}
                foreach ($name in 'like', 'repost', 'reply') { if ($post['engagementBaseline'].Contains($name)) { $baseline[$name] = [long] $post['engagementBaseline'][$name] } }
                $out['engagementBaseline'] = $baseline
            }
            $out
        })
    return $body
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Manifest: %LOCALAPPDATA%\Pulse\demo-seed\<exerciseId>.json (Windows), $HOME/.local/share/Pulse/demo-seed
# elsewhere. Ids, hashes and times only: never a secret or a token. Sections: files and media (uploads), personas
# (profile edits), posts (post key → post id) and injects (run-sheet item key → inject item id).
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-SeedManifestDirectory {
    param([AllowNull()] [string] $Override)
    if ($Override) { return $Override }
    if ($env:LOCALAPPDATA) { return (Join-Path $env:LOCALAPPDATA 'Pulse' 'demo-seed') }
    $base = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $HOME '.local' 'share' }
    return (Join-Path $base 'Pulse' 'demo-seed')
}

function Get-SeedManifestPath {
    param([Parameter(Mandatory)] [string] $Directory, [Parameter(Mandatory)] [string] $ExerciseId)
    $guid = [guid]::Empty
    if (-not [guid]::TryParse($ExerciseId, [ref] $guid)) { throw "The exerciseId '$ExerciseId' is not a GUID." }
    return (Join-Path $Directory ('{0}.json' -f $guid.ToString('D')))
}

function New-SeedManifest {
    param([string] $ExerciseId, [string] $ApiHost)
    [ordered]@{
        schema      = 'pulse.demoseed.manifest.v1'
        exerciseId  = $ExerciseId
        apiHost     = $ApiHost
        anchor      = $null
        startedAt   = $null
        updatedAt   = $null
        completedAt = $null
        files       = [ordered]@{}
        media       = [ordered]@{}
        personas    = [ordered]@{}
        posts       = [ordered]@{}
        injects     = [ordered]@{}
    }
}

function Read-SeedManifest {
    param([Parameter(Mandatory)] [string] $Path, [Parameter(Mandatory)] [string] $ExerciseId, [string] $ApiHost)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return (New-SeedManifest -ExerciseId $ExerciseId -ApiHost $ApiHost) }
    $manifest = ConvertFrom-SeedJson (Get-Content -LiteralPath $Path -Raw)
    if ((Get-JsonKind $manifest) -ne 'object' -or $manifest['schema'] -cne 'pulse.demoseed.manifest.v1' -or [string] $manifest['exerciseId'] -ne $ExerciseId) {
        throw "$Path is not a seed manifest for exercise $ExerciseId. Move it aside and run again."
    }
    foreach ($section in 'files', 'media', 'personas', 'posts', 'injects') {
        if ($manifest[$section] -isnot [System.Collections.IDictionary]) { $manifest[$section] = [ordered]@{} }
    }
    return $manifest
}

function Save-SeedManifest {
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Manifest, [Parameter(Mandatory)] [string] $Path)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $Manifest['updatedAt'] = Format-SeedInstant -Instant ([DateTimeOffset]::UtcNow)
    $temporary = "$Path.tmp"
    [IO.File]::WriteAllText($temporary, (ConvertTo-SeedJson $Manifest) + "`n", [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Update-SeedManifestMediaKeys {
    <# The pack-key view of the uploads (media key → asset id, poster id, SHA-256), for people reading the manifest. #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Manifest, [Parameter(Mandatory)] [System.Collections.IDictionary] $Pack)
    $view = [ordered]@{}
    foreach ($item in @(Get-SeedList $Pack 'media')) {
        $entry = $Manifest['files'][(Get-NormalizedPackFile $item['file'])]
        if (-not $entry) { continue }
        $row = [ordered]@{ assetId = $entry['assetId']; sha256 = $entry['sha256'] }
        if ($entry['posterAssetId']) { $row['posterAssetId'] = $entry['posterAssetId'] }
        $view[$item['key']] = $row
    }
    $Manifest['media'] = $view
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# HTTP. Invoke-PulseApi is the one door to the API: allowlisted paths only, the bearer token only to the API
# host, 429 → wait Retry-After and retry. Nothing here prints a header or a request body, and that holds under
# -Debug and -Verbose too: the web cmdlet's own debug output dumps request bodies (the login secret), every
# Authorization header and the login response, so it is switched off per call (Gate-1 H-1). A failed request
# leaves an error record holding the HttpRequestMessage (with its Authorization header) in $Error, where
# Get-Error would print the token; those records are removed and a clean error is thrown instead (Gate-1 M-1).
# Redirects are never followed: the API never redirects, and a redirected POST would re-send its body (the
# secret) to another host (Gate-1 L-5).
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Resolve-SeedApiBaseUrl {
    param([Parameter(Mandatory)] [string] $ApiHost)
    $value = $ApiHost.Trim().TrimEnd('/')
    if ($value -notmatch '^[A-Za-z][A-Za-z0-9+.-]*://') { $value = "https://$value" }
    $uri = $null
    if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref] $uri)) { throw "-ApiHost '$ApiHost' is not a host name or an origin." }
    if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.IsLoopback)) {
        throw "-ApiHost must use https (plain http is accepted for localhost only): the session token must not travel in the clear."
    }
    if ($uri.AbsolutePath -ne '/' -or $uri.Query) { throw "-ApiHost must be a host name or origin, without a path." }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Clear-SeedWebErrors {
    <#
    .SYNOPSIS
        Removes from $Error every record a web request left behind. Invoke-WebRequest's error records keep the
        HttpRequestMessage (Authorization header included) as their TargetObject, and Get-Error prints it.
    #>
    param([AllowEmptyCollection()] [object[]] $Exceptions = @())
    foreach ($record in @($global:Error)) {
        if ($record -isnot [System.Management.Automation.ErrorRecord]) { continue }
        $fromRequest = $record.TargetObject -is [System.Net.Http.HttpRequestMessage]
        $listed = @($Exceptions | Where-Object { $null -ne $_ -and [object]::ReferenceEquals($_, $record.Exception) }).Count -gt 0
        if ($fromRequest -or $listed) { $global:Error.Remove($record) }
    }
}

function Invoke-PulseApi {
    param(
        [Parameter(Mandatory)] [hashtable] $Context,
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'PATCH')] [string] $Method,
        [Parameter(Mandatory)] [string] $Path,
        [AllowNull()] [object] $Body,
        [string] $ContentType = 'application/json',
        [System.Collections.IDictionary] $Form,
        [switch] $Anonymous,
        [int] $TimeoutSec = 120,
        [int] $MaxRateLimitRetries = 6
    )
    $bare = ($Path -split '\?', 2)[0]
    if (-not (Test-SeedApiPath -Path $Path)) { throw "Refusing to call ${bare}: it is not on this script's public-API allowlist." }
    $headers = @{ Accept = 'application/json' }
    if (-not $Anonymous) {
        if (-not $Context.Token) { throw 'Not signed in.' }
        $headers['Authorization'] = "Bearer $($Context.Token)"
    }
    $request = @{
        Uri = "$($Context.BaseUrl)$Path"; Method = $Method; Headers = $headers; TimeoutSec = $TimeoutSec
        SkipHttpErrorCheck = $true
        Debug = $false                  # H-1: the web cmdlet's debug stream carries bodies and the Authorization header
        Verbose = $false
        MaximumRedirection = 0          # L-5: never follow a redirect (a 3xx comes back and fails below)
        ErrorAction = 'SilentlyContinue'
        ErrorVariable = 'webErrors'
    }
    if ($Context.BaseUrl -like 'http://*') { $request['AllowUnencryptedAuthentication'] = $true }
    if ($Form) { $request['Form'] = $Form }
    elseif ($null -ne $Body) {
        $request['Body'] = [Text.Encoding]::UTF8.GetBytes((ConvertTo-SeedJson $Body -Compress))
        $request['ContentType'] = "$ContentType; charset=utf-8"
    }

    try {
        $response = $null
        for ($attempt = 1; ; $attempt++) {
            $webErrors = $null
            $failure = $null
            try { $response = Invoke-WebRequest @request }
            catch { $failure = $_.Exception }
            $caught = @($webErrors | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception } else { $_ } }) + @($failure)
            Clear-SeedWebErrors -Exceptions $caught
            $status = if ($response) { [int] $response.StatusCode } else { 0 }
            if ($status -ge 300 -and $status -lt 400) {
                throw [System.Exception]::new("$Method $bare answered a redirect ($status). The API never redirects, so it was not followed: check -ApiHost.")
            }
            if (-not $response) {
                $reason = if ($failure) { $failure.Message } elseif (@($webErrors).Count) { @($webErrors)[0].Exception.Message } else { 'no response' }
                throw [System.Exception]::new("$Method $bare failed: $reason")
            }
            if ($status -ne 429 -or $attempt -gt $MaxRateLimitRetries) { break }
            $wait = Get-RetryAfterSeconds -Value $response.Headers['Retry-After']
            Write-Host ("    429 on {0} {1}: waiting {2}s (Retry-After), retry {3}/{4}" -f $Method, $bare, $wait, $attempt, $MaxRateLimitRetries) -ForegroundColor DarkGray
            Start-Sleep -Seconds $wait
        }
    }
    finally {
        # The request body may hold the login secret: wipe the bytes as soon as they are sent.
        if ($request['Body'] -is [byte[]]) { [Array]::Clear($request['Body'], 0, $request['Body'].Length) }
        $headers.Clear()
    }

    $text = [string] $response.Content
    $json = $null
    if ($text.Trim()) {
        try {
            $json = if ($text.TrimStart().StartsWith('[')) { , @(ConvertFrom-SeedJson $text) } else { ConvertFrom-SeedJson $text }
        }
        catch { $json = $null }
    }
    return [pscustomobject]@{ Status = [int] $response.StatusCode; Json = $json; Text = $text }
}

function Get-ApiErrorText {
    <#
    .SYNOPSIS
        A 4xx body is a plain JSON string (implementation.md §1.1), {"error": code}, or a ProblemDetails whose
        "detail" is the readable reason (the inject queue); short and safe to print. -Full keeps a long detail
        whole (a 400 from POST /api/injects is printed exactly as the server wrote it).
    #>
    param([Parameter(Mandatory)] [object] $Response, [switch] $Full)
    $json = $Response.Json
    $text = if ($json -is [string]) { $json }
    elseif ($json -is [System.Collections.IDictionary] -and $json['detail']) { [string] $json['detail'] }
    elseif ($json -is [System.Collections.IDictionary] -and $json['error']) { [string] $json['error'] }
    elseif ($json -is [System.Collections.IDictionary] -and $json['reason']) { [string] $json['reason'] }
    else { [string] $Response.Text }
    if (-not $Full -and $text.Length -gt 300) { $text = $text.Substring(0, 300) + '…' }
    return $text
}

function Add-InjectItem {
    <#
    .SYNOPSIS
        POST /api/injects for one run-sheet item, made safe to stop and run again. Returns
        @{ Outcome = created | adopted | refused | failed | uncertain; Item (the item, when there is one); Status; Detail }.
    .DESCRIPTION
        A create is NOT idempotent: sending it again after an uncertain outcome could put the item in the queue
        twice. So no response (a network failure), a 408, a 5xx or a 2xx without a readable item never leads
        to a second POST. GET /api/injects is re-read instead, and an item with the same kind, title and posts
        that no other pack item has claimed is adopted. If there is none, the outcome stays 'uncertain' and the
        run stops: the next run (-Resume) re-reads the queue and adopts or creates it then. A 429 has already
        been waited out and retried by Invoke-PulseApi (the server refused it, so nothing was created).
    #>
    param(
        [Parameter(Mandatory)] [hashtable] $Context,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Body,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [Parameter(Mandatory)] [hashtable] $PersonaIds,
        [AllowNull()] [System.Collections.Generic.HashSet[string]] $Claimed
    )
    $result = { param($Outcome, $Item, $Status, $Detail) [pscustomobject]@{ Outcome = $Outcome; Item = $Item; Status = [int] $Status; Detail = $Detail } }
    $response = $null
    $why = $null
    try { $response = Invoke-PulseApi -Context $Context -Method POST -Path '/api/injects' -Body $Body }
    catch { $why = $_.Exception.Message.TrimEnd('.') }
    if ($response) {
        $status = $response.Status
        $isSuccess = $status -ge 200 -and $status -lt 300
        if ($status -eq 201 -and $response.Json -is [System.Collections.IDictionary] -and $response.Json['id']) { return & $result 'created' $response.Json 201 $null }
        if ($status -eq 400) { return & $result 'refused' $null 400 (Get-ApiErrorText $response -Full) }
        if (-not ($isSuccess -or $status -eq 408 -or $status -ge 500)) { return & $result 'failed' $null $status (Get-ApiErrorText $response) }
        $why = if ($isSuccess) { "POST /api/injects answered $status without a readable item" } else { "POST /api/injects answered $status $(Get-ApiErrorText $response)" }
    }

    # Uncertain: the item may or may not exist now. Look before doing anything else.
    $reread = $null
    try { $reread = Invoke-PulseApi -Context $Context -Method GET -Path '/api/injects' }
    catch { return & $result 'uncertain' $null 0 "$why; re-reading the run sheet failed too ($($_.Exception.Message))" }
    if ($reread.Status -ne 200 -or $reread.Json -isnot [System.Collections.IDictionary]) {
        return & $result 'uncertain' $null 0 "$why; re-reading the run sheet answered $($reread.Status)"
    }
    $match = Find-InjectItemMatch -PackItem $PackItem -Rows @(Get-SeedList $reread.Json 'items') -PersonaIds $PersonaIds -Claimed $Claimed
    if ($match) { return & $result 'adopted' $match 0 $why }
    return & $result 'uncertain' $null 0 "$why; it is not in the run sheet now"
}

function Invoke-MediaRangeRequest {
    <#
    .SYNOPSIS
        GET <url> with Range: bytes=0-1 and returns the status code (0 on a network failure). Reads headers only.
        No Authorization header: media URLs are pre-signed, and the session token never leaves the API host.
        Redirects are not followed (a 3xx is reported as such).
    #>
    param([Parameter(Mandatory)] [string] $Url)
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    try {
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Url)
        $request.Headers.Range = [System.Net.Http.Headers.RangeHeaderValue]::new(0, 1)
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try { return [int] $response.StatusCode } finally { $response.Dispose() }
    }
    catch { Clear-SeedWebErrors -Exceptions @($_.Exception); return 0 }
    finally { $client.Dispose() }
}

function Get-PauseTierRank {
    <# How restrictive a pause tier is (PauseTierRegistry.cs: running < injects < engine < freeze). #>
    param([AllowNull()] [string] $Tier)
    switch ($Tier) { 'running' { 0 } 'injects' { 1 } 'engine' { 2 } 'freeze' { 3 } default { -1 } }
}

function Set-EnginePauseTier {
    <#
    .SYNOPSIS
        Makes sure the engine is paused. Reads the current tier first (GET /api/steering/pause-tier) and never
        DOWNGRADES a more restrictive one: a frozen world stays frozen (Gate-1 L-6). Otherwise POSTs {tier: engine};
        the server also requires actingHumanId (COR-018).
    #>
    param([Parameter(Mandatory)] [hashtable] $Context, [Parameter(Mandatory)] [AllowEmptyString()] [string] $ActingHumanId, [string] $TimeZone)
    $current = Invoke-PulseApi -Context $Context -Method GET -Path '/api/steering/pause-tier'
    if ($current.Status -eq 200 -and $current.Json -is [System.Collections.IDictionary]) {
        $found = [string] $current.Json['tier']
        if ((Get-PauseTierRank $found) -ge (Get-PauseTierRank 'engine')) {
            return [pscustomobject]@{ Ok = $true; Tier = $found; Changed = $false; Detail = "found '$found' (the engine is already paused); left as it is" }
        }
    }
    elseif ($current.Status -in 401, 403) {
        return [pscustomobject]@{ Ok = $false; Tier = $null; Changed = $false; Detail = "$($current.Status) — the staff user must be assigned to this exercise" }
    }
    if ([string]::IsNullOrWhiteSpace($ActingHumanId)) {
        return [pscustomobject]@{ Ok = $false; Tier = $null; Changed = $false; Detail = 'the sign-in returned no actingHumanId, which the pause tier requires' }
    }
    $body = [ordered]@{ tier = 'engine'; actingHumanId = $ActingHumanId }
    if ($TimeZone) { $body['timeZone'] = $TimeZone }
    $response = Invoke-PulseApi -Context $Context -Method POST -Path '/api/steering/pause-tier' -Body $body
    $was = if ($current.Status -eq 200) { " (was '$($current.Json['tier'])')" } else { '' }
    switch ($response.Status) {
        200 { return [pscustomobject]@{ Ok = ($response.Json['tier'] -eq 'engine'); Tier = [string] $response.Json['tier']; Changed = $true; Detail = "set to '$($response.Json['tier'])'$was" } }
        409 { return [pscustomobject]@{ Ok = $false; Tier = $null; Changed = $false; Detail = "409 refused: $(Get-ApiErrorText $response)" } }
        { $_ -in 401, 403 } { return [pscustomobject]@{ Ok = $false; Tier = $null; Changed = $false; Detail = "$_ — the staff user must be a controller assigned to this exercise" } }
        default { return [pscustomobject]@{ Ok = $false; Tier = $null; Changed = $false; Detail = "$_ $(Get-ApiErrorText $response)" } }
    }
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Output helpers
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Write-SeedLine {
    param([ValidateSet('PASS', 'WARN', 'FAIL', 'INFO', 'SKIP')] [string] $Status, [string] $Text)
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red'; INFO = 'Gray'; SKIP = 'DarkGray' }[$Status]
    Write-Host ("  [{0}] {1}" -f $Status, $Text) -ForegroundColor $color
}

function Format-Bytes {
    param([long] $Bytes)
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N0} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

function Write-SeedPlan {
    param(
        [object[]] $UploadPlan, [object[]] $PersonaPlan, [object] $PostPlan, [object] $Anchor,
        [object] $InjectPlan, [switch] $LeaveEngineRunning, [int] $TopLevel, [switch] $Offline
    )
    $uploads = @($UploadPlan | Where-Object Action -eq 'upload')
    $images = @($uploads | Where-Object { $_.Unit.Kind -eq 'image' }).Count
    $videos = @($uploads | Where-Object { $_.Unit.Kind -eq 'video' }).Count
    $bytes = [long] ($uploads | ForEach-Object { $_.Unit.Bytes } | Measure-Object -Sum).Sum
    Write-Host ("  Media uploads   {0} to upload ({1} image(s), {2} video(s), {3}); {4} already uploaded" -f $uploads.Count, $images, $videos, (Format-Bytes $bytes), ($UploadPlan.Count - $uploads.Count))
    foreach ($item in $uploads) { Write-Host ("                    + {0}  ({1}, {2}; {3})" -f $item.Unit.File, $item.Unit.Kind, (Format-Bytes $item.Unit.Bytes), $item.Reason) -ForegroundColor DarkGray }

    $editing = @($PersonaPlan | Where-Object { $_.Fields.Count -gt 0 })
    if ($Offline) { Write-Host ("  Persona edits   {0} persona(s) in the pack; a live run sends only the fields that differ from the server" -f $PersonaPlan.Count) }
    else { Write-Host ("  Persona edits   {0} to edit; {1} unchanged" -f $editing.Count, ($PersonaPlan.Count - $editing.Count)) }
    foreach ($row in $editing) { Write-Host ("                    ~ @{0}: {1}" -f $row.Handle, ($row.Fields -join ', ')) -ForegroundColor DarkGray }

    $toPost = @($PostPlan.Items | Where-Object Action -eq 'post')
    $replies = @($toPost | Where-Object IsReply).Count
    Write-Host ("  Posts           {0} to post ({1} repl{2}); {3} already seeded" -f $toPost.Count, $replies, $(if ($replies -eq 1) { 'y' } else { 'ies' }), $PostPlan.Done)
    if ($Anchor -and $Anchor.Anchor -and $toPost.Count -gt 0) {
        $first = $toPost | Select-Object -First 1
        $last = $toPost | Select-Object -Last 1
        Write-Host ("                    anchor {0} ({1}); first T-{2}m = {3}, last T-{4}m = {5}" -f (Format-SeedInstant $Anchor.Anchor), $Anchor.Source,
            $first.MinutesBeforeAnchor, (Get-PostScenarioTime $Anchor.Anchor $first.MinutesBeforeAnchor), $last.MinutesBeforeAnchor, (Get-PostScenarioTime $Anchor.Anchor $last.MinutesBeforeAnchor)) -ForegroundColor DarkGray
    }
    foreach ($item in $PostPlan.Items | Where-Object Action -ne 'post') { Write-Host ("                    = {0}  {1}" -f $item.Key, $item.Reason) -ForegroundColor DarkGray }
    foreach ($item in $toPost | Where-Object { $_.Reason -ne 'new' }) { Write-Host ("                    + {0}  {1}" -f $item.Key, $item.Reason) -ForegroundColor DarkGray }

    $sheetItems = @(if ($InjectPlan) { $InjectPlan.Items })
    if ($sheetItems.Count -eq 0) { Write-Host '  Run sheet       none in the pack (nothing to load)' }
    else {
        $creating = @($sheetItems | Where-Object Action -eq 'create')
        $scripted = [long] ($creating | Measure-Object -Property PostCount -Sum).Sum
        Write-Host ("  Run sheet       {0} item(s) to create ({1} scripted post(s), each item pending in the console's queue); {2} already loaded" -f $creating.Count, $scripted, $InjectPlan.Done)
        foreach ($item in $creating) {
            $why = if ($item.Reason -ne 'new') { "; $($item.Reason)" } else { '' }
            Write-Host ("                    + {0}  {1,-5}  ""{2}"" ({3} post{4}){5}" -f $item.Key, $item.Kind, $item.Title, $item.PostCount, $(if ($item.PostCount -eq 1) { '' } else { 's' }), $why) -ForegroundColor DarkGray
        }
        foreach ($item in $sheetItems | Where-Object Action -ne 'create') { Write-Host ("                    = {0}  {1}" -f $item.Key, $item.Reason) -ForegroundColor DarkGray }
    }
    if ($LeaveEngineRunning) { Write-Host '  Engine          left as it is (-LeaveEngineRunning)' }
    else { Write-Host '  Engine          pause tier: at least "engine" before the posts and again after seeding (a stricter tier is left as it is)' }
    $sheetCheck = if ($sheetItems.Count -gt 0) { "; every run-sheet item in GET /api/injects with its posts" } else { '' }
    Write-Host ("  Self-check      GET /api/feed shows >= {0} top-level post(s); Range bytes=0-1 -> 206 on every media URL{1}" -f $TopLevel, $sheetCheck)
    if ($Offline) { Write-Host '  (Offline plan from the pack and the manifest. A live run first re-checks the feed, the media library, the personas and the run sheet.)' -ForegroundColor DarkGray }
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# The run
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Invoke-DemoSeed {
    <# The whole run. Returns the process exit code (0 = seeded and every self-check passed). #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $PackPath,
        [Parameter(Mandatory)] [string] $ApiHost,
        [string] $SiteUrl,
        [Parameter(Mandatory)] [string] $StaffUsername,
        [Nullable[DateTimeOffset]] $ScenarioAnchor,
        [switch] $WhatIf,
        [switch] $Resume,
        [switch] $LeaveEngineRunning,
        [switch] $AcceptUnverifiableFeed,
        [string] $ManifestDirectory
    )
    $ProgressPreference = 'SilentlyContinue'
    $limits = Get-SeedLimits
    try { $baseUrl = Resolve-SeedApiBaseUrl -ApiHost $ApiHost }
    catch { Write-SeedLine FAIL $_.Exception.Message; return 1 }
    $context = @{ BaseUrl = $baseUrl; Token = $null }
    Write-Host "Pulse demo seed — $baseUrl$(if ($WhatIf) { '  (WhatIf: nothing is sent or written)' })" -ForegroundColor Cyan

    # ── 1. Validate the whole pack before any request ──────────────────────────────────────────────────────────
    Write-Host "`n1. Validate the pack" -ForegroundColor Cyan
    $packFull = [IO.Path]::GetFullPath($PackPath)
    if (-not (Test-Path -LiteralPath $packFull -PathType Leaf)) { Write-SeedLine FAIL "No pack at $packFull (S2 authors docs/demo/pack/pack.json; pass -PackPath)."; return 1 }
    $packRoot = Split-Path -Parent $packFull
    try { $pack = ConvertFrom-SeedJson (Get-Content -LiteralPath $packFull -Raw) }
    catch { Write-SeedLine FAIL "$packFull is not valid JSON: $($_.Exception.Message)"; return 1 }
    $problems = @(Test-DemoPack -Pack $pack -PackRoot $packRoot -Limits $limits)
    if ($problems.Count -gt 0) {
        foreach ($problem in $problems) { Write-SeedLine FAIL ("{0}: {1}  [{2}]" -f $problem.Where, $problem.Message, $problem.Code) }
        Write-Host "`n$($problems.Count) problem(s) in $packFull. Nothing was sent." -ForegroundColor Red
        return 1
    }
    $units = @(Get-PackUploadUnits -Pack $pack -PackRoot $packRoot)
    $posts = @(Get-SeedList $pack 'posts')
    $topLevel = @($posts | Where-Object { -not $_['replyTo'] }).Count
    $sheetItems = @(Get-RunSheetItems -Pack $pack)
    $sheetPosts = [long] ($sheetItems | ForEach-Object { @(Get-SeedList $_ 'posts').Count } | Measure-Object -Sum).Sum
    Write-SeedLine PASS ("{0}: {1} persona edit(s), {2} file(s) ({3}), {4} post(s) ({5} top-level), {6} run-sheet item(s) ({7} scripted post(s))" -f
        (Split-Path -Leaf $packFull), @(Get-SeedList $pack 'personas').Count, $units.Count, (Format-Bytes ([long] ($units | Measure-Object -Property Bytes -Sum).Sum)),
        $posts.Count, $topLevel, $sheetItems.Count, $sheetPosts)

    # ── 2. Exercise context (anonymous) ──────────────────────────────────────────────────────────────────────
    Write-Host "`n2. Exercise context" -ForegroundColor Cyan
    $exercise = $null
    $contextError = $null
    try {
        $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/exercise-context' -Anonymous -TimeoutSec 60
        $guid = [guid]::Empty
        if ($response.Status -eq 200 -and $response.Json -is [System.Collections.IDictionary] -and [guid]::TryParse([string] $response.Json['exerciseId'], [ref] $guid) -and $response.Json['timeZone']) {
            $exercise = @{ Id = $guid.ToString('D'); Name = [string] $response.Json['exerciseName']; TimeZone = [string] $response.Json['timeZone']; Status = [string] $response.Json['status'] }
        }
        else { $contextError = "/api/exercise-context -> $($response.Status)$(if ($response.Status -eq 404) { ' (no exercise is bound to this host)' })" }
    }
    catch { $contextError = "/api/exercise-context unreachable: $($_.Exception.Message)" }
    if ($exercise) { Write-SeedLine PASS ("exercise '{0}' ({1}), status {2}, time zone {3}" -f $exercise.Name, $exercise.Id, $exercise.Status, $exercise.TimeZone) }
    elseif ($WhatIf) { Write-SeedLine WARN "$contextError — planning from the pack alone (no manifest)" }
    else { Write-SeedLine FAIL $contextError; return 1 }

    $manifestDir = Get-SeedManifestDirectory -Override $ManifestDirectory
    $manifestPath = $null
    $manifest = New-SeedManifest -ExerciseId '' -ApiHost $ApiHost
    if ($exercise) {
        $manifestPath = Get-SeedManifestPath -Directory $manifestDir -ExerciseId $exercise.Id
        try { $manifest = Read-SeedManifest -Path $manifestPath -ExerciseId $exercise.Id -ApiHost $ApiHost }
        catch { Write-SeedLine FAIL $_.Exception.Message; return 1 }
        $state = if (Test-Path -LiteralPath $manifestPath) { "found ($(@($manifest['files'].Keys).Count) file(s), $(@($manifest['posts'].Keys).Count) post(s), $(@($manifest['injects'].Keys).Count) run-sheet item(s))" } else { 'none yet (first run for this exercise)' }
        Write-SeedLine INFO "manifest $manifestPath — $state"
    }

    if ($WhatIf) {
        Write-Host "`nPlan" -ForegroundColor Cyan
        $uploadPlan = @(Get-UploadPlan -Units $units -Manifest $manifest -Library $null -Username $StaffUsername)
        $postPlan = Get-PostPlan -Pack $pack -Manifest $manifest -Feed $null -PersonaIds $null
        $anchor = Resolve-SeedAnchor -Explicit $ScenarioAnchor -Resume:$Resume -Manifest $manifest -PostPlan $postPlan -Now ([DateTimeOffset]::UtcNow)
        $personaPlan = @(foreach ($persona in @(Get-SeedList $pack 'personas')) {
                $fields = @($persona.Keys | Where-Object { $_ -ne 'handle' } | ForEach-Object { if ($_ -in 'avatar', 'banner') { "${_}MediaId" } else { $_ } })
                [pscustomobject]@{ Handle = $persona['handle']; Fields = $fields }
            })
        $injectPlan = Get-InjectPlan -Pack $pack -Manifest $manifest -Queue $null -PersonaIds $null
        Write-SeedPlan -UploadPlan $uploadPlan -PersonaPlan $personaPlan -PostPlan $postPlan -Anchor $anchor -InjectPlan $injectPlan `
            -LeaveEngineRunning:$LeaveEngineRunning -TopLevel $topLevel -Offline
        if ($anchor.Error) { Write-SeedLine WARN "A live run would stop here: $($anchor.Error)" }
        elseif ($anchor.Anchor) { foreach ($problem in @(Test-SeedReplyTimes -PostPlan $postPlan -Anchor $anchor.Anchor)) { Write-SeedLine WARN "A live run would stop here: $problem" } }
        Write-Host "`nWhatIf: nothing was sent or written. Sign-in, uploads, edits, posts, the run sheet and the pause tier were all skipped." -ForegroundColor Cyan
        return 0
    }

    # ── 3. Sign in (the secret and the token stay in memory) ─────────────────────────────────────────────────
    Write-Host "`n3. Sign in as $StaffUsername" -ForegroundColor Cyan
    $secret = $env:PULSE_STAFF_SECRET
    if (-not $secret) {
        $secure = Read-Host "Staff secret for '$StaffUsername' (hidden; Copy-StaffSecret.ps1 $StaffUsername puts it on the clipboard)" -AsSecureString
        $secret = [System.Net.NetworkCredential]::new('', $secure).Password
        $secure = $null
    }
    if ([string]::IsNullOrWhiteSpace($secret)) { $secret = $null; Write-SeedLine FAIL 'No secret given. Nothing was sent.'; return 1 }
    $login = $null
    $loginBody = [ordered]@{ username = $StaffUsername; secret = $secret; exerciseId = $exercise.Id }
    try { $login = Invoke-PulseApi -Context $context -Method POST -Path '/api/auth/staff/login' -Anonymous -Body $loginBody }
    catch { Write-SeedLine FAIL "sign-in failed: $($_.Exception.Message)"; return 1 }
    finally {
        # The body object is still referenced by the call's bound parameters (and any error record): blank it.
        $loginBody['secret'] = $null
        $secret = $null
    }
    $actingHumanId = $null
    switch ($login.Status) {
        200 {
            $context.Token = [string] $login.Json['token']
            # The staff user id the pause tier must name as actingHumanId (COR-018); the server stamps posts itself.
            $session = $login.Json['session']
            $actingHumanId = if ($session -is [System.Collections.IDictionary]) { [string] $session['actingHumanId'] } else { '' }
        }
        400 { Write-SeedLine FAIL '400: the sign-in request was refused as malformed (username, secret and exerciseId are all required).' }
        401 { Write-SeedLine FAIL "401: '$StaffUsername' or the secret was rejected." }
        403 { Write-SeedLine FAIL "403: '$StaffUsername' is not assigned to exercise $($exercise.Id)." }
        429 { Write-SeedLine FAIL '429: too many sign-ins; wait a minute and run again.' }
        default { Write-SeedLine FAIL "sign-in -> $($login.Status)" }
    }
    $login = $null
    if (-not $context.Token) { return 1 }
    Write-SeedLine PASS "signed in as $StaffUsername"

    try {
        # ── 4. Read the current state; stop on an unknown handle or assignee before any write ─────────────────
        Write-Host "`n4. Read the exercise's personas, media library, feed and run sheet" -ForegroundColor Cyan
        $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/personas'
        if ($response.Status -ne 200) { Write-SeedLine FAIL "GET /api/personas -> $($response.Status) $(Get-ApiErrorText $response)"; return 1 }
        $personaByHandle = @{}
        foreach ($row in @($response.Json)) { $personaByHandle[([string] $row['handle']).TrimStart('@')] = $row }
        $named = [System.Collections.Generic.List[string]]::new()
        foreach ($persona in @(Get-SeedList $pack 'personas')) { $named.Add([string] $persona['handle']) }
        foreach ($post in $posts) { $named.Add([string] $post['persona']) }
        foreach ($sheetItem in $sheetItems) { foreach ($sheetPost in @(Get-SeedList $sheetItem 'posts')) { $named.Add([string] $sheetPost['persona']) } }
        $unknown = @($named | Sort-Object -Unique | Where-Object { -not $personaByHandle.Contains($_) })
        if ($unknown.Count -gt 0) {
            Write-SeedLine FAIL ("unknown persona handle(s): {0}. Nothing was written." -f ($unknown -join ', '))
            Write-Host ("  Known handles in this exercise: {0}" -f ((@($personaByHandle.Values | ForEach-Object { ([string] $_['handle']).TrimStart('@') }) | Sort-Object) -join ', '))
            return 1
        }
        Write-SeedLine PASS "$($personaByHandle.Count) personas; every handle the pack names exists"
        $personaIds = @{}
        foreach ($handle in $personaByHandle.Keys) { $personaIds[$handle] = [string] $personaByHandle[$handle]['id'] }

        $library = @{ Ids = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase); Complete = @{} }
        foreach ($kind in 'image', 'video') {
            $response = Invoke-PulseApi -Context $context -Method GET -Path "/api/staff/media?kind=$kind&take=$($limits.LibraryTake)"
            if ($response.Status -eq 503) { Write-SeedLine FAIL 'the media store is unavailable (503): uploads and media posts would fail. Check the UAT blob storage first.'; return 1 }
            if ($response.Status -ne 200) { Write-SeedLine FAIL "GET /api/staff/media -> $($response.Status) $(Get-ApiErrorText $response)"; return 1 }
            $rows = @($response.Json)
            foreach ($row in $rows) { [void] $library.Ids.Add([string] $row['id']) }
            $library.Complete[$kind] = $rows.Count -lt $limits.LibraryTake
        }
        Write-SeedLine PASS "media library: $($library.Ids.Count) asset(s)"

        $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/feed?includeReplies=true'
        if ($response.Status -ne 200) { Write-SeedLine FAIL "GET /api/feed -> $($response.Status) $(Get-ApiErrorText $response)"; return 1 }
        $feed = @($response.Json)
        Write-SeedLine PASS "feed: $($feed.Count) post(s) and replies$(if ($feed.Count -ge $limits.FeedTake) { " (at the $($limits.FeedTake)-post cap)" })"

        # The run sheet (inject queue, inject-queue 06): what is already loaded, and who the assignees are.
        $injectQueue = $null
        $assigneeIds = [hashtable]::new([StringComparer]::OrdinalIgnoreCase)
        if ($sheetItems.Count -gt 0) {
            $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/injects'
            if ($response.Status -ne 200 -or $response.Json -isnot [System.Collections.IDictionary]) {
                $hint = switch ($response.Status) {
                    404 { ' (this API has no inject queue: deploy inject-queue 06 first)' }
                    { $_ -in 401, 403 } { ' (the staff user must be assigned to this exercise)' }
                    default { " $(Get-ApiErrorText $response)" }
                }
                Write-SeedLine FAIL "GET /api/injects -> $($response.Status)$hint. Nothing was written."
                return 1
            }
            $injectQueue = @(Get-SeedList $response.Json 'items')
            Write-SeedLine PASS "run sheet: $($injectQueue.Count) item(s) in the console's queue"

            if (@($sheetItems | Where-Object { $_['assignee'] -is [string] }).Count -gt 0) {
                $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/injects/assignees'
                if ($response.Status -ne 200 -or $response.Json -isnot [System.Collections.IDictionary]) {
                    Write-SeedLine FAIL "GET /api/injects/assignees -> $($response.Status) $(Get-ApiErrorText $response). Nothing was written."
                    return 1
                }
                $assignees = Resolve-InjectAssignees -Items $sheetItems -Roster $response.Json
                if ($assignees.Unknown.Count -gt 0 -or $assignees.Ambiguous.Count -gt 0) {
                    if ($assignees.Unknown.Count -gt 0) { Write-SeedLine FAIL ("unknown run-sheet assignee(s): {0}. Nothing was written." -f ($assignees.Unknown -join ', ')) }
                    if ($assignees.Ambiguous.Count -gt 0) { Write-SeedLine FAIL ("run-sheet assignee(s) matching more than one staff member: {0}. Nothing was written." -f ($assignees.Ambiguous -join ', ')) }
                    Write-Host ("  Staff assigned to this exercise: {0} (or ""me"" for {1})" -f ($assignees.Known -join ', '), $StaffUsername)
                    return 1
                }
                $assigneeIds = $assignees.Ids
                Write-SeedLine PASS "every run-sheet assignee is staff assigned to this exercise ($(@($assigneeIds.Keys | Sort-Object) -join ', '))"
            }
        }

        # ── Plan ───────────────────────────────────────────────────────────────────────────────────────────────
        $uploadPlan = @(Get-UploadPlan -Units $units -Manifest $manifest -Library $library -Username $StaffUsername)
        $postPlan = Get-PostPlan -Pack $pack -Manifest $manifest -Feed $feed -PersonaIds $personaIds -FeedTake $limits.FeedTake
        $anchor = Resolve-SeedAnchor -Explicit $ScenarioAnchor -Resume:$Resume -Manifest $manifest -PostPlan $postPlan -Now ([DateTimeOffset]::UtcNow)
        $plannedIds = @{}
        foreach ($item in $uploadPlan) { $plannedIds[$item.Unit.File] = $(if ($item.AssetId) { $item.AssetId } else { "(new upload of $($item.Unit.File))" }) }
        $personaPlan = @(foreach ($persona in @(Get-SeedList $pack 'personas')) {
                $handle = [string] $persona['handle']
                $avatar = if ($persona['avatar'] -is [string]) { $plannedIds[(Get-NormalizedPackFile $persona['avatar'])] } else { $null }
                $banner = if ($persona['banner'] -is [string]) { $plannedIds[(Get-NormalizedPackFile $persona['banner'])] } else { $null }
                $applied = if ($manifest['personas'].Contains($handle)) { $manifest['personas'][$handle] } else { $null }
                $patch = Get-PersonaPatch -PackPersona $persona -Current $personaByHandle[$handle] -AvatarAssetId $avatar -BannerAssetId $banner -Applied $applied
                [pscustomobject]@{ Handle = $handle; Fields = @($patch.Keys) }
            })
        $injectPlan = Get-InjectPlan -Pack $pack -Manifest $manifest -Queue $injectQueue -PersonaIds $personaIds
        Write-Host "`nPlan" -ForegroundColor Cyan
        Write-SeedPlan -UploadPlan $uploadPlan -PersonaPlan $personaPlan -PostPlan $postPlan -Anchor $anchor -InjectPlan $injectPlan `
            -LeaveEngineRunning:$LeaveEngineRunning -TopLevel $topLevel
        foreach ($warning in @($postPlan.Warnings) + @($injectPlan.Warnings)) { Write-SeedLine WARN $warning }
        if ($anchor.Error) { Write-SeedLine FAIL "$($anchor.Error) Nothing was written."; return 1 }
        $unverifiable = @($postPlan.Items | Where-Object Unverifiable)
        if ($unverifiable.Count -gt 0 -and -not $AcceptUnverifiableFeed) {
            Write-SeedLine FAIL ("the feed returned its full {0}-post window, so {1} post(s) cannot be checked against an earlier seed: {2}. The manifest on this machine does not know them, and an older copy may sit beyond the window. Nothing was written." -f
                $limits.FeedTake, $unverifiable.Count, (@($unverifiable | ForEach-Object Key) -join ', '))
            Write-Host "  Run from the machine that holds the manifest ($manifestPath), or archive old content first (Clear-DemoContent.ps1)," -ForegroundColor Yellow
            Write-Host '  or pass -AcceptUnverifiableFeed to post them anyway (they may duplicate an earlier seed).' -ForegroundColor Yellow
            return 1
        }
        if ($unverifiable.Count -gt 0) { Write-SeedLine WARN "posting $($unverifiable.Count) post(s) the full feed window could not verify (-AcceptUnverifiableFeed)" }
        $replyProblems = @(Test-SeedReplyTimes -PostPlan $postPlan -Anchor $anchor.Anchor)
        if ($replyProblems.Count -gt 0) {
            foreach ($problem in $replyProblems) { Write-SeedLine FAIL $problem }
            Write-Host '  Nothing was written.' -ForegroundColor Red
            return 1
        }
        if ($Resume -and $postPlan.Done -eq 0 -and $postPlan.ToPost -gt 0 -and $null -eq $ScenarioAnchor) {
            Write-SeedLine INFO 'nothing from an earlier run is in the feed, so this is a fresh timeline anchored at now'
        }

        if (-not $manifest['startedAt']) { $manifest['startedAt'] = Format-SeedInstant ([DateTimeOffset]::UtcNow) }
        $manifest['staffUsername'] = $StaffUsername
        Save-SeedManifest -Manifest $manifest -Path $manifestPath

        # ── 5. Pause the engine first, so it does not react to the seeded posts ─────────────────────────────────
        $pause = $null
        if ($LeaveEngineRunning) { Write-Host "`n5. Engine: left as it is (-LeaveEngineRunning)" -ForegroundColor Cyan }
        else {
            Write-Host "`n5. Pause the engine before seeding" -ForegroundColor Cyan
            $pause = Set-EnginePauseTier -Context $context -ActingHumanId $actingHumanId -TimeZone $exercise.TimeZone
            if ($pause.Ok) { Write-SeedLine PASS "pause tier: $($pause.Detail)" } else { Write-SeedLine WARN "pause tier not set ($($pause.Detail)); the engine may react to the seeded posts" }
        }

        # ── 6. Upload media: posters first, then images, then videos with posterMediaId ────────────────────────
        Write-Host "`n6. Upload media" -ForegroundColor Cyan
        $assetIds = @{}
        foreach ($item in $uploadPlan) {
            $unit = $item.Unit
            if ($item.Action -eq 'reuse') { $assetIds[$unit.File] = $item.AssetId; Write-SeedLine SKIP "$($unit.File) — already uploaded ($($item.AssetId))"; continue }
            $form = [ordered]@{ file = (Get-Item -LiteralPath $unit.Path); kind = $unit.Kind }
            if ($null -ne $unit.Width) { $form['width'] = ([long] $unit.Width).ToString([Globalization.CultureInfo]::InvariantCulture) }
            if ($null -ne $unit.Height) { $form['height'] = ([long] $unit.Height).ToString([Globalization.CultureInfo]::InvariantCulture) }
            if ($unit.Kind -eq 'video' -and $null -ne $unit.DurationSec) { $form['durationSec'] = ([double] $unit.DurationSec).ToString('R', [Globalization.CultureInfo]::InvariantCulture) }
            if ($unit.Kind -eq 'video' -and $unit.PosterFile) { $form['posterMediaId'] = $assetIds[$unit.PosterFile] }
            $timeout = if ($unit.Kind -eq 'video') { 900 } else { 180 }
            try { $response = Invoke-PulseApi -Context $context -Method POST -Path '/api/media' -Form $form -TimeoutSec $timeout }
            catch { $response = [pscustomobject]@{ Status = 0; Json = $null; Text = "network error: $($_.Exception.Message)" } }
            if ($response.Status -ne 201 -or -not $response.Json['id']) {
                $why = switch ($response.Status) {
                    400 { "400 $(Get-ApiErrorText $response)" }
                    413 { '413: larger than the server accepts' }
                    415 { "415 $(Get-ApiErrorText $response)" }
                    429 { '429: still rate-limited after retries; wait a minute and run again with -Resume' }
                    503 { '503: the media store is unavailable' }
                    { $_ -in 401, 403 } { "$_ — this staff user may not upload in this exercise" }
                    default { "$_ $(Get-ApiErrorText $response)" }
                }
                Write-SeedLine FAIL "$($unit.File): $why"
                Write-Host '  Progress so far is in the manifest; fix the cause and run again (uploads already made are reused).' -ForegroundColor Yellow
                return 1
            }
            $assetId = [string] $response.Json['id']
            $assetIds[$unit.File] = $assetId
            $entry = [ordered]@{
                assetId = $assetId; sha256 = $unit.Sha256; kind = $unit.Kind; bytes = $unit.Bytes
                uploadedBy = $StaffUsername.ToLowerInvariant(); uploadedAt = Format-SeedInstant ([DateTimeOffset]::UtcNow)
            }
            if ($unit.Kind -eq 'video' -and $unit.PosterFile) {
                $entry['posterAssetId'] = $assetIds[$unit.PosterFile]
                $entry['posterSha256'] = ($units | Where-Object File -ceq $unit.PosterFile | Select-Object -First 1).Sha256
            }
            $manifest['files'][$unit.File] = $entry
            Update-SeedManifestMediaKeys -Manifest $manifest -Pack $pack
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
            Write-SeedLine PASS ("{0} — uploaded ({1}, {2}) -> {3}" -f $unit.File, $unit.Kind, (Format-Bytes $unit.Bytes), $assetId)
        }
        Update-SeedManifestMediaKeys -Manifest $manifest -Pack $pack
        Save-SeedManifest -Manifest $manifest -Path $manifestPath

        # ── 7. Persona profiles (JSON merge-patch, changed fields only) ──────────────────────────────────────────
        Write-Host "`n7. Edit persona profiles" -ForegroundColor Cyan
        foreach ($persona in @(Get-SeedList $pack 'personas')) {
            $handle = [string] $persona['handle']
            $current = $personaByHandle[$handle]
            $avatar = if ($persona['avatar'] -is [string]) { $assetIds[(Get-NormalizedPackFile $persona['avatar'])] } else { $null }
            $banner = if ($persona['banner'] -is [string]) { $assetIds[(Get-NormalizedPackFile $persona['banner'])] } else { $null }
            $applied = if ($manifest['personas'].Contains($handle)) { $manifest['personas'][$handle] } else { $null }
            $patch = Get-PersonaPatch -PackPersona $persona -Current $current -AvatarAssetId $avatar -BannerAssetId $banner -Applied $applied
            if ($patch.Count -eq 0) { Write-SeedLine SKIP "@$handle — unchanged"; continue }
            $response = Invoke-PulseApi -Context $context -Method PATCH -Path "/api/staff/personas/$($current['id'])" -Body $patch -ContentType 'application/merge-patch+json'
            if ($response.Status -ne 200) {
                $why = switch ($response.Status) {
                    400 { "400 $(Get-ApiErrorText $response)" }
                    404 { '404: the persona is not in this exercise' }
                    415 { '415: the server refused the merge-patch content type' }
                    { $_ -in 401, 403 } { "$_ — persona edits need a CONTROLLER assigned to this exercise" }
                    default { "$_ $(Get-ApiErrorText $response)" }
                }
                Write-SeedLine FAIL "@${handle}: $why"
                return 1
            }
            $personaByHandle[$handle] = $response.Json
            $manifest['personas'][$handle] = [ordered]@{
                personaId = [string] $current['id']; avatarAssetId = $avatar; bannerAssetId = $banner; patchedAt = Format-SeedInstant ([DateTimeOffset]::UtcNow)
            }
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
            Write-SeedLine PASS ("@{0} — {1}" -f $handle, (@($patch.Keys) -join ', '))
        }

        # ── 8. Posts, earliest first, as controller-as-persona ────────────────────────────────────────────────────
        Write-Host "`n8. Post the opening feed" -ForegroundColor Cyan
        $mediaIds = @{}; $mediaAlt = @{}
        foreach ($item in @(Get-SeedList $pack 'media')) {
            $mediaIds[$item['key']] = $assetIds[(Get-NormalizedPackFile $item['file'])]
            $mediaAlt[$item['key']] = Get-JsTrimmed $item['alt']
        }
        $postIds = @{}
        if ($postPlan.ToPost -gt 0) {
            $manifest['anchor'] = Format-SeedInstant $anchor.Anchor
            $manifest['completedAt'] = $null
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
        }
        foreach ($item in $postPlan.Items) {
            $post = $item.Post
            if ($item.Action -ne 'post') {
                $postIds[$item.Key] = $item.PostId
                if ($item.Action -eq 'adopt') {
                    $manifest['posts'][$item.Key] = [ordered]@{ postId = $item.PostId; scenarioTime = [string] $item.ScenarioTime; adoptedAt = Format-SeedInstant ([DateTimeOffset]::UtcNow) }
                    Save-SeedManifest -Manifest $manifest -Path $manifestPath
                }
                Write-SeedLine SKIP "$($item.Key) — $($item.Reason)"
                continue
            }
            $scenarioTime = Get-PostScenarioTime -Anchor $anchor.Anchor -MinutesBeforeAnchor $item.MinutesBeforeAnchor
            $parentId = if ($item.IsReply) { $postIds[[string] $post['replyTo']] } else { $null }
            $body = New-PostRequestBody -Post $post -AuthorPersonaId $personaIds[[string] $post['persona']] -ScenarioTime $scenarioTime -TimeZone $exercise.TimeZone `
                -MediaIds $mediaIds -MediaAlt $mediaAlt -ParentPostId $parentId
            try { $response = Invoke-PulseApi -Context $context -Method POST -Path '/api/posts' -Body $body }
            catch { $response = [pscustomobject]@{ Status = 0; Json = $null; Text = $_.Exception.Message } }
            if ($response.Status -ne 201 -or -not $response.Json['id']) {
                if ($response.Status -eq 400) { Write-SeedLine FAIL "$($item.Key) refused: $(Get-ApiErrorText $response)" }
                elseif ($response.Status -in 401, 403) { Write-SeedLine FAIL "$($item.Key): $($response.Status) — this staff user may not post as @$($post['persona'])" }
                else {
                    Write-SeedLine FAIL "$($item.Key): $($response.Status) $(Get-ApiErrorText $response)"
                    Write-Host '  The post may or may not have been written. Run again with -Resume: posts already in the feed are matched by persona, text and parent, so it is not duplicated.' -ForegroundColor Yellow
                }
                return 1
            }
            $postId = [string] $response.Json['id']
            $postIds[$item.Key] = $postId
            $manifest['posts'][$item.Key] = [ordered]@{ postId = $postId; scenarioTime = $scenarioTime; postedAt = Format-SeedInstant ([DateTimeOffset]::UtcNow) }
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
            $attachments = @(Get-SeedList $post 'media').Count
            $what = @()
            if ($attachments) { $what += "$attachments media" }
            if ($item.IsReply) { $what += "reply to $($post['replyTo'])" }
            Write-SeedLine PASS ("{0}  T-{1}m  @{2}{3} -> {4}" -f $item.Key, $item.MinutesBeforeAnchor, $post['persona'], $(if ($what) { " ($($what -join ', '))" }), $postId)
        }
        $manifest['completedAt'] = Format-SeedInstant ([DateTimeOffset]::UtcNow)
        Save-SeedManifest -Manifest $manifest -Path $manifestPath

        # ── 9. Run sheet: one inject item per pack item, through POST /api/injects (inject-queue 06) ───────────────
        Write-Host "`n9. Load the run sheet (the console's inject queue)" -ForegroundColor Cyan
        $injectIds = @{}            # run-sheet item key → inject item id
        $injectPostIds = @{}        # run-sheet item key → its post ids in sequence order (for replies from later items)
        $claimedItems = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $injectPlan.Items) { if ($entry.ItemId) { [void] $claimedItems.Add($entry.ItemId) } }
        if ($injectPlan.Items.Count -eq 0) { Write-SeedLine SKIP 'the pack has no run-sheet items' }
        if ($injectPlan.ToCreate -gt 0) {
            $manifest['completedAt'] = $null
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
        }
        foreach ($entry in $injectPlan.Items) {
            $item = $entry.Item
            if ($entry.Action -ne 'create') {
                $injectIds[$entry.Key] = $entry.ItemId
                $injectPostIds[$entry.Key] = @(Get-InjectChildIds -Row $entry.Row)
                if ($entry.Action -eq 'adopt') {
                    $manifest['injects'][$entry.Key] = [ordered]@{
                        itemId = $entry.ItemId; kind = $entry.Kind; title = $entry.Title; posts = $entry.PostCount; adoptedAt = Format-SeedInstant ([DateTimeOffset]::UtcNow)
                    }
                    Save-SeedManifest -Manifest $manifest -Path $manifestPath
                }
                Write-SeedLine SKIP "$($entry.Key) — $($entry.Reason) ($($entry.ItemId))"
                $stale = @(Get-InjectStaleReplies -PackItem $item -Row $entry.Row -PostIds $postIds)
                if ($stale.Count -gt 0) {
                    Write-SeedLine WARN ("{0} still replies to the earlier copy of {1} (archived and posted again since it was loaded), so it would fail at fire. Delete {0} in the console and run again to load it against the current post." -f
                        $entry.Key, ($stale -join ', '))
                }
                continue
            }
            $assigneeId = if ($item['assignee'] -is [string]) { [string] $assigneeIds[$item['assignee'].Trim()] } else { $null }
            $body = New-InjectRequestBody -Item $item -PersonaIds $personaIds -MediaIds $mediaIds -MediaAlt $mediaAlt -PostIds $postIds `
                -InjectPostIds $injectPostIds -AssigneeId $assigneeId
            $outcome = Add-InjectItem -Context $context -Body $body -PackItem $item -PersonaIds $personaIds -Claimed $claimedItems
            switch ($outcome.Outcome) {
                'refused' {
                    # The server's own reason, as it wrote it (a ProblemDetails "detail").
                    Write-SeedLine FAIL "$($entry.Key) refused (400): $($outcome.Detail)"
                    Write-Host '  Nothing was created for it. Fix the pack (or the exercise) and run again with -Resume: items already loaded are skipped.' -ForegroundColor Yellow
                    return 1
                }
                'failed' {
                    $why = switch ($outcome.Status) {
                        429 { '429: still rate-limited after retries; wait a minute and run again with -Resume' }
                        404 { '404: this API has no inject queue (deploy inject-queue 06 first)' }
                        { $_ -in 401, 403 } { "$_ — loading the run sheet needs a CONTROLLER assigned to this exercise" }
                        default { "$_ $($outcome.Detail)" }
                    }
                    Write-SeedLine FAIL "$($entry.Key): $why"
                    return 1
                }
                'uncertain' {
                    Write-SeedLine FAIL "$($entry.Key): $($outcome.Detail)."
                    Write-Host '  It may or may not have been created, so it was NOT sent again (that could duplicate it). Run again with -Resume:' -ForegroundColor Yellow
                    Write-Host '  the run sheet is re-read first, and an item with the same kind, title and posts is adopted instead of created.' -ForegroundColor Yellow
                    return 1
                }
            }
            $itemId = [string] $outcome.Item['id']
            [void] $claimedItems.Add($itemId)
            $injectIds[$entry.Key] = $itemId
            $injectPostIds[$entry.Key] = @(Get-InjectChildIds -Row $outcome.Item)
            $stamp = if ($outcome.Outcome -eq 'adopted') { 'adoptedAt' } else { 'createdAt' }
            $manifest['injects'][$entry.Key] = [ordered]@{
                itemId = $itemId; kind = $entry.Kind; title = $entry.Title; posts = $entry.PostCount; $stamp = Format-SeedInstant ([DateTimeOffset]::UtcNow)
            }
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
            $assigned = if ($assigneeId) { ", assigned to $($item['assignee'].Trim())" } else { '' }
            $summary = "{0}  {1}  ""{2}"" ({3} post{4}{5})" -f $entry.Key, $entry.Kind, $entry.Title, $entry.PostCount, $(if ($entry.PostCount -eq 1) { '' } else { 's' }), $assigned
            if ($outcome.Outcome -eq 'adopted') {
                Write-SeedLine WARN "$summary — $($outcome.Detail); the matching item was found in the run sheet and adopted, not sent again -> $itemId"
            }
            else { Write-SeedLine PASS "$summary -> $itemId" }
        }
        if ($injectPlan.ToCreate -gt 0) {
            $manifest['completedAt'] = Format-SeedInstant ([DateTimeOffset]::UtcNow)
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
        }

        # ── 10. Engine paused after seeding (Decision 4) ──────────────────────────────────────────────────────────
        if (-not $LeaveEngineRunning) {
            Write-Host "`n10. Pause the engine (pause tier engine)" -ForegroundColor Cyan
            $pause = Set-EnginePauseTier -Context $context -ActingHumanId $actingHumanId -TimeZone $exercise.TimeZone
            if ($pause.Ok) { Write-SeedLine PASS "pause tier $($pause.Detail) (it resets to 'running' on any reset or restart)" }
            else { Write-SeedLine FAIL "pause tier: $($pause.Detail)" }
        }

        # ── 11. Self-check ────────────────────────────────────────────────────────────────────────────────────────
        Write-Host "`n11. Self-check" -ForegroundColor Cyan
        $checks = [System.Collections.Generic.List[object]]::new()
        $check = { param([bool] $Ok, [string] $Text) $checks.Add([pscustomobject]@{ Ok = $Ok; Text = $Text }) }

        $topLevelIds = @($postPlan.Items | Where-Object { -not $_.IsReply } | ForEach-Object { $postIds[$_.Key] })
        $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/feed'
        if ($response.Status -ne 200) { & $check $false "GET /api/feed -> $($response.Status)" }
        else {
            $top = @($response.Json)
            & $check ($top.Count -ge $topLevel) "the feed shows $($top.Count) top-level post(s); $topLevel seeded"
            $visible = @{}
            foreach ($row in $top) { $visible[[string] $row['id']] = $true }
            $missing = @($topLevelIds | Where-Object { -not $visible.Contains($_) })
            & $check ($missing.Count -eq 0) $(if ($missing.Count) { "$($missing.Count) seeded top-level post(s) not in the feed: $($missing -join ', ')" } else { "every seeded top-level post is in the feed" })
        }

        $probes = [System.Collections.Generic.List[object]]::new()
        $addProbe = {
            param([string] $Label, [string] $Url)
            if ([string]::IsNullOrEmpty($Url)) { return }
            $absolute = if ([Uri]::IsWellFormedUriString($Url, [UriKind]::Absolute)) { $Url } else { [Uri]::new([Uri] $baseUrl, $Url).AbsoluteUri }
            if (-not @($probes | Where-Object Url -ceq $absolute)) { $probes.Add([pscustomobject]@{ Label = $Label; Url = $absolute }) }
        }
        $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/feed?includeReplies=true'
        if ($response.Status -ne 200) { & $check $false "GET /api/feed?includeReplies=true -> $($response.Status)" }
        else {
            $byId = @{}
            foreach ($row in @($response.Json)) { $byId[[string] $row['id']] = $row }
            $mediaShort = [System.Collections.Generic.List[string]]::new()
            foreach ($item in $postPlan.Items) {
                $expected = @(Get-SeedList $item.Post 'media').Count
                $row = $byId[[string] $postIds[$item.Key]]
                if (-not $row) { if ($expected) { $mediaShort.Add("$($item.Key) (not in the feed)") }; continue }
                $media = @(Get-SeedList $row 'media')
                if ($media.Count -ne $expected) { $mediaShort.Add("$($item.Key) ($($media.Count)/$expected)") }
                for ($k = 0; $k -lt $media.Count; $k++) {
                    & $addProbe "$($item.Key) media[$k]" ([string] $media[$k]['url'])
                    & $addProbe "$($item.Key) media[$k] poster" ([string] $media[$k]['posterUrl'])
                }
            }
            $withMedia = @($postPlan.Items | Where-Object { @(Get-SeedList $_.Post 'media').Count -gt 0 }).Count
            & $check ($mediaShort.Count -eq 0) $(if ($mediaShort.Count) { "seeded posts missing media: $($mediaShort -join ', ')" } else { "all $withMedia seeded post(s) with media show their attachments" })
        }
        $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/personas'
        if ($response.Status -eq 200) {
            $rows = @{}
            foreach ($row in @($response.Json)) { $rows[([string] $row['handle']).TrimStart('@')] = $row }
            foreach ($persona in @(Get-SeedList $pack 'personas')) {
                $row = $rows[[string] $persona['handle']]
                foreach ($image in @(@('avatar', 'avatarUrl'), @('banner', 'bannerUrl'))) {
                    if ($persona[$image[0]] -isnot [string]) { continue }
                    if (-not $row -or -not $row[$image[1]]) { & $check $false "@$($persona['handle']) shows no $($image[0])"; continue }
                    & $addProbe "@$($persona['handle']) $($image[0])" ([string] $row[$image[1]])
                }
            }
        }
        else { & $check $false "GET /api/personas -> $($response.Status)" }

        if ($injectPlan.Items.Count -gt 0) {
            $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/injects'
            if ($response.Status -ne 200 -or $response.Json -isnot [System.Collections.IDictionary]) { & $check $false "GET /api/injects -> $($response.Status)" }
            else {
                $queueById = @{}
                foreach ($row in @(Get-SeedList $response.Json 'items')) { $queueById[[string] $row['id']] = $row }
                $sheetShort = [System.Collections.Generic.List[string]]::new()
                foreach ($entry in $injectPlan.Items) {
                    $id = [string] $injectIds[$entry.Key]
                    $row = if ($id) { $queueById[$id] } else { $null }
                    if (-not $row) { $sheetShort.Add("$($entry.Key) (not in the run sheet)"); continue }
                    $have = @(Get-SeedList $row 'posts').Count
                    if ($have -ne $entry.PostCount) { $sheetShort.Add("$($entry.Key) ($have/$($entry.PostCount) posts)") }
                }
                & $check ($sheetShort.Count -eq 0) $(if ($sheetShort.Count) { "run-sheet items missing or changed: $($sheetShort -join ', ')" } else { "all $($injectPlan.Items.Count) run-sheet item(s) are in the console's queue with their posts" })
            }
        }

        $failedProbes = @(foreach ($probe in $probes) {
                $status = Invoke-MediaRangeRequest -Url $probe.Url
                if ($status -ne 206) { "$($probe.Label) -> $(if ($status) { $status } else { 'no response' })" }
            })
        & $check ($failedProbes.Count -eq 0) $(if ($failedProbes.Count) { "media URL(s) not answering 206 to Range bytes=0-1: $($failedProbes -join '; ')" } else { "all $($probes.Count) media URL(s) answered 206 to Range: bytes=0-1" })

        if ($LeaveEngineRunning) { $checks.Add([pscustomobject]@{ Ok = $true; Text = 'engine left as it was (-LeaveEngineRunning)'; Neutral = $true }) }
        else { & $check ([bool] $pause.Ok) "engine pause tier: $($pause.Detail)" }

        Write-Host ''
        foreach ($row in $checks) {
            $mark = if ($row.PSObject.Properties['Neutral']) { '➖' } elseif ($row.Ok) { '✅' } else { '❌' }
            Write-Host "  $mark $($row.Text)" -ForegroundColor $(if ($row.Ok) { 'Green' } else { 'Red' })
        }
        $failed = @($checks | Where-Object { -not $_.Ok }).Count
        Write-Host ''
        if ($failed -eq 0) {
            Write-Host "SEEDED — every check passed. Manifest: $manifestPath" -ForegroundColor Green
            if ($SiteUrl) { Write-Host "  Participant: $SiteUrl/login     Controller: $SiteUrl/staff/login (the scripted posts are in the run-sheet panel)" }
            return 0
        }
        Write-Host "NOT READY — $failed check(s) failed. Manifest: $manifestPath" -ForegroundColor Red
        return 1
    }
    catch {
        # Invoke-PulseApi already threw a clean error (method, path, reason; never a header or a body).
        Write-SeedLine FAIL $_.Exception.Message
        if ($manifestPath) { Write-Host "  Progress so far is in the manifest ($manifestPath); fix the cause and run again (-Resume if posts were made)." -ForegroundColor Yellow }
        return 1
    }
    finally {
        $context.Token = $null
    }
}

# Dot-sourcing (the Pester tests) loads the functions above and stops here.
if ($MyInvocation.InvocationName -eq '.') { return }

$seedArguments = @{
    PackPath           = $PackPath
    ApiHost            = $ApiHost
    SiteUrl            = $SiteUrl
    StaffUsername      = $StaffUsername
    WhatIf             = $WhatIf
    Resume             = $Resume
    LeaveEngineRunning = $LeaveEngineRunning
    AcceptUnverifiableFeed = $AcceptUnverifiableFeed
    ManifestDirectory  = $ManifestDirectory
}
if ($PSBoundParameters.ContainsKey('ScenarioAnchor')) { $seedArguments['ScenarioAnchor'] = $ScenarioAnchor }
$exitCode = Invoke-DemoSeed @seedArguments | Select-Object -Last 1
exit ([int] $exitCode)
