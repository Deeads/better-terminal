# Loaded only in this terminal process. Never modifies the user's PowerShell profile.
$global:BetterTerminalToken = $env:BETTER_TERMINAL_TOKEN
$global:BetterTerminalCompletionFile = $env:BETTER_TERMINAL_COMPLETION_FILE
$global:BetterTerminalCompletionReady = $false
function global:Send-BetterTerminalEvent($Type, $Command) {
    try {
        if ($PWD.Provider.Name -ne 'FileSystem') { return }
        $eventData = @{ type = $Type; cwd = $PWD.Path }
        if ($Type -eq 'command') { $eventData.command = $Command }
        if ($Type -eq 'prompt') { $eventData.command = [string][int]$global:BetterTerminalCompletionReady }
        $json = ConvertTo-Json -InputObject $eventData -Compress
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
        [Console]::Write("$([char]27)]777;BT;$global:BetterTerminalToken;$encoded$([char]7)")
    } catch {}
}
function global:Send-BetterTerminalInput {
    try {
        $line = ''; $cursor = 0
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
        $json = ConvertTo-Json -InputObject @{ type = 'input'; cwd = $PWD.Path; command = $line; cursor = $cursor } -Compress
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
        [Console]::Write("$([char]27)]777;BT;$global:BetterTerminalToken;$encoded$([char]7)")
    } catch {}
}
$global:BetterTerminalOriginalPrompt = $function:prompt
$global:BetterTerminalHistoryHook = $false
$global:BetterTerminalLastHistoryId = 0
try {
    Import-Module PSReadLine -ErrorAction Stop
    $global:BetterTerminalOriginalHistoryHandler = (Get-PSReadLineOption).AddToHistoryHandler
    Set-PSReadLineOption -AddToHistoryHandler {
        param([string]$line)
        # PSReadLine also calls this for every line it loads from the saved history file, while the buffer is empty.
        $buffer = ''; $cursor = 0
        try { [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$buffer, [ref]$cursor) } catch {}
        if ($buffer -ceq $line) { Send-BetterTerminalEvent 'command' $line }
        if ($null -ne $global:BetterTerminalOriginalHistoryHandler) {
            return $global:BetterTerminalOriginalHistoryHandler.Invoke($line)
        }
        return $true
    }
    $global:BetterTerminalHistoryHook = $true
    Set-PSReadLineKeyHandler -Chord Ctrl+F12 -ScriptBlock { Send-BetterTerminalInput }
    Set-PSReadLineKeyHandler -Chord Ctrl+Shift+F12 -ScriptBlock {
        try {
            $parts = [IO.File]::ReadAllLines($global:BetterTerminalCompletionFile)
            if ($parts.Length -ge 3 -and $parts[0] -eq $global:BetterTerminalToken) {
                $expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
                $replacement = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[2]))
                $line = ''; $cursor = 0
                [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
                if ($line -ceq $expected -and $cursor -eq $line.Length -and $replacement -notmatch '[\x00-\x1f\x7f]') {
                    [Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $line.Length, $replacement)
                }
            }
        } catch {}
        Send-BetterTerminalInput
    }
    $global:BetterTerminalCompletionReady = $true
} catch {}
$global:BetterTerminalPreviousCwd = $PWD.Path
function global:prompt {
    $savedExitCode = $global:LASTEXITCODE
    if (-not $global:BetterTerminalHistoryHook) {
        $last = Get-History -Count 1
        if ($last -and $last.Id -gt $global:BetterTerminalLastHistoryId) {
            $global:BetterTerminalLastHistoryId = $last.Id
            $json = ConvertTo-Json -InputObject @{ type = 'command'; cwd = $global:BetterTerminalPreviousCwd; command = $last.CommandLine } -Compress
            $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
            [Console]::Write("$([char]27)]777;BT;$global:BetterTerminalToken;$encoded$([char]7)")
        }
    }
    Send-BetterTerminalEvent 'cwd' ''
    Send-BetterTerminalEvent 'prompt' ''
    $global:BetterTerminalPreviousCwd = $PWD.Path
    $global:LASTEXITCODE = $savedExitCode
    if ($global:BetterTerminalOriginalPrompt) { & $global:BetterTerminalOriginalPrompt } else { "PS $PWD> " }
    $global:LASTEXITCODE = $savedExitCode
}
