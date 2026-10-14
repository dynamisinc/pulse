#Requires -Version 7.4

<#
.SYNOPSIS
    Pester 5 tests for Import-Roster.ps1 (easy-login story 14, #479). No network: the API is an in-memory fake
    behind a mocked Invoke-WebRequest, az is mocked, and so is the clipboard. A dropped connection and a 7.6
    redirect are thrown as the real cmdlet throws them: an ErrorRecord whose TargetObject is the
    HttpRequestMessage, Authorization header included.

.DESCRIPTION
    Runs the real script (`& Import-Roster.ps1 ...`, so its parameter sets, exit codes and every output stream
    are what is tested) against a fake of the routes it calls: GET /api/exercise-context, POST
    /api/auth/staff/login, POST /api/staff/roster/import, GET /api/staff/roster, GET and PUT /api/staff/day-word
    and POST /api/auth/logout. The fake enforces the request shapes the real endpoints enforce (the login body, the
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
            Redirect = @{}       # 'METHOD /path' -> $true: PowerShell 7.6's MaximumRedirection 0 failure
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
                HasDebug = @($Request.Keys) -contains 'Debug'; Debug = $Request['Debug']
                HasVerbose = @($Request.Keys) -contains 'Verbose'; Verbose = $Request['Verbose']
                MaximumRedirection = $Request['MaximumRedirection']; SkipHttpErrorCheck = $Request['SkipHttpErrorCheck']
            })

        $reply = { param([int] $Status, $Json) [pscustomobject]@{ StatusCode = $Status; Content = $(if ($null -ne $Json) { ConvertTo-Json -InputObject $Json -Depth 10 -Compress } else { '' }); Headers = @{} } }
        $problem = { param([int] $Status, [string] $Detail) & $reply $Status ([ordered]@{ type = 'https://tools.ietf.org/html/rfc9110'; title = 'Bad Request'; status = $Status; detail = $Detail }) }

        $key = "$method $path"
        # No response: thrown exactly as Invoke-WebRequest does, with the HttpRequestMessage (and so the bearer token)
        # as the error record's TargetObject. Left in $Error, Get-Error would print the token.
        $cmdletError = {
            param([System.Exception] $Exception, [string] $ErrorId)
            $message = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), $uri)
            if ($headers['Authorization']) { $null = $message.Headers.TryAddWithoutValidation('Authorization', [string] $headers['Authorization']) }
            [System.Management.Automation.ErrorRecord]::new($Exception, "$ErrorId,Microsoft.PowerShell.Commands.InvokeWebRequestCommand",
                [System.Management.Automation.ErrorCategory]::InvalidOperation, $message)
        }
        if ($fake.Unreachable.ContainsKey($key)) {
            throw (& $cmdletError ([System.Net.Http.HttpRequestException]::new($fake.Unreachable[$key])) 'WebCmdletWebResponseException')
        }
        if ($fake.Redirect.ContainsKey($key)) {
            throw (& $cmdletError ([System.InvalidOperationException]::new('Operation is not valid due to the current state of the object.')) 'MaximumRedirectExceeded')
        }
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
                    if ($persona -and $persona -ne 'ExampleOrg') {
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
            'GET /api/staff/day-word' {
                $status = [ordered]@{ timeZone = 'America/Chicago'; today = '2026-10-19'; todayEndsAt = '2026-10-20T05:00:00.0000000+00:00'; todaySet = $fake.WordSet; replacedCount = 0; upcoming = @() }
                if ($fake.WordSet) { $status['setAt'] = '2026-10-19T12:30:00.0000000+00:00'; $status['setByName'] = 'Casey Controller' }
                return & $reply 200 $status
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
        'Jane Smith,Example County,PIO,jane@example.test,ExampleOrg,'
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
            $staff.Count | Should -Be 5
            foreach ($call in $staff) {
                "$($call.Query) $($call.Body)" | Should -Not -Match 'exercise' -Because "$($call.Method) $($call.Path)"
                $call.Query | Should -Not -Match $global:ImportRosterFake.ExerciseId
            }
        }

        It 'every request: no redirects, the web cmdlet''s Debug and Verbose off, HTTP errors returned not thrown' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true; Verbose = $true; Debug = $true }
            $global:ImportRosterFake.Calls.Count | Should -Be 7
            foreach ($call in $global:ImportRosterFake.Calls) {
                $what = "$($call.Method) $($call.Path)"
                $call.MaximumRedirection | Should -Be 0 -Because $what
                # Present AND false: an absent switch would inherit the script's -Debug/-Verbose.
                $call.HasDebug | Should -BeTrue -Because "$what must pass -Debug:`$false explicitly"
                [bool] $call.Debug | Should -BeFalse -Because $what
                $call.HasVerbose | Should -BeTrue -Because "$what must pass -Verbose:`$false explicitly"
                [bool] $call.Verbose | Should -BeFalse -Because $what
                $call.SkipHttpErrorCheck | Should -BeTrue -Because $what
            }
        }

        It '-GenerateWord checks GET /api/staff/day-word, then sends PUT {} after the import; -Word sends { word }' {
            $null = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true }
            $put = Get-FakeCall PUT '/api/staff/day-word'
            $put.Count | Should -Be 1
            $put[0].Body | Should -BeExactly '{}'
            $put[0].Authorized | Should -BeTrue
            (Get-FakeCall GET '/api/staff/day-word')[0].Authorized | Should -BeTrue
            (Get-CallSequence)[-3..-1] | Should -Be @('GET /api/staff/day-word', 'PUT /api/staff/day-word', 'POST /api/auth/logout')

            $global:ImportRosterFake.Calls.Clear()
            $global:ImportRosterFake.WordSet = $false     # another day: no word set yet
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

        It 'formula injection: the file and the clipboard escape every dangerous cell, and quote every cell' {
            # Names come from outside agencies. These people are already on the roster (the server stores names as
            # typed), so the file's rows match them by sign-in name and the names in the links file are theirs.
            # Expected = the cell's value once a spreadsheet has parsed the quoting.
            $zwsp = [string] [char] 0x200B
            $hostile = @(
                @{ SignIn = 'eq1'; Name = '=HYPERLINK("http://evil.test","x")'; Expected = '''=HYPERLINK("http://evil.test","x")' }
                @{ SignIn = 'plus1'; Name = '+1+cmd'; Expected = '''+1+cmd' }
                @{ SignIn = 'minus1'; Name = '-2+3'; Expected = '''-2+3' }
                @{ SignIn = 'at1'; Name = '@SUM(A1)'; Expected = '''@SUM(A1)' }
                @{ SignIn = 'tab1'; Name = "`tTabbed"; Expected = "'`tTabbed" }
                @{ SignIn = 'cr1'; Name = "`rCarriage"; Expected = "'`rCarriage" }
                @{ SignIn = 'space1'; Name = '  =1+1'; Expected = '''  =1+1' }                   # S-002: after spaces
                @{ SignIn = 'zw1'; Name = "$zwsp=1+1"; Expected = "'$zwsp=1+1" }                 # S-002: after a format character
                @{ SignIn = 'quote1'; Name = '"=2+2'; Expected = '"=2+2' }                        # W-005: quoted, so it stays text
                @{ SignIn = 'safe1'; Name = 'Ann =Equals Inside'; Expected = 'Ann =Equals Inside' }
            )
            foreach ($case in $hostile) { $global:ImportRosterFake.Participants.Add((New-FakeEntry $case.Name $case.SignIn)) }
            $csv = New-RosterCsv @($hostile | ForEach-Object { "Placeholder $($_.SignIn),,,,,$($_.SignIn)" })
            $run = Invoke-ImportRoster @{ CsvPath = $csv; OutFile = $script:OutFile; CopyLinks = $true }
            $run.Code | Should -Be 0
            $text = [Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($script:OutFile)).TrimStart([char] 0xFEFF)
            $dangerous = '^[\s\p{Cc}\p{Cf}]*[=+\-@]'
            foreach ($case in $hostile) {
                $url = ($global:ImportRosterFake.Participants | Where-Object signInName -eq $case.SignIn).link['joinUrl']
                # The file: the exact quoted cells, embedded quotes doubled.
                $text | Should -Match ([regex]::Escape(('"{0}","{1}","{2}"' -f $case.Expected.Replace('"', '""'), $case.SignIn, $url))) -Because $case.SignIn
                $case.Expected | Should -Not -Match $dangerous -Because "$($case.SignIn) must never parse as a formula"
            }
            # The clipboard: tab-separated, the same quoting and escaping (a tab or line break inside a cell is a space).
            $rows = @(ConvertFrom-Csv -InputObject $global:ImportRosterClipboard[0] -Delimiter "`t")
            $rows.Count | Should -Be $hostile.Count
            foreach ($case in $hostile) {
                $row = $rows | Where-Object signInName -eq $case.SignIn
                $row.name | Should -BeExactly ($case.Expected -replace '[\t\r\n]', ' ') -Because "clipboard $($case.SignIn)"
                $row.name | Should -Not -Match $dangerous
            }
            $global:ImportRosterClipboard[0] | Should -Match ([regex]::Escape("`"`"`"=2+2`"`t`"quote1`"`t"))
        }

        It 'ConvertTo-CsvCell: <Label>' -ForEach @(
            @{ Label = 'leading spaces then = are escaped'; Value = '  =1'; Cell = '"''  =1"' }
            @{ Label = 'a zero-width space then + is escaped'; Value = "$([char] 0x200B)+1"; Cell = "`"'$([char] 0x200B)+1`"" }
            @{ Label = 'a control character then @ is escaped'; Value = "$([char] 7)@x"; Cell = "`"'$([char] 7)@x`"" }
            @{ Label = 'a leading " is quoted, so = stays inside a text field'; Value = '"=1'; Cell = '"""=1"' }
            @{ Label = 'leading spaces alone are left alone'; Value = ' Ann'; Cell = '" Ann"' }
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

        It 'ConvertTo-LinksClipboardText quotes and escapes every cell, header included (W-005)' {
            $text = ConvertTo-LinksClipboardText -Links @(
                [pscustomobject]@{ Name = '"=1+1'; SignInName = 'q1'; JoinUrl = 'https://site.test/join/a' }
                [pscustomobject]@{ Name = "=cmd`tx"; SignInName = 'e1'; JoinUrl = '' }
            )
            $lines = $text -split '\r?\n'
            $lines[0] | Should -BeExactly "`"name`"`t`"signInName`"`t`"joinUrl`""
            $lines[1] | Should -BeExactly "`"`"`"=1+1`"`t`"q1`"`t`"https://site.test/join/a`""
            $lines[2] | Should -BeExactly "`"'=cmd x`"`t`"e1`"`t`"`""
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
            $lines[0] | Should -BeExactly "`"name`"`t`"signInName`"`t`"joinUrl`""
            $lines.Count | Should -Be 4
            foreach ($p in @($global:ImportRosterFake.Participants | Where-Object signInName -in 'jsmith', 'bjones', 'cdiaz')) {
                $lines | Should -Contain ("`"{0}`"`t`"{1}`"`t`"{2}`"" -f $p.name, $p.signInName, $p.link['joinUrl'])
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

    Describe 'The links file fails closed without an owner-only ACL (Copilot review on #486)' {
        # -WindowsAcl forces the Windows branch. Off Windows the ACL APIs throw PlatformNotSupportedException,
        # which is exactly the "the owner-only ACL could not be set" path this pins. On Windows the ACL succeeds,
        # so these are skipped there (the Windows Get-Acl check is in story 14's manual UAT steps).
        It 'throws and writes nothing, rather than falling back to the folder''s permissions' -Skip:$IsWindows {
            $target = Join-Path $TestDrive "acl-$([guid]::NewGuid().ToString('N')).csv"
            { Write-PrivateTextFile -Path $target -Text "name,signInName,joinUrl`nA,a1,https://site.test/join/secret" -WindowsAcl $true } |
                Should -Throw '*owner-only ACL could not be set*no links file was written*'
            Test-Path -LiteralPath $target | Should -BeFalse
        }

        It 'a file already at the path is not left behind either' -Skip:$IsWindows {
            $target = Join-Path $TestDrive "acl-old-$([guid]::NewGuid().ToString('N')).csv"
            Set-Content -LiteralPath $target -Value 'old links'
            { Write-PrivateTextFile -Path $target -Text 'name,signInName,joinUrl' -WindowsAcl $true } | Should -Throw '*owner-only ACL*'
            Test-Path -LiteralPath $target | Should -BeFalse
        }
    }

    Describe '-OutFile is checked before anything is sent (CR-001, S-003, W-002)' {
    It 'a non-empty folder is refused, with a Join-Path hint, and survives intact' {
        $folder = Join-Path $TestDrive 'keep-me'
        New-Item -ItemType Directory -Path (Join-Path $folder 'nested') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $folder 'notes.txt') -Value 'precious'
        Set-Content -LiteralPath (Join-Path $folder 'nested/deep.txt') -Value 'also precious'
        $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $folder }
        $run.Code | Should -Be 1
        $global:ImportRosterFake.Calls.Count | Should -Be 0
        $run.Red -join "`n" | Should -Match "is a folder\. Name a file in it instead, e\.g\. -OutFile \(Join-Path '.+keep-me' 'roster-links\.csv'\)\. Nothing was sent\."
        Get-Content -LiteralPath (Join-Path $folder 'notes.txt') | Should -Be 'precious'
        Get-Content -LiteralPath (Join-Path $folder 'nested/deep.txt') | Should -Be 'also precious'
    }

    It 'a trailing separator (''newdir/'') names a folder: refused, and the folder is not created (W-2)' {
        $csv = New-RosterCsv $script:GoodRows
        Push-Location -LiteralPath $TestDrive
        try { $run = Invoke-ImportRoster @{ CsvPath = $csv; OutFile = 'newdir/' } }
        finally { Pop-Location }
        $run.Code | Should -Be 1
        $global:ImportRosterFake.Calls.Count | Should -Be 0
        $run.Red -join "`n" | Should -Match "is a folder\. Name a file in it instead, e\.g\. -OutFile \(Join-Path '.+newdir' 'roster-links\.csv'\)\. Nothing was sent\."
        Test-Path -LiteralPath (Join-Path $TestDrive 'newdir') | Should -BeFalse
    }

    It 'the writer''s own backstop: a folder that appeared after the checks (<Name>) is never replaced (W-1)' -ForEach @(
        @{ Name = 'the folder itself'; Link = $false }
        @{ Name = 'a symbolic link to it'; Link = $true }
    ) {
        if ($Link -and $IsWindows) { Set-ItResult -Skipped -Because 'symbolic links need elevation on Windows' }
        $folder = Join-Path $TestDrive "appeared-$([guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Path (Join-Path $folder 'nested') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $folder 'notes.txt') -Value 'precious'
        Set-Content -LiteralPath (Join-Path $folder 'nested/deep.txt') -Value 'also precious'
        $target = $folder
        if ($Link) {
            $target = Join-Path $TestDrive "link-$([guid]::NewGuid().ToString('N'))"
            New-Item -ItemType SymbolicLink -Path $target -Target $folder | Out-Null
        }
        { Write-PrivateTextFile -Path $target -Text 'name,signInName,joinUrl' } | Should -Throw '*is not a regular file*'
        Get-Content -LiteralPath (Join-Path $folder 'notes.txt') | Should -Be 'precious'
        Get-Content -LiteralPath (Join-Path $folder 'nested/deep.txt') | Should -Be 'also precious'
        if ($Link) { (Get-Item -LiteralPath $target -Force).LinkType | Should -Be 'SymbolicLink' }
    }

    It 'the CSV itself is refused: <Name>' -ForEach @(
        @{ Name = 'the same path'; Spell = { param($Csv) $Csv } }
        @{ Name = 'another spelling of it'; Spell = { param($Csv) Join-Path (Split-Path -Parent $Csv) '.' (Split-Path -Leaf $Csv) } }
        @{ Name = 'a symbolic link to it'; Link = $true; Spell = { param($Csv) $link = Join-Path $TestDrive 'link-to-csv.csv'; New-Item -ItemType SymbolicLink -Path $link -Target $Csv -Force | Out-Null; $link } }
    ) {
        if ($Link -and $IsWindows) { Set-ItResult -Skipped -Because 'symbolic links need elevation on Windows' }
        $csv = New-RosterCsv $script:GoodRows
        $before = Get-Content -LiteralPath $csv -Raw
        $run = Invoke-ImportRoster @{ CsvPath = $csv; OutFile = (& $Spell $csv) }
        $run.Code | Should -Be 1
        $global:ImportRosterFake.Calls.Count | Should -Be 0
        $run.Red -join "`n" | Should -Match 'is the roster CSV itself, which the links file would overwrite\. Choose another -OutFile\. Nothing was sent\.'
        Get-Content -LiteralPath $csv -Raw | Should -BeExactly $before
    }

    It 'a path under a file (not a folder) is refused' {
        $file = Join-Path $TestDrive 'a-file.txt'
        Set-Content -LiteralPath $file -Value 'x'
        $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = (Join-Path $file 'links.csv') }
        $run.Code | Should -Be 1
        $global:ImportRosterFake.Calls.Count | Should -Be 0
        $run.Red -join "`n" | Should -Match "is a file, not a folder"
        Get-Content -LiteralPath $file | Should -Be 'x'
    }

    It 'a FIFO (not a regular file) is refused and left alone' -Skip:$IsWindows {
        $fifo = Join-Path $TestDrive 'a-pipe'
        & mkfifo -- $fifo
        $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $fifo }
        $run.Code | Should -Be 1
        $global:ImportRosterFake.Calls.Count | Should -Be 0
        $run.Red -join "`n" | Should -Match 'is not a regular file'
        [string] (Get-Item -LiteralPath $fifo -Force).UnixStat.ItemType | Should -Be 'NamedPipe'
    }

    It 'missing folders on the way are created, and the file is written' {
        $deep = Join-Path $TestDrive 'a/b/c/links.csv'
        $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $deep }
        $run.Code | Should -Be 0
        @(Import-Csv -LiteralPath $deep).Count | Should -Be 3
        @(Get-ChildItem -LiteralPath (Split-Path -Parent $deep) -Force).Name | Should -Be @('links.csv')   # the probe file is gone
    }

    It 'a links file that cannot be created: the import is saved, a readable reason, exit 1, signed out (W-002)' {
        Mock New-PrivateFileStream {
            throw [System.Management.Automation.MethodInvocationException]::new(
                'Exception calling ".ctor" with "2" argument(s): "Access to the path is denied."', [System.UnauthorizedAccessException]::new('Access to the path is denied.'))
        }
        $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
        $run.Code | Should -Be 1
        $run.Red -join "`n" | Should -Match ('The import was saved, but the links file could not be written \(permission denied on ' + [regex]::Escape($script:OutFile) +
            '\)\. Run again with the same file and a writable -OutFile; every row comes back unchanged\.')
        $run.Text | Should -Not -Match 'Exception calling|MethodInvocationException|\.ctor'
        (Get-CallSequence)[-1] | Should -Be 'POST /api/auth/logout'
        Test-Path -LiteralPath $script:OutFile | Should -BeFalse
    }

    It 'a write that fails half-way leaves no partial links file behind (W-002)' {
        Mock New-PrivateFileStream { [System.IO.File]::WriteAllText($Path, 'partial'); [System.IO.FileStream]::new($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read) }
        $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
        $run.Code | Should -Be 1
        $run.Red -join "`n" | Should -Match 'The import was saved, but the links file could not be written \(Stream does not support writing\)'
        Test-Path -LiteralPath $script:OutFile | Should -BeFalse
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

        It 'a word already set today is left alone: no PUT, nothing printed or copied, and it says so (exit 0)' {
            $global:ImportRosterFake.WordSet = $true
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; GenerateWord = $true }
            $run.Code | Should -Be 0
            (Get-FakeCall GET '/api/staff/day-word').Count | Should -Be 1
            (Get-FakeCall PUT '/api/staff/day-word').Count | Should -Be 0
            $run.Text | Should -Match "Today's word for 2026-10-19 was already set by Casey Controller at .+, so it was NOT changed"
            $run.Text | Should -Match 'run again with -ReplaceWord'
            $run.Text.Contains($global:ImportRosterFake.GeneratedWord) | Should -BeFalse
            Should -Invoke Set-Clipboard -Times 0 -Exactly
            (Get-CallSequence)[-1] | Should -Be 'POST /api/auth/logout'
        }

        It 'with -Word, it says the word you passed was NOT set, and never prints it (S-4)' {
    $global:ImportRosterFake.WordSet = $true
    $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; Word = 'Harbor Lantern' }
    $run.Code | Should -Be 0
    (Get-FakeCall PUT '/api/staff/day-word').Count | Should -Be 0
    $run.Text | Should -Match 'was already set by Casey Controller at .+, so the word you passed with -Word was NOT set'
    $run.Text | Should -Not -Match 'Harbor Lantern'
    Should -Invoke Set-Clipboard -Times 0 -Exactly
}

It '-ReplaceWord replaces it, and says the earlier word stopped working' {
            $global:ImportRosterFake.WordSet = $true
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; Word = 'Harbor Lantern'; ReplaceWord = $true }
            $run.Code | Should -Be 0
            (Get-FakeCall PUT '/api/staff/day-word')[0].Body | Should -BeExactly '{"word":"Harbor Lantern"}'
            $run.Text | Should -Match 'REPLACED the word already set'
            $run.Text | Should -Match '\(as given'
        }

        It '-ReplaceWord without -GenerateWord or -Word is refused before anything is sent' {
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; ReplaceWord = $true }
            $run.Code | Should -Be 1
            $run.Text | Should -Match '-ReplaceWord goes with -GenerateWord or -Word'
            $global:ImportRosterFake.Calls.Count | Should -Be 0
        }

        It 'the failed-row hint warns against re-running with -GenerateWord/-Word, only when they were given' {
            $csv = New-RosterCsv ($script:GoodRows + 'Nora Nope,,,,NotAPersona,')
            $run = Invoke-ImportRoster @{ CsvPath = $csv; OutFile = $script:OutFile; GenerateWord = $true }
            $run.Red -join "`n" | Should -Match "run it without -GenerateWord/-Word unless you mean to change today's word"
            $run = Invoke-ImportRoster @{ CsvPath = $csv; OutFile = $script:OutFile }
            $run.Red -join "`n" | Should -Not -Match 'GenerateWord'
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
            $global:ImportRosterFake.Unreachable['GET /api/exercise-context'] = 'Name or service not known (nope.example.test:443).'
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; ApiHost = 'nope.example.test' }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match 'No answer from the API to GET /api/exercise-context: Name or service not known \(nope\.example\.test:443\)\. Check -ApiHost'
            $run.Red -join "`n" | Should -Not -Match '\.\.'
            Get-CallSequence | Should -Be @('GET /api/exercise-context')
        }

        It 'a redirect (PowerShell 7.6: MaximumRedirectExceeded) is not followed and explains -ApiHost (S-001)' {
            $global:ImportRosterFake.Redirect['GET /api/exercise-context'] = $true
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
            Assert-CleanFailure $run
            $run.Red -join "`n" | Should -Match 'GET /api/exercise-context answered a redirect\. The API never redirects, so it was not followed\. Check -ApiHost'
            $run.Text | Should -Not -Match 'Operation is not valid'
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
                Should -Be @('POST /api/staff/roster/import', 'GET /api/staff/roster', 'GET /api/staff/day-word', 'PUT /api/staff/day-word', 'POST /api/auth/logout')
        }

        It 'failures with -Verbose -Debug (<Name>) leak nothing either' -ForEach @(
            @{ Name = 'rejected secret'; Setup = { $env:PULSE_STAFF_SECRET = 'wrong-' + $global:ImportRosterFake.Secret } }
            @{ Name = 'dropped upload'; Setup = { $global:ImportRosterFake.Unreachable['POST /api/staff/roster/import'] = 'The response ended prematurely.' } }
            @{ Name = '400 upload'; Setup = { $global:ImportRosterFake.Overrides['POST /api/staff/roster/import'] = @{ Status = 400; Content = '{"detail":"too many rows"}' } } }
            @{ Name = 'failed roster read'; Setup = { $global:ImportRosterFake.Overrides['GET /api/staff/roster'] = @{ Status = 503; Content = '' } } }
            @{ Name = 'redirected upload'; Setup = { $global:ImportRosterFake.Redirect['POST /api/staff/roster/import'] = $true } }
            @{ Name = 'dropped word check'; Setup = { $global:ImportRosterFake.Unreachable['GET /api/staff/day-word'] = 'Connection reset by peer' } }
        ) {
            & $Setup
            $before = $global:Error.Count
            $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile; CopyLinks = $true; GenerateWord = $true; Verbose = $true; Debug = $true }
            $run.Code | Should -Be 1
            Assert-NoSecret $run.Text 'all output'
            Assert-NoSecret (Get-ErrorDump $before) '$Error'
            Assert-NoSecret ((Get-Error -Newest 5 -ErrorAction SilentlyContinue) | Out-String) 'Get-Error'
        }

        It 'the caller''s $PSDefaultParameterValues do not reach the script''s commands (S-004)' {
    $saved = $global:PSDefaultParameterValues
    try {
        $global:PSDefaultParameterValues = @{ 'Write-Verbose:Verbose' = $true }
        $run = Invoke-ImportRoster @{ CsvPath = (New-RosterCsv $script:GoodRows); OutFile = $script:OutFile }
        $run.Code | Should -Be 0
        @($run.Records | Where-Object { $_ -is [System.Management.Automation.VerboseRecord] -and "$_" -match '^(GET|POST|PUT) /api/|^Staff secret|^Exercise ' }).Count |
            Should -Be 0 -Because 'a profile default must not switch on the script''s verbose output'
    }
    finally { $global:PSDefaultParameterValues = $saved }
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
            foreach ($name in 'CsvPath', 'DryRun', 'OutFile', 'CopyLinks', 'GenerateWord', 'Word', 'ReplaceWord', 'CheckOnly', 'StaffUsername', 'ApiHost', 'SiteUrl', 'Subscription', 'ResourceGroup', 'WebAppName') {
                $names | Should -Contain $name
                (($help.parameters.parameter | Where-Object name -eq $name).description | Out-String).Trim() | Should -Not -BeNullOrEmpty -Because $name
            }
            @($help.examples.example).Count | Should -BeGreaterOrEqual 3
        }

        It 'Get-Help renders <Script>''s description (it needs a blank line after #Requires)' -ForEach @(
    @{ Script = 'Import-Roster.ps1' }, @{ Script = 'New-DemoParticipant.ps1' }, @{ Script = 'Copy-StaffSecret.ps1' }, @{ Script = 'Clear-DemoContent.ps1' }
) {
    ((Get-Help (Join-Path $PSScriptRoot $Script) -Full).description | Out-String).Trim() | Should -Not -BeNullOrEmpty
}

It 'New-DemoParticipant.ps1''s help points testers at Import-Roster.ps1' {
            $help = Get-Help (Join-Path $PSScriptRoot 'New-DemoParticipant.ps1') -Full
            ($help.description | Out-String) | Should -Match 'Import-Roster\.ps1'
        }
    }
}
