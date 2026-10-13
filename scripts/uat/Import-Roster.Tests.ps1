#Requires -Version 7.0

<#
.SYNOPSIS
    Pester 5 tests for Import-Roster.ps1 (easy-login story 14, #479). No network: the API is an in-memory fake
    behind a mocked Invoke-WebRequest, az is mocked, and so is the clipboard.

.DESCRIPTION
    Runs the real script (`& Import-Roster.ps1 ...`, so its parameter sets, exit codes and every output stream
    are what is tested) against a fake of the routes it calls: GET /api/exercise-context, POST
    /api/auth/staff/login, POST /api/staff/roster/import, GET /api/staff/roster, PUT /api/staff/day-word and POST
    /api/auth/logout. The fake enforces the request shapes the real endpoints enforce (the login body, the
    strict dryRun query, the multipart field "file", the bearer token).

    Covers:
      - the request shapes (the staff login body, the multipart field, the dryRun query, the word body), and that
        no staff request carries an exercise id;
      - the exit code (1 on a failed row, dry run or real; 0 otherwise) and the red failed rows;
      - the links file: its exact contents, the formula escaping (=, +, -, @, tab, CR), mode 600, the default
        path under the gitignored scripts/uat/out, and that only its path is printed;
      - -DryRun: sends ?dryRun=true and writes, copies and sets nothing;
      - no secret, token or join URL in any output stream (Information/host, Verbose, Debug, Warning, Error,
        Output) with -Verbose -Debug, nor in $Error, on success and on failure;
      - sign-out in a finally (after a 400, a dropped connection, a failed roster read and a failed word);
      - a 401 or 400 prints the server's reason and exits 1 with no stack trace; a 404 or a dropped connection
        explains -ApiHost.

.EXAMPLE
    Invoke-Pester scripts/uat/Import-Roster.Tests.ps1 -Output Detailed
#>

BeforeAll {
    $script:ScriptFile = Join-Path $PSScriptRoot 'Import-Roster.ps1'
    # Loads the script's functions (the dot-source guard stops before the run), so they can be unit-tested and mocked.
    . $script:ScriptFile -CheckOnly

    $global:ImportRosterClipboard = [System.Collections.Generic.List[string]]::new()

    function New-FakeEntry {
        <# A RosterEntryDto as GET /api/staff/roster returns it. #>
        param([string] $Name, [string] $SignIn, [string] $LinkStatus = 'active', [string] $Access = 'enabled', [bool] $JoinLinks = $true)
        $link = [ordered]@{ status = $LinkStatus; useCount = 0 }
        if ($LinkStatus -eq 'active') {
            $link['issuedAt'] = '2026-10-19T12:00:00.0000000+00:00'
            if ($JoinLinks) { $link['joinUrl'] = "https://site.fake.test/join/JOIN-$([guid]::NewGuid().ToString('N'))" }
        }
        [ordered]@{
            id = [guid]::NewGuid().ToString(); name = $Name; signInName = $SignIn; exerciseRole = 'participant'
            link = $link; access = $Access; liveSessions = 0; createdAt = '2026-10-19T12:00:00.0000000+00:00'
        }
    }

    function New-FakePulse {
        $fake = @{
            ExerciseId = '7e1c2f00-1111-4222-8333-444455556666'; ExerciseName = 'UAT Fake Exercise'
            Secret = 'Sekr1t-' + [guid]::NewGuid().ToString('N')
            Token = 'TOKEN-' + [guid]::NewGuid().ToString('N')
            Refresh = 'REFRESH-' + [guid]::NewGuid().ToString('N')
            GeneratedWord = 'amber-harbor-' + (Get-Random -Minimum 1000 -Maximum 9999)
            JoinLinksAvailable = $true
            WordSet = $false
            Participants = [System.Collections.Generic.List[object]]::new()
            Calls = [System.Collections.Generic.List[object]]::new()
            Overrides = @{}      # 'METHOD /path' -> @{ Status = n; Content = '<raw body>' }
            Unreachable = @{}    # 'METHOD /path' -> the HttpRequestException message (no response at all)
        }
        # Already on the roster and in no test file: never in a links file.
        $fake.Participants.Add((New-FakeEntry 'Olive Outsider' 'ooutsider'))
        return $fake
    }

    function Get-FakeJoinUrls { @($global:ImportRosterFake.Participants | ForEach-Object { $_.link['joinUrl'] } | Where-Object { $_ }) }

    function Invoke-FakePulse {
        <# The mocked Invoke-WebRequest: records the call (copies: the script wipes bodies and headers afterwards) and answers. #>
        param([System.Collections.IDictionary] $Request)
        $fake = $global:ImportRosterFake
        $uri = [Uri] [string] $Request['Uri']
        $method = [string] $Request['Method']
        $path = $uri.AbsolutePath
        $headers = @{}
        if ($Request['Headers']) { foreach ($key in $Request['Headers'].Keys) { $headers[$key] = $Request['Headers'][$key] } }
        $bodyText = if ($Request['Body'] -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Request['Body']) } elseif ($Request['Body']) { [string] $Request['Body'] } else { '' }
        $form = $null
        if ($Request['Form']) { $form = @{}; foreach ($key in $Request['Form'].Keys) { $form[$key] = $Request['Form'][$key] } }
        $authorized = $headers['Authorization'] -ceq "Bearer $($fake.Token)"
        $fake.Calls.Add([pscustomobject]@{
                Method = $method; Path = $path; Query = $uri.Query; Uri = [string] $Request['Uri']; Body = $bodyText
                ContentType = [string] $Request['ContentType']; Headers = $headers; Form = $form; Authorized = $authorized
                Debug = $Request['Debug']; Verbose = $Request['Verbose']; MaximumRedirection = $Request['MaximumRedirection']
                SkipHttpErrorCheck = $Request['SkipHttpErrorCheck']
            })

        $reply = { param([int] $Status, $Json) [pscustomobject]@{ StatusCode = $Status; Content = $(if ($null -ne $Json) { ConvertTo-Json -InputObject $Json -Depth 10 -Compress } else { '' }); Headers = @{} } }
        $problem = { param([int] $Status, [string] $Detail) & $reply $Status ([ordered]@{ type = 'https://tools.ietf.org/html/rfc9110'; title = 'Bad Request'; status = $Status; detail = $Detail }) }

        $key = "$method $path"
        if ($fake.Unreachable.ContainsKey($key)) { throw [System.Net.Http.HttpRequestException]::new($fake.Unreachable[$key]) }
        if ($fake.Overrides.ContainsKey($key)) {
            $override = $fake.Overrides[$key]
            return [pscustomobject]@{ StatusCode = $override.Status; Content = [string] $override.Content; Headers = @{} }
        }

        if ($key -eq 'GET /api/exercise-context') {
            return & $reply 200 ([ordered]@{ exerciseId = $fake.ExerciseId; exerciseName = $fake.ExerciseName; timeZone = 'America/Chicago'; status = 'live' })
        }
        if ($key -eq 'POST /api/auth/staff/login') {
            # StaffLoginService: the body is { username, secret, exerciseId }; a bad exerciseId is a 400 (JSON string).
            $login = ConvertFrom-Json $bodyText -AsHashtable
            $id = [guid]::Empty
            if (-not [guid]::TryParse([string] $login['exerciseId'], [ref] $id)) { return & $reply 400 'exerciseId must be a non-empty GUID.' }
            if ($login['username'] -ne 'controller1' -or $login['secret'] -cne $fake.Secret) { return & $reply 401 $null }
            if ($id.ToString() -ne $fake.ExerciseId) { return & $reply 400 'exerciseId does not resolve to a known exercise.' }
            return & $reply 200 ([ordered]@{ token = $fake.Token; refreshToken = $fake.Refresh; session = [ordered]@{ exerciseId = $fake.ExerciseId; role = 'controller' } })
        }
        if ($key -eq 'POST /api/auth/logout') { return & $reply 204 $null }
        if (-not $authorized) { return & $reply 401 $null }

        switch ($key) {
            'GET /api/staff/roster' {
                return & $reply 200 ([ordered]@{ participants = @($fake.Participants); joinLinksAvailable = $fake.JoinLinksAvailable; capabilities = [ordered]@{ emailLinks = $false } })
            }
            'POST /api/staff/roster/import' {
                # RosterEndpoints.ImportAsync: a strict dryRun, then a non-empty multipart "file".
                if ($uri.Query -notmatch '^\?dryRun=(?<value>true|false)$') { return & $problem 400 'dryRun must be true or false.' }
                $dryRun = $Matches.value -eq 'true'
                if (-not $form -or $form.Keys.Count -ne 1 -or $form['file'] -isnot [System.IO.FileInfo]) { return & $problem 400 "A non-empty CSV file (multipart/form-data field 'file') is required." }
                $header = Get-Content -LiteralPath $form['file'].FullName -TotalCount 1
                if ($header -notmatch '(^|,)"?name"?(,|$)') { return & $problem 400 "The CSV header must include a 'name' column." }
                $rows = [System.Collections.Generic.List[object]]::new()
                $number = 0
                foreach ($row in @(Import-Csv -LiteralPath $form['file'].FullName)) {
                    $number++
                    $name = [string] $row.name
                    $signIn = ([string] $row.signInName).Trim().ToLowerInvariant()
                    $persona = ([string] $row.personaHandle).Trim().TrimStart('@')
                    $result = [ordered]@{ rowNumber = $number; name = $name; status = 'created'; personaCreated = $false }
                    if (-not $name.Trim()) { $result['status'] = 'failed'; $result['message'] = 'name is required.'; $rows.Add($result); continue }
                    if ($persona -and $persona -ne 'FulcoEM') {
                        if ($signIn) { $result['signInName'] = $signIn }
                        $result['status'] = 'failed'; $result['message'] = "personaHandle '$persona' is not an org persona in this exercise."
                        $rows.Add($result); continue
                    }
                    if (-not $signIn) { $words = @($name.Trim() -split '\s+'); $signIn = ($words[0].Substring(0, 1) + $words[-1]).ToLowerInvariant() -replace '[^a-z0-9]', '' }
                    $result['signInName'] = $signIn
                    $existing = $fake.Participants | Where-Object { $_.signInName -eq $signIn } | Select-Object -First 1
                    if ($existing) { $result['name'] = $existing.name; $result['status'] = 'unchanged' }
                    else {
                        $result['personaCreated'] = -not $persona
                        if (-not $dryRun) { $fake.Participants.Add((New-FakeEntry $name $signIn -JoinLinks $fake.JoinLinksAvailable)) }
                    }
                    $rows.Add($result)
                }
                $count = { param($Status) @($rows | Where-Object { $_['status'] -eq $Status }).Count }
                return & $reply 200 ([ordered]@{
                        dryRun = $dryRun; totalRows = $rows.Count; createdCount = (& $count 'created'); updatedCount = (& $count 'updated')
                        unchangedCount = (& $count 'unchanged'); failedCount = (& $count 'failed'); rows = @($rows)
                    })
            }
            'PUT /api/staff/day-word' {
                $put = ConvertFrom-Json $bodyText -AsHashtable
                if ($put -isnot [System.Collections.IDictionary]) { return & $problem 400 'A JSON body is required.' }
                $given = [string] $put['word']
                if ($put.Contains('word') -and $given.Length -lt 4) { return & $problem 400 'The word must be 4 to 32 letters or digits; accents, spaces and punctuation are ignored.' }
                $replaced = $fake.WordSet
                $fake.WordSet = $true
                return & $reply 200 ([ordered]@{
                        date = '2026-10-19'; word = $(if ($given) { $given } else { $fake.GeneratedWord }); generated = -not $given
                        replaced = $replaced; setAt = '2026-10-19T13:00:00.0000000+00:00'; validUntil = '2026-10-20T05:00:00.0000000+00:00'
                    })
            }
        }
        return & $reply 404 $null
    }

    function New-RosterCsv {
        <# A roster CSV in $TestDrive. #>
        param([string[]] $Lines, [string] $Name = 'testers.csv')
        $path = Join-Path $TestDrive $Name
        Set-Content -LiteralPath $path -Value (@('name,agency,role,email,personaHandle,signInName') + $Lines) -Encoding utf8
        return $path
    }

    function Invoke-ImportRoster {
        <# Runs the real script. Returns { Code; Records (every stream); Text; Red (red host lines) }. #>
        param([hashtable] $Arguments)
        $global:LASTEXITCODE = -1
        $records = @(& $script:ScriptFile @Arguments *>&1)
        $code = $global:LASTEXITCODE
        [pscustomobject]@{
            Code    = $code
            Records = $records
            Text    = ($records | ForEach-Object { "$_" }) -join "`n"
            Red     = @($records | Where-Object { $_ -is [System.Management.Automation.InformationRecord] -and $_.MessageData.ForegroundColor -eq 'Red' } | ForEach-Object { "$($_.MessageData)" })
        }
    }

    function Get-FakeCall([string] $Method, [string] $Path) { @($global:ImportRosterFake.Calls | Where-Object { $_.Method -eq $Method -and $_.Path -eq $Path }) }

    function Get-CallSequence { @($global:ImportRosterFake.Calls | ForEach-Object { "$($_.Method) $($_.Path)" }) }

    # The good testers: one with an org persona, one derived sign-in name, one already on the roster.
    $script:GoodRows = @(
        'Jane Smith,Fulton EM,PIO,jane@example.test,FulcoEM,'
        'Bob Jones,Red Cross,Volunteer,,,'
        'Carla Diaz,City,Planner,,,cdiaz'
    )
}

AfterAll {
    Remove-Variable -Name ImportRosterFake, ImportRosterClipboard -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Import-Roster.ps1' {
    BeforeEach {
        $global:ImportRosterFake = New-FakePulse
        $global:ImportRosterClipboard.Clear()
        $env:PULSE_STAFF_SECRET = $global:ImportRosterFake.Secret
        Mock Invoke-WebRequest { Invoke-FakePulse -Request $PesterBoundParameters }
        Mock Invoke-Az { throw 'az must not be called while PULSE_STAFF_SECRET is set.' }
        Mock Test-ClipboardAvailable { $true }
        Mock Set-Clipboard { $global:ImportRosterClipboard.Add([string] $Value) }
        $script:OutFile = Join-Path $TestDrive "links-$([guid]::NewGuid().ToString('N')).csv"
    }

    AfterEach {
        $env:PULSE_STAFF_SECRET = $null
    }

    Describe 'Request shapes' {
        It 'signs in with { username, secret, exerciseId }: the host''s exercise, the default staff user, no bearer' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            $login = Get-FakeCall POST '/api/auth/staff/login'
            $login.Count | Should -Be 1
            $body = ConvertFrom-Json $login[0].Body -AsHashtable
            @($body.Keys | Sort-Object) | Should -Be @('exerciseId', 'secret', 'username')
            $body['username'] | Should -Be 'controller1'
            $body['secret'] | Should -BeExactly $global:ImportRosterFake.Secret
            $body['exerciseId'] | Should -Be $global:ImportRosterFake.ExerciseId
            $login[0].ContentType | Should -BeLike 'application/json*'
            $login[0].Headers.ContainsKey('Authorization') | Should -BeFalse
            $login[0].Uri | Should -BeLike 'https://app-pulse-api-uat-dynamis.azurewebsites.net/*'
        }

        It '-StaffUsername is the login''s username' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; StaffUsername = 'planner1' }
            (ConvertFrom-Json (Get-FakeCall POST '/api/auth/staff/login')[0].Body -AsHashtable)['username'] | Should -Be 'planner1'
            $run.Code | Should -Be 1     # the fake knows only controller1: 401
        }

        It 'uploads the file as the multipart field "file", with ?dryRun=false and the bearer token' {
            $csv = New-RosterCsv $script:GoodRows
            $null = Invoke-ImportRoster @{ CsvPath = $csv; OutFile = $script:OutFile }
            $import = Get-FakeCall POST '/api/staff/roster/import'
            $import.Count | Should -Be 1
            $import[0].Query | Should -BeExactly '?dryRun=false'
            @($import[0].Form.Keys) | Should -Be @('file')
            $import[0].Form['file'] | Should -BeOfType [System.IO.FileInfo]
            $import[0].Form['file'].FullName | Should -Be (Get-Item -LiteralPath $csv).FullName
            $import[0].Body | Should -BeNullOrEmpty
            $import[0].Authorized | Should -BeTrue
        }

        It 'calls exercise-context, login, import, roster, logout in that order' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            Get-CallSequence | Should -Be @(
                'GET /api/exercise-context', 'POST /api/auth/staff/login', 'POST /api/staff/roster/import', 'GET /api/staff/roster', 'POST /api/auth/logout')
            (Get-FakeCall POST '/api/auth/logout')[0].Authorized | Should -BeTrue
        }

        It 'isolation: no request after the login carries an exercise id (the session decides)' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true }
            $staff = @($global:ImportRosterFake.Calls | Where-Object { $_.Path -notin '/api/exercise-context', '/api/auth/staff/login' })
            $staff.Count | Should -Be 4
            foreach ($call in $staff) {
                "$($call.Query) $($call.Body)" | Should -Not -Match 'exercise' -Because "$($call.Method) $($call.Path)"
                $call.Query | Should -Not -Match $global:ImportRosterFake.ExerciseId
            }
        }

        It 'every request: no redirects, the web cmdlet''s Debug and Verbose off, HTTP errors returned not thrown' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true; Verbose = $true; Debug = $true }
            $global:ImportRosterFake.Calls.Count | Should -Be 6
            foreach ($call in $global:ImportRosterFake.Calls) {
                $call.MaximumRedirection | Should -Be 0 -Because "$($call.Method) $($call.Path)"
                $call.Debug | Should -BeFalse -Because "$($call.Method) $($call.Path)"
                $call.Verbose | Should -BeFalse -Because "$($call.Method) $($call.Path)"
                $call.SkipHttpErrorCheck | Should -BeTrue -Because "$($call.Method) $($call.Path)"
            }
        }

        It '-GenerateWord sends PUT /api/staff/day-word {} after the import; -Word sends { word }' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true }
            $put = Get-FakeCall PUT '/api/staff/day-word'
            $put.Count | Should -Be 1
            $put[0].Body | Should -BeExactly '{}'
            $put[0].Authorized | Should -BeTrue
            (Get-CallSequence)[-2..-1] | Should -Be @('PUT /api/staff/day-word', 'POST /api/auth/logout')

            $global:ImportRosterFake.Calls.Clear()
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; Word = 'Harbor Lantern' }
            (Get-FakeCall PUT '/api/staff/day-word')[0].Body | Should -BeExactly '{"word":"Harbor Lantern"}'
        }

        It 'a localhost origin may use plain http; any other http host is refused before anything is sent' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; ApiHost = 'http://localhost:5000' }
            (Get-FakeCall POST '/api/auth/staff/login')[0].Uri | Should -Be 'http://localhost:5000/api/auth/staff/login'

            $global:ImportRosterFake.Calls.Clear()
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; ApiHost = 'http://api.example.test' }
            $run.Code | Should -Be 1
            $run.Text | Should -Match 'must use https'
            $global:ImportRosterFake.Calls.Count | Should -Be 0
        }
    }

    Describe 'Results table and exit code' {
        It 'prints the counts and a row / name / sign-in name / status / message table; exits 0 when no row failed' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            $run.Code | Should -Be 0
            $run.Text | Should -Match 'Imported testers\.csv: 3 row\(s\), 3 created, 0 updated, 0 unchanged, 0 failed\.'
            $run.Text | Should -Match 'Row\s+Name\s+Sign-in name\s+Status\s+Message'
            $run.Text | Should -Match '1\s+Jane Smith\s+jsmith\s+created'
            $run.Text | Should -Match '2\s+Bob Jones\s+bjones\s+created'
            $run.Red | Should -BeNullOrEmpty
        }

        It 'a failed row is red with the server''s reason, and the run exits 1 (dry run)' {
            $csv = New-RosterCsv ($script:GoodRows + 'Nora Nope,,,,NotAPersona,')
            $run = Invoke-ImportRoster @{ CsvPath = $csv; DryRun = $true }
            $run.Code | Should -Be 1
            $run.Text | Should -Match 'Dry run of testers\.csv: 4 row\(s\), 3 created, 0 updated, 0 unchanged, 1 failed\.'
            $failedLine = @($run.Red | Where-Object { $_ -match 'Nora Nope' })
            $failedLine.Count | Should -Be 1
            $failedLine[0] | Should -Match "^\s*4\s+Nora Nope\s+failed\s+personaHandle 'NotAPersona' is not an org persona in this exercise\.$"
            @($run.Red | Where-Object { $_ -match 'Jane Smith|Bob Jones|Carla Diaz' }).Count | Should -Be 0
            $run.Red -join "`n" | Should -Match '1 row\(s\) failed'
        }

        It 'a real import with a failed row still writes the links for the others, and exits 1' {
            $csv = New-RosterCsv ($script:GoodRows + 'Nora Nope,,,,NotAPersona,nnope')
            $run = Invoke-ImportRoster @{ CsvPath = $csv; OutFile = $script:OutFile }
            $run.Code | Should -Be 1
            $links = @(Import-Csv -LiteralPath $script:OutFile)
            @($links.signInName) | Should -Be @('jsmith', 'bjones', 'cdiaz')
            (Get-FakeCall POST '/api/auth/logout').Count | Should -Be 1
        }

        It 'a row already on the roster comes back unchanged and is still in the links file' {
            $global:ImportRosterFake.Participants.Add((New-FakeEntry 'Carla Diaz' 'cdiaz'))
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            $run.Code | Should -Be 0
            $run.Text | Should -Match '2 created, 0 updated, 1 unchanged, 0 failed'
            @((Import-Csv -LiteralPath $script:OutFile).signInName) | Should -Contain 'cdiaz'
        }
    }

    Describe 'Links file' {
        It 'holds name, signInName and joinUrl for exactly the file''s participants, in file order' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            $run.Code | Should -Be 0
            $byName = @{}; foreach ($p in $global:ImportRosterFake.Participants) { $byName[$p.signInName] = $p }
            $expected = "`"name`",`"signInName`",`"joinUrl`"`r`n" + ((@('jsmith', 'bjones', 'cdiaz') | ForEach-Object {
                        '"{0}","{1}","{2}"' -f $byName[$_].name, $_, $byName[$_].link['joinUrl'] }) -join "`r`n") + "`r`n"
            $bytes = [System.IO.File]::ReadAllBytes($script:OutFile)
            $bytes[0..2] | Should -Be @(0xEF, 0xBB, 0xBF)        # UTF-8 BOM, so Excel reads accented names
            [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) | Should -BeExactly $expected
            (Get-Content -LiteralPath $script:OutFile -Raw) | Should -Not -Match 'ooutsider'   # on the roster, not in the file
        }

        It 'prefixes '' to every cell that begins with =, +, -, @, a tab or a CR (formula injection)' {
            # Names come from outside agencies. These people are already on the roster (the server stores names as
            # typed), so the file's rows match them by sign-in name and the names in the links file are theirs.
            $hostile = [ordered]@{
                eq1 = '=HYPERLINK("http://evil.test","x")'; plus1 = '+1+cmd'; minus1 = '-2+3'; at1 = '@SUM(A1)'
                tab1 = "`tTabbed"; cr1 = "`rCarriage"; safe1 = 'Ann =Equals Inside'
            }
            foreach ($signIn in $hostile.Keys) { $global:ImportRosterFake.Participants.Add((New-FakeEntry $hostile[$signIn] $signIn)) }
            $csv = New-RosterCsv @($hostile.Keys | ForEach-Object { "Placeholder $_,,,,,$_" })
            $run = Invoke-ImportRoster @{ CsvPath = $csv; OutFile = $script:OutFile; CopyLinks = $true }
            $run.Code | Should -Be 0
            $text = [Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($script:OutFile)).TrimStart([char] 0xFEFF)
            foreach ($signIn in $hostile.Keys) {
                $url = ($global:ImportRosterFake.Participants | Where-Object signInName -eq $signIn).link['joinUrl']
                $name = $hostile[$signIn]
                $cell = if ($name -match '^[=+\-@\t\r]') { "'" + $name } else { $name }
                $text | Should -Match ([regex]::Escape(('"{0}","{1}","{2}"' -f $cell.Replace('"', '""'), $signIn, $url))) -Because $signIn
            }
            $text | Should -Not -Match '(^|,|\n)"[=+\-@\t\r]'      # no cell starts with a formula character
            # The clipboard copy is escaped the same way (a tab or line break inside a cell becomes a space).
            $clip = $global:ImportRosterClipboard[0]
            $clip | Should -Match "(?m)^'=HYPERLINK"
            $clip | Should -Match "(?m)^' Tabbed`t"
            $clip | Should -Match "(?m)^' Carriage`t"
            $clip | Should -Match "(?m)^Ann =Equals Inside`t"
        }

        It 'ConvertTo-CsvCell: <Label>' -ForEach @(
            @{ Label = 'leading = is escaped'; Value = '=1+1'; Cell = '"''=1+1"' }
            @{ Label = 'leading + is escaped'; Value = '+1'; Cell = '"''+1"' }
            @{ Label = 'leading - is escaped'; Value = '-1'; Cell = '"''-1"' }
            @{ Label = 'leading @ is escaped'; Value = '@x'; Cell = '"''@x"' }
            @{ Label = 'leading tab is escaped'; Value = "`tx"; Cell = "`"'`tx`"" }
            @{ Label = 'leading CR is escaped'; Value = "`rx"; Cell = "`"'`rx`"" }
            @{ Label = 'an inner = is left alone; quotes are doubled'; Value = 'a "quoted" =name'; Cell = '"a ""quoted"" =name"' }
            @{ Label = 'empty'; Value = ''; Cell = '""' }
            @{ Label = 'a join URL is left alone'; Value = 'https://site.test/join/abc'; Cell = '"https://site.test/join/abc"' }
        ) {
            ConvertTo-CsvCell $Value | Should -BeExactly $Cell
        }

        It 'is readable and writable by the current user only (mode 600)' -Skip:$IsWindows {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            (Get-Item -LiteralPath $script:OutFile).UnixMode | Should -Be '-rw-------'
        }

        It 'replaces a file already at -OutFile, and the new one is mode 600 too' -Skip:$IsWindows {
            Set-Content -LiteralPath $script:OutFile -Value 'old content'
            & chmod 644 -- $script:OutFile
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            (Get-Content -LiteralPath $script:OutFile -Raw) | Should -Not -Match 'old content'
            (Get-Item -LiteralPath $script:OutFile).UnixMode | Should -Be '-rw-------'
        }

        It 'prints only the path, never a link' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            $run.Text | Should -Match ([regex]::Escape($script:OutFile))
            foreach ($url in Get-FakeJoinUrls) { $run.Text.Contains($url) | Should -BeFalse }
            $run.Text | Should -Not -Match 'JOIN-|/join/'
        }

        It 'defaults to scripts/uat/out/roster-links-yyyyMMdd-HHmmss.csv, which git ignores' {
            $outDir = Join-Path $PSScriptRoot 'out'
            $existed = Test-Path -LiteralPath $outDir
            $path = $null
            try {
                $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows) }
                $run.Code | Should -Be 0
                $path = ($run.Records | ForEach-Object { "$_".Trim() } | Where-Object { $_ -like '*roster-links-*.csv' } | Select-Object -First 1)
                $path | Should -Not -BeNullOrEmpty
                Split-Path -Parent $path | Should -Be ([System.IO.Path]::GetFullPath($outDir))
                Split-Path -Leaf $path | Should -Match '^roster-links-\d{8}-\d{6}\.csv$'
                Test-Path -LiteralPath $path | Should -BeTrue
                if (Get-Command git -ErrorAction SilentlyContinue) {
                    & git -C $PSScriptRoot check-ignore -q -- $path
                    $LASTEXITCODE | Should -Be 0 -Because '.gitignore must exclude scripts/uat/out/'
                }
            }
            finally {
                if ($path -and (Test-Path -LiteralPath $path)) { Remove-Item -LiteralPath $path -Force }
                if (-not $existed -and (Test-Path -LiteralPath $outDir) -and -not (Get-ChildItem -LiteralPath $outDir -Force)) { Remove-Item -LiteralPath $outDir -Force }
            }
        }

        It '.gitignore lists scripts/uat/out/' {
            Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../.gitignore') | Should -Contain 'scripts/uat/out/'
        }

        It 'a participant without a usable link gets an empty joinUrl and a warning; nobody saved means no file' {
            $global:ImportRosterFake.Participants.Add((New-FakeEntry 'Rita Revoked' 'rrevoked' -LinkStatus 'revoked'))
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv ($script:GoodRows + 'Rita Revoked,,,,,rrevoked')); OutFile = $script:OutFile }
            $run.Code | Should -Be 0
            (Import-Csv -LiteralPath $script:OutFile | Where-Object signInName -eq 'rrevoked').joinUrl | Should -BeExactly ''
            $run.Text | Should -Match '1 participant\(s\) have no usable link'

            $other = Join-Path $TestDrive 'none.csv'
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv @('Nora Nope,,,,NotAPersona,') -Name 'bad.csv'); OutFile = $other }
            $run.Code | Should -Be 1
            Test-Path -LiteralPath $other | Should -BeFalse
            $run.Text | Should -Match 'no links file was written'
        }

        It 'join links not configured on the API: sign-in names only, and it says so' {
            $global:ImportRosterFake.JoinLinksAvailable = $false
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            $run.Code | Should -Be 0
            @((Import-Csv -LiteralPath $script:OutFile).joinUrl | Where-Object { $_ }).Count | Should -Be 0
            $run.Text | Should -Match 'Join links are NOT available'
        }

        It '-CopyLinks puts the links on the clipboard (tab-separated) and never echoes them' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; CopyLinks = $true }
            $global:ImportRosterClipboard.Count | Should -Be 1
            $lines = $global:ImportRosterClipboard[0] -split '\r?\n'
            $lines[0] | Should -BeExactly "name`tsignInName`tjoinUrl"
            $lines.Count | Should -Be 4
            foreach ($p in @($global:ImportRosterFake.Participants | Where-Object signInName -in 'jsmith', 'bjones', 'cdiaz')) {
                $lines | Should -Contain ("{0}`t{1}`t{2}" -f $p.name, $p.signInName, $p.link['joinUrl'])
            }
            $run.Text | Should -Match 'also on the clipboard'
            foreach ($url in Get-FakeJoinUrls) { $run.Text.Contains($url) | Should -BeFalse }
        }

        It 'no clipboard (Linux without xclip): warns, copies nothing, the file is still written' {
            Mock Test-ClipboardAvailable { $false }
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; CopyLinks = $true }
            $run.Code | Should -Be 0
            Should -Invoke Set-Clipboard -Times 0 -Exactly
            @($run.Records | Where-Object { $_ -is [System.Management.Automation.WarningRecord] }).Count | Should -Be 1
            Test-Path -LiteralPath $script:OutFile | Should -BeTrue
        }
    }

    Describe '-DryRun' {
        It 'sends ?dryRun=true, then writes, copies and sets nothing (and reads no roster)' {
            $outDir = Join-Path $TestDrive 'dry-out'
            $out = Join-Path $outDir 'links.csv'
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); DryRun = $true; OutFile = $out; CopyLinks = $true; GenerateWord = $true }
            $run.Code | Should -Be 0
            (Get-FakeCall POST '/api/staff/roster/import')[0].Query | Should -BeExactly '?dryRun=true'
            Get-CallSequence | Should -Be @('GET /api/exercise-context', 'POST /api/auth/staff/login', 'POST /api/staff/roster/import', 'POST /api/auth/logout')
            Test-Path -LiteralPath $outDir | Should -BeFalse
            Should -Invoke Set-Clipboard -Times 0 -Exactly
            $run.Text | Should -Match "Dry run: the server saved nothing, no links file was written, nothing was copied, today's word was not set\."
            @($global:ImportRosterFake.Participants).Count | Should -Be 1      # the fake created nobody
        }
    }

    Describe "Today's word" {
        It '-GenerateWord prints the word exactly once (in any stream) and copies it' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true; Verbose = $true; Debug = $true }
            $run.Code | Should -Be 0
            $word = $global:ImportRosterFake.GeneratedWord
            ([regex]::Matches($run.Text, [regex]::Escape($word))).Count | Should -Be 1
            $global:ImportRosterClipboard | Should -Be @($word)
            $run.Text | Should -Match "Today's word for 2026-10-19 \(generated"
            $run.Text | Should -Match 'https://pulse-uat\.cobrasoftware\.com/login'
        }

        It 'says so when it replaced the word already set that day' {
            $global:ImportRosterFake.WordSet = $true
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; Word = 'Harbor Lantern' }
            $run.Text | Should -Match 'REPLACED the word already set'
            $run.Text | Should -Match '\(as given'
        }

        It '-GenerateWord with -Word is refused before anything is sent' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); GenerateWord = $true; Word = 'Harbor Lantern' }
            $run.Code | Should -Be 1
            $run.Text | Should -Match 'not both'
            $global:ImportRosterFake.Calls.Count | Should -Be 0
        }

        It 'a 400 for the word prints the server''s reason, exits 1 and still signs out' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; Word = 'abc' }
            $run.Code | Should -Be 1
            $run.Red -join "`n" | Should -Match "Setting today's word was refused \(400\): The word must be 4 to 32 letters or digits"
            (Get-CallSequence)[-1] | Should -Be 'POST /api/auth/logout'
        }
    }

    Describe '-CheckOnly' {
        It 'signs in, reads the roster, reports the count, signs out; no CSV, no import' {
            $global:ImportRosterFake.Participants.Add((New-FakeEntry 'Dee Disabled' 'ddisabled' -Access 'disabled'))
            $global:ImportRosterFake.Participants.Add((New-FakeEntry 'Rita Revoked' 'rrevoked' -LinkStatus 'revoked'))
            $run = Invoke-ImportRoster @{ CheckOnly = $true }
            $run.Code | Should -Be 0
            Get-CallSequence | Should -Be @('GET /api/exercise-context', 'POST /api/auth/staff/login', 'GET /api/staff/roster', 'POST /api/auth/logout')
            $run.Text | Should -Match 'Roster: 3 participant\(s\), 2 with an active personal link, 1 disabled\. Join links: available\.'
        }
    }

    Describe 'Errors: the server''s reason, exit 1, no stack trace' {
        BeforeAll {
            function Assert-CleanFailure {
                param($Run)
                $Run.Code | Should -Be 1
                @($Run.Records | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }).Count | Should -Be 0
                $Run.Text | Should -Not -Match 'ScriptStackTrace|at <ScriptBlock>|Import-Roster\.ps1:\d+|FullyQualifiedErrorId|CategoryInfo|\+ ~~~'
            }
        }

        It 'a 401 at sign-in: the rejection, exit 1, nothing else sent (and no sign-out: there is no session)' {
            $env:PULSE_STAFF_SECRET = 'wrong-' + $global:ImportRosterFake.Secret
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match "Sign-in was refused \(401\): 'controller1' or its secret was rejected"
            Get-CallSequence | Should -Be @('GET /api/exercise-context', 'POST /api/auth/staff/login')
            Test-Path -LiteralPath $script:OutFile | Should -BeFalse
        }

        It 'a 400 at sign-in prints the server''s own reason (a plain JSON string)' {
            $global:ImportRosterFake.Overrides['POST /api/auth/staff/login'] = @{ Status = 400; Content = '"exerciseId does not resolve to a known exercise."' }
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match 'Sign-in was refused \(400\): exerciseId does not resolve to a known exercise\.'
        }

        It 'a 400 for the file prints the ProblemDetails detail, exits 1 and signs out' {
            $bad = Join-Path $TestDrive 'bad-header.csv'
            Set-Content -LiteralPath $bad -Value @('fullname,agency', 'Jane Smith,EM')
            $run = Invoke-ImportRoster @{ CsvPath = $bad; OutFile = $script:OutFile }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match "The import was refused \(400\): The CSV header must include a 'name' column\."
            (Get-CallSequence)[-1] | Should -Be 'POST /api/auth/logout'
            (Get-FakeCall POST '/api/auth/logout')[0].Authorized | Should -BeTrue
        }

        It 'a 403 on the roster explains the controller-or-planner rule' {
            $global:ImportRosterFake.Overrides['POST /api/staff/roster/import'] = @{ Status = 403; Content = '' }
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match "\(403\): 'controller1' must be a controller or planner assigned to this exercise"
            (Get-CallSequence)[-1] | Should -Be 'POST /api/auth/logout'
        }

        It 'a 404 from the roster route explains -ApiHost and the backend stories' {
            $global:ImportRosterFake.Overrides['POST /api/staff/roster/import'] = @{ Status = 404; Content = '' }
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match 'answered 404.*stories 02, 03, 05.*-ApiHost'
        }

        It 'no exercise on the host (404 from exercise-context) explains -ApiHost; nothing else is sent' {
            $global:ImportRosterFake.Overrides['GET /api/exercise-context'] = @{ Status = 404; Content = '' }
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match 'No exercise is bound to https://app-pulse-api-uat-dynamis\.azurewebsites\.net.*Check -ApiHost'
            Get-CallSequence | Should -Be @('GET /api/exercise-context')
        }

        It 'a connection failure explains -ApiHost; nothing else is sent' {
            $global:ImportRosterFake.Unreachable['GET /api/exercise-context'] = 'Name or service not known (nope.example.test:443)'
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; ApiHost = 'nope.example.test' }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match 'No answer from the API to GET /api/exercise-context: Name or service not known.*Check -ApiHost'
            Get-CallSequence | Should -Be @('GET /api/exercise-context')
        }

        It 'a missing CSV fails before anything is sent' {
            $run = Invoke-ImportRoster @{ CsvPath = (Join-Path $TestDrive 'nope.csv'); OutFile = $script:OutFile }
            Assert-CleanFailure $run
            $run.Text | Should -Match 'No file at'
            $global:ImportRosterFake.Calls.Count | Should -Be 0
        }
    }

    Describe 'Sign-out runs in a finally' {
        It 'after <Name>' -ForEach @(
            @{ Name = 'a dropped connection during the upload'; Key = 'POST /api/staff/roster/import'; Unreachable = 'The response ended prematurely.' }
            @{ Name = 'a 500 from the roster read after the import'; Key = 'GET /api/staff/roster'; Status = 500 }
            @{ Name = 'a 401 from the word'; Key = 'PUT /api/staff/day-word'; Status = 401 }
        ) {
            if ($Unreachable) { $global:ImportRosterFake.Unreachable[$Key] = $Unreachable }
            else { $global:ImportRosterFake.Overrides[$Key] = @{ Status = $Status; Content = '' } }
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true }
            $run.Code | Should -Be 1
            (Get-CallSequence)[-1] | Should -Be 'POST /api/auth/logout'
            (Get-FakeCall POST '/api/auth/logout').Count | Should -Be 1
            (Get-FakeCall POST '/api/auth/logout')[0].Authorized | Should -BeTrue
            $run.Text | Should -Match 'Signed out\.'
        }

        It 'a failed sign-out only warns; the run''s own result stands' {
            $global:ImportRosterFake.Unreachable['POST /api/auth/logout'] = 'Connection reset by peer'
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            $run.Code | Should -Be 0
            @($run.Records | Where-Object { $_ -is [System.Management.Automation.WarningRecord] -and "$_" -match 'Sign-out failed' }).Count | Should -Be 1
        }
    }

    Describe 'Secrets never leave memory' {
        BeforeAll {
            function Get-Secrets {
                @($global:ImportRosterFake.Secret, $global:ImportRosterFake.Token, $global:ImportRosterFake.Refresh) + @(Get-FakeJoinUrls) +
                @(Get-FakeJoinUrls | ForEach-Object { ($_ -split '/join/')[1] })
            }
            function Assert-NoSecret {
                param([string] $Text, [string] $Because)
                foreach ($secret in Get-Secrets) { $Text.Contains($secret) | Should -BeFalse -Because "$Because must not contain a secret, token or join link" }
            }
            function Get-ErrorDump([int] $Since) {
                $new = @($global:Error)[0..([Math]::Max(0, $global:Error.Count - $Since - 1))] | Where-Object { $_ }
                if ($global:Error.Count -le $Since) { return '' }
                ($new | ForEach-Object {
                    $_ | Format-List * -Force | Out-String
                    $_.Exception | Format-List * -Force | Out-String
                    $_.InvocationInfo | Format-List * -Force | Out-String
                    "$($_.TargetObject)"
                }) -join "`n"
            }
        }

        It 'a full run with -Verbose -Debug -CopyLinks -GenerateWord: no secret in any stream or in $Error' {
            $before = $global:Error.Count
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; CopyLinks = $true; GenerateWord = $true; Verbose = $true; Debug = $true }
            $run.Code | Should -Be 0
            @(Get-FakeJoinUrls).Count | Should -Be 4          # the run really did handle links
            # The streams were really captured: host lines, verbose and debug records are all there.
            @($run.Records | Where-Object { $_ -is [System.Management.Automation.InformationRecord] }).Count | Should -BeGreaterThan 5
            @($run.Records | Where-Object { $_ -is [System.Management.Automation.VerboseRecord] }).Count | Should -BeGreaterThan 3
            @($run.Records | Where-Object { $_ -is [System.Management.Automation.DebugRecord] }).Count | Should -BeGreaterThan 3
            foreach ($kind in 'InformationRecord', 'VerboseRecord', 'DebugRecord', 'WarningRecord', 'ErrorRecord') {
                Assert-NoSecret (($run.Records | Where-Object { $_.GetType().Name -eq $kind } | ForEach-Object { "$_" }) -join "`n") $kind
            }
            Assert-NoSecret (($run.Records | Where-Object { $_ -isnot [System.Management.Automation.InformationalRecord] -and $_ -isnot [System.Management.Automation.InformationRecord] -and $_ -isnot [System.Management.Automation.ErrorRecord] } | Out-String)) 'the output stream'
            Assert-NoSecret $run.Text 'all output'
            Assert-NoSecret (Get-ErrorDump $before) '$Error'
            # The links went where asked, and only there.
            $file = Get-Content -LiteralPath $script:OutFile -Raw
            $file.Contains($global:ImportRosterFake.Secret) -or $file.Contains($global:ImportRosterFake.Token) | Should -BeFalse
        }

        It 'the secret is sent only in the login body; the token only as the Authorization header' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true }
            @($global:ImportRosterFake.Calls | Where-Object { $_.Body.Contains($global:ImportRosterFake.Secret) -or $_.Uri.Contains($global:ImportRosterFake.Secret) } | ForEach-Object Path) |
                Should -Be @('/api/auth/staff/login')
            @($global:ImportRosterFake.Calls | Where-Object { $_.Body.Contains($global:ImportRosterFake.Token) -or $_.Uri.Contains($global:ImportRosterFake.Token) }).Count | Should -Be 0
            @($global:ImportRosterFake.Calls | Where-Object Authorized | ForEach-Object { "$($_.Method) $($_.Path)" }) |
                Should -Be @('POST /api/staff/roster/import', 'GET /api/staff/roster', 'PUT /api/staff/day-word', 'POST /api/auth/logout')
        }

        It 'failures with -Verbose -Debug (<Name>) leak nothing either' -ForEach @(
            @{ Name = 'rejected secret'; Setup = { $env:PULSE_STAFF_SECRET = 'wrong-' + $global:ImportRosterFake.Secret } }
            @{ Name = 'dropped upload'; Setup = { $global:ImportRosterFake.Unreachable['POST /api/staff/roster/import'] = 'The response ended prematurely.' } }
            @{ Name = '400 upload'; Setup = { $global:ImportRosterFake.Overrides['POST /api/staff/roster/import'] = @{ Status = 400; Content = '{"detail":"too many rows"}' } } }
            @{ Name = 'failed roster read'; Setup = { $global:ImportRosterFake.Overrides['GET /api/staff/roster'] = @{ Status = 503; Content = '' } } }
        ) {
            & $Setup
            $before = $global:Error.Count
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; CopyLinks = $true; GenerateWord = $true; Verbose = $true; Debug = $true }
            $run.Code | Should -Be 1
            Assert-NoSecret $run.Text 'all output'
            Assert-NoSecret (Get-ErrorDump $before) '$Error'
            Assert-NoSecret ((Get-Error -Newest 5 -ErrorAction SilentlyContinue) | Out-String) 'Get-Error'
        }

        It 'with no PULSE_STAFF_SECRET, the secret is read through az (usernames first, then only that entry) and never shown' {
            $env:PULSE_STAFF_SECRET = $null
            $global:ImportRosterAz = [System.Collections.Generic.List[string]]::new()
            Mock Invoke-Az {
                $line = @($args) -join ' '
                $global:ImportRosterAz.Add($line)
                if ($line -match "ends_with\(name, '__Username'\)") {
                    return '[{"name":"Authentication__StaffIdentity__Accounts__0__Username","value":"evaluator1"},{"name":"Authentication__StaffIdentity__Accounts__1__Username","value":"controller1"}]'
                }
                if ($line -match "Authentication__StaffIdentity__Accounts__1__Secret") {
                    return (ConvertTo-Json -Compress ([ordered]@{ name = 'Authentication__StaffIdentity__Accounts__1__Secret'; value = $global:ImportRosterFake.Secret }))
                }
                throw "unexpected az call: $line"
            }
            try {
                $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; Verbose = $true; Debug = $true }
                $run.Code | Should -Be 0
                $global:ImportRosterAz.Count | Should -Be 2
                $global:ImportRosterAz[0] | Should -Match '--name app-pulse-api-uat-dynamis .*--subscription 2a127d53-c9bf-471a-8196-3155eae6cb1b'
                $global:ImportRosterAz[0] | Should -Not -Match '__Secret'
                Assert-NoSecret $run.Text 'all output'
            }
            finally { Remove-Variable -Name ImportRosterAz -Scope Global -ErrorAction SilentlyContinue }
        }

        It 'an unknown staff login in the App Service settings is a readable error listing the known ones' {
            $env:PULSE_STAFF_SECRET = $null
            Mock Invoke-Az { '[{"name":"Authentication__StaffIdentity__Accounts__0__Username","value":"controller1"}]' }
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; StaffUsername = 'ghost' }
            $run.Code | Should -Be 1
            $run.Red -join "`n" | Should -Match "No staff login 'ghost' is configured on app-pulse-api-uat-dynamis \(there are: controller1\)"
            @(Get-CallSequence) | Should -Be @('GET /api/exercise-context')
        }
    }

    Describe 'Docs' {
        It 'Get-Help renders the synopsis, every parameter and the examples' {
            $help = Get-Help $script:ScriptFile -Full
            $help.Synopsis | Should -Match 'Provisions UAT testers from a CSV'
            $names = @($help.parameters.parameter | ForEach-Object name)
            foreach ($name in 'CsvPath', 'DryRun', 'OutFile', 'CopyLinks', 'GenerateWord', 'Word', 'CheckOnly', 'StaffUsername', 'ApiHost', 'SiteUrl', 'Subscription', 'ResourceGroup', 'WebAppName') {
                $names | Should -Contain $name
                (($help.parameters.parameter | Where-Object name -eq $name).description | Out-String).Trim() | Should -Not -BeNullOrEmpty -Because $name
            }
            @($help.examples.example).Count | Should -BeGreaterOrEqual 3
        }

        It 'New-DemoParticipant.ps1''s help points testers at Import-Roster.ps1' {
            $help = Get-Help (Join-Path $PSScriptRoot 'New-DemoParticipant.ps1') -Full
            ($help.description | Out-String) | Should -Match 'Import-Roster\.ps1'
        }
    }
}
