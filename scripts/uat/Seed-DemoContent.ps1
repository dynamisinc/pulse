#Requires -Version 7.0

<#
.SYNOPSIS
    Loads the demo's opening content into Pulse UAT through the public product APIs: media, persona profiles,
    backdated posts, replies and engagement baselines. It also loads the run sheet: the pack's scripted posts
    become inject items in the console's server-side queue. And it sets the exercise up for the demo: posts
    pinned for everyone, the white-noise pool loaded with white noise left off, and media marking on.

.DESCRIPTION
    Reads a pulse.demopack.v1 pack (docs/demo/pack/pack.json, implementation.md section 1.10) and:

      1. Validates the WHOLE pack before any request. Keys are unique and every reference resolves. Replies
         come after their parents. Text is at most 280 characters, with no markup (the server strips tags).
         Every media item has alt text. Every file exists inside the pack folder (symbolic links resolved), is a
         type the server accepts (judged by its first bytes, as the server does) and is within the server's
         size limits. The run-sheet items (runSheet.items) are checked against the inject queue's own rules
         (InjectItemValidator): kind, title, notes, planned minute, post counts, the burst window, text, media,
         alt, replies and baselines. The white-noise entries (noise) follow the post-text rules, each pin (pins)
         names a pack post, and an msel ref sits on a post item only and is unique. With -RunSheet exceptMsel, no
         item the run loads may reply to an msel item: the on-stage MSEL import creates that one later, so the
         reply would have no parent (the message names both items). If anything fails, every problem is listed,
         nothing is sent and the script exits 1.
      2. Reads GET /api/exercise-context (anonymous): the host's exerciseId and the timeZone every post needs.
      3. With -WhatIf it stops here. It prints the plan (counts per step, each run-sheet item it would create
         with its kind, title and post count, and each one -RunSheet leaves out) and exits 0: no sign-in, no
         writes.
      4. Signs in as a staff controller: POST /api/auth/staff/login with {username, secret, exerciseId}.
      5. Checks every handle the pack names (posts, run-sheet posts and noise entries) against GET /api/personas,
         and the assignee of every run-sheet item this run loads against GET /api/injects/assignees ("me", or a
         staff display name, ignoring case). An unknown handle or assignee stops the run before any write, and
         the known ones are listed. It also reads the current run sheet (GET /api/injects), unless -RunSheet
         loads no item.
      6. Pauses the engine (pause tier "engine") so it does not react to the seeded posts. It reads the tier
         first and never loosens a stricter one: a frozen world stays frozen. Skip this with -LeaveEngineRunning.
         Then, on every run, it turns white noise OFF (PUT /api/staff/noise { level: off }), so no noise post
         lands among the seeded ones, and makes sure media marking is ON before any media is posted (DF-3): it
         reads GET /api/staff/chrome-settings and, only when watermarkEnabled is false, sends PUT
         /api/staff/chrome-settings with that one field changed and every other field exactly as read (the PUT
         is a full replace and carries no version or ETag).
      7. Uploads each media file once (POST /api/media): poster images first, then each video with its
         posterMediaId. A 201 is recorded in the manifest at once. On a 429 it waits the Retry-After and
         retries. A 400 stops the run and prints the server's reason. An upload is not idempotent either, so
         after an uncertain outcome (no response, 408, a 5xx or an unreadable 2xx; a 503 can come after the
         file was stored) it never simply sends it again: it re-reads GET /api/staff/media and adopts the asset
         that upload stored, or stops and says so (wait about a minute and run the same command again). That
         asset is the library row with the file's kind, name, size hints and poster that was not in the library
         when the uploading run first read it and that the manifest does not claim, and whose bytes (and its
         poster's), fetched from its signed URL, have the file's SHA-256. The manifest marks a file "pending"
         before its upload is sent. A run that stopped on an uncertain upload, or was interrupted during one,
         leaves the mark, and the next run looks for that upload the same way before it sends the file again
         (when the file's bytes, and a video's poster's bytes, are still the ones it sent). A pending video keeps
         its poster even though the library no longer lists it: the library hides an image once a video uses
         it as its poster. Every such look-up runs before anything is sent. So a video found there keeps the
         poster it carries, and no new copy of that poster is uploaded, even on a run by another staff user.
         Each look-up download has one deadline, body included. The library returns at most
         its newest 200 rows of a kind. "Not there" counts only when those rows reach back to before the
         upload; otherwise the script cannot tell, and it stops.
      8. Edits persona profiles: PATCH /api/staff/personas/{id} as a JSON merge-patch, covering display name,
         bio, location, verified, avatar and banner. Only the fields that differ are sent.
      9. Posts the opening feed as controller-as-persona (POST /api/posts) in scenario-time order, with
         scenarioTime = anchor - minutesBeforeAnchor. Replies go after their parents. Engagement baselines
         are included.
     10. Pins each post the pack lists in pins for everyone (PUT /api/staff/posts/{id}/pin, DF-7), its id
         resolved from the post key as step 9 resolved it. The last listed is pinned first: the Pinned tab shows
         the newest pin first (DF-5), so it reads in pack order while the exercise clock runs. With the clock
         stopped, the server stamps a pin with the later of the exercise's stored scenario time and the post's
         own (PinService), so the tab may follow the posts' own times, or its id tie-break. A post already
         pinned stays as it was (the server answers 204 and changes nothing). A refused pin (a 404: the post is
         gone or taken down) is reported, and the self-check fails on it.
     11. Loads the run sheet: one POST /api/injects per run-sheet item, in pack order (each lands at the end
         of the console's queue, pending; nothing is fired). Which items it loads follows -RunSheet: all, or
         exceptMsel (every item WITHOUT an msel ref; the on-stage MSEL import adds the others, DF-16), or none.
         An item left out is never created, adopted, re-pointed or self-checked, and its manifest entry stays as
         it is, so the import's items are never touched. A copy of it that an earlier run of this script recorded
         and the console could still fire is warned about: a seeded copy carries no Inject #, so the import would
         add a second one (the queue does not show Inject #, so it may also be an item the import made itself).
         So is an msel item that replies to a post: an MSEL row cannot carry the reply, so the import creates it
         top-level. And so is a loaded item without a plannedMinute while msel items are left out: the import
         slots each item it creates in by planned minute (DF-22), and cannot place around one without it.
         Handles become persona ids, media keys become
         the uploaded asset ids, a reply to a seeded post becomes { postId }, a reply to an earlier post of
         the same item stays { sequence }, and a reply to a post of an earlier item becomes { injectPostId }.
         A 201 is recorded in the manifest at once. On a 429 it waits the Retry-After and retries. A 400
         stops the run and prints the server's reason as it is. A create is not idempotent, so after an
         uncertain outcome (no response, 408, a 5xx or an unreadable 2xx) it never simply sends it again:
         it re-reads GET /api/injects and adopts an armable item with the same kind, title and posts, or
         stops and says so (wait about a minute and run the same command again; no -Resume needed).
         A KEPT item (loaded by an earlier run, still armable) whose reply target is DEAD is re-pointed IN
         PLACE with PUT /api/injects/{id}. A target is dead when it is a post this machine seeded that is no
         longer live (on the Tue 10/20 re-seed, Clear-DemoContent.ps1 archives the posts and step 9 posts them
         again under new ids), or a post of a superseded or deleted item (a reloaded item's old copy). A reply
         a controller re-targeted in the console to another LIVE post is left alone and only warned about. The
         PUT sends the QUEUE's own copy (a controller's console edits stay), echoes every child by its id,
         changes only the dead replyTo, and carries the version GET /api/injects showed. The item keeps its id,
         its children and its place in the queue. A 409 or no answer re-reads the queue and retries once with
         the fresh version; after a failed retry the queue is read once more, in case a slow PUT landed. If it
         still points at the dead target, that is a warning naming the item, and the self-check's reply line
         fails. Spent items are never edited (-ReloadFiredRunSheet's fresh copies already point at the new ids).
     12. Loads the white-noise pool (DF-12): PUT /api/staff/noise/pool with the pack's noise entries, handles as
         persona ids. The first 1,000 go with mode "replace", so they become the whole pool; any more follow
         with mode "append" (1,000 per call, the server's limit). Each entry the server rejects is a warning with
         its index in noise and the server's reason; the rest still load. A refused call stops the loading and
         the self-check fails on it. A pack without noise leaves the server's pool as it is.
     13. Checks the pause tier again (same rule) and reports what it found or set. The tier lives in
         memory, and every reset or restart sets it back to "running". After any reset, run this script
         again or pause from the console. Then it turns white noise OFF again, on every run (with
         -LeaveEngineRunning too), so a seed never leaves noise running.
     14. Self-check. GET /api/feed must show at least the seeded top-level posts. Every media URL (post
         media, posters, avatars, banners) must answer a ranged GET (Range: bytes=0-1) with 206. Every
         run-sheet item must be in GET /api/injects with the pack's post count, and armable: pending, or
         held before its release (see AFTER A REHEARSAL). Every reply of an armable item must point at a live
         post: not an earlier copy of its target, not an archived post, not a post of a superseded, spent or
         deleted item. A post outside a full 200-post feed window cannot be confirmed, and the line says how
         many it did not check. The armable items it loaded must be in pack order in the console's queue,
         because "Fire next" follows that order. (With exceptMsel the on-stage import then slots its items in by
         planned minute, DF-22, so the queue reads in pack order again when every seeded item has a
         plannedMinute.) Every pin must have been accepted and show pinnedForAll in the feed, the white-noise
         pool must have loaded, white noise must be off and media marking on. It prints a ✅/❌ summary and
         exits 1 if any check failed. However a run ends after step 6 began (an early stop, an error), it
         turns white noise off once more on the way out unless step 13 already confirmed it off.

    RE-RUNNING IS SAFE. A manifest records what has been seeded, at
    %LOCALAPPDATA%\Pulse\demo-seed\<exerciseId>.json on Windows or $HOME/.local/share/Pulse/demo-seed on
    Linux and macOS. It maps pack files and media keys to asset ids, with each file's SHA-256, post keys
    to post ids, and run-sheet item keys to inject item ids. It holds no secret.
      - A re-run uploads nothing whose bytes are unchanged and posts nothing already in the feed.
      - An upload whose outcome was uncertain is never simply sent again, in that run or the next. The media
        library is checked for the asset it stored (see step 7), and that asset is adopted. If it is not there
        yet, the run stops; the next run checks again and uploads the file only if it is still not there. So a
        lost answer does not leave a second, unused copy of the file in the library.
      - Before posting, the feed is also matched by persona, text and parent. A lost manifest therefore does
        not duplicate posts either.
      - Posts archived since the last run (for example by Clear-DemoContent.ps1) are posted again, on a fresh
        timeline anchored at now.
      - The feed only returns its 200 newest posts. When it is full and this machine's manifest does not know a
        post, an earlier copy could be hidden beyond the window, so the run stops before writing anything
        unless -AcceptUnverifiableFeed is passed. Run from the machine that holds the manifest instead.
      - A run-sheet item whose id is still in the queue is skipped. One that was deleted in the console is
        created again. An item the manifest does not know is first matched against the queue by kind, title
        and posts (persona and text), so a lost manifest does not duplicate the run sheet either. Only an
        ARMABLE item is ever adopted: pending, or held with nothing out yet.
      - An item -RunSheet leaves out is not drift and not missing: it is not planned, compared or checked at
        all, and switching -RunSheet between runs never deletes anything.
      - The white-noise pool is REPLACED, not added to, so a re-run leaves the same pool (its rotation starts
        over). Pinning a post that is already pinned changes nothing. Media marking is written only when off.

    AFTER A REHEARSAL. Firing a run-sheet item in a rehearsal spends it: the console cannot fire it again, the
    server refuses to delete a fired item, and the reset scripts never touch an item this script seeded
    (Reset-DemoState.ps1 leaves the inject queue alone; Clear-DemoContent.ps1 archives only the items an MSEL
    import created, the ones with an Inject #, so a rehearsal's fired imports do not block the show's import).
    So every run checks each loaded item's status. The plan lists any item that is fired,
    firing, skipped, failed or held part-way, and the self-check FAILS on it. Re-arm the run sheet with
    -ReloadFiredRunSheet: each spent item gets a fresh copy (POST /api/injects, with the same uncertain-create
    rules), the manifest records the new id and keeps the old one as superseded (never adopted again), and the
    old item is never touched (no fire, delete or reorder). An item still firing is refused, and nothing is
    written: wait for the burst to finish, or Hold it in the console, then run again. The old items stay in
    the console; its run-sheet filter "Open" hides fired and skipped ones, and failed or skipped ones (and a
    burst held part-way) can be deleted there (fired ones cannot).

    ORDER. A created item (new, re-created or reloaded) lands at the END of the console's queue, and the
    script never reorders. After a PARTIAL rehearsal (some items fired, the rest still pending), a reload would
    put the fresh copies behind the untouched later items, and "Fire next" would go out of order. The plan
    warns about this, and the self-check fails on it. First Skip the remaining items in the console, then run
    with -ReloadFiredRunSheet: everything reloads, in pack order. Or drag the items into order in the console.
    The on-stage MSEL import is the one writer that does not append: it places each item it creates just before
    the first pending item with a later planned minute (DF-22, story 16). So give every seeded item a
    plannedMinute; the plan warns when an exceptMsel run loads one without it.

    -Resume continues a partial run on its ORIGINAL scenario anchor. Without it, the script refuses to add
    posts next to ones already seeded, because their times would not line up. It says so and writes nothing.
    -ScenarioAnchor cannot move a partial run either, and a reply is never posted earlier than its parent.

    PUBLIC APIs ONLY. There are no ops endpoints and no direct database access: nothing the product's own
    console could not do. The script also refuses, at runtime, any API path outside its allowlist. On a
    run-sheet item it only ever sends PUT (the re-point above): never fire, hold, delete or reorder.

    DEMO WEEK. The participant app's scenario "now" is the browser's wall clock, and Trending counts the last
    12 hours, so the demo feed is seeded fresh on the morning: Clear-DemoContent.ps1, Reset-DemoState.ps1, then
    this script (README-seed.md has the run-of-show). Never leave the world FROZEN overnight: a frozen server
    clock falls behind, so the next day's run-sheet fires and engine posts would be stamped in the past and
    never trend. Recover with Reset-DemoState.ps1 -Restart, wait ~8 minutes, Reset-DemoState.ps1, then this
    script. This script warns when it finds the world frozen.

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
    Continue a partial run (or add posts to an earlier one) on the earlier run's scenario anchor. A run that
    stopped while loading the run sheet needs no -Resume (the posts are all in by then): run the same command
    again, and items already in the queue are skipped or adopted, never created twice.

.PARAMETER ReloadFiredRunSheet
    After a rehearsal that fired the run sheet: load a fresh copy of every loaded run-sheet item that is fired,
    skipped, failed or held part-way, so the console has it to fire again. The old items stay as they are. An
    item that is still firing stops the run before any write.

.PARAMETER RunSheet
    Which run-sheet items this run loads (Test-RunSheetItemLoaded is the one place this is decided):
      all         every item (the default).
      exceptMsel  every item WITHOUT an msel ref: the demo setting (DF-16). The on-stage Cadence MSEL import
                  adds the items with one, so the import does not duplicate them. A burst, and any single post a
                  seeded item replies to, cannot travel through an MSEL, so those are seeded.
      none        no item; the console's queue is not even read.
    An item left out is never created, adopted, re-pointed or self-checked. With exceptMsel, a loaded item that
    replies to an msel item stops the run at validation (its parent would not exist yet).

.PARAMETER LeaveEngineRunning
    Do not touch the pause tier (the engine stays as it is, normally "running"). It is still read once, to
    warn about a world left frozen. White noise is still turned off.

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
    pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -RunSheet exceptMsel

    The demo seed (DF-16): everything except the run-sheet items with an msel ref, which the on-stage MSEL
    import adds.

.EXAMPLE
    pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -Resume

.EXAMPLE
    pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -ReloadFiredRunSheet

    After a rehearsal that fired the run sheet: fresh copies of the spent items, so the console can fire them.

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
    [switch] $ReloadFiredRunSheet,
    [ValidateSet('all', 'exceptMsel', 'none')] [string] $RunSheet = 'all',
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
#   msel     Features/Injects/Import/MselImportPlanner.cs (an Inject # is at most 64: InjectItem.ExternalRef)
#   noise    Features/WhiteNoise/WhiteNoiseService.cs (1,000 entries per pool call; text 1 to 280 code points)
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-SeedLimits {
    @{
        ImageMaxBytes = 5MB; VideoMaxBytes = 100MB; MaxDimension = 16384; MaxDurationSec = 3600
        TextMax = 280; AltMax = 1000; MaxMediaPerPost = 4; BaselineMax = 1000000; KeyMax = 64
        DisplayNameMax = 100; BioMax = 512; LocationMax = 100; HandleMax = 50
        InjectTitleMax = 120; InjectNotesMax = 500; PlannedMinuteMax = [int]::MaxValue
        BurstMinPosts = 2; BurstMaxPosts = 20; BurstWindowMin = 30; BurstWindowMax = 600; BurstWindowDefault = 90
        BurstMinGapSeconds = 3; MselMax = 64
        # NoiseMax is the pack's cap (pack.schema.json maxItems); NoisePoolChunk the server's per-call limit.
        NoiseMax = 1000; NoisePoolChunk = 1000
        FeedTake = 200; LibraryTake = 200
    }
}

function Get-SeedApiAllowlist {
    # The ONLY API paths this script may call: story S1 "Public APIs only" (demo-polish 24), plus the routes the
    # demo-feedback S1 story (#510) names. Seed-DemoContent.Tests.ps1 greps this file for any other API path, and
    # Invoke-PulseApi refuses one at runtime.
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
        '/api/injects/{id}'
        '/api/staff/noise/pool'
        '/api/staff/noise'
        '/api/staff/posts/{id}/pin'
        '/api/staff/chrome-settings'
    )
}

function Test-SeedApiPath {
    <#
    .SYNOPSIS
        True when the path is on the allowlist. An item route, /api/injects/{id}, is allowed for PUT only (re-pointing
        a kept item's stale reply in place): never fire, hold, delete or reorder. A post's pin route,
        /api/staff/posts/{id}/pin, is allowed for PUT only too: the seed pins, never unpins. Pass the method to allow
        either.
    #>
    param([Parameter(Mandatory)] [string] $Path, [string] $Method)
    $bare = ($Path -split '\?', 2)[0]
    $guid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    if ($bare -cmatch "^/api/staff/personas/$guid`$") { return $true }
    if ($bare -cmatch "^/api/injects/$guid`$") { return $Method -ceq 'PUT' }
    if ($bare -cmatch ('^' + ('/api/staff/posts/{id}/pin' -replace '\{id\}', $guid) + '$')) { return $Method -ceq 'PUT' }
    # The {id} entries are placeholders for the patterns above, never paths: a literal "{id}" matches nothing.
    return @(Get-SeedApiAllowlist | Where-Object { $_ -notmatch '[{}]' }) -ccontains $bare
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
        # Blank to EITHER trim: JavaScript's (U+FEFF) or .NET's, which the server uses (U+0085). Gate-1 S1b L-3.
        if ((Get-JsonKind $Value) -ne 'string' -or (Test-JsBlank $Value) -or $Value.Trim().Length -eq 0) {
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
    & $checkKeys $Pack @('$schema', 'schema', 'county', 'personas', 'media', 'posts', 'runSheet', 'noise', 'pins') 'pack'
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
        # The import matches an Inject # ignoring case, after trimming (MselImportPlanner, InjectQueueService.Import).
        $seenMsel = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $itemEdges = @{}                                                    # item index → item indexes its posts reply to
        $forward = [System.Collections.Generic.List[object]]::new()        # replies naming a LATER item
        $replyForms = 'must be exactly one of { "postKey": "<pack post key>" }, { "sequence": <n> } (an earlier post of this item) or { "item": "<run-sheet item key>", "sequence": <n> }.'

        for ($j = 0; $j -lt $items.Count; $j++) {
            $item = $items[$j]; $where = "runSheet.items[$j]"
            if ((Get-JsonKind $item) -ne 'object') { & $add 'type' $where 'must be an object.'; continue }
            & $checkKeys $item @('key', 'kind', 'msel', 'title', 'notes', 'plannedMinute', 'assignee', 'burstWindowSeconds', 'posts') $where
            $key = $item['key']
            if ((Get-JsonKind $key) -ne 'string' -or $key -cnotmatch $keyPattern) { & $add 'key-format' "$where.key" "must be 1 to $($Limits.KeyMax) letters, digits, '_' or '-'." }
            elseif (-not $seenItemKeys.Add($key)) { & $add 'duplicate-key' "$where.key" "'$key' is already used by another run-sheet item (keys are compared ignoring case)." }

            $kind = $item['kind']
            if (@('post', 'burst') -cnotcontains $kind) { & $add 'inject-kind' "$where.kind" 'must be "post" (one post) or "burst" (2 to 20 posts released across a window).'; $kind = $null }

            # msel: the MSEL Inject # the on-stage import creates this item from (DF-16). -RunSheet decides who loads it.
            if ($item.Contains('msel')) {
                $msel = $item['msel']
                if ($kind -ceq 'burst') { & $add 'inject-msel-kind' "$where.msel" 'applies to a "post" item only: the MSEL import creates one single-post item per row (DF-9), never a burst.' }
                if ((Get-JsonKind $msel) -ne 'string' -or $msel.Trim().Length -eq 0 -or (Get-CodePointCount $msel) -gt $Limits.MselMax) {
                    & $add 'inject-msel' "$where.msel" "must be the MSEL Inject # the on-stage import creates this item from: 1 to $($Limits.MselMax) characters, not blank."
                }
                elseif (Find-SeedMarkup $msel) { & $add 'markup' "$where.msel" "msel $(& $markupMessage (Find-SeedMarkup $msel))" }
                elseif (-not $seenMsel.Add($msel.Trim())) { & $add 'duplicate-msel' "$where.msel" "'$msel' is already the msel of another item; the import matches an Inject # ignoring case, so each is unique." }
            }

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

    # ── noise (optional): the white-noise pool for PUT /api/staff/noise/pool (DF-12) ─────────────────────────────
    # The server's rules (WhiteNoiseService): a persona of the exercise (checked after sign-in, like every handle) and
    # text of 1 to 280 code points once sanitised and trimmed. The pack refuses markup, so trimming is the whole story.
    if ($Pack.Contains('noise')) {
        $noise = $Pack['noise']
        if ((Get-JsonKind $noise) -ne 'array') { & $add 'type' 'pack.noise' 'must be a list of { "persona": "<handle>", "text": "..." } (use [] for none).' }
        else {
            if ($noise.Count -gt $Limits.NoiseMax) { & $add 'noise-count' 'pack.noise' "has $($noise.Count) entries; a pack carries at most $($Limits.NoiseMax)." }
            for ($i = 0; $i -lt $noise.Count; $i++) {
                $entry = $noise[$i]; $where = "noise[$i]"
                if ((Get-JsonKind $entry) -ne 'object') { & $add 'type' $where 'must be an object like { "persona": "<handle>", "text": "..." }.'; continue }
                & $checkKeys $entry @('persona', 'text') $where
                [void] (& $checkHandle $entry['persona'] "$where.persona" 'handle-format')
                $text = $entry['text']
                if ((Get-JsonKind $text) -ne 'string' -or $text.Trim().Length -eq 0) { & $add 'noise-text' "$where.text" 'is required: 1 to 280 characters of text.' }
                elseif ((Get-CodePointCount $text.Trim()) -gt $Limits.TextMax) { & $add 'noise-text' "$where.text" "is $(Get-CodePointCount $text.Trim()) characters; the limit is $($Limits.TextMax)." }
                elseif (Find-SeedMarkup $text) { & $add 'markup' "$where.text" "text $(& $markupMessage (Find-SeedMarkup $text))" }
            }
        }
    }

    # ── pins (optional): pack posts a controller pins for everyone (PUT /api/staff/posts/{id}/pin, DF-7) ──────────
    if ($Pack.Contains('pins')) {
        $pins = $Pack['pins']
        if ((Get-JsonKind $pins) -ne 'array') { & $add 'type' 'pack.pins' 'must be a list of post keys (use [] for none).' }
        else {
            $seenPins = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            for ($i = 0; $i -lt $pins.Count; $i++) {
                $pin = $pins[$i]
                if ((Get-JsonKind $pin) -ne 'string' -or -not $postIndex.Contains($pin)) { & $add 'pin-ref' "pins[$i]" "names no post key in this pack: '$pin'." }
                elseif (-not $seenPins.Add($pin)) { & $add 'duplicate-pin' "pins[$i]" "'$pin' is listed twice." }
            }
        }
    }

    return $errors.ToArray()
}

function Test-RunSheetItemLoaded {
    <#
    .SYNOPSIS
        Whether this run loads a run-sheet item, by -RunSheet. The ONE place the selection lives: validation
        (Test-RunSheetSelection), the plan, the load, the self-check and the summaries all follow it.
          all         every item.
          exceptMsel  every item without an msel ref: the on-stage MSEL import creates those (DF-16).
          none        no item.
    #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Item, [Parameter(Mandatory)] [string] $RunSheet)
    switch ($RunSheet) {
        'all' { return $true }
        'exceptMsel' { return [string]::IsNullOrEmpty([string] $Item['msel']) }
        'none' { return $false }
    }
    throw "Unknown -RunSheet '$RunSheet' (all, exceptMsel or none)."
}

function Test-RunSheetSelection {
    <#
    .SYNOPSIS
        The rule that depends on -RunSheet, for a pack Test-DemoPack accepted: an item this run loads may not reply to
        a post of an item it leaves out (with exceptMsel, an msel item, which the MSEL import creates later, on stage),
        because that parent would not exist yet when the seed creates the reply. Emits one { Code, Where, Message }
        per such reply, naming both items, as Test-DemoPack does; nothing when every loaded reply has its parent.
    #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Pack, [Parameter(Mandatory)] [string] $RunSheet)
    $items = @(Get-RunSheetItems -Pack $Pack)
    $leftOut = [hashtable]::new([StringComparer]::Ordinal)
    foreach ($item in @(Get-RunSheetItems -Pack $Pack -RunSheet $RunSheet -Left)) { $leftOut[[string] $item['key']] = $item }
    for ($j = 0; $j -lt $items.Count; $j++) {
        $key = [string] $items[$j]['key']
        if ($leftOut.Contains($key)) { continue }
        $posts = @(Get-SeedList $items[$j] 'posts')
        for ($k = 0; $k -lt $posts.Count; $k++) {
            $reply = $posts[$k]['replyTo']
            if ($reply -isnot [System.Collections.IDictionary] -or -not $reply.Contains('item')) { continue }
            $parent = $leftOut[[string] $reply['item']]
            if (-not $parent) { continue }
            $target = [string] $reply['item']
            $why = if ($parent['msel']) { "which -RunSheet $RunSheet leaves for the on-stage MSEL import (msel '$($parent['msel'])')" } else { "which -RunSheet $RunSheet does not load" }
            [pscustomobject]@{
                Code = 'inject-reply-left-out'; Where = "runSheet.items[$j].posts[$k].replyTo.item"
                Message = "item '$key' is seeded, but its post $($k + 1) replies to item '$target', $why. '$target' would not exist yet when '$key' is created. Remove msel from '$target', drop the reply, or run with -RunSheet all."
            }
        }
    }
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
            # The video's last upload got no clear answer: if it landed, this poster is attached to it, and the library
            # hides it. Keep it, so step 7 can find that upload (it checks the poster's bytes) instead of sending both again.
            if ((Test-PendingUpload -Entry $videoEntry -Unit $video -PosterUnit $unit) -and [string] $videoEntry['pending']['posterAssetId'] -eq $posterId) { $verified = $true }
        }
        if ($verified) { & $decide $unit 'reuse' $posterId 'already uploaded' }
        else { & $decide $unit 'upload' $null 'no longer in the media library' }
    }

    foreach ($unit in $Units) {
        $reason = $decision[$unit.File].Reason
        # An earlier upload of these bytes got no clear answer (or its run was interrupted): step 7 looks first, by
        # the same test (Test-PendingUpload), so the plan says exactly what the run will do.
        $posterUnit = if ($unit.PosterFile) { $byFile[$unit.PosterFile] } else { $null }
        if ($decision[$unit.File].Action -eq 'upload' -and (Test-PendingUpload -Entry (& $entryFor $unit.File) -Unit $unit -PosterUnit $posterUnit)) {
            $lookFirst = 'an earlier upload of it got no clear answer, so the media library is checked for it first'
            $reason = if ($reason -eq 'new file') { $lookFirst } else { "$reason; $lookFirst" }
        }
        # A poster sent again only for a video whose earlier upload step 7 looks for first: if that upload is found, it
        # carries this poster, and the copy already uploaded is kept instead.
        $entry = & $entryFor $unit.File
        if ($decision[$unit.File].Action -eq 'upload' -and $unit.Roles.Contains('poster') -and $entry -and $entry['assetId'] -and [string] $entry['sha256'] -ceq $unit.Sha256) {
            $pendingVideos = @($Units | Where-Object { $_.PosterFile -ceq $unit.File -and (Test-PendingUpload -Entry (& $entryFor $_.File) -Unit $_ -PosterUnit $unit) })
            if ($pendingVideos.Count -gt 0) { $reason += "; kept instead if the earlier upload of $(@($pendingVideos.File) -join ', ') is found (it carries this poster)" }
        }
        [pscustomobject]@{ Unit = $unit; Action = $decision[$unit.File].Action; AssetId = $decision[$unit.File].AssetId; Reason = $reason }
    }
}

function Test-PendingUpload {
    <#
    .SYNOPSIS
        True when a manifest files entry carries a "pending" mark for an upload of exactly these bytes: the file's
        SHA-256 and, for a video with a poster, the poster file's SHA-256. Step 7 then looks for that upload in the
        media library before sending the file again, and the plan says so. Bytes, not ids: the poster may have been
        uploaded again since (its library row hides while it is the poster of the upload that landed).
    #>
    param([AllowNull()] [object] $Entry, [Parameter(Mandatory)] [object] $Unit, [AllowNull()] [object] $PosterUnit)
    if ($Entry -isnot [System.Collections.IDictionary] -or $Entry['pending'] -isnot [System.Collections.IDictionary]) { return $false }
    $pending = $Entry['pending']
    $posterSha = if ($PosterUnit) { $PosterUnit.Sha256 } else { '' }
    return ([string] $pending['sha256'] -ceq $Unit.Sha256) -and ([string] $pending['posterSha256'] -ceq $posterSha)
}

function Get-MediaUploadFileName {
    <#
    .SYNOPSIS
        The file name the server keeps for an upload of this file (MediaUploadService.SanitizeFileName): the name
        the web cmdlet sends, without control characters, cut after the last path separator, trimmed, at most 255
        characters. $null when the server's markup stripping could change it (a '<' in the name) or it would be
        empty: then a library row of any name can be the upload (its bytes still have to match).
    #>
    param([Parameter(Mandatory)] [string] $Path)
    $name = -join @([IO.Path]::GetFileName($Path).ToCharArray() | Where-Object { -not [char]::IsControl($_) })
    $name = ($name -split '[\\/]')[-1].Trim()
    if (-not $name -or $name.Contains('<')) { return $null }
    if ($name.Length -gt 255) {
        $name = $name.Substring(0, 255)
        if ([char]::IsHighSurrogate($name[-1])) { $name = $name.Substring(0, 254) }
    }
    return $name
}

function Select-MediaUploadCandidates {
    <#
    .SYNOPSIS
        The library rows (GET /api/staff/media, newest first) that could be the asset an upload of this file stored,
        before any bytes are compared: the file's kind and name, the width, height and duration hints it was sent
        with, and a poster exactly when one was sent. A row named in KnownIds (one the library already held before
        the upload) or in Claimed (the manifest's and this run's assets) is never a candidate.
    #>
    param(
        [AllowEmptyCollection()] [object[]] $Rows = @(),
        [Parameter(Mandatory)] [object] $Unit,
        [switch] $WithPoster,
        [AllowEmptyCollection()] [string[]] $KnownIds = @(),
        [AllowNull()] [System.Collections.Generic.HashSet[string]] $Claimed
    )
    $name = Get-MediaUploadFileName -Path $Unit.Path
    # The hints step 7 sends: width and height when the pack has them, durationSec for a video only.
    $hints = @{ width = $Unit.Width; height = $Unit.Height; durationSec = $(if ($Unit.Kind -eq 'video') { $Unit.DurationSec } else { $null }) }
    foreach ($row in @($Rows)) {
        if ($row -isnot [System.Collections.IDictionary]) { continue }
        $id = [string] $row['id']
        if (-not $id -or $KnownIds -contains $id -or ($Claimed -and $Claimed.Contains($id))) { continue }
        if ([string] $row['kind'] -cne $Unit.Kind) { continue }
        if ($null -ne $name -and [string] $row['fileName'] -cne $name) { continue }
        $sameHints = $true
        foreach ($hint in $hints.Keys) {
            $sent = $hints[$hint]; $kept = $row[$hint]
            if (($null -eq $sent) -ne ($null -eq $kept) -or ($null -ne $sent -and [double] $sent -ne [double] $kept)) { $sameHints = $false }
        }
        if (-not $sameHints) { continue }
        if ([string]::IsNullOrEmpty([string] $row['posterUrl']) -eq [bool] $WithPoster) { continue }
        $row
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
    <#
    .SYNOPSIS
        The pack's run-sheet items that -RunSheet loads (Test-RunSheetItemLoaded; every item by default), or with
        -Left the ones it leaves out. Nothing when the pack has no runSheet. Always call it as @(Get-RunSheetItems …).
    #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Pack, [string] $RunSheet = 'all', [switch] $Left)
    if ($Pack['runSheet'] -isnot [System.Collections.IDictionary]) { return }
    foreach ($item in @(Get-SeedList $Pack['runSheet'] 'items')) {
        if ((Test-RunSheetItemLoaded -Item $item -RunSheet $RunSheet) -ne [bool] $Left) { $item }
    }
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

function Test-InjectArmable {
    <#
    .SYNOPSIS
        True when the console can still fire this queue item as scripted: it is 'pending', or 'held' before it
        was ever released. Only pending and held items fire (InjectTransitions.WhyNotFireable). A fired, firing,
        skipped or failed item (a rehearsal's) is not armable, and neither is a burst held after its release:
        Fire would only resume what is left. "Released" shows as any post that is no longer pending (fired,
        failed or skipped: a post can fail while its siblings wait, then a Hold leaves firedCount at 0), or any
        post with a dueOffsetSeconds (the server lays out the burst's pacing on first release only).
    #>
    param([AllowNull()] [System.Collections.IDictionary] $Row)
    if (-not $Row) { return $false }
    $status = [string] $Row['status']
    if ($status -ceq 'pending') { return $true }
    if ($status -cne 'held') { return $false }
    if ([long] $Row['firedCount'] -gt 0) { return $false }
    foreach ($post in @(Get-SeedList $Row 'posts')) {
        if ([string] $post['status'] -cne 'pending' -or $null -ne $post['dueOffsetSeconds']) { return $false }
    }
    return $true
}

function Get-InjectStatusText {
    <# A queue item's status for messages: "fired", "skipped", or "held part-way (2/5 posts out[, 1 failed])". #>
    param([AllowNull()] [System.Collections.IDictionary] $Row)
    if (-not $Row) { return 'missing' }
    $status = [string] $Row['status']
    if ($status -ceq 'held' -and -not (Test-InjectArmable -Row $Row)) {
        $posts = @(Get-SeedList $Row 'posts')
        $out = [math]::Max([long] $Row['firedCount'], @($posts | Where-Object { [string] $_['status'] -ceq 'fired' }).Count)
        $failed = @($posts | Where-Object { [string] $_['status'] -ceq 'failed' }).Count
        return "held part-way ($out/$($posts.Count) posts out$(if ($failed) { ", $failed failed" }))"
    }
    return $status
}

function Find-InjectItemMatches {
    <#
    .SYNOPSIS
        The queue items, in queue order, that match the run-sheet item (Test-InjectItemMatch) and that no pack
        item has claimed. Only ARMABLE ones (pending, or held with nothing out): a fired, firing, skipped or
        failed copy is never adopted, because the console could not fire it. -Unarmable returns the matching
        copies the console can no longer fire instead (for messages only). The caller adopts the first; more
        than one means a duplicate is already in the queue.
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Rows,
        [AllowNull()] [hashtable] $PersonaIds,
        [AllowNull()] [System.Collections.Generic.HashSet[string]] $Claimed,
        [switch] $Unarmable
    )
    foreach ($row in @($Rows)) {
        if ($row -isnot [System.Collections.IDictionary]) { continue }
        $id = [string] $row['id']
        if (-not $id -or ($Claimed -and $Claimed.Contains($id))) { continue }
        if ((Test-InjectArmable -Row $row) -eq [bool] $Unarmable) { continue }
        if (Test-InjectItemMatch -PackItem $PackItem -Row $row -PersonaIds $PersonaIds) { $row }
    }
}

function Get-InjectPlan {
    <#
    .SYNOPSIS
        Per run-sheet item, in pack order, one Action:
          skip    its id from the manifest is still in the queue. Armable says whether the console can still
                  fire it; one that is not (fired, firing, skipped, failed: a rehearsal's) is listed in
                  NotArmable and warned about, and the self-check fails on it.
          adopt   an unclaimed, armable queue item with the same kind, title and posts: recorded, not created
                  again. Replaces names the manifest's spent item it takes over from, if any.
          create  new, or deleted in the console since it was loaded.
          reload  -ReloadFired only: the manifest's item is fired, skipped, failed or held part-way, so a
                  fresh copy is created; the old item is never touched and its id goes to the manifest's
                  superseded list (Replaces).
          refuse  -ReloadFired only: the manifest's item is still firing (a burst releasing its posts). The run
                  stops before any write.
        Only the items -RunSheet loads are planned. The ones it leaves out are listed in Left with the reason,
        and nothing else: not created, adopted, compared, re-pointed or checked, and their manifest entries (and
        the claim on their ids) stay as they are. So the MSEL import's items are never touched.
    .PARAMETER Queue
        The items of GET /api/injects, or $null offline (-WhatIf: then the manifest alone decides, and nothing
        is known about statuses).
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Pack,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Manifest,
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Queue,
        [AllowNull()] [hashtable] $PersonaIds,
        [switch] $ReloadFired,
        [string] $RunSheet = 'all'
    )
    $manifestItems = $Manifest['injects']
    $entryFor = { param($Key) if ($manifestItems -is [System.Collections.IDictionary] -and $manifestItems.Contains($Key)) { $manifestItems[$Key] } else { $null } }
    $online = $null -ne $Queue
    $rowsById = [hashtable]::new([StringComparer]::OrdinalIgnoreCase)
    if ($online) { foreach ($row in $Queue) { if ($row -is [System.Collections.IDictionary]) { $rowsById[[string] $row['id']] = $row } } }
    # Ids the manifest accounts for can never be adopted by another pack item: the current ones, and every
    # superseded one (a skipped copy that someone unskips must not come back as the pack's item).
    $claimed = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    if ($manifestItems -is [System.Collections.IDictionary]) {
        foreach ($key in @($manifestItems.Keys)) {
            $id = [string] $manifestItems[$key]['itemId']
            if ($id -and $rowsById.Contains($id)) { [void] $claimed.Add($id) }
            foreach ($old in @(Get-SeedList $manifestItems[$key] 'superseded')) { if ($old) { [void] $claimed.Add([string] $old) } }
        }
    }
    $items = [System.Collections.Generic.List[object]]::new()
    $warnings = [System.Collections.Generic.List[string]]::new()
    $adoptFrom = {
        param($Found)
        if ($Found.Count -gt 1) {
            $warnings.Add(("{0} matches {1} items in the run sheet ({2}): a duplicate is already in the queue. The first is used; delete the others in the console." -f
                    $key, $Found.Count, (@($Found | ForEach-Object { [string] $_['id'] }) -join ', ')))
        }
        $Found[0]
    }

    foreach ($item in @(Get-RunSheetItems -Pack $Pack -RunSheet $RunSheet)) {
        $key = [string] $item['key']
        $entry = & $entryFor $key
        $manifestId = if ($entry) { [string] $entry['itemId'] } else { '' }
        $action = 'create'; $itemId = $null; $row = $null; $reason = 'new'; $status = $null; $armable = $null; $replaces = $null

        if (-not $online) {
            if ($manifestId) { $action = 'skip'; $itemId = $manifestId; $reason = 'in the manifest; a live run checks it can still be fired' }
        }
        elseif ($manifestId -and $rowsById.Contains($manifestId)) {
            $row = $rowsById[$manifestId]
            $status = Get-InjectStatusText -Row $row
            $armable = Test-InjectArmable -Row $row
            $action = 'skip'; $itemId = $manifestId; $reason = "in the run sheet ($status)"
            if ($armable) {
                if (-not (Test-InjectItemMatch -PackItem $item -Row $row -PersonaIds $PersonaIds)) {
                    $warnings.Add("$key differs from the pack (edited in the console, or the pack changed after it was loaded); the queue's version stays. To load the pack's version, delete the item in the console and run again.")
                }
            }
            else {
                # Spent (a rehearsal fired it, or it was skipped or failed). FIRING comes first, before anything else
                # is decided: an item still releasing posts is never replaced, not even by a copy already in the
                # queue (Gate-1 S1b N-2), so "an item still firing is refused and nothing is written" always holds.
                $found = @()
                if ([string] $row['status'] -cne 'firing') { $found = @(Find-InjectItemMatches -PackItem $item -Rows $Queue -PersonaIds $PersonaIds -Claimed $claimed) }
                if ([string] $row['status'] -ceq 'firing') {
                    if ($ReloadFired) {
                        $action = 'refuse'
                        $reason = 'is firing (a burst still releasing its posts, or suspended by PAUSE INJECTS or FREEZE). -ReloadFiredRunSheet does not reload an item that is still firing: wait for it to finish, or Hold it in the console, then run again'
                    }
                    else {
                        $warnings.Add("$key is firing (a burst still releasing its posts, or suspended by PAUSE INJECTS or FREEZE): the console has nothing left to fire. When it has finished (or after Hold in the console), run again with -ReloadFiredRunSheet to load a fresh copy.")
                    }
                }
                elseif ($found.Count -gt 0) {
                    # An armable identical copy already in the queue (an earlier reload that stopped part-way) takes
                    # over; nothing is created for that.
                    $reason = "the loaded copy is $status; adopting the armable copy already in the run sheet"
                    $row = & $adoptFrom $found
                    $action = 'adopt'; $itemId = [string] $row['id']; [void] $claimed.Add($itemId); $replaces = $manifestId
                    $armable = $true; $status = Get-InjectStatusText -Row $row
                }
                elseif ($ReloadFired) {
                    $action = 'reload'; $itemId = $null; $replaces = $manifestId
                    $reason = "reload: the loaded copy is $status (rehearsal?); it stays in the console, untouched"
                }
                else {
                    $warnings.Add("$key is $status (rehearsal?): the console has nothing to fire. Run again with -ReloadFiredRunSheet to load a fresh copy (the $([string] $row['status']) one stays in the console, untouched).")
                }
            }
        }
        else {
            $found = @(Find-InjectItemMatches -PackItem $item -Rows $Queue -PersonaIds $PersonaIds -Claimed $claimed)
            if ($found.Count -gt 0) {
                $row = & $adoptFrom $found
                $action = 'adopt'; $itemId = [string] $row['id']; [void] $claimed.Add($itemId); $armable = $true; $status = Get-InjectStatusText -Row $row
                $reason = 'already in the run sheet (same kind, title and posts)'
            }
            else {
                if ($manifestId) { $reason = 'loaded before, but no longer in the run sheet (deleted in the console)' }
                $spent = @(Find-InjectItemMatches -PackItem $item -Rows $Queue -PersonaIds $PersonaIds -Claimed $claimed -Unarmable)
                if ($spent.Count -gt 0) { $reason += "; the copy already in the run sheet is $(Get-InjectStatusText -Row $spent[0]), so a fresh one is created" }
            }
        }
        $items.Add([pscustomobject]@{
                Key = $key; Item = $item; Action = $action; ItemId = $itemId; Row = $row; Reason = $reason; Status = $status; Armable = $armable
                Replaces = $replaces; Superseded = @(if ($entry) { Get-SeedList $entry 'superseded' })
                Kind = [string] $item['kind']; Title = [string] $item['title']; PostCount = @(Get-SeedList $item 'posts').Count
            })
    }

    # Order (Gate-1 S1b N-1). A created item (new, re-created or reloaded) lands at the END of the console's queue,
    # while an item kept from an earlier run keeps its place, and "Fire next" takes the first pending item in the
    # queue's order. A fresh item followed in the pack by a kept armable one will therefore come after it. The
    # script never reorders (not on its allowlist), so it says so here, and the self-check fails on the result.
    $late = [System.Collections.Generic.List[string]]::new()
    $ahead = [System.Collections.Generic.List[string]]::new()
    for ($i = 0; $i -lt $items.Count; $i++) {
        if ($items[$i].Action -notin 'create', 'reload') { continue }
        $kept = @(for ($j = $i + 1; $j -lt $items.Count; $j++) { if ($items[$j].Action -in 'skip', 'adopt' -and $items[$j].Armable) { $items[$j].Key } })
        if ($kept.Count -eq 0) { continue }
        $late.Add($items[$i].Key)
        foreach ($k in $kept) { if (-not $ahead.Contains($k)) { $ahead.Add($k) } }
    }
    if ($late.Count -gt 0) {
        $warnings.Add(("Order: {0} will be added at the END of the console's queue, after {1}, which come{2} later in the pack, so ""Fire next"" would take the run sheet out of order. After this run, drag them into pack order in the console; or Skip the remaining old items ({1}) in the console and run again with -ReloadFiredRunSheet, so the whole sheet reloads in pack order." -f
                ($late -join ', '), ($ahead -join ', '), $(if ($ahead.Count -eq 1) { 's' } else { '' })))
    }

    # The items -RunSheet leaves out (DF-16). Two things are said about one the import will create, never more: a copy an
    # earlier run of this script recorded, that the console could still fire (the import matches on Inject #, which a
    # seeded copy does not carry; the queue does not show Inject #, so it may also be one the import made, adopted by
    # an earlier -RunSheet all run), and a reply the item makes (an MSEL row cannot carry one).
    $left = @(foreach ($item in @(Get-RunSheetItems -Pack $Pack -RunSheet $RunSheet -Left)) {
            $key = [string] $item['key']
            $msel = [string] $item['msel']
            $entry = & $entryFor $key
            $loaded = if ($entry -and $online) { $rowsById[[string] $entry['itemId']] } else { $null }
            if ($msel -and (Test-InjectArmable -Row $loaded)) {
                $warnings.Add("$key is left for the MSEL import (msel '$msel'), but an earlier run of this script loaded it and it is still in the run sheet ($(Get-InjectStatusText -Row $loaded), $($loaded['id'])). A seeded copy carries no Inject #, so the import would add a second one: delete $($loaded['id']) in the console before the import, unless the MSEL import created it (the queue does not expose Inject #). Never run -RunSheet all after the on-stage import.")
            }
            if ($msel -and @(Get-SeedList $item 'posts' | Where-Object { $_['replyTo'] }).Count -gt 0) {
                $warnings.Add("$key is left for the MSEL import (msel '$msel'), but it replies to another post: an MSEL row cannot carry a reply, so the import creates it as a top-level post, out of its thread. To keep the thread, remove msel so the seed loads it.")
            }
            [pscustomobject]@{
                Key = $key; Kind = [string] $item['kind']; Title = [string] $item['title']; PostCount = @(Get-SeedList $item 'posts').Count; Msel = $msel
                Reason = $(if ($msel) { "left for the on-stage MSEL import (msel '$msel'; -RunSheet $RunSheet)" } else { "not loaded (-RunSheet $RunSheet)" })
            }
        })

    # Order with the import (DF-22, story 16): it places each item it creates just before the first pending item with a
    # later planned minute, so the queue reads in pack order again only when every seeded item has one.
    $unplanned = @($items | Where-Object { $null -eq $_.Item['plannedMinute'] } | ForEach-Object Key)
    if ($unplanned.Count -gt 0 -and @($left | Where-Object Msel).Count -gt 0) {
        $warnings.Add(("{0} ha{1} no plannedMinute, but the on-stage MSEL import places each item it creates just before the first pending item with a later planned minute (DF-22), so it cannot place its items around {0}, and ""Fire next"" may leave pack order. Give every seeded item a plannedMinute." -f
                ($unplanned -join ', '), $(if ($unplanned.Count -eq 1) { 's' } else { 've' })))
    }

    [pscustomobject]@{
        Items = $items.ToArray(); Warnings = $warnings.ToArray(); Online = $online; Claimed = $claimed; Left = $left
        LandsLate = $late.ToArray()
        ToCreate = @($items | Where-Object Action -in 'create', 'reload').Count
        Done = @($items | Where-Object Action -in 'skip', 'adopt').Count
        NotArmable = @($items | Where-Object { $_.Action -eq 'skip' -and $_.Armable -eq $false })
        Refused = @($items | Where-Object Action -eq 'refuse')
    }
}

function New-InjectLiveness {
    <#
    .SYNOPSIS
        What counts as a LIVE reply target, so that only a DEAD one is ever re-pointed: a controller may have
        re-targeted a reply in the console to another live post on purpose, and that is never written over.
          postId        live when it is one of this run's pack posts or in the feed read. Otherwise it is dead
                        when it is a post this machine seeded earlier (an archived copy), or when the feed read was
                        complete (under its cap). Outside a full feed window it is unknown, and treated as live.
          injectPostId  dead when its item is superseded (the old copy of a reloaded item), or when no live item
                        in the queue holds it. -SpentDead also counts the posts of a spent item (fired, firing,
                        skipped, failed, held part-way) as dead; the self-check uses that.
        Add-InjectLivenessItem registers an item created during the run.
    #>
    param(
        [AllowEmptyCollection()] [string[]] $LivePostIds = @(),
        [AllowEmptyCollection()] [string[]] $RetiredPostIds = @(),
        [bool] $FeedComplete = $true,
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Queue,
        [AllowEmptyCollection()] [string[]] $SupersededItemIds = @(),
        [switch] $SpentDead
    )
    $newSet = { , [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase) }
    $liveness = [pscustomobject]@{
        Live = & $newSet; Retired = & $newSet; FeedComplete = $FeedComplete; Superseded = & $newSet; Spent = & $newSet
        ChildItem = [hashtable]::new([StringComparer]::OrdinalIgnoreCase); SpentDead = [bool] $SpentDead
    }
    foreach ($id in @($LivePostIds)) { if ($id) { [void] $liveness.Live.Add([string] $id) } }
    foreach ($id in @($RetiredPostIds)) { if ($id) { [void] $liveness.Retired.Add([string] $id) } }
    foreach ($id in @($SupersededItemIds)) { if ($id) { [void] $liveness.Superseded.Add([string] $id) } }
    foreach ($row in @($Queue)) { Add-InjectLivenessItem -Liveness $liveness -Row $row }
    return $liveness
}

function Add-InjectLivenessItem {
    <# Registers a queue item's posts (and whether the item is spent) with a liveness object. #>
    param([Parameter(Mandatory)] [object] $Liveness, [AllowNull()] [System.Collections.IDictionary] $Row)
    if (-not $Row) { return }
    $itemId = [string] $Row['id']
    foreach ($child in @(Get-SeedList $Row 'posts')) { if ($child['id']) { $Liveness.ChildItem[[string] $child['id']] = $itemId } }
    if (Test-InjectArmable -Row $Row) { [void] $Liveness.Spent.Remove($itemId) } else { [void] $Liveness.Spent.Add($itemId) }
}

function Test-InjectTargetDead {
    <# True when a reply target (a postId or an injectPostId) is dead by the rules of New-InjectLiveness. #>
    param([Parameter(Mandatory)] [object] $Liveness, [Parameter(Mandatory)] [string] $Field, [AllowEmptyString()] [AllowNull()] [string] $Id)
    if (-not $Id) { return $false }
    if ($Field -ceq 'postId') {
        if ($Liveness.Live.Contains($Id)) { return $false }
        return $Liveness.Retired.Contains($Id) -or [bool] $Liveness.FeedComplete
    }
    $itemId = [string] $Liveness.ChildItem[$Id]
    if (-not $itemId) { return $true }
    if ($Liveness.Superseded.Contains($itemId)) { return $true }
    return $Liveness.SpentDead -and $Liveness.Spent.Contains($itemId)
}

function Get-InjectReplyRepairs {
    <#
    .SYNOPSIS
        The replies of a queue item (kept from an earlier run: skipped or adopted) that point somewhere other than
        the pack's CURRENT target, one object per post: @{ Index; Sequence; Field (postId | injectPostId); Loaded;
        Current; Target ("p02", "post 1 of i01"); Label (the target and why); Dead }. Only a Dead one is
        re-pointed (Gate-1 S1c L-1). Without -Liveness every one counts as dead.
          - a pack post that was archived (for example by Clear-DemoContent.ps1) and posted again: { postKey }
            resolves to a new postId;
          - a post of an earlier run-sheet item that was loaded again (-ReloadFiredRunSheet, or deleted and
            re-created): { item, sequence } resolves to a new injectPostId.
        The current ids are known by then: posts are made before the run sheet, and a reply names an EARLIER item.
        Sibling replies never go stale (a kept item keeps its children). The run-sheet step re-points the dead
        ones in place (Update-InjectReplies); a live one that differs is a console re-target, only warned about.
    .PARAMETER InjectPostIds
        Run-sheet item key → the CURRENT ids of its posts in sequence order.
    .PARAMETER Liveness
        From New-InjectLiveness: which loaded targets are dead.
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [AllowNull()] [System.Collections.IDictionary] $Row,
        [Parameter(Mandatory)] [hashtable] $PostIds,
        [hashtable] $InjectPostIds = @{},
        [AllowNull()] [object] $Liveness
    )
    if (-not $Row) { return }
    $key = [string] $PackItem['key']
    $want = @(Get-SeedList $PackItem 'posts')
    $have = @(@(Get-SeedList $Row 'posts') | Sort-Object { [long] $_['sequence'] })
    for ($k = 0; $k -lt [math]::Min($want.Count, $have.Count); $k++) {
        $reply = $want[$k]['replyTo']
        if ($reply -isnot [System.Collections.IDictionary]) { continue }
        $loadedReply = $have[$k]['replyTo']
        $field = $null; $current = ''; $label = ''; $name = ''
        if ($reply.Contains('postKey')) {
            $field = 'postId'
            $current = [string] $PostIds[[string] $reply['postKey']]
            $name = [string] $reply['postKey']
            $label = "$name (archived and posted again since)"
        }
        elseif ($reply.Contains('item') -and [string] $reply['item'] -cne $key) {
            $target = [string] $reply['item']
            $children = @($InjectPostIds[$target])
            $index = [long] $reply['sequence'] - 1
            $field = 'injectPostId'
            $current = if ($index -ge 0 -and $index -lt $children.Count) { [string] $children[$index] } else { '' }
            $name = "post $($reply['sequence']) of $target"
            $label = "$name ($target was loaded again since)"
        }
        if (-not $field) { continue }
        $loaded = if ($loadedReply -is [System.Collections.IDictionary]) { [string] $loadedReply[$field] } else { '' }
        if ($current -and $loaded -and $loaded -ne $current) {
            $dead = if ($Liveness) { Test-InjectTargetDead -Liveness $Liveness -Field $field -Id $loaded } else { $true }
            [pscustomobject]@{ Index = $k; Sequence = $k + 1; Field = $field; Loaded = $loaded; Current = $current; Target = $name; Label = $label; Dead = $dead }
        }
    }
}

function Get-InjectStaleReplies {
    <# The labels of Get-InjectReplyRepairs, for messages ("p02 (archived and posted again since)"). #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [AllowNull()] [System.Collections.IDictionary] $Row,
        [Parameter(Mandatory)] [hashtable] $PostIds,
        [hashtable] $InjectPostIds = @{}
    )
    Get-InjectReplyRepairs -PackItem $PackItem -Row $Row -PostIds $PostIds -InjectPostIds $InjectPostIds | ForEach-Object Label
}

function New-InjectRepointBody {
    <#
    .SYNOPSIS
        The PUT /api/injects/{id} body (InjectItemWrite & { version }) that re-points a kept item's stale replies
        IN PLACE: same item, same place in the queue, same children. It is built from the QUEUE's copy, not the
        pack, so a controller's console edits (title, notes, text, assignee, media, ...) are sent back as they are.
        Every child is echoed by its id, which keeps its identity ("Child identity on PUT", inject-queue
        implementation.md). Only the replies named in Repairs change. Version is the one the queue showed.
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Row,
        [AllowEmptyCollection()] [object[]] $Repairs = @()
    )
    $bySequence = @{}
    foreach ($repair in @($Repairs)) { if ($repair) { $bySequence[[long] $repair.Sequence] = $repair } }
    $body = [ordered]@{ kind = [string] $Row['kind']; title = [string] $Row['title'] }
    if ($null -ne $Row['notes']) { $body['notes'] = [string] $Row['notes'] }
    if ($null -ne $Row['plannedMinute']) { $body['plannedMinute'] = [long] $Row['plannedMinute'] }
    if ($Row['assigneeId']) { $body['assigneeId'] = [string] $Row['assigneeId'] }
    if ([string] $Row['kind'] -ceq 'burst' -and $null -ne $Row['burstWindowSeconds']) { $body['burstWindowSeconds'] = [long] $Row['burstWindowSeconds'] }
    $body['posts'] = @(foreach ($post in @(@(Get-SeedList $Row 'posts') | Sort-Object { [long] $_['sequence'] })) {
            $out = [ordered]@{ id = [string] $post['id']; personaId = [string] $post['personaId']; text = [string] $post['text'] }
            $media = @(Get-SeedList $post 'media')
            if ($media.Count -gt 0) { $out['media'] = @(foreach ($item in $media) { [ordered]@{ mediaId = [string] $item['mediaId']; alt = [string] $item['alt'] } }) }
            $repair = $bySequence[[long] $post['sequence']]
            if ($repair) { $out['replyTo'] = [ordered]@{}; $out['replyTo'][$repair.Field] = $repair.Current }
            elseif ($post['replyTo'] -is [System.Collections.IDictionary]) {
                if ($post['replyTo']['postId']) { $out['replyTo'] = [ordered]@{ postId = [string] $post['replyTo']['postId'] } }
                elseif ($post['replyTo']['injectPostId']) { $out['replyTo'] = [ordered]@{ injectPostId = [string] $post['replyTo']['injectPostId'] } }
            }
            if ($post['engagementBaseline'] -is [System.Collections.IDictionary]) {
                $baseline = [ordered]@{}
                foreach ($name in 'like', 'repost', 'reply') { if ($null -ne $post['engagementBaseline'][$name]) { $baseline[$name] = [long] $post['engagementBaseline'][$name] } }
                $out['engagementBaseline'] = $baseline
            }
            $out
        })
    $body['version'] = [long] $Row['version']
    return $body
}

function Get-InjectRepointPlan {
    <#
    .SYNOPSIS
        What the plan expects to re-point in place: per kept, armable run-sheet item, the replies whose target will
        get a new id in this run (a pack post posted again, a run-sheet item created or reloaded), or (online) that
        already differ from the target's current id. A prediction for the plan only; step 11 decides on the real
        ids (Get-InjectReplyRepairs). Offline (-WhatIf) only the manifest is known, so it sees less: it cannot
        tell that posts were archived, nor see the queue.
    #>
    param([Parameter(Mandatory)] [object] $InjectPlan, [Parameter(Mandatory)] [object] $PostPlan, [AllowNull()] [object] $Liveness)
    # A loaded target that is still live (a console re-target) is never re-pointed: predict only dead ones.
    $isDead = { param([string] $Field, $Loaded) -not $Liveness -or -not $Loaded -or (Test-InjectTargetDead -Liveness $Liveness -Field $Field -Id ([string] $Loaded[$Field])) }
    $posts = @{}
    foreach ($entry in @($PostPlan.Items)) { $posts[$entry.Key] = $entry }
    $sheet = @{}
    foreach ($entry in @($InjectPlan.Items)) { $sheet[$entry.Key] = $entry }
    foreach ($entry in @($InjectPlan.Items)) {
        if ($entry.Action -notin 'skip', 'adopt' -or $entry.Armable -eq $false) { continue }
        $have = @(if ($entry.Row) { @(Get-SeedList $entry.Row 'posts') | Sort-Object { [long] $_['sequence'] } })
        $labels = @(for ($k = 0; $k -lt @(Get-SeedList $entry.Item 'posts').Count; $k++) {
                $reply = @(Get-SeedList $entry.Item 'posts')[$k]['replyTo']
                if ($reply -isnot [System.Collections.IDictionary]) { continue }
                $loaded = if ($k -lt $have.Count -and $have[$k]['replyTo'] -is [System.Collections.IDictionary]) { $have[$k]['replyTo'] } else { $null }
                if ($reply.Contains('postKey')) {
                    $target = $posts[[string] $reply['postKey']]
                    if (-not $target) { continue }
                    if (-not (& $isDead 'postId' $loaded)) { continue }
                    if ($target.Action -eq 'post') { "post $($k + 1)'s reply to $($reply['postKey']) (posted again)" }
                    elseif ($loaded -and $loaded['postId'] -and $target.PostId -and [string] $loaded['postId'] -ne [string] $target.PostId) { "post $($k + 1)'s reply to $($reply['postKey']) (an earlier copy)" }
                }
                elseif ($reply.Contains('item') -and [string] $reply['item'] -cne $entry.Key) {
                    $target = $sheet[[string] $reply['item']]
                    if (-not $target) { continue }
                    $label = "post $($k + 1)'s reply to post $($reply['sequence']) of $($reply['item'])"
                    if (-not (& $isDead 'injectPostId' $loaded)) { continue }
                    if ($target.Action -in 'create', 'reload') { "$label (loaded again)" }
                    elseif ($loaded -and $loaded['injectPostId'] -and $target.Row) {
                        $current = @(Get-InjectChildIds -Row $target.Row)
                        $index = [long] $reply['sequence'] - 1
                        if ($index -ge 0 -and $index -lt $current.Count -and [string] $loaded['injectPostId'] -ne $current[$index]) { "$label (an earlier copy)" }
                    }
                }
            })
        if ($labels.Count -gt 0) { [pscustomobject]@{ Key = $entry.Key; Labels = $labels } }
    }
}

function Find-InjectOrderInversion {
    <#
    .SYNOPSIS
        The first pair of run-sheet items that the console's queue has the other way round from the pack:
        @{ PackFirst = the item the pack has first; QueuedAhead = the later pack item the queue puts ahead of it },
        or $null when the queue's "order" increases in pack order. Entries are @{ Key; Order } in pack order
        (armable items only).
    #>
    param([AllowEmptyCollection()] [object[]] $Entries = @())
    $highest = $null
    foreach ($entry in @($Entries)) {
        if ($null -eq $entry -or (Get-JsonKind $entry.Order) -ne 'integer') { continue }
        if ($highest -and [long] $entry.Order -le [long] $highest.Order) { return [pscustomobject]@{ PackFirst = $highest; QueuedAhead = $entry } }
        $highest = $entry
    }
    return $null
}

function Get-InjectContentDrift {
    <#
    .SYNOPSIS
        Where a queue item kept from an earlier run (skipped or adopted) differs from the pack in what its posts
        attach or reply to, now that the real ids are known (Gate-1 S1b N-4): the media ids (a changed file is
        uploaded again under a new id), and whether and how each post replies. That covers a reply missing
        altogether, one the pack does not have, one of the wrong form (a post vs a scripted post), and a sibling
        reply to a different post of the item. A reply to an EARLIER COPY of the right target is reported by
        Get-InjectStaleReplies; kind, title, persona and text are compared by the plan (Test-InjectItemMatch).
    #>
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [AllowNull()] [System.Collections.IDictionary] $Row,
        [hashtable] $MediaIds = @{}
    )
    if (-not $Row) { return }
    $key = [string] $PackItem['key']
    $want = @(Get-SeedList $PackItem 'posts')
    $have = @(@(Get-SeedList $Row 'posts') | Sort-Object { [long] $_['sequence'] })
    $ownIds = @($have | ForEach-Object { [string] $_['id'] })
    for ($k = 0; $k -lt [math]::Min($want.Count, $have.Count); $k++) {
        $label = "post $($k + 1)"
        $wantMedia = @(@(Get-SeedList $want[$k] 'media') | ForEach-Object { [string] $MediaIds[[string] $_['ref']] })
        $haveMedia = @(@(Get-SeedList $have[$k] 'media') | ForEach-Object { [string] $_['mediaId'] })
        if (($wantMedia -join '|') -ne ($haveMedia -join '|')) { "$label's media" }

        $reply = $want[$k]['replyTo']
        $loaded = $have[$k]['replyTo']
        $loadedForm = if ($loaded -isnot [System.Collections.IDictionary]) { '' } elseif ($loaded['postId']) { 'postId' } elseif ($loaded['injectPostId']) { 'injectPostId' } else { '' }
        if ($reply -isnot [System.Collections.IDictionary]) {
            if ($loadedForm) { "$label's reply (the loaded post replies; the pack's does not)" }
            continue
        }
        if (-not $loadedForm) { "$label's reply (missing)"; continue }
        $wantForm = if ($reply.Contains('postKey')) { 'postId' } else { 'injectPostId' }
        if ($loadedForm -ne $wantForm) {
            "$label's reply (to $(if ($loadedForm -eq 'postId') { 'a feed post' } else { 'a scripted post' }) instead of $(if ($wantForm -eq 'postId') { 'a feed post' } else { 'a scripted post' }))"
            continue
        }
        if ($wantForm -eq 'injectPostId' -and (-not $reply.Contains('item') -or [string] $reply['item'] -ceq $key)) {
            $index = [long] $reply['sequence'] - 1
            $expected = if ($index -ge 0 -and $index -lt $ownIds.Count) { $ownIds[$index] } else { '' }
            if ([string] $loaded['injectPostId'] -ne $expected) { "$label's reply (to another post of this item)" }
        }
    }
}

function Resolve-InjectAssignees {
    <#
    .SYNOPSIS
        Pack assignees → staff ids, from GET /api/injects/assignees: "me" is the signed-in staff user, and must
        itself be on the exercise's assignee list; anything else must be exactly one assignee's displayName,
        ignoring case. Returns @{ Ids (assignee → id); Unknown; Ambiguous; Known (the display names) }.
    #>
    param(
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Items,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Roster
    )
    $byName = [hashtable]::new([StringComparer]::OrdinalIgnoreCase)
    $rosterIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($row in @(Get-SeedList $Roster 'assignees')) {
        $name = ([string] $row['displayName']).Trim()
        $id = [string] $row['id']
        if (-not $id) { continue }
        [void] $rosterIds.Add($id)
        if (-not $name) { continue }
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
            # The server's assigneeId rule is the roster, so "me" must be on it too (a staff user can sign in to
            # an exercise without being an assignee the queue accepts).
            $me = [string] $Roster['me']
            if ($me -and $rosterIds.Contains($me)) { $ids[$want] = $me } else { $unknown.Add($want) }
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
# (profile edits), posts (post key → post id) and injects (run-sheet item key → inject item id). A files entry
# carries "pending" while an upload of it has been sent but has no clear answer yet (step 7 looks for it first).
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
        if (-not $entry -or -not $entry['assetId']) { continue }    # only a pending upload so far
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
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'PATCH', 'PUT')] [string] $Method,
        [Parameter(Mandatory)] [string] $Path,
        [AllowNull()] [object] $Body,
        [string] $ContentType = 'application/json',
        [System.Collections.IDictionary] $Form,
        [switch] $Anonymous,
        [int] $TimeoutSec = 120,
        [int] $MaxRateLimitRetries = 6
    )
    $bare = ($Path -split '\?', 2)[0]
    if (-not (Test-SeedApiPath -Path $Path -Method $Method)) { throw "Refusing to call $Method ${bare}: it is not on this script's public-API allowlist." }
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
        to a second POST. GET /api/injects is re-read instead, and an armable item (pending, or held with nothing
        out) with the same kind, title and posts that no pack item has claimed is adopted. If there is none, the
        outcome stays 'uncertain' and the run stops: the next run re-reads the queue and adopts or creates it. A 429 has already
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
    # Only an armable, unclaimed copy can be the one just created (a fresh item is pending); a rehearsal's fired
    # copy, or a superseded one, never is.
    $found = @(Find-InjectItemMatches -PackItem $PackItem -Rows @(Get-SeedList $reread.Json 'items') -PersonaIds $PersonaIds -Claimed $Claimed)
    if ($found.Count -gt 1) { $why += " ($($found.Count) matching items are in the run sheet: delete the extras in the console)" }
    if ($found.Count -gt 0) { return & $result 'adopted' $found[0] 0 $why }
    return & $result 'uncertain' $null 0 "$why; it is not in the run sheet now"
}

function Add-MediaAsset {
    <#
    .SYNOPSIS
        POST /api/media for one file, made safe to stop and run again. Returns
        @{ Outcome = created | adopted | refused | failed | uncertain; AssetId; Status; Detail; Others }.
    .DESCRIPTION
        An upload is NOT idempotent: sending the file again after an uncertain outcome could store it twice (a
        second blob and row that nothing uses). So no response (a network failure or a timeout), a 408, a 5xx (a
        503 also comes when the file WAS stored and only its read URL could not be signed) or a 2xx without a
        readable asset never leads to a second POST. The media library is re-read instead (Find-UploadedMediaAsset)
        and the asset this upload stored is adopted. If it is not there, or the library cannot tell, the outcome
        stays 'uncertain' and the run stops; the file's "pending" mark makes the next run look again before it
        uploads. A 429 has already been waited out and retried by Invoke-PulseApi (the rate limiter refused it, so
        nothing was stored). A 400, 413 or 415 is a refusal: the server deletes whatever it had streamed.
    #>
    param(
        [Parameter(Mandatory)] [hashtable] $Context,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Form,
        [Parameter(Mandatory)] [object] $Unit,
        [AllowNull()] [object] $PosterUnit,
        [AllowEmptyCollection()] [string[]] $KnownIds = @(),
        [AllowNull()] [System.Collections.Generic.HashSet[string]] $Claimed
    )
    $result = { param($Outcome, $AssetId, $Status, $Detail, $Others) [pscustomobject]@{ Outcome = $Outcome; AssetId = $AssetId; Status = [int] $Status; Detail = $Detail; Others = [int] $Others } }
    $timeout = if ($Unit.Kind -eq 'video') { 900 } else { 180 }
    $response = $null
    $why = $null
    try { $response = Invoke-PulseApi -Context $Context -Method POST -Path '/api/media' -Form $Form -TimeoutSec $timeout }
    catch { $why = $_.Exception.Message.TrimEnd('.') }
    if ($response) {
        $status = $response.Status
        $isSuccess = $status -ge 200 -and $status -lt 300
        if ($status -eq 201 -and $response.Json -is [System.Collections.IDictionary] -and $response.Json['id']) { return & $result 'created' ([string] $response.Json['id']) 201 $null 0 }
        if ($status -eq 400) { return & $result 'refused' $null 400 (Get-ApiErrorText $response) 0 }
        if (-not ($isSuccess -or $status -eq 408 -or $status -ge 500)) { return & $result 'failed' $null $status (Get-ApiErrorText $response) 0 }
        $why = if ($isSuccess) { "POST /api/media answered $status without a readable asset" } else { "POST /api/media answered $status $(Get-ApiErrorText $response)" }
    }

    # Uncertain: the file may or may not be stored now. Look before doing anything else.
    $found = Find-UploadedMediaAsset -Context $Context -Unit $Unit -PosterUnit $PosterUnit -KnownIds $KnownIds -Claimed $Claimed
    switch ($found.Outcome) {
        'found' { return & $result 'adopted' $found.AssetId 0 $why $found.Others }
        'none' { return & $result 'uncertain' $null 0 "$why; it is not in the media library now" 0 }
        default { return & $result 'uncertain' $null 0 "$why; $($found.Detail)" 0 }
    }
}

function Find-UploadedMediaAsset {
    <#
    .SYNOPSIS
        Looks in the media library for the asset an upload of this file stored when its answer was lost. Returns
        @{ Outcome = found | none | unknown; AssetId; Others; Detail }.
    .DESCRIPTION
        A GET /api/staff/media row has no size, hash or uploader, but its url (and posterUrl) is pre-signed, so the
        bytes themselves are compared. The candidates are the rows Select-MediaUploadCandidates keeps: the file's
        kind, name, hints and poster, not in KnownIds (rows the library held before the upload: those of that name,
        and its newest few) and not claimed. "Not there" needs proof too: a full page (Take rows) counts only when it
        reaches one of the KnownIds, else the answer is 'unknown'. Each candidate's bytes, and its poster's, are fetched from the signed URL (Get-MediaUrlSha256,
        no token) and must hash to the file's SHA-256 and the poster file's. The library lists the newest upload
        first, so the first match is adopted; Others counts any further copies (an earlier attempt that also
        landed). 'unknown' means the library or a candidate's URL did not answer, so it cannot tell: the caller must
        not upload then.
    #>
    param(
        [Parameter(Mandatory)] [hashtable] $Context,
        [Parameter(Mandatory)] [object] $Unit,
        [AllowNull()] [object] $PosterUnit,
        [AllowEmptyCollection()] [string[]] $KnownIds = @(),
        [AllowNull()] [System.Collections.Generic.HashSet[string]] $Claimed,
        [int] $Take = 200
    )
    $result = { param($Outcome, $AssetId, $Others, $Detail) [pscustomobject]@{ Outcome = $Outcome; AssetId = $AssetId; Others = [int] $Others; Detail = $Detail } }
    $response = $null
    try { $response = Invoke-PulseApi -Context $Context -Method GET -Path "/api/staff/media?kind=$($Unit.Kind)&take=$Take" }
    catch { return & $result 'unknown' $null 0 "re-reading the media library failed ($($_.Exception.Message.TrimEnd('.')))" }
    if ($response.Status -ne 200 -or $null -eq $response.Json) { return & $result 'unknown' $null 0 "re-reading the media library answered $($response.Status)" }
    # "Not there" is only as good as the page: anything but an array of readable rows proves nothing.
    $rows = @($response.Json)
    $unreadable = @($rows | Where-Object { $_ -isnot [System.Collections.IDictionary] -or -not $_['id'] -or -not $_['kind'] -or -not $_['url'] -or $_['fileName'] -isnot [string] })
    if ($response.Json -isnot [System.Collections.IList] -or $unreadable.Count -gt 0) {
        return & $result 'unknown' $null 0 're-reading the media library answered 200 with rows it cannot read'
    }

    $candidates = @(Select-MediaUploadCandidates -Rows $rows -Unit $Unit -WithPoster:($null -ne $PosterUnit) -KnownIds $KnownIds -Claimed $Claimed)
    $timeout = if ($Unit.Kind -eq 'video') { 900 } else { 180 }
    $found = [System.Collections.Generic.List[string]]::new()
    foreach ($row in $candidates) {
        $copy = Get-MediaUrlSha256 -Url ([string] $row['url']) -Bytes $Unit.Bytes -TimeoutSec $timeout
        if ($copy.Status -ne 200) { return & $result 'unknown' $null 0 "the library's copy $($row['id']) answered $(if ($copy.Status) { $copy.Status } else { 'nothing' })" }
        if ($copy.Sha256 -cne $Unit.Sha256) { continue }
        if ($PosterUnit) {
            $poster = Get-MediaUrlSha256 -Url ([string] $row['posterUrl']) -Bytes $PosterUnit.Bytes -TimeoutSec 180
            if ($poster.Status -ne 200) { return & $result 'unknown' $null 0 "the poster of the library's copy $($row['id']) answered $(if ($poster.Status) { $poster.Status } else { 'nothing' })" }
            if ($poster.Sha256 -cne $PosterUnit.Sha256) { continue }
        }
        $found.Add([string] $row['id'])
    }
    if ($found.Count -gt 0) { return & $result 'found' $found[0] ($found.Count - 1) $null }
    # A FULL page is no proof of absence: newest first, the upload could sit below it. It is proof once the page reaches
    # a row that was there before the upload (KnownIds): every newer row, the upload included, is then on the page.
    $reachesBack = @($rows | Where-Object { $_ -is [System.Collections.IDictionary] -and $KnownIds -contains [string] $_['id'] }).Count -gt 0
    if ($rows.Count -ge $Take -and -not $reachesBack) {
        return & $result 'unknown' $null 0 ("the media library's newest $Take $($Unit.Kind)s do not reach back to before that upload, so they cannot show whether it is there " +
            '(to send the file anyway, accepting a possible second copy, remove its "pending" mark from the manifest)')
    }
    return & $result 'none' $null 0 $null
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

function Get-MediaUrlSha256 {
    <#
    .SYNOPSIS
        GET <url> and returns @{ Status; Sha256 }: the SHA-256 of the body when it is a 200 of exactly -Bytes bytes,
        else $null (another file). Status is 0 on a network failure. Like Invoke-MediaRangeRequest: no Authorization
        header (media URLs are pre-signed, and the session token never leaves the API host), and redirects are not
        followed. A body longer than -Bytes is not read to the end. -TimeoutSec is ONE deadline for the whole
        download, body included: HttpClient.Timeout stops covering the body once the headers are in
        (ResponseHeadersRead), so a stalled body would otherwise hang the run. Past it, the result is Status 0.
    #>
    param([Parameter(Mandatory)] [string] $Url, [Parameter(Mandatory)] [long] $Bytes, [int] $TimeoutSec = 180)
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan      # the deadline below bounds everything
    $deadline = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSec))
    $hash = [System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        $response = $client.GetAsync($Url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        try {
            $status = [int] $response.StatusCode
            $length = $response.Content.Headers.ContentLength
            if ($status -ne 200 -or ($null -ne $length -and $length -ne $Bytes)) { return [pscustomobject]@{ Status = $status; Sha256 = $null } }
            $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $buffer = [byte[]]::new(81920)
            $total = [long] 0
            while (($read = $stream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()) -gt 0) {
                $total += $read
                if ($total -gt $Bytes) { return [pscustomobject]@{ Status = 200; Sha256 = $null } }
                $hash.AppendData($buffer, 0, $read)
            }
            if ($total -ne $Bytes) { return [pscustomobject]@{ Status = 200; Sha256 = $null } }
            return [pscustomobject]@{ Status = 200; Sha256 = [BitConverter]::ToString($hash.GetHashAndReset()).Replace('-', '').ToLowerInvariant() }
        }
        finally { $response.Dispose() }
    }
    catch { Clear-SeedWebErrors -Exceptions @($_.Exception); return [pscustomobject]@{ Status = 0; Sha256 = $null } }
    finally { $hash.Dispose(); $deadline.Dispose(); $client.Dispose() }
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

function Update-InjectReplies {
    <#
    .SYNOPSIS
        Re-points a kept item's stale replies IN PLACE: PUT /api/injects/{id} with the queue's own content, every
        child echoed by id, and only the stale replyTo values changed (New-InjectRepointBody). The item keeps its
        id, its children and its place in the queue; its version advances. Returns @{ Ok; Row (the item now);
        Puts (requests sent); Detail }.
    .DESCRIPTION
        Anything but a 200 (a 409 for a stale version or an item that stopped being editable, no response, a 5xx)
        re-reads GET /api/injects. If the item already points at the current ids there (the PUT landed), that is
        success. If it is still armable and still stale, the PUT is sent once more with the fresh version and
        content, and if that one fails too, the queue is read once more (a slow PUT may still have landed: S-2).
        Otherwise the outcome is a failure the caller reports as a warning: the run goes on, and the self-check's
        reply line fails. A 400 is not retried; its detail is returned as it is. Only DEAD targets are re-pointed
        (New-InjectLiveness).
    #>
    param(
        [Parameter(Mandatory)] [hashtable] $Context,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $PackItem,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Row,
        [Parameter(Mandatory)] [hashtable] $PostIds,
        [hashtable] $InjectPostIds = @{},
        [AllowNull()] [object] $Liveness
    )
    $id = [string] $Row['id']
    $deadRepairs = { param($Now) @(Get-InjectReplyRepairs -PackItem $PackItem -Row $Now -PostIds $PostIds -InjectPostIds $InjectPostIds -Liveness $Liveness | Where-Object Dead) }
    $readBack = {
        # The item as the queue holds it now, or a reason it cannot be read.
        try { $answer = Invoke-PulseApi -Context $Context -Method GET -Path '/api/injects' }
        catch { return [pscustomobject]@{ Row = $null; Why = "re-reading the run sheet failed too ($($_.Exception.Message.TrimEnd('.')))" } }
        if ($answer.Status -ne 200 -or $answer.Json -isnot [System.Collections.IDictionary]) { return [pscustomobject]@{ Row = $null; Why = "re-reading the run sheet answered $($answer.Status)" } }
        $found = @(Get-SeedList $answer.Json 'items') | Where-Object { [string] $_['id'] -eq $id } | Select-Object -First 1
        if (-not $found) { return [pscustomobject]@{ Row = $null; Why = 'the item is no longer in the run sheet' } }
        return [pscustomobject]@{ Row = $found; Why = $null }
    }
    $result = { param([bool] $Ok, $Now, [int] $Puts, $Detail) [pscustomobject]@{ Ok = $Ok; Row = $Now; Puts = $Puts; Detail = $Detail } }
    $current = $Row
    $puts = 0
    $why = $null
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $repairs = @(& $deadRepairs $current)
        if ($repairs.Count -eq 0) { return & $result $true $current $puts $why }
        $body = New-InjectRepointBody -Row $current -Repairs $repairs
        $response = $null
        $puts++
        try { $response = Invoke-PulseApi -Context $Context -Method PUT -Path "/api/injects/$id" -Body $body }
        catch { $why = $_.Exception.Message.TrimEnd('.') }
        if ($response) {
            if ($response.Status -eq 200 -and $response.Json -is [System.Collections.IDictionary] -and $response.Json['id']) { return & $result $true $response.Json $puts $null }
            if ($response.Status -eq 400) { return & $result $false $current $puts "400: $(Get-ApiErrorText $response -Full)" }
            $why = "PUT /api/injects/{id} answered $($response.Status) $(Get-ApiErrorText $response)".TrimEnd()
        }
        # Look before doing anything else: the PUT may have landed (a slow answer), or someone else changed the item.
        $back = & $readBack
        if (-not $back.Row) { return & $result $false $current $puts "$why; $($back.Why)" }
        if (@(& $deadRepairs $back.Row).Count -eq 0) { return & $result $true $back.Row $puts $why }   # it landed
        if ($attempt -eq 2) { break }
        if (-not (Test-InjectArmable -Row $back.Row)) { return & $result $false $back.Row $puts "$why; the item is now $(Get-InjectStatusText -Row $back.Row)" }
        $current = $back.Row
    }
    return & $result $false $current $puts "$why (also after re-reading it and retrying once with the fresh version)"
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Demo-feedback steps (S1, #510): white noise (story 05, DF-12), exercise pins (04, DF-7) and media marking (01/06,
# DF-3). Each returns a result instead of throwing: nothing after it depends on it, so the run goes on, reports it,
# and the self-check fails on it. That way every run reaches its end, where white noise is turned off.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-NoisePoolChunks {
    <#
    .SYNOPSIS
        The pack's noise entries as PUT /api/staff/noise/pool bodies of at most -Size entries (the server's per-call
        limit): the first replaces the pool, every later one appends to it. Handles become persona ids (step 5 has
        checked them all). Offset is the chunk's first index in the pack's noise list, so a rejection's index maps
        back to noise[Offset + index]. Pure.
    #>
    param(
        [AllowEmptyCollection()] [object[]] $Entries = @(),
        [Parameter(Mandatory)] [hashtable] $PersonaIds,
        [int] $Size = 1000
    )
    for ($offset = 0; $offset -lt $Entries.Count; $offset += $Size) {
        $posts = @(for ($i = $offset; $i -lt [math]::Min($offset + $Size, $Entries.Count); $i++) {
                $handle = [string] $Entries[$i]['persona']
                $personaId = [string] $PersonaIds[$handle]
                if (-not $personaId) { throw "noise[$i]: persona '$handle' has no id." }
                [ordered]@{ persona = $personaId; text = [string] $Entries[$i]['text'] }
            })
        [pscustomobject]@{ Offset = $offset; Body = [ordered]@{ mode = $(if ($offset -eq 0) { 'replace' } else { 'append' }); posts = $posts } }
    }
}

function Import-NoisePool {
    <#
    .SYNOPSIS
        Loads the white-noise pool from the pack (PUT /api/staff/noise/pool, in Get-NoisePoolChunks). The entries
        REPLACE the server's pool, so a re-run leaves the same pool. Returns @{ Ok; PoolSize; Loaded; Rejected
        (@{ Index, into the pack's noise list; Reason, the server's words }); Detail }.
    .DESCRIPTION
        A rejected entry is not a failure: the server applies the rest of the call and lists it, and the caller
        warns about it. A refused call stops the loading: a 400 (a replace none of whose entries could be used
        leaves the pool unchanged and still lists them), 401/403, 404, or no answer. Later chunks are not sent
        then, since they would append to a pool the first one did not replace.
    #>
    param(
        [Parameter(Mandatory)] [hashtable] $Context,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Entries,
        [Parameter(Mandatory)] [hashtable] $PersonaIds,
        [int] $ChunkSize = 1000
    )
    $rejected = [System.Collections.Generic.List[object]]::new()
    $poolSize = $null
    $result = { param([bool] $Ok, $Detail) [pscustomobject]@{ Ok = $Ok; PoolSize = $poolSize; Loaded = $Entries.Count - $rejected.Count; Rejected = $rejected.ToArray(); Detail = $Detail } }
    try {
        foreach ($chunk in @(Get-NoisePoolChunks -Entries $Entries -PersonaIds $PersonaIds -Size $ChunkSize)) {
            $response = Invoke-PulseApi -Context $Context -Method PUT -Path '/api/staff/noise/pool' -Body $chunk.Body
            # A 200 and a refused replace's 400 both carry poolSize and rejected (the 400 as ProblemDetails extensions).
            if ($response.Json -is [System.Collections.IDictionary]) {
                foreach ($rejection in @(Get-SeedList $response.Json 'rejected')) {
                    $rejected.Add([pscustomobject]@{ Index = $chunk.Offset + [int] $rejection['index']; Reason = [string] $rejection['reason'] })
                }
                if ($null -ne $response.Json['poolSize']) { $poolSize = [int] $response.Json['poolSize'] }
            }
            if ($response.Status -eq 200) { continue }
            $why = switch ($response.Status) {
                400 { "400 $(Get-ApiErrorText $response -Full)" }
                404 { '404: this API has no white noise (deploy demo-feedback 05 first)' }
                { $_ -in 401, 403 } { "$_ — loading the noise pool needs a CONTROLLER assigned to this exercise" }
                default { "$_ $(Get-ApiErrorText $response)" }
            }
            return & $result $false "PUT /api/staff/noise/pool (mode $($chunk.Body.mode), entries $($chunk.Offset) on) answered $why"
        }
    }
    catch { return & $result $false $_.Exception.Message.TrimEnd('.') }
    return & $result $true $null
}

function Set-NoiseLevelOff {
    <#
    .SYNOPSIS
        Turns white noise off: PUT /api/staff/noise { level: off } (DF-12). The server changes nothing when the level
        is already off, so every run sends it twice: before seeding (no noise post lands among the seeded ones, and a
        run that stops part-way still leaves it off) and at the end. A seed never leaves noise running. Returns
        @{ Ok; PoolSize; Detail }.
    #>
    param([Parameter(Mandatory)] [hashtable] $Context)
    $result = { param([bool] $Ok, $PoolSize, $Detail) [pscustomobject]@{ Ok = $Ok; PoolSize = $PoolSize; Detail = $Detail } }
    try { $response = Invoke-PulseApi -Context $Context -Method PUT -Path '/api/staff/noise' -Body ([ordered]@{ level = 'off' }) }
    catch { return & $result $false $null $_.Exception.Message.TrimEnd('.') }
    $state = $response.Json
    if ($response.Status -eq 200 -and $state -is [System.Collections.IDictionary] -and [string] $state['level'] -ceq 'off') {
        return & $result $true $state['poolSize'] "level 'off'; the pool holds $($state['poolSize']) entr$(if ($state['poolSize'] -eq 1) { 'y' } else { 'ies' })"
    }
    $why = switch ($response.Status) {
        200 { "PUT /api/staff/noise answered 200 without level 'off'" }
        404 { 'PUT /api/staff/noise -> 404: this API has no white noise (deploy demo-feedback 05 first)' }
        { $_ -in 401, 403 } { "PUT /api/staff/noise -> $_ — turning white noise off needs a CONTROLLER assigned to this exercise" }
        default { "PUT /api/staff/noise -> $_ $(Get-ApiErrorText $response)".TrimEnd() }
    }
    return & $result $false $null $why
}

function Set-ExercisePins {
    <#
    .SYNOPSIS
        Pins each pack pin for everyone: PUT /api/staff/posts/{id}/pin with the post id step 9 resolved. The LAST
        listed goes first: the Pinned tab shows the newest pin first (DF-5), so it then reads in pack order while the
        exercise clock runs. With the clock stopped, PinService stamps the later of the exercise's stored scenario time
        and the post's own, so the tab may follow the posts' own times, or its id tie-break. Idempotent on the server:
        a post already pinned answers 204 and keeps its pin and its time. Returns one @{ Key; PostId; Ok; Detail } per
        pin, in pack order.
    #>
    param(
        [Parameter(Mandatory)] [hashtable] $Context,
        [AllowEmptyCollection()] [string[]] $Keys = @(),
        [Parameter(Mandatory)] [hashtable] $PostIds
    )
    $outcomes = @{}
    for ($i = $Keys.Count - 1; $i -ge 0; $i--) {
        $key = $Keys[$i]
        $postId = [string] $PostIds[$key]
        $outcome = { param([bool] $Ok, $Detail) [pscustomobject]@{ Key = $key; PostId = $postId; Ok = $Ok; Detail = $Detail } }
        if (-not $postId) { $outcomes[$key] = & $outcome $false 'it has no post id (it was not posted)'; continue }
        try { $response = Invoke-PulseApi -Context $Context -Method PUT -Path ('/api/staff/posts/{id}/pin' -replace '\{id\}', $postId) }
        catch { $outcomes[$key] = & $outcome $false $_.Exception.Message.TrimEnd('.'); continue }
        $outcomes[$key] = switch ($response.Status) {
            { $_ -ge 200 -and $_ -lt 300 } { & $outcome $true $null }
            404 { & $outcome $false '404: the post is not in this exercise, or it was taken down' }
            { $_ -in 401, 403 } { & $outcome $false "$_ — pinning for everyone needs a CONTROLLER assigned to this exercise" }
            default { & $outcome $false ("$_ $(Get-ApiErrorText $response)".TrimEnd()) }
        }
    }
    foreach ($key in $Keys) { $outcomes[$key] }
}

function New-ChromeSettingsBody {
    <#
    .SYNOPSIS
        The PUT /api/staff/chrome-settings body that turns media marking on and changes nothing else: every field of
        the settings as GET read them, echoed as it is, except watermarkEnabled (true) and exerciseId (the server's
        own scope, echoed for display; never an input). The PUT is a FULL replace, so a field left out would be
        cleared (a banner text back to the shipped default). Pure.
    #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Current)
    $body = [ordered]@{}
    foreach ($name in @($Current.Keys)) { if ($name -cne 'exerciseId') { $body[$name] = $Current[$name] } }
    $body['watermarkEnabled'] = $true
    return $body
}

function Set-WatermarkOn {
    <#
    .SYNOPSIS
        Makes sure media marking is on (DF-3: the participant app bands every image and video while the exercise's
        watermarkEnabled is true). Reads GET /api/staff/chrome-settings and writes only when watermarkEnabled is
        false: PUT /api/staff/chrome-settings with New-ChromeSettingsBody. The endpoint has no version or ETag, so
        the read and the write go back to back. Returns @{ Ok; Changed; Detail }.
    #>
    param([Parameter(Mandatory)] [hashtable] $Context)
    $result = { param([bool] $Ok, [bool] $Changed, $Detail) [pscustomobject]@{ Ok = $Ok; Changed = $Changed; Detail = $Detail } }
    $refusal = {
        param($Response, [string] $Call)
        switch ($Response.Status) {
            404 { "$Call -> 404 (this API has no chrome settings, or no exercise for this host)" }
            { $_ -in 401, 403 } { "$Call -> $_ — the staff user must be assigned to this exercise" }
            default { "$Call -> $_ $(Get-ApiErrorText $Response)".TrimEnd() }
        }
    }
    try {
        $read = Invoke-PulseApi -Context $Context -Method GET -Path '/api/staff/chrome-settings'
        if ($read.Status -ne 200) { return & $result $false $false (& $refusal $read 'GET /api/staff/chrome-settings') }
        $current = $read.Json
        if ($current -isnot [System.Collections.IDictionary] -or $current['chromeEnabled'] -isnot [bool] -or $current['watermarkEnabled'] -isnot [bool]) {
            return & $result $false $false 'GET /api/staff/chrome-settings answered without chromeEnabled and watermarkEnabled, so nothing was written'
        }
        if ($current['watermarkEnabled']) { return & $result $true $false 'watermarkEnabled was already on; nothing was sent' }
        $write = Invoke-PulseApi -Context $Context -Method PUT -Path '/api/staff/chrome-settings' -Body (New-ChromeSettingsBody -Current $current)
        if ($write.Status -eq 200 -and $write.Json -is [System.Collections.IDictionary] -and $write.Json['watermarkEnabled'] -eq $true) {
            return & $result $true $true 'watermarkEnabled turned on; every other chrome setting was sent back as read'
        }
        return & $result $false $false (& $refusal $write 'PUT /api/staff/chrome-settings')
    }
    catch { return & $result $false $false $_.Exception.Message.TrimEnd('.') }
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
        [object] $InjectPlan, [object[]] $Repoint = @(), [switch] $ReloadFired, [switch] $LeaveEngineRunning, [int] $TopLevel, [switch] $Offline,
        [string] $RunSheet = 'all', [AllowEmptyCollection()] [string[]] $Pins = @(), [int] $NoiseCount = 0
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
    $leftItems = @(if ($InjectPlan) { $InjectPlan.Left })
    if ($sheetItems.Count -eq 0 -and $leftItems.Count -eq 0) { Write-Host '  Run sheet       none in the pack (nothing to load)' }
    elseif ($sheetItems.Count -eq 0 -and $RunSheet -eq 'none') {
        Write-Host ("  Run sheet       -RunSheet none: none of the pack's {0} item(s) is loaded, and the console's queue is not read or touched" -f $leftItems.Count)
    }
    else {
        $creating = @($sheetItems | Where-Object Action -in 'create', 'reload')
        $scripted = [long] ($creating | Measure-Object -Property PostCount -Sum).Sum
        $reloading = @($creating | Where-Object Action -eq 'reload').Count
        $spent = @($InjectPlan.NotArmable).Count
        Write-Host ("  Run sheet       {0} item(s) to create ({1} scripted post(s), each pending in the console's queue{2}); {3} already loaded{4}{5}" -f
            $creating.Count, $scripted, $(if ($reloading) { "; $reloading fresh cop$(if ($reloading -eq 1) { 'y' } else { 'ies' }) of spent items" }), $InjectPlan.Done,
            $(if ($spent) { ", $spent of them NOT armable (the console has nothing to fire)" }),
            $(if ($leftItems.Count) { "; $($leftItems.Count) left out by -RunSheet $RunSheet" }))
        foreach ($item in $creating) {
            $why = if ($item.Reason -ne 'new') { "; $($item.Reason)" } else { '' }
            Write-Host ("                    + {0}  {1,-5}  ""{2}"" ({3} post{4}){5}" -f $item.Key, $item.Kind, $item.Title, $item.PostCount, $(if ($item.PostCount -eq 1) { '' } else { 's' }), $why) -ForegroundColor DarkGray
        }
        foreach ($item in $sheetItems | Where-Object Action -notin 'create', 'reload') {
            # = loaded and armable; ! loaded but spent (a rehearsal's); x refused (-ReloadFiredRunSheet on a firing item)
            $mark = if ($item.Action -eq 'refuse') { 'x' } elseif ($item.Armable -eq $false) { '!' } else { '=' }
            $note = if ($mark -eq '!') { ' — NOT armable: the console has nothing to fire (rehearsal?)' } else { '' }
            Write-Host ("                    {0} {1}  {2}{3}" -f $mark, $item.Key, $item.Reason, $note) -ForegroundColor $(if ($mark -eq '=') { 'DarkGray' } else { 'Yellow' })
        }
        # - left out by -RunSheet: never created, adopted, re-pointed or checked (the MSEL import adds the msel ones)
        foreach ($item in $leftItems) {
            Write-Host ("                    - {0}  {1,-5}  ""{2}"" ({3} post{4}); {5}" -f $item.Key, $item.Kind, $item.Title, $item.PostCount,
                $(if ($item.PostCount -eq 1) { '' } else { 's' }), $item.Reason) -ForegroundColor DarkGray
        }
    }
    $repointing = @($Repoint | Where-Object { $_ })
    if ($repointing.Count -gt 0 -or ($Offline -and $sheetItems.Count -gt 0)) {
        Write-Host (("  Re-point        {0} kept item(s) whose reply target gets a new id: " -f $repointing.Count) + 'PUT /api/injects/{id} in place (same item, same place in the queue; only the stale reply changes)')
        foreach ($row in $repointing) { Write-Host ("                    ~ {0}  {1}" -f $row.Key, ($row.Labels -join '; ')) -ForegroundColor DarkGray }
        if ($Offline) { Write-Host '                    (-WhatIf cannot see the feed or the queue: a live run re-points every kept item whose reply target was posted or loaded again)' -ForegroundColor DarkGray }
    }
    if ($ReloadFired) {
        $when = if ($Offline) { ' (-WhatIf cannot see statuses: a live run decides which items are spent)' } else { '' }
        Write-Host "  Reload          -ReloadFiredRunSheet: each loaded item that is fired, skipped, failed or held part-way gets a fresh copy; the old one is never touched$when"
    }
    if ($Pins.Count -gt 0) { Write-Host ("  Pins            {0} post(s) pinned for everyone, in this order on the Pinned tab while the exercise clock runs: {1} (one already pinned stays as it is)" -f $Pins.Count, ($Pins -join ', ')) }
    else { Write-Host '  Pins            none in the pack' }
    $level = 'level: off before seeding and again at the end (a seed never leaves noise running)'
    if ($NoiseCount -gt 0) { Write-Host ("  White noise     pool: replaced by the pack's {0} entr{1}; {2}" -f $NoiseCount, $(if ($NoiseCount -eq 1) { 'y' } else { 'ies' }), $level) }
    else { Write-Host "  White noise     pool: none in the pack, so the server's pool is left as it is; $level" }
    Write-Host '  Media marking   watermarkEnabled on before any media is posted: read first, written only when off, every other chrome setting sent back as read'
    if ($LeaveEngineRunning) { Write-Host '  Engine          left as it is (-LeaveEngineRunning)' }
    else { Write-Host '  Engine          pause tier: at least "engine" before the posts and again after seeding (a stricter tier is left as it is)' }
    $sheetCheck = if ($sheetItems.Count -gt 0) { "; every run-sheet item in GET /api/injects with its posts, and armable (pending, or held with nothing out)" } else { '' }
    $pinCheck = if ($Pins.Count -gt 0) { '; pinnedForAll on every pin' } else { '' }
    Write-Host ("  Self-check      GET /api/feed shows >= {0} top-level post(s); Range bytes=0-1 -> 206 on every media URL{1}{2}; white noise off; media marking on" -f $TopLevel, $sheetCheck, $pinCheck)
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
        [switch] $ReloadFiredRunSheet,
        [ValidateSet('all', 'exceptMsel', 'none')] [string] $RunSheet = 'all',
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
    # The rule that depends on -RunSheet, once the pack itself is sound.
    if ($problems.Count -eq 0) { $problems = @(Test-RunSheetSelection -Pack $pack -RunSheet $RunSheet) }
    if ($problems.Count -gt 0) {
        foreach ($problem in $problems) { Write-SeedLine FAIL ("{0}: {1}  [{2}]" -f $problem.Where, $problem.Message, $problem.Code) }
        Write-Host "`n$($problems.Count) problem(s) in $packFull. Nothing was sent." -ForegroundColor Red
        return 1
    }
    $units = @(Get-PackUploadUnits -Pack $pack -PackRoot $packRoot)
    $posts = @(Get-SeedList $pack 'posts')
    $topLevel = @($posts | Where-Object { -not $_['replyTo'] }).Count
    $allSheetItems = @(Get-RunSheetItems -Pack $pack)
    $sheetItems = @(Get-RunSheetItems -Pack $pack -RunSheet $RunSheet)          # the ones this run loads
    $sheetPosts = [long] ($allSheetItems | ForEach-Object { @(Get-SeedList $_ 'posts').Count } | Measure-Object -Sum).Sum
    $noise = @(Get-SeedList $pack 'noise')
    $pinKeys = @(Get-SeedList $pack 'pins' | ForEach-Object { [string] $_ })
    Write-SeedLine PASS ("{0}: {1} persona edit(s), {2} file(s) ({3}), {4} post(s) ({5} top-level), {6} run-sheet item(s) ({7} scripted post(s)), {8} noise entr{9}, {10} pin(s){11}" -f
        (Split-Path -Leaf $packFull), @(Get-SeedList $pack 'personas').Count, $units.Count, (Format-Bytes ([long] ($units | Measure-Object -Property Bytes -Sum).Sum)),
        $posts.Count, $topLevel, $allSheetItems.Count, $sheetPosts, $noise.Count, $(if ($noise.Count -eq 1) { 'y' } else { 'ies' }), $pinKeys.Count,
        $(if ($sheetItems.Count -ne $allSheetItems.Count) { "; -RunSheet $RunSheet loads $($sheetItems.Count) of the run-sheet items" }))

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
        $injectPlan = Get-InjectPlan -Pack $pack -Manifest $manifest -Queue $null -PersonaIds $null -ReloadFired:$ReloadFiredRunSheet -RunSheet $RunSheet
        $repointPlan = @(Get-InjectRepointPlan -InjectPlan $injectPlan -PostPlan $postPlan)
        Write-SeedPlan -UploadPlan $uploadPlan -PersonaPlan $personaPlan -PostPlan $postPlan -Anchor $anchor -InjectPlan $injectPlan -Repoint $repointPlan `
            -ReloadFired:$ReloadFiredRunSheet -LeaveEngineRunning:$LeaveEngineRunning -TopLevel $topLevel -Offline -RunSheet $RunSheet -Pins $pinKeys -NoiseCount $noise.Count
        foreach ($warning in @($injectPlan.Warnings)) { Write-SeedLine WARN $warning }
        if ($anchor.Error) { Write-SeedLine WARN "A live run would stop here: $($anchor.Error)" }
        elseif ($anchor.Anchor) { foreach ($problem in @(Test-SeedReplyTimes -PostPlan $postPlan -Anchor $anchor.Anchor)) { Write-SeedLine WARN "A live run would stop here: $problem" } }
        Write-Host "`nWhatIf: nothing was sent or written. Sign-in, uploads, edits, posts, pins, the run sheet, the white-noise pool and level, media marking and the pause tier were all skipped." -ForegroundColor Cyan
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

    $seedingStarted = $false                        # step 5 reached: writes have begun
    $noiseEndedOff = $false                         # step 12 confirmed white noise off
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
        # Every run-sheet item, loaded or not: an item left for the MSEL import needs its persona in the exercise too.
        foreach ($sheetItem in $allSheetItems) { foreach ($sheetPost in @(Get-SeedList $sheetItem 'posts')) { $named.Add([string] $sheetPost['persona']) } }
        foreach ($entry in $noise) { $named.Add([string] $entry['persona']) }
        $unknown = @($named | Sort-Object -Unique | Where-Object { -not $personaByHandle.Contains($_) })
        if ($unknown.Count -gt 0) {
            Write-SeedLine FAIL ("unknown persona handle(s): {0}. Nothing was written." -f ($unknown -join ', '))
            Write-Host ("  Known handles in this exercise: {0}" -f ((@($personaByHandle.Values | ForEach-Object { ([string] $_['handle']).TrimStart('@') }) | Sort-Object) -join ', '))
            return 1
        }
        Write-SeedLine PASS "$($personaByHandle.Count) personas; every handle the pack names exists"
        $personaIds = @{}
        foreach ($handle in $personaByHandle.Keys) { $personaIds[$handle] = [string] $personaByHandle[$handle]['id'] }

        # The rows are kept too: an upload whose answer is lost is looked for among the rows that were NOT here yet.
        $library = @{ Ids = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase); Complete = @{}; Rows = @{} }
        foreach ($kind in 'image', 'video') {
            $response = Invoke-PulseApi -Context $context -Method GET -Path "/api/staff/media?kind=$kind&take=$($limits.LibraryTake)"
            if ($response.Status -eq 503) { Write-SeedLine FAIL 'the media store is unavailable (503): uploads and media posts would fail. Check the UAT blob storage first.'; return 1 }
            if ($response.Status -ne 200) { Write-SeedLine FAIL "GET /api/staff/media -> $($response.Status) $(Get-ApiErrorText $response)"; return 1 }
            $rows = @($response.Json)
            foreach ($row in $rows) { [void] $library.Ids.Add([string] $row['id']) }
            $library.Complete[$kind] = $rows.Count -lt $limits.LibraryTake
            $library.Rows[$kind] = $rows
        }
        Write-SeedLine PASS "media library: $($library.Ids.Count) asset(s)"

        $response = Invoke-PulseApi -Context $context -Method GET -Path '/api/feed?includeReplies=true'
        if ($response.Status -ne 200) { Write-SeedLine FAIL "GET /api/feed -> $($response.Status) $(Get-ApiErrorText $response)"; return 1 }
        $feed = @($response.Json)
        Write-SeedLine PASS "feed: $($feed.Count) post(s) and replies$(if ($feed.Count -ge $limits.FeedTake) { " (at the $($limits.FeedTake)-post cap)" })"

        # The run sheet (inject queue, inject-queue 06): what is already loaded, and who the assignees are. Read when
        # -RunSheet loads an item, or leaves out an msel item an earlier run recorded (so the plan can warn about that
        # seeded copy even when every item is msel). With none, or a pack without a run sheet, it is not read at all.
        $injectQueue = $null
        $assigneeIds = [hashtable]::new([StringComparer]::OrdinalIgnoreCase)
        $recordedLeft = @(Get-RunSheetItems -Pack $pack -RunSheet $RunSheet -Left | Where-Object { $_['msel'] -and $manifest['injects'].Contains([string] $_['key']) })
        if ($sheetItems.Count -gt 0 -or ($RunSheet -ne 'none' -and $recordedLeft.Count -gt 0)) {
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
                    if ($assignees.Unknown -icontains 'me') { Write-Host "  ""me"" is $StaffUsername, who is not on this exercise's assignee list: assign them in the console, or name another assignee." -ForegroundColor Yellow }
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
        $injectPlan = Get-InjectPlan -Pack $pack -Manifest $manifest -Queue $injectQueue -PersonaIds $personaIds -ReloadFired:$ReloadFiredRunSheet -RunSheet $RunSheet
        # Which reply targets are dead (S1c L-1): only those are ever re-pointed. Retired = every post this machine
        # seeded before (snapshot now: step 8 overwrites the manifest's ids); superseded = every old copy of a
        # reloaded item, from the manifest and from this plan.
        $retiredPostIds = @(foreach ($seeded in @($manifest['posts'].Values)) { [string] $seeded['postId'] })
        $supersededItemIds = @(foreach ($loaded in @($manifest['injects'].Values)) { Get-SeedList $loaded 'superseded' }) + @($injectPlan.Items | ForEach-Object Replaces | Where-Object { $_ })
        $liveness = New-InjectLiveness -LivePostIds @($feed | ForEach-Object { [string] $_['id'] }) -RetiredPostIds $retiredPostIds `
            -FeedComplete ($feed.Count -lt $limits.FeedTake) -Queue $injectQueue -SupersededItemIds $supersededItemIds
        $repointPlan = @(Get-InjectRepointPlan -InjectPlan $injectPlan -PostPlan $postPlan -Liveness $liveness)
        Write-Host "`nPlan" -ForegroundColor Cyan
        Write-SeedPlan -UploadPlan $uploadPlan -PersonaPlan $personaPlan -PostPlan $postPlan -Anchor $anchor -InjectPlan $injectPlan -Repoint $repointPlan `
            -ReloadFired:$ReloadFiredRunSheet -LeaveEngineRunning:$LeaveEngineRunning -TopLevel $topLevel -RunSheet $RunSheet -Pins $pinKeys -NoiseCount $noise.Count
        foreach ($warning in @($postPlan.Warnings) + @($injectPlan.Warnings)) { Write-SeedLine WARN $warning }
        if ($anchor.Error) { Write-SeedLine FAIL "$($anchor.Error) Nothing was written."; return 1 }
        if ($injectPlan.Refused.Count -gt 0) {
            foreach ($entry in $injectPlan.Refused) { Write-SeedLine FAIL "$($entry.Key) $($entry.Reason). Nothing was written." }
            return 1
        }
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
        $seedingStarted = $true                     # from here on, the run ends with white noise off (see finally)
        $frozenWarning = 'the world is FROZEN. A frozen server clock falls behind: run-sheet fires and engine posts would be stamped in the past and never trend. ' +
            'Unless it was frozen on purpose just now, run Reset-DemoState.ps1 -Restart, wait ~8 minutes, run Reset-DemoState.ps1, then this script again.'
        $pause = $null
        if ($LeaveEngineRunning) {
            Write-Host "`n5. Before seeding: engine left as it is (-LeaveEngineRunning); white noise off; media marking on" -ForegroundColor Cyan
            # Not touched, but still looked at once: a world left frozen overnight is the demo-week hazard (S1c S-4).
            $tierNow = $null
            try { $tierNow = Invoke-PulseApi -Context $context -Method GET -Path '/api/steering/pause-tier' } catch { $tierNow = $null }
            if ($tierNow -and $tierNow.Status -eq 200 -and $tierNow.Json -is [System.Collections.IDictionary]) {
                Write-SeedLine INFO "pause tier: '$($tierNow.Json['tier'])' (left as it is)"
                if ([string] $tierNow.Json['tier'] -eq 'freeze') { Write-SeedLine WARN $frozenWarning }
            }
        }
        else {
            Write-Host "`n5. Before seeding: engine paused; white noise off; media marking on" -ForegroundColor Cyan
            $pause = Set-EnginePauseTier -Context $context -ActingHumanId $actingHumanId -TimeZone $exercise.TimeZone
            if ($pause.Ok) { Write-SeedLine PASS "pause tier: $($pause.Detail)" } else { Write-SeedLine WARN "pause tier not set ($($pause.Detail)); the engine may react to the seeded posts" }
            if ($pause.Tier -eq 'freeze') { Write-SeedLine WARN $frozenWarning }
        }
        # White noise off before anything is posted (a noise post must not land among the seeded ones, and a run that
        # stops part-way leaves it off), and media marking on before any media is posted (DF-3, NFR-008).
        $noiseOff = Set-NoiseLevelOff -Context $context
        if ($noiseOff.Ok) { Write-SeedLine PASS "white noise: $($noiseOff.Detail)" } else { Write-SeedLine WARN "white noise not turned off ($($noiseOff.Detail)); it is tried again at the end" }
        $marking = Set-WatermarkOn -Context $context
        if ($marking.Ok) { Write-SeedLine PASS "media marking: $($marking.Detail)" } else { Write-SeedLine FAIL "media marking: $($marking.Detail)" }

        # ── 6. Upload media: posters first, then images, then videos with posterMediaId ────────────────────────
        Write-Host "`n6. Upload media" -ForegroundColor Cyan
        $assetIds = @{}
        # Every asset the manifest accounts for, plus each one reused, uploaded or adopted below: never adopted as
        # another file's lost upload.
        $claimedAssets = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($known in @($manifest['files'].Values)) {
            foreach ($field in 'assetId', 'posterAssetId') { if ($known -is [System.Collections.IDictionary] -and $known[$field]) { [void] $claimedAssets.Add([string] $known[$field]) } }
        }
        $me = $StaffUsername.ToLowerInvariant()
        $posterOf = { param($Unit) if ($Unit.Kind -eq 'video' -and $Unit.PosterFile) { $units | Where-Object File -ceq $Unit.PosterFile | Select-Object -First 1 } else { $null } }

        # Every look-up first, before anything is sent. An earlier run sent these bytes (and this poster's bytes) and got
        # no clear answer, or stopped mid-upload: the asset may be in the library already. A video found here carries the
        # poster it was sent with, so that poster is kept below, never sent again, even when this run's staff user could
        # not reuse it for a NEW video upload (the server's same-uploader rule).
        $early = @{}
        foreach ($item in @($uploadPlan | Where-Object Action -eq 'upload')) {
            $unit = $item.Unit
            $posterUnit = & $posterOf $unit
            $previous = if ($manifest['files'].Contains($unit.File)) { $manifest['files'][$unit.File] } else { $null }
            if (-not (Test-PendingUpload -Entry $previous -Unit $unit -PosterUnit $posterUnit)) { continue }
            $earlier = $previous['pending']
            $found = Find-UploadedMediaAsset -Context $context -Unit $unit -PosterUnit $posterUnit -KnownIds @(Get-SeedList $earlier 'knownIds') -Claimed $claimedAssets
            if ($found.Outcome -eq 'unknown') {
                Write-SeedLine FAIL "$($unit.File): an earlier upload of it got no clear answer, and the media library cannot tell now whether it was stored: $($found.Detail)."
                Write-Host '  Nothing was sent for it. Wait about a minute, then run the same command again.' -ForegroundColor Yellow
                return 1
            }
            if ($found.Outcome -eq 'found') {
                # Recorded with what THAT upload sent: its uploader and its poster (the poster it carries).
                [void] $claimedAssets.Add([string] $found.AssetId)
                $early[$unit.File] = [pscustomobject]@{
                    Outcome = 'adopted'; AssetId = $found.AssetId; Detail = 'an earlier upload of it got no clear answer'; Others = $found.Others
                    UploadedBy = $(if ($earlier['uploadedBy']) { [string] $earlier['uploadedBy'] } else { $me })
                    PosterAssetId = $(if ($posterUnit) { [string] $earlier['posterAssetId'] } else { $null })
                }
            }
        }

        foreach ($item in $uploadPlan) {
            $unit = $item.Unit
            if ($item.Action -eq 'reuse') {
                $assetIds[$unit.File] = $item.AssetId
                [void] $claimedAssets.Add([string] $item.AssetId)
                Write-SeedLine SKIP "$($unit.File) — already uploaded ($($item.AssetId))"
                continue
            }
            $posterUnit = & $posterOf $unit
            $posterId = if ($posterUnit) { [string] $assetIds[$unit.PosterFile] } else { $null }
            $previous = if ($manifest['files'].Contains($unit.File)) { $manifest['files'][$unit.File] } else { $null }
            $marked = $null
            $outcome = $early[$unit.File]                                           # found above: nothing to send

            # A poster planned to be sent again only for its videos' uploads, when each of them was found above: no
            # upload needs it any more, so the copy already uploaded stays (the found video carries its own poster).
            if (-not $outcome -and $unit.Roles.Contains('poster') -and $previous -is [System.Collections.IDictionary] -and $previous['assetId'] -and [string] $previous['sha256'] -ceq $unit.Sha256) {
                $sending = @($uploadPlan | Where-Object { $_.Unit.PosterFile -ceq $unit.File -and $_.Action -eq 'upload' -and -not $early.Contains($_.Unit.File) })
                if ($sending.Count -eq 0) {
                    $assetIds[$unit.File] = [string] $previous['assetId']
                    [void] $claimedAssets.Add([string] $previous['assetId'])
                    Write-SeedLine SKIP "$($unit.File) — kept ($($previous['assetId'])): its video's earlier upload was found in the media library, so no new upload needs it"
                    continue
                }
            }

            if (-not $outcome) {
                $form = [ordered]@{ file = (Get-Item -LiteralPath $unit.Path); kind = $unit.Kind }
                if ($null -ne $unit.Width) { $form['width'] = ([long] $unit.Width).ToString([Globalization.CultureInfo]::InvariantCulture) }
                if ($null -ne $unit.Height) { $form['height'] = ([long] $unit.Height).ToString([Globalization.CultureInfo]::InvariantCulture) }
                if ($unit.Kind -eq 'video' -and $null -ne $unit.DurationSec) { $form['durationSec'] = ([double] $unit.DurationSec).ToString('R', [Globalization.CultureInfo]::InvariantCulture) }
                if ($posterUnit) { $form['posterMediaId'] = $posterId }
                # Rows the library held before this upload: those of this name (none can be the asset it stores) and the
                # newest few (a later look-up's page that reaches one of them reaches back past the upload).
                $name = Get-MediaUploadFileName -Path $unit.Path
                $before = @(@($library.Rows[$unit.Kind]) | Where-Object { $_ -is [System.Collections.IDictionary] })
                $known = @(@($before | Where-Object { $null -eq $name -or [string] $_['fileName'] -ceq $name }) + @($before | Select-Object -First 10) |
                        ForEach-Object { [string] $_['id'] } | Select-Object -Unique)
                # Marked pending BEFORE it is sent: a run that stops, or is interrupted, before a clear answer leaves
                # the mark, and the next run looks for this upload (above) before sending the file again.
                $marked = [ordered]@{}
                if ($previous -is [System.Collections.IDictionary]) { foreach ($key in $previous.Keys) { if ($key -ne 'pending') { $marked[$key] = $previous[$key] } } }
                $marked['pending'] = [ordered]@{
                    sha256 = $unit.Sha256; posterAssetId = $posterId; posterSha256 = $(if ($posterUnit) { $posterUnit.Sha256 } else { $null })
                    knownIds = $known; uploadedBy = $me; sentAt = Format-SeedInstant ([DateTimeOffset]::UtcNow)
                }
                $manifest['files'][$unit.File] = $marked
                Save-SeedManifest -Manifest $manifest -Path $manifestPath
                $outcome = Add-MediaAsset -Context $context -Form $form -Unit $unit -PosterUnit $posterUnit -KnownIds $known -Claimed $claimedAssets
                $outcome | Add-Member -NotePropertyName UploadedBy -NotePropertyValue $me
                $outcome | Add-Member -NotePropertyName PosterAssetId -NotePropertyValue $posterId
            }

            switch ($outcome.Outcome) {
                { $_ -in 'refused', 'failed' } {
                    # A clear "no": nothing was stored, so the pending mark goes (an earlier one was looked for above).
                    $kept = [ordered]@{}
                    foreach ($key in $marked.Keys) { if ($key -ne 'pending') { $kept[$key] = $marked[$key] } }
                    if ($kept.Count -gt 0) { $manifest['files'][$unit.File] = $kept } else { $manifest['files'].Remove($unit.File) }
                    Save-SeedManifest -Manifest $manifest -Path $manifestPath
                    $why = switch ($outcome.Status) {
                        400 { "400 $($outcome.Detail)" }
                        413 { '413: larger than the server accepts' }
                        415 { "415 $($outcome.Detail)" }
                        429 { '429: still rate-limited after retries; wait a minute and run again with -Resume' }
                        { $_ -in 401, 403 } { "$_ — this staff user may not upload in this exercise" }
                        default { "$_ $($outcome.Detail)" }
                    }
                    Write-SeedLine FAIL "$($unit.File): $why"
                    Write-Host '  Progress so far is in the manifest; fix the cause and run again (uploads already made are reused).' -ForegroundColor Yellow
                    return 1
                }
                'uncertain' {
                    Write-SeedLine FAIL "$($unit.File): $($outcome.Detail)."
                    Write-Host '  It may or may not have been stored, so it was NOT sent again (that could store it twice). Wait about a minute' -ForegroundColor Yellow
                    Write-Host '  (the server may still be finishing it), then run the same command again. The media library is checked first,' -ForegroundColor Yellow
                    Write-Host '  and the asset that upload stored (same kind, name and bytes) is adopted instead of sent again.' -ForegroundColor Yellow
                    return 1
                }
            }
            $assetId = [string] $outcome.AssetId
            $assetIds[$unit.File] = $assetId
            [void] $claimedAssets.Add($assetId)
            # Recorded exactly as a 201 would be; an adopted asset says when it was adopted instead of uploaded.
            $entry = [ordered]@{ assetId = $assetId; sha256 = $unit.Sha256; kind = $unit.Kind; bytes = $unit.Bytes; uploadedBy = $outcome.UploadedBy }
            $entry[$(if ($outcome.Outcome -eq 'adopted') { 'adoptedAt' } else { 'uploadedAt' })] = Format-SeedInstant ([DateTimeOffset]::UtcNow)
            if ($posterUnit) {
                $entry['posterAssetId'] = $outcome.PosterAssetId
                $entry['posterSha256'] = $posterUnit.Sha256
            }
            $manifest['files'][$unit.File] = $entry
            Update-SeedManifestMediaKeys -Manifest $manifest -Pack $pack
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
            if ($outcome.Outcome -eq 'adopted') {
                $extra = if ($outcome.Others -gt 0) { " ($($outcome.Others) more stored cop$(if ($outcome.Others -eq 1) { 'y' } else { 'ies' }) of it stay unused in the library; participants never see them)" } else { '' }
                Write-SeedLine WARN ("{0} — {1}; the asset it stored (same kind, name and bytes) was found in the media library and adopted, not sent again -> {2}{3}" -f
                    $unit.File, $outcome.Detail, $assetId, $extra)
            }
            else { Write-SeedLine PASS ("{0} — uploaded ({1}, {2}) -> {3}" -f $unit.File, $unit.Kind, (Format-Bytes $unit.Bytes), $assetId) }
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

        # ── 9. Exercise pins (demo-feedback 04, DF-7): the pack's pins, pinned for everyone ─────────────────────────
        Write-Host "`n9. Pin posts for everyone" -ForegroundColor Cyan
        $pinResults = @()
        if ($pinKeys.Count -eq 0) { Write-SeedLine SKIP 'the pack pins no post' }
        else {
            $pinResults = @(Set-ExercisePins -Context $context -Keys $pinKeys -PostIds $postIds)
            foreach ($pin in $pinResults) {
                if ($pin.Ok) { Write-SeedLine PASS "$($pin.Key) — pinned for everyone ($($pin.PostId))" } else { Write-SeedLine FAIL "$($pin.Key) not pinned: $($pin.Detail)" }
            }
        }

        # ── 10. Run sheet: one inject item per pack item -RunSheet loads, through POST /api/injects (inject-queue 06) ─
        Write-Host "`n10. Load the run sheet (the console's inject queue)" -ForegroundColor Cyan
        $injectIds = @{}            # run-sheet item key → inject item id
        $injectPostIds = @{}        # run-sheet item key → its post ids in sequence order (for replies from later items)
        # Every id the manifest accounts for (current and superseded), plus each one adopted or created below.
        $claimedItems = $injectPlan.Claimed
        if ($injectPlan.Items.Count -eq 0 -and @($injectPlan.Left).Count -eq 0) { Write-SeedLine SKIP 'the pack has no run-sheet items' }
        # Left out by -RunSheet (the MSEL import adds the msel ones on stage): never created, adopted, re-pointed or checked.
        foreach ($left in @($injectPlan.Left)) { Write-SeedLine SKIP "$($left.Key) — $($left.Reason)" }
        if ($injectPlan.ToCreate -gt 0) {
            $manifest['completedAt'] = $null
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
        }
        $recordItem = {
            # The manifest entry for one item: its current id, and every id it replaced (superseded: never adopted again).
            param($Entry, [string] $ItemId, [string] $Stamp)
            $superseded = [System.Collections.Generic.List[string]]::new()
            foreach ($old in @($Entry.Superseded) + @($Entry.Replaces)) {
                if ($old -and [string] $old -ne $ItemId -and -not $superseded.Contains([string] $old)) { $superseded.Add([string] $old) }
            }
            $record = [ordered]@{ itemId = $ItemId; kind = $Entry.Kind; title = $Entry.Title; posts = $Entry.PostCount }
            $record[$Stamp] = Format-SeedInstant ([DateTimeOffset]::UtcNow)
            if ($superseded.Count -gt 0) { $record['superseded'] = $superseded.ToArray() }
            $manifest['injects'][$Entry.Key] = $record
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
        }
        $rerun = 'run the same command again (no -Resume needed: the posts are all in)'
        foreach ($id in @($postIds.Values)) { if ($id) { [void] $liveness.Live.Add([string] $id) } }   # this run's posts are live
        foreach ($entry in $injectPlan.Items) {
            $item = $entry.Item
            if ($entry.Action -in 'skip', 'adopt') {
                $injectIds[$entry.Key] = $entry.ItemId
                $injectPostIds[$entry.Key] = @(Get-InjectChildIds -Row $entry.Row)
                if ($entry.Action -eq 'adopt') { & $recordItem $entry $entry.ItemId 'adoptedAt' }
                if ($entry.Armable -eq $false) {
                    Write-SeedLine WARN "$($entry.Key) — $($entry.Reason) ($($entry.ItemId)): NOT armable, the console has nothing to fire"
                    continue
                }
                Write-SeedLine SKIP "$($entry.Key) — $($entry.Reason) ($($entry.ItemId))"
                # Re-point a stale reply IN PLACE (the Tuesday re-seed: Clear-DemoContent archived the posts and
                # step 8 posted them again under new ids). Deleting and re-creating would lose its place in the queue.
                $differ = @(Get-InjectReplyRepairs -PackItem $item -Row $entry.Row -PostIds $postIds -InjectPostIds $injectPostIds -Liveness $liveness)
                $repairs = @($differ | Where-Object Dead)
                # A LIVE target that differs from the pack is a console re-target: warned about (below), never written.
                $retargeted = @($differ | Where-Object { -not $_.Dead } | ForEach-Object { "post $($_.Sequence)'s reply (re-targeted to another live post, not the pack's $($_.Target))" })
                if ($repairs.Count -gt 0) {
                    $repoint = Update-InjectReplies -Context $context -PackItem $item -Row $entry.Row -PostIds $postIds -InjectPostIds $injectPostIds -Liveness $liveness
                    $what = ($repairs | ForEach-Object { "post $($_.Sequence)'s reply to $($_.Target)" }) -join ', '
                    if ($repoint.Ok) {
                        Write-SeedLine PASS ("{0} — re-pointed {1} in place: same item, order {2}, version {3} -> {4}" -f
                            $entry.Key, $what, $repoint.Row['order'], $entry.Row['version'], $repoint.Row['version'])
                        $entry.Row = $repoint.Row
                    }
                    else {
                        Write-SeedLine WARN ("{0}: could not re-point {1} in place ({2}). It still replies to the earlier copy of {3}, so at fire it would fail or answer the old post. Run again, or delete {0} in the console and run again (that re-creates it at the end of the queue)." -f
                            $entry.Key, $what, $repoint.Detail, (@($repairs | ForEach-Object Label) -join ', '))
                        if ($repoint.Row) { $entry.Row = $repoint.Row }
                    }
                }
                $drift = @(Get-InjectContentDrift -PackItem $item -Row $entry.Row -MediaIds $mediaIds) + $retargeted
                if ($drift.Count -gt 0) {
                    Write-SeedLine WARN ("{0} differs from the pack in {1} (edited in the console, or the pack or its media changed after it was loaded); the queue's version stays. To load the pack's version, delete {0} in the console and run again." -f
                        $entry.Key, ($drift -join ', '))
                }
                continue
            }
            # create, or reload (a fresh copy of a spent item; the old one is never touched)
            $assigneeId = if ($item['assignee'] -is [string]) { [string] $assigneeIds[$item['assignee'].Trim()] } else { $null }
            $body = New-InjectRequestBody -Item $item -PersonaIds $personaIds -MediaIds $mediaIds -MediaAlt $mediaAlt -PostIds $postIds `
                -InjectPostIds $injectPostIds -AssigneeId $assigneeId
            $outcome = Add-InjectItem -Context $context -Body $body -PackItem $item -PersonaIds $personaIds -Claimed $claimedItems
            switch ($outcome.Outcome) {
                'refused' {
                    # The server's own reason, as it wrote it (a ProblemDetails "detail").
                    Write-SeedLine FAIL "$($entry.Key) refused (400): $($outcome.Detail)"
                    Write-Host "  Nothing was created for it. Fix the pack (or the exercise), then $rerun; items already loaded are skipped." -ForegroundColor Yellow
                    return 1
                }
                'failed' {
                    $why = switch ($outcome.Status) {
                        429 { "429: still rate-limited after retries; wait a minute, then $rerun" }
                        404 { '404: this API has no inject queue (deploy inject-queue 06 first)' }
                        { $_ -in 401, 403 } { "$_ — loading the run sheet needs a CONTROLLER assigned to this exercise" }
                        default { "$_ $($outcome.Detail)" }
                    }
                    Write-SeedLine FAIL "$($entry.Key): $why"
                    return 1
                }
                'uncertain' {
                    Write-SeedLine FAIL "$($entry.Key): $($outcome.Detail)."
                    Write-Host '  It may or may not have been created, so it was NOT sent again (that could duplicate it). Wait about a minute (the' -ForegroundColor Yellow
                    Write-Host "  server may still be finishing it), then $rerun. The run sheet is re-read first," -ForegroundColor Yellow
                    Write-Host '  and an item with the same kind, title and posts is adopted instead of created.' -ForegroundColor Yellow
                    return 1
                }
            }
            $itemId = [string] $outcome.Item['id']
            [void] $claimedItems.Add($itemId)
            Add-InjectLivenessItem -Liveness $liveness -Row $outcome.Item
            $injectIds[$entry.Key] = $itemId
            $injectPostIds[$entry.Key] = @(Get-InjectChildIds -Row $outcome.Item)
            & $recordItem $entry $itemId $(if ($outcome.Outcome -eq 'adopted') { 'adoptedAt' } else { 'createdAt' })
            $assigned = if ($assigneeId) { ", assigned to $($item['assignee'].Trim())" } else { '' }
            $summary = "{0}  {1}  ""{2}"" ({3} post{4}{5})" -f $entry.Key, $entry.Kind, $entry.Title, $entry.PostCount, $(if ($entry.PostCount -eq 1) { '' } else { 's' }), $assigned
            $fresh = if ($entry.Action -eq 'reload') { " (a fresh copy; the $($entry.Status) $($entry.Replaces) stays in the console as it is)" } else { '' }
            if ($outcome.Outcome -eq 'adopted') {
                Write-SeedLine WARN "$summary — $($outcome.Detail); the matching item was found in the run sheet and adopted, not sent again -> $itemId$fresh"
            }
            else { Write-SeedLine PASS "$summary -> $itemId$fresh" }
        }
        if ($injectPlan.ToCreate -gt 0) {
            $manifest['completedAt'] = Format-SeedInstant ([DateTimeOffset]::UtcNow)
            Save-SeedManifest -Manifest $manifest -Path $manifestPath
        }

        # ── 11. White-noise pool (demo-feedback 05, DF-12): replaced by the pack's entries ──────────────────────────
        Write-Host "`n11. Load the white-noise pool" -ForegroundColor Cyan
        $noiseLoad = $null
        if ($noise.Count -eq 0) { Write-SeedLine SKIP 'the pack has no noise entries, so the server''s pool is left as it is' }
        else {
            $noiseLoad = Import-NoisePool -Context $context -Entries $noise -PersonaIds $personaIds -ChunkSize $limits.NoisePoolChunk
            foreach ($rejection in $noiseLoad.Rejected) {
                $who = if ($rejection.Index -ge 0 -and $rejection.Index -lt $noise.Count) { " (@$($noise[$rejection.Index]['persona']))" } else { '' }
                Write-SeedLine WARN ("noise[{0}]{1} was not loaded: {2}" -f $rejection.Index, $who, $rejection.Reason)
            }
            if ($noiseLoad.Ok) { Write-SeedLine PASS ("{0} of {1} noise entr{2} loaded; the pool holds {3}" -f $noiseLoad.Loaded, $noise.Count, $(if ($noise.Count -eq 1) { 'y' } else { 'ies' }), $noiseLoad.PoolSize) }
            else { Write-SeedLine FAIL "white-noise pool: $($noiseLoad.Detail)" }
        }

        # ── 12. After seeding: engine paused (Decision 4), and white noise off on every run (DF-12) ─────────────────
        Write-Host "`n12. After seeding: $(if ($LeaveEngineRunning) { 'engine left as it is; ' } else { 'engine paused; ' })white noise off" -ForegroundColor Cyan
        if (-not $LeaveEngineRunning) {
            $pause = Set-EnginePauseTier -Context $context -ActingHumanId $actingHumanId -TimeZone $exercise.TimeZone
            if ($pause.Ok) { Write-SeedLine PASS "pause tier $($pause.Detail) (it resets to 'running' on any reset or restart)" }
            else { Write-SeedLine FAIL "pause tier: $($pause.Detail)" }
        }
        $noiseOff = Set-NoiseLevelOff -Context $context
        $noiseEndedOff = [bool] $noiseOff.Ok
        if ($noiseOff.Ok) { Write-SeedLine PASS "white noise: $($noiseOff.Detail)" } else { Write-SeedLine FAIL "white noise: $($noiseOff.Detail)" }

        # ── 13. Self-check ────────────────────────────────────────────────────────────────────────────────────────
        Write-Host "`n13. Self-check" -ForegroundColor Cyan
        $checks = [System.Collections.Generic.List[object]]::new()
        $check = { param([bool] $Ok, [string] $Text) $checks.Add([pscustomobject]@{ Ok = $Ok; Text = $Text }) }

        $topLevelIds = @($postPlan.Items | Where-Object { -not $_.IsReply } | ForEach-Object { $postIds[$_.Key] })
        # Posts known to be live: this run's (posted or found in the feed) and whatever the feed read below returns.
        $liveFeedIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $selfFeedComplete = $false                                   # unknown until the feed read below succeeds
        foreach ($id in $postIds.Values) { if ($id) { [void] $liveFeedIds.Add([string] $id) } }
        # Exercise pins: a PUT step 9 saw refused fails the pins line on its own; the rest are read back from the feed.
        $unpinned = [System.Collections.Generic.List[string]]::new()
        $refusedPins = @($pinResults | Where-Object { -not $_.Ok } | ForEach-Object { $unpinned.Add("$($_.Key) (not accepted: $($_.Detail))"); $_.Key })
        $pinsNotRead = 'the feed could not be read'
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
            foreach ($id in $byId.Keys) { [void] $liveFeedIds.Add($id) }
            $selfFeedComplete = @($response.Json).Count -lt $limits.FeedTake
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

            # Exercise pins, read back: the feed marks a post pinned for everyone with pinnedForAll (DF-7). A pin whose
            # PUT was refused is already listed (below), whatever the feed shows.
            $pinsUnchecked = 0; $pinsNotRead = ''
            foreach ($key in @($pinKeys | Where-Object { $_ -notin $refusedPins })) {
                $row = $byId[[string] $postIds[$key]]
                if (-not $row) { if ($selfFeedComplete) { $unpinned.Add("$key (not in the feed)") } else { $pinsUnchecked++ } }
                elseif ($row['pinnedForAll'] -ne $true) { $unpinned.Add($key) }
            }
        }
        if ($pinKeys.Count -gt 0) {
            $pinText = if ($unpinned.Count) { "pins not pinned for everyone: $($unpinned -join ', ')" }
            elseif ($pinsNotRead) { "pins accepted, but not read back: $pinsNotRead" }
            elseif ($pinsUnchecked) { "every pin that could be checked is pinned for everyone ($pinsUnchecked beyond the feed's newest $($limits.FeedTake) posts not checked)" }
            else { "all $($pinKeys.Count) pin(s) are pinned for everyone (pinnedForAll in the feed)" }
            & $check ($unpinned.Count -eq 0) $pinText
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
                $sheetSpent = [System.Collections.Generic.List[string]]::new()
                foreach ($entry in $injectPlan.Items) {
                    $id = [string] $injectIds[$entry.Key]
                    $row = if ($id) { $queueById[$id] } else { $null }
                    if (-not $row) { $sheetShort.Add("$($entry.Key) (not in the run sheet)"); continue }
                    $have = @(Get-SeedList $row 'posts').Count
                    if ($have -ne $entry.PostCount) { $sheetShort.Add("$($entry.Key) ($have/$($entry.PostCount) posts)") }
                    # M-1: present is not enough; the console must be able to fire it (a rehearsal may have).
                    if (-not (Test-InjectArmable -Row $row)) { $sheetSpent.Add("$($entry.Key) ($(Get-InjectStatusText -Row $row))") }
                }
                & $check ($sheetShort.Count -eq 0) $(if ($sheetShort.Count) { "run-sheet items missing or changed: $($sheetShort -join ', ')" } else { "all $($injectPlan.Items.Count) run-sheet item(s) are in the console's queue with their posts" })
                & $check ($sheetSpent.Count -eq 0) $(if ($sheetSpent.Count) {
                        "run-sheet items the console cannot fire: $($sheetSpent -join ', '). After a rehearsal, run again with -ReloadFiredRunSheet to load fresh copies"
                    }
                    else { 'every run-sheet item is armable (pending, or held with nothing out)' })
                # N-1: "Fire next" takes the first pending item in the queue's order, so the armable items must be in
                # pack order there too. A fresh copy lands at the end, behind items kept from an earlier run.
                $inversion = Find-InjectOrderInversion -Entries @(foreach ($entry in $injectPlan.Items) {
                        $row = $queueById[[string] $injectIds[$entry.Key]]
                        if ($row -and (Test-InjectArmable -Row $row)) { [pscustomobject]@{ Key = $entry.Key; Order = $row['order'] } }
                    })
                # Every reply of an armable item must point at a live post (S1c, S-3): not an earlier copy of its pack
                # target, not an archived post, and not a post of a superseded, spent or deleted item. A postId outside
                # a full 200-post feed window cannot be confirmed either way, so the line says how many it did not check.
                $finalLiveness = New-InjectLiveness -LivePostIds @($liveFeedIds) -RetiredPostIds $retiredPostIds -FeedComplete $selfFeedComplete `
                    -Queue @($queueById.Values) -SupersededItemIds @(foreach ($loaded in @($manifest['injects'].Values)) { Get-SeedList $loaded 'superseded' }) -SpentDead
                $deadReplies = [System.Collections.Generic.List[string]]::new()
                $unchecked = 0
                foreach ($entry in $injectPlan.Items) {
                    $row = $queueById[[string] $injectIds[$entry.Key]]
                    if (-not $row -or -not (Test-InjectArmable -Row $row)) { continue }
                    $staleAt = @{}
                    foreach ($repair in @(Get-InjectReplyRepairs -PackItem $entry.Item -Row $row -PostIds $postIds -InjectPostIds $injectPostIds -Liveness $finalLiveness | Where-Object Dead)) {
                        $staleAt[[long] $repair.Sequence] = $true
                        $deadReplies.Add("$($entry.Key) post $($repair.Sequence) (the earlier copy of $($repair.Target))")
                    }
                    foreach ($child in @(@(Get-SeedList $row 'posts') | Sort-Object { [long] $_['sequence'] })) {
                        $reply = $child['replyTo']
                        if ($reply -isnot [System.Collections.IDictionary] -or $staleAt.Contains([long] $child['sequence'])) { continue }
                        if ($reply['postId']) {
                            if (Test-InjectTargetDead -Liveness $finalLiveness -Field 'postId' -Id ([string] $reply['postId'])) { $deadReplies.Add("$($entry.Key) post $($child['sequence']) (post $($reply['postId']) is not live)") }
                            elseif (-not $finalLiveness.Live.Contains([string] $reply['postId'])) { $unchecked++ }
                        }
                        if ($reply['injectPostId'] -and (Test-InjectTargetDead -Liveness $finalLiveness -Field 'injectPostId' -Id ([string] $reply['injectPostId']))) {
                            $deadReplies.Add("$($entry.Key) post $($child['sequence']) (its scripted parent is spent, superseded or gone)")
                        }
                    }
                }
                $replyText = if ($deadReplies.Count) { "run-sheet replies that do not point at a live post: $($deadReplies -join ', ')" }
                elseif ($unchecked) { "every run-sheet reply that could be checked points at a live post ($unchecked target(s) beyond the feed's newest $($limits.FeedTake) posts not checked)" }
                else { 'every run-sheet reply points at a live post' }
                & $check ($deadReplies.Count -eq 0) $replyText
                & $check ($null -eq $inversion) $(if ($inversion) {
                        ("the console's queue is out of pack order: {0} (order {1}) comes after {2} (order {3}), so ""Fire next"" would take {2} first. Drag them into pack order in the console, or Skip the remaining old items in the console and run again with -ReloadFiredRunSheet so the whole sheet reloads in order" -f
                            $inversion.PackFirst.Key, $inversion.PackFirst.Order, $inversion.QueuedAhead.Key, $inversion.QueuedAhead.Order)
                    }
                    elseif (@($injectPlan.Left | Where-Object Msel).Count -gt 0) {
                        "the armable run-sheet items are in pack order in the console's queue; the on-stage import slots the msel items in by planned minute (DF-22), so ""Fire next"" follows the pack when every seeded item has a plannedMinute"
                    }
                    else { "the armable run-sheet items are in pack order in the console's queue (""Fire next"" follows the pack)" })
            }
        }

        # Left out by -RunSheet: neither checked nor counted against the run (the MSEL import adds the msel ones).
        if (@($injectPlan.Left).Count -gt 0) {
            $leftKeys = @($injectPlan.Left | ForEach-Object { if ($_.Msel) { "$($_.Key) (msel '$($_.Msel)')" } else { $_.Key } }) -join ', '
            $checks.Add([pscustomobject]@{ Ok = $true; Text = "run-sheet item(s) left out by -RunSheet ${RunSheet}, not checked: $leftKeys"; Neutral = $true })
        }

        $failedProbes = @(foreach ($probe in $probes) {
                $status = Invoke-MediaRangeRequest -Url $probe.Url
                if ($status -ne 206) { "$($probe.Label) -> $(if ($status) { $status } else { 'no response' })" }
            })
        & $check ($failedProbes.Count -eq 0) $(if ($failedProbes.Count) { "media URL(s) not answering 206 to Range bytes=0-1: $($failedProbes -join '; ')" } else { "all $($probes.Count) media URL(s) answered 206 to Range: bytes=0-1" })

        # White noise (DF-12) and media marking (DF-3), from what steps 5, 11 and 12 were answered.
        if ($noiseLoad) {
            $rejectedNote = if ($noiseLoad.Rejected.Count) { "; $($noiseLoad.Rejected.Count) rejected (see the warnings)" } else { '' }
            & $check ([bool] $noiseLoad.Ok) $(if ($noiseLoad.Ok) { "white-noise pool: $($noiseLoad.Loaded) of the pack's $($noise.Count) entries loaded$rejectedNote" } else { "white-noise pool not loaded: $($noiseLoad.Detail)" })
        }
        else { $checks.Add([pscustomobject]@{ Ok = $true; Text = 'white-noise pool: none in the pack, the server''s pool left as it is'; Neutral = $true }) }
        & $check ([bool] $noiseOff.Ok) $(if ($noiseOff.Ok) { "white noise is off ($($noiseOff.Detail))" } else { "white noise may still be running: $($noiseOff.Detail)" })
        & $check ([bool] $marking.Ok) $(if ($marking.Ok) { "media marking is on ($($marking.Detail))" } else { "media marking is not confirmed on: $($marking.Detail)" })

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
        # A seed never leaves white noise running. A run that began writing (step 5) but did not end with noise confirmed
        # off at step 12 (an early stop, an error, a failed PUT) turns it off once more on the way out. Step 5 already
        # turned it off, but someone may have turned it up since; Set-NoiseLevelOff never throws.
        if ($seedingStarted -and -not $noiseEndedOff -and $context.Token) {
            $lastTry = Set-NoiseLevelOff -Context $context
            if ($lastTry.Ok) { Write-SeedLine INFO "white noise on the way out: $($lastTry.Detail)" }
            else { Write-SeedLine WARN "white noise may still be running ($($lastTry.Detail)): turn it off with the console's knob." }
        }
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
    ReloadFiredRunSheet = $ReloadFiredRunSheet
    RunSheet           = $RunSheet
    LeaveEngineRunning = $LeaveEngineRunning
    AcceptUnverifiableFeed = $AcceptUnverifiableFeed
    ManifestDirectory  = $ManifestDirectory
}
if ($PSBoundParameters.ContainsKey('ScenarioAnchor')) { $seedArguments['ScenarioAnchor'] = $ScenarioAnchor }
$exitCode = Invoke-DemoSeed @seedArguments | Select-Object -Last 1
exit ([int] $exitCode)
