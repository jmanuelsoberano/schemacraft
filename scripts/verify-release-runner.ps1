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
$report = [ordered]@{ runner = $env:ImageOS; imageVersion = $env:ImageVersion; runId = $env:GITHUB_RUN_ID; standardAccountCreated = $false; taskRegistered = $false; passed = $false; limitation = 'Windows Server runner; the worker records the observed UAC setting. This does not verify interactive elevation prompts on Windows 10 or 11.' }
$account = $null
$registered = $false
$created = $false
$password = $null
$taskLog = $null
$taskLogChanged = $false
$taskLogName = 'Microsoft-Windows-TaskScheduler/Operational'
function Read-BatchLogonRights([string]$AccountSid) {
    # Inspect only the two relevant rights for this account and known batch-logon groups.
    # This is diagnostic evidence, not a claim to have obtained the account's logon token.
    $subjects = [ordered]@{
        CreatedAccount = $AccountSid
        Users = 'S-1-5-32-545'
        Everyone = 'S-1-1-0'
        AuthenticatedUsers = 'S-1-5-11'
        LocalAccount = 'S-1-5-113'
        Local = 'S-1-2-0'
        Batch = 'S-1-5-3'
    }
    foreach ($subject in $subjects.GetEnumerator()) {
        $rights = @([ReleaseBatchRights]::Read($subject.Value))
        [ordered]@{ subject = $subject.Key; sid = $subject.Value; allowBatch = $rights -contains 'SeBatchLogonRight'; denyBatch = $rights -contains 'SeDenyBatchLogonRight' }
    }
}
function Read-OwnedTaskEvents {
    # Filter at the event service; never collect other tasks, event messages, or task XML.
    $eventErrors = @()
    $events = @(Get-WinEvent -LogName $taskLogName -FilterXPath "*[EventData[Data[@Name='TaskName']='\$taskName']]" -MaxEvents 100 -ErrorAction SilentlyContinue -ErrorVariable eventErrors)
    foreach ($failure in $eventErrors) {
        if ($failure.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw $failure }
    }
    foreach ($event in $events | Sort-Object RecordId) {
        $xml = [xml]$event.ToXml()
        $data = [ordered]@{}
        foreach ($item in $xml.Event.EventData.Data) {
            if ($item.Name -in @('TaskName', 'UserContext', 'UserName', 'ResultCode', 'ErrorCode', 'ErrorValue', 'ProcessId', 'EnginePID', 'InstanceId', 'TaskInstanceId', 'ActionName')) { $data[$item.Name] = [string]$item.InnerText }
        }
        [ordered]@{ id = [int]$event.Id; recordId = [long]$event.RecordId; timeUtc = $event.TimeCreated.ToUniversalTime().ToString('o'); level = [int]$event.Level; data = $data }
    }
}
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
    $taskLog = Get-WinEvent -ListLog $taskLogName
    $report.taskOperationalLogInitiallyEnabled = [bool]$taskLog.IsEnabled
    if (-not $taskLog.IsEnabled) {
        $taskLog.IsEnabled = $true
        $taskLogChanged = $true
        $taskLog.SaveChanges()
    }
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class ReleaseBatchRights {
    [StructLayout(LayoutKind.Sequential)] struct ObjectAttributes {
        public uint Length; public IntPtr RootDirectory; public IntPtr ObjectName;
        public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)] struct UnicodeString {
        public ushort Length; public ushort MaximumLength; public IntPtr Buffer;
    }
    [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system, ref ObjectAttributes attributes, uint access, out IntPtr policy);
    [DllImport("advapi32.dll")] static extern uint LsaEnumerateAccountRights(IntPtr policy, byte[] sid, out IntPtr rights, out uint count);
    [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr policy, byte[] sid, ref UnicodeString right, uint count);
    [DllImport("advapi32.dll")] static extern uint LsaNtStatusToWinError(uint status);
    [DllImport("advapi32.dll")] static extern uint LsaFreeMemory(IntPtr memory);
    [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr policy);
    public static void GrantBatchLogon(string accountSid) {
        const string name = "SeBatchLogonRight";
        var attributes = new ObjectAttributes { Length = (uint)Marshal.SizeOf(typeof(ObjectAttributes)) };
        IntPtr policy;
        // A fresh SID may not yet have an LSA policy account: LOOKUP_NAMES | CREATE_ACCOUNT.
        uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x00000810, out policy);
        if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
        IntPtr buffer = IntPtr.Zero;
        try {
            var sid = new SecurityIdentifier(accountSid);
            var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
            buffer = Marshal.StringToHGlobalUni(name);
            var right = new UnicodeString { Length = (ushort)(name.Length * 2), MaximumLength = (ushort)((name.Length + 1) * 2), Buffer = buffer };
            status = LsaAddAccountRights(policy, bytes, ref right, 1);
            if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
        } finally {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            LsaClose(policy);
        }
    }
    public static string[] Read(string accountSid) {
        var attributes = new ObjectAttributes { Length = (uint)Marshal.SizeOf(typeof(ObjectAttributes)) };
        IntPtr policy;
        uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x00000800, out policy); // POLICY_LOOKUP_NAMES only.
        if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
        IntPtr rights = IntPtr.Zero;
        try {
            var sid = new SecurityIdentifier(accountSid);
            var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
            uint count;
            status = LsaEnumerateAccountRights(policy, bytes, out rights, out count);
            uint error = LsaNtStatusToWinError(status);
            if (error == 2) return new string[0]; // No rights are directly assigned to this SID.
            if (status != 0) throw new Win32Exception((int)error);
            var result = new List<string>();
            int size = Marshal.SizeOf(typeof(UnicodeString));
            for (uint index = 0; index < count; index++) {
                var value = (UnicodeString)Marshal.PtrToStructure(IntPtr.Add(rights, checked((int)index * size)), typeof(UnicodeString));
                string name = Marshal.PtrToStringUni(value.Buffer, value.Length / 2);
                if (name == "SeBatchLogonRight" || name == "SeDenyBatchLogonRight") result.Add(name);
            }
            return result.ToArray();
        } finally {
            if (rights != IntPtr.Zero) LsaFreeMemory(rights);
            LsaClose(policy);
        }
    }
}
'@
    $report.batchLogonRightsBeforeRegistration = @(Read-BatchLogonRights $standardSid)
    $report.taskRegistrationUtc = [DateTime]::UtcNow.ToString('o')
    Register-ScheduledTask -TaskName $taskName -InputObject $task -User ($env:COMPUTERNAME + '\' + $userName) -Password $password | Out-Null
    $registered = $true
    $report.taskRegistered = $true
    $password = $null
    $effectiveTask = Get-ScheduledTask -TaskName $taskName
    $report.taskConfiguration = [ordered]@{
        principal = [ordered]@{ userId = [string]$effectiveTask.Principal.UserId; groupId = [string]$effectiveTask.Principal.GroupId; logonType = [string]$effectiveTask.Principal.LogonType; runLevel = [string]$effectiveTask.Principal.RunLevel }
        settings = [ordered]@{ enabled = [bool]$effectiveTask.Settings.Enabled; allowDemandStart = [bool]$effectiveTask.Settings.AllowDemandStart; runOnlyIfIdle = [bool]$effectiveTask.Settings.RunOnlyIfIdle; runOnlyIfNetworkAvailable = [bool]$effectiveTask.Settings.RunOnlyIfNetworkAvailable; disallowStartIfOnBatteries = [bool]$effectiveTask.Settings.DisallowStartIfOnBatteries; stopIfGoingOnBatteries = [bool]$effectiveTask.Settings.StopIfGoingOnBatteries; startWhenAvailable = [bool]$effectiveTask.Settings.StartWhenAvailable; multipleInstances = [string]$effectiveTask.Settings.MultipleInstances; executionTimeLimit = [string]$effectiveTask.Settings.ExecutionTimeLimit; compatibility = [string]$effectiveTask.Settings.Compatibility }
    }
    $report.batchLogonRightsAfterRegistration = @(Read-BatchLogonRights $standardSid)
    # Hosted run 39324218555 proved that registration left this right absent (event 101, 0x80070569).
    # Provision only the freshly created account; no groups, deny rules, or task run level change.
    if (-not $created -or $userName -notmatch '^scverify[0-9a-f]{12}$' -or (Get-LocalUser -SID $account.SID).Name -ne $userName -or $account.SID.Value -ne $standardSid) { throw 'Batch-logon provisioning requires the exact newly created acceptance account.' }
    if (@($report.batchLogonRightsAfterRegistration | Where-Object { $_.denyBatch }).Count -gt 0) { throw 'A relevant batch-logon deny assignment exists; it must not be overridden by this verifier.' }
    $directBatchRights = @([ReleaseBatchRights]::Read($standardSid))
    $report.batchLogonProvisioning = [ordered]@{ sid = $standardSid; right = 'SeBatchLogonRight'; changed = $false; verified = $false; reason = 'Task Scheduler Password logon requires this right for the isolated standard account.'; evidenceRunId = '39324218555'; evidenceEventId = 101; evidenceErrorCode = '0x80070569' }
    if ($directBatchRights -notcontains 'SeBatchLogonRight') {
        [ReleaseBatchRights]::GrantBatchLogon($standardSid)
        $report.batchLogonProvisioning.changed = $true
    }
    $report.batchLogonRightsAfterProvisioning = @(Read-BatchLogonRights $standardSid)
    $directBatchRights = @([ReleaseBatchRights]::Read($standardSid))
    if ($directBatchRights -notcontains 'SeBatchLogonRight' -or $directBatchRights -contains 'SeDenyBatchLogonRight') { throw 'The newly created account does not have the required direct batch-logon right.' }
    $report.batchLogonProvisioning.verified = $true
    $requestedAt = [DateTime]::UtcNow
    $report.taskStartRequestedUtc = $requestedAt.ToString('o')
    Start-ScheduledTask -TaskName $taskName
    $startDeadline = $requestedAt.AddSeconds(75)
    $runningDeadline = $null
    $workerReport = Join-Path $results 'worker-report.json'
    $report.taskStartObserved = $false
    do {
        Start-Sleep -Seconds 2
        $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
        $state = (Get-ScheduledTask -TaskName $taskName).State
        $report.taskResult = [long]$taskInfo.LastTaskResult
        $report.taskResultHex = '0x{0:X8}' -f [long]$taskInfo.LastTaskResult
        $report.taskState = [string]$state
        $report.taskLastRunTimeUtc = $taskInfo.LastRunTime.ToUniversalTime().ToString('o')
        if (-not $report.taskStartObserved -and ($state -eq 'Running' -or $taskInfo.LastRunTime.Year -gt 2000)) {
            $report.taskStartObserved = $true
            $report.taskStartObservedUtc = [DateTime]::UtcNow.ToString('o')
            $runningDeadline = [DateTime]::UtcNow.AddMinutes(14)
        }
        if ($report.taskStartObserved -and $state -notin @('Running', 'Queued')) { break }
        if (-not $report.taskStartObserved -and [DateTime]::UtcNow -ge $startDeadline) { throw 'The limited-account task did not start within 75 seconds; inspect its effective configuration, batch-logon rights and task events.' }
        if ($report.taskStartObserved -and [DateTime]::UtcNow -ge $runningDeadline) { throw 'The limited-account worker exceeded its running deadline.' }
    } while ($true)
    if (-not (Test-Path -LiteralPath $workerReport)) { throw ('The worker produced no report. Task Scheduler result: ' + $taskInfo.LastTaskResult + '. A non-interactive desktop or batch-logon restriction may prevent this approach; never substitute an administrator run.') }
    $workerResult = Get-Content -LiteralPath $workerReport -Raw | ConvertFrom-Json
    $report.workerPassed = $workerResult.passed
    if (-not $workerResult.passed -or $taskInfo.LastTaskResult -ne 0) { throw 'The standard-account worker failed; inspect its report.' }
    $report.passed = $true
}
catch { $report.error = $_.Exception.Message; Write-Error $_ -ErrorAction Continue }
finally {
    if ($registered) {
        try {
            $finalTaskInfo = Get-ScheduledTaskInfo -TaskName $taskName
            $report.taskResult = [long]$finalTaskInfo.LastTaskResult
            $report.taskResultHex = '0x{0:X8}' -f [long]$finalTaskInfo.LastTaskResult
            $report.taskLastRunTimeUtc = $finalTaskInfo.LastRunTime.ToUniversalTime().ToString('o')
            $report.taskState = [string](Get-ScheduledTask -TaskName $taskName).State
        }
        catch { $report.taskStatusError = $_.Exception.Message }
        try { $report.taskEvents = @(Read-OwnedTaskEvents) }
        catch { $report.taskEventsError = $_.Exception.Message }
        try {
            if ((Get-ScheduledTask -TaskName $taskName).State -in @('Running', 'Queued')) {
                Stop-ScheduledTask -TaskName $taskName
                $report.workerForcedToStop = $true
            }
        }
        catch { $report.taskStopError = $_.Exception.Message; $report.passed = $false }
        try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
        catch { $report.taskRemovalError = $_.Exception.Message; $report.passed = $false }
    }
    if ($taskLogChanged) {
        try { $taskLog.IsEnabled = $false; $taskLog.SaveChanges(); $report.taskOperationalLogRestored = $true }
        catch { $report.taskOperationalLogRestored = $false; $report.taskOperationalLogRestoreError = $_.Exception.Message; $report.passed = $false }
    }
    if ($null -ne $taskLog) {
        try { $taskLog.Dispose() }
        catch { $report.taskLogDisposalError = $_.Exception.Message; $report.passed = $false }
    }
    # Never guess which system process to kill. The disposable VM owns any remaining processes.
    # Evidence includes only known reports and screenshots, not profiles, preferences or credentials.
    if (Test-Path -LiteralPath (Join-Path $staging 'results')) {
        $report.evidenceCopyErrors = @()
        $evidenceFiles = @('worker-report.json', 'missing-runtime\report.json', 'installer-manifest.json', 'html-viewer\report.json', 'html-viewer\01-diagram.png', 'html-viewer\02-table-triggers.png', 'html-viewer\03-view-definition.png')
        foreach ($session in @('portable', 'installed')) {
            foreach ($name in @('report.json', 'diagram.html', '01-welcome-en-light.png', '02-about.png', '03-welcome-es-dark.png', '04-windows-auth-capture.png')) { $evidenceFiles += Join-Path $session $name }
        }
        foreach ($relative in $evidenceFiles) {
            try {
                $source = Join-Path (Join-Path $staging 'results') $relative
                if (Test-Path -LiteralPath $source -PathType Leaf) {
                    $destination = Join-Path $output $relative
                    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
                    Copy-Item -LiteralPath $source -Destination $destination
                }
            }
            catch { $report.evidenceCopyErrors = @($report.evidenceCopyErrors) + @([ordered]@{ file = $relative; error = $_.Exception.Message }); $report.passed = $false }
        }
    }
    if ($created) {
        try { Disable-LocalUser -SID $account.SID }
        catch { $report.standardAccountDisableError = $_.Exception.Message; $report.passed = $false }
        try { Remove-LocalUser -SID $account.SID; $report.standardAccountRemoved = $true }
        catch { $report.standardAccountRemovalError = $_.Exception.Message; $report.passed = $false }
    }
    $password = $null
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $output 'controller-report.json') -Encoding UTF8
}
if (-not $report.passed) { exit 1 }
