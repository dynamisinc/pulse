# Shared helpers for the scripts in scripts/uat. Dot-source it: . "$PSScriptRoot/Common.ps1"

function Invoke-Az {
    <#
    .SYNOPSIS
        Runs az and returns its stdout as one string. Throws with az's own error text when it fails.
    .DESCRIPTION
        The Windows az CLI prints a harmless "32-bit Python" cryptography UserWarning on stderr for many
        commands. It runs Python in isolated mode (-I), so PYTHONWARNINGS can't silence it; this drops that
        line and keeps any real error. Nothing here echoes stdout, so a command whose output is a secret
        stays unprinted.
    #>
    $stdout = [System.Collections.Generic.List[string]]::new()
    $stderr = [System.Collections.Generic.List[string]]::new()
    az @args --only-show-errors 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) {
            $line = $_.ToString()
            if ($line -notmatch 'cryptography|UserWarning|32-bit Python') { $stderr.Add($line) }
        }
        else {
            $stdout.Add([string] $_)
        }
    }
    if ($LASTEXITCODE -ne 0) {
        throw "az $($args[0]) $($args[1]) failed: $($stderr -join ' ') — check 'az login' and access to the Shared SandBox subscription."
    }
    return ($stdout -join "`n")
}
