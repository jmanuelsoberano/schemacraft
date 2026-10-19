# Controller: run ONLY on an ephemeral GitHub-hosted Windows runner.
# No application, installer or uninstaller is ever launched by this administrator controller.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AssetsDirectory,
    [Parameter(Mandatory = $true)][string]$ResultsDirectory,
    [string]$SqlSetupScript,
    [string]$FixtureDirectory
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This controller is restricted to disposable GitHub-hosted Windows runners. Do not run it on a workstation or self-hosted runner.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'The hosted-runner controller requires its existing administrator token to create the isolated standard account.' }
$output = [IO.Path]::GetFullPath($ResultsDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 12)
$userName = 'scverify' + $suffix
$taskName = 'SchemaCraftAcceptance-' + $suffix
$staging = Join-Path $env:SystemDrive ('SchemaCraftAcceptance-' + $suffix)
if (Test-Path -LiteralPath $staging) { throw 'The unique staging directory already exists.' }
$report = [ordered]@{ runner = $env:ImageOS; imageVersion = $env:ImageVersion; runId = $env:GITHUB_RUN_ID; standardAccountCreated = $false; taskRegistered = $false; passed = $false; limitation = 'Windows Server runner; UAC is disabled by the image. This does not verify interactive elevation prompts on Windows 10 or 11.' }
$account = $null
$registered = $false
$created = $false
$password = $null
try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    $inputs = Join-Path $staging 'inputs'
    $results = Join-Path $staging 'results'
    New-Item -ItemType Directory -Path $inputs, $results | Out-Null
    foreach ($name in @('schemacraft-v1.2.0-windows-x64.exe', 'schemacraft-v1.2.0-windows-x64-setup.exe', 'SHA256SUMS.txt')) {
        Copy-Item -LiteralPath (Join-Path $AssetsDirectory $name) -Destination $inputs
    }
    foreach ($name in @('verify-release-standard-user.ps1', 'smoke-release-standard-user.mjs', 'release-cdp.mjs', 'inspect-pe-manifest.mjs')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $inputs
    }
    # Only the already-provisioned Node binary is copied; the worker performs no downloads.
    Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $inputs 'node.exe')
    # Known official Evergreen bootstrapper; it is only executed by the standard-account worker
    # when the image naturally lacks a registered runtime, after the negative startup check.
    $runtimeSetup = Join-Path $inputs 'MicrosoftEdgeWebview2Setup.exe'
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $runtimeSetup
    $runtimeSignature = Get-AuthenticodeSignature -LiteralPath $runtimeSetup
    if ($runtimeSignature.Status -ne 'Valid' -or $runtimeSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'The official WebView2 bootstrapper does not have a valid Microsoft signature.' }
    $random = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $password = [Convert]::ToBase64String($random) + '!aA1'
    Write-Output ('::add-mask::' + $password)
    $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
    $account = New-LocalUser -Name $userName -Password $securePassword -Description 'Disposable release acceptance standard account' -AccountNeverExpires
    $created = $true
    $report.standardAccountCreated = $true
    $standardSid = $account.SID.Value
    $users = Get-LocalGroup -SID 'S-1-5-32-545'
    Add-LocalGroupMember -Group $users -Member $account
    $administratorGroup = Get-LocalGroup -SID 'S-1-5-32-544'
    if (@(Get-LocalGroupMember -Group $administratorGroup | Where-Object { $_.SID.Value -eq $standardSid }).Count -ne 0) { throw 'The test account unexpectedly belongs to Administrators.' }
    # Retain SYSTEM/Administrators control; grant the test account read-only inputs and writable evidence.
    $acl = Get-Acl -LiteralPath $staging
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    $readRule = New-Object Security.AccessControl.FileSystemAccessRule($account.SID, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($readRule)
    Set-Acl -LiteralPath $staging -AclObject $acl
    $resultAcl = Get-Acl -LiteralPath $results
    $writeRule = New-Object Security.AccessControl.FileSystemAccessRule($account.SID, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $resultAcl.AddAccessRule($writeRule)
    Set-Acl -LiteralPath $results -AclObject $resultAcl
    $sqlPort = 0
    if ($SqlSetupScript) {
        if (-not $FixtureDirectory) { throw 'FixtureDirectory is required with SqlSetupScript.' }
        $sqlEvidence = Join-Path $env:RUNNER_TEMP ('schemacraft-sql-' + $suffix)
        & (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $SqlSetupScript -TestAccount ($env:COMPUTERNAME + '\' + $userName) -FixtureDirectory $FixtureDirectory -EvidenceDirectory $sqlEvidence -ConfirmDisposableHostedRunner
        $sqlExit = $LASTEXITCODE
        if (Test-Path -LiteralPath (Join-Path $sqlEvidence 'windows-auth-sql-setup.json')) { Copy-Item -LiteralPath (Join-Path $sqlEvidence 'windows-auth-sql-setup.json') -Destination $output }
        if ($sqlExit -ne 0) { throw 'Disposable Windows Authentication SQL setup failed.' }
        $sqlPort = 14335
    }
    $worker = Join-Path $inputs 'verify-release-standard-user.ps1'
    # None of these arguments contains credentials. Task Scheduler receives the password through its API.
    $command = "& '$worker' -InputsDirectory '$inputs' -ResultsDirectory '$results' -ExpectedSid '$standardSid' -SqlPort $sqlPort"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + $encoded) -WorkingDirectory $inputs
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId ($env:COMPUTERNAME + '\' + $userName) -LogonType Password -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $task = New-ScheduledTask -Action $action -Principal $taskPrincipal -Settings $settings
    Register-ScheduledTask -TaskName $taskName -InputObject $task -User ($env:COMPUTERNAME + '\' + $userName) -Password $password | Out-Null
    $registered = $true
    $report.taskRegistered = $true
    $password = $null
    Start-ScheduledTask -TaskName $taskName
    $deadline = [DateTime]::UtcNow.AddMinutes(14)
    $workerReport = Join-Path $results 'worker-report.json'
    do {
        Start-Sleep -Seconds 2
        $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
        $state = (Get-ScheduledTask -TaskName $taskName).State
        if ($state -ne 'Running' -and $taskInfo.LastRunTime.Year -gt 2000) { break }
    } while ([DateTime]::UtcNow -lt $deadline)
    $report.taskResult = $taskInfo.LastTaskResult
    $report.taskState = [string]$state
    if ($state -eq 'Running') { throw 'The limited-account worker exceeded its deadline.' }
    if (-not (Test-Path -LiteralPath $workerReport)) { throw ('The worker produced no report. Task Scheduler result: ' + $taskInfo.LastTaskResult + '. A non-interactive desktop or batch-logon restriction may prevent this approach; never substitute an administrator run.') }
    $workerResult = Get-Content -LiteralPath $workerReport -Raw | ConvertFrom-Json
    $report.workerPassed = $workerResult.passed
    if (-not $workerResult.passed -or $taskInfo.LastTaskResult -ne 0) { throw 'The standard-account worker failed; inspect its report.' }
    $report.passed = $true
}
catch { $report.error = $_.Exception.Message; Write-Error $_ -ErrorAction Continue }
finally {
    if ($registered) {
        if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') {
            Stop-ScheduledTask -TaskName $taskName
            $report.workerForcedToStop = $true
        }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    # Never guess which system process to kill. The disposable VM owns any remaining processes.
    # Evidence includes only known reports and screenshots, not profiles, preferences or credentials.
    if (Test-Path -LiteralPath (Join-Path $staging 'results')) {
        $evidenceFiles = @('worker-report.json', 'missing-runtime\report.json', 'installer-manifest.json')
        foreach ($session in @('portable', 'installed')) {
            foreach ($name in @('report.json', '01-welcome-en-light.png', '02-about.png', '03-welcome-es-dark.png', '04-windows-auth-capture.png')) { $evidenceFiles += Join-Path $session $name }
        }
        foreach ($relative in $evidenceFiles) {
            $source = Join-Path (Join-Path $staging 'results') $relative
            if (Test-Path -LiteralPath $source -PathType Leaf) {
                $destination = Join-Path $output $relative
                New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
                Copy-Item -LiteralPath $source -Destination $destination
            }
        }
    }
    if ($created) { Disable-LocalUser -SID $account.SID; Remove-LocalUser -SID $account.SID; $report.standardAccountRemoved = $true }
    $password = $null
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $output 'controller-report.json') -Encoding UTF8
}
if (-not $report.passed) { exit 1 }
