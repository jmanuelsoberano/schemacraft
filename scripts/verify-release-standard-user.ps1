# Worker: launched by verify-release-runner.ps1 under its unique standard account.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InputsDirectory,
    [Parameter(Mandatory = $true)][string]$ResultsDirectory,
    [Parameter(Mandatory = $true)][string]$ExpectedSid,
    [int]$SqlPort = 0
)
$ErrorActionPreference = 'Stop'
$report = [ordered]@{ version = '1.2.0'; checks = @(); passed = $false; missingRuntime = $null; runtimeInstall = $null }
$resultFile = Join-Path $ResultsDirectory 'worker-report.json'
$identifier = 'com.jmanuelsoberano.schemacraft'
function Check([string]$Name, [bool]$Passed) {
    $script:report.checks += [ordered]@{ name = $Name; passed = $Passed }
    if (-not $Passed) { throw $Name }
}
function Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function RuntimeVersions {
    $versions = @()
    foreach ($key in @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    )) {
        $value = (Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue).pv
        if ($value -and $value -ne '0.0.0.0') { $versions += [string]$value }
    }
    return @($versions | Select-Object -Unique)
}
function RunBounded([string]$Path, [string[]]$Arguments, [int]$Seconds) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit($Seconds * 1000)) { throw ('Owned process timed out: ' + [IO.Path]::GetFileName($Path) + '; PID ' + $process.Id + '. Stop this worker before retrying; the disposable runner will be destroyed.') }
    $process.Refresh()
    return $process.ExitCode
}
function MissingRuntime([string]$Executable, [bool]$InjectFailure, [string]$PreferenceFile) {
    $directory = Join-Path $ResultsDirectory 'missing-runtime'
    New-Item -ItemType Directory -Path $directory | Out-Null
    $backup = Join-Path $directory 'preferences.backup'
    $existed = Test-Path -LiteralPath $PreferenceFile
    if ($existed) { Copy-Item -LiteralPath $PreferenceFile -Destination $backup; $originalHash = Sha256 $PreferenceFile; Check 'Opaque missing-runtime preference backup matches' ((Sha256 $backup) -eq $originalHash) }
    $result = [ordered]@{ mechanism = $(if ($InjectFailure) { 'injected-empty-runtime-folder' } else { 'natural-runtime-absence' }); passed = $false; terminationConfirmed = $true; preferencesRestored = $false }
    $process = $null
    $oldRuntime = $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER
    $oldProfile = $env:WEBVIEW2_USER_DATA_FOLDER
    $oldDebug = $env:SCHEMACRAFT_REMOTE_DEBUGGING_PORT
    try {
        if ($InjectFailure) {
            $empty = Join-Path $directory 'empty-runtime'
            New-Item -ItemType Directory -Path $empty | Out-Null
            $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $empty
        } else { Remove-Item Env:\WEBVIEW2_BROWSER_EXECUTABLE_FOLDER -ErrorAction SilentlyContinue }
        $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $directory 'webview-profile'
        Remove-Item Env:\SCHEMACRAFT_REMOTE_DEBUGGING_PORT -ErrorAction SilentlyContinue
        $process = Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
        $result.terminationConfirmed = $false
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $dialog = [IntPtr]::Zero
        do {
            $process.Refresh()
            if ($process.HasExited) { break }
            $dialog = [ReleaseNativeDialog]::Find($process.Id)
            if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 200 }
        } while ($dialog -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
        Check 'Missing-runtime dialog exists in the owned application process' ($dialog -ne [IntPtr]::Zero)
        $visibility = [ReleaseNativeDialog]::ShowOwnedDialog($dialog, $process.Id)
        $result.dialogVisibility = [ordered]@{ wasVisible = $visibility.WasVisible; isVisible = $visibility.IsVisible; className = $visibility.ClassName }
        Check 'The owned native dialog is visible for GUI verification' $visibility.IsVisible
        $observed = [ReleaseNativeDialog]::ReadText($dialog, $process.Id)
        $text = $observed.Text
        $result.dialogText = $text
        $result.dialogTextReader = [ordered]@{ method = 'owned-window messages and UI Automation'; automationElements = $observed.AutomationElements; rejectedProcessIds = $observed.RejectedProcessIds; zeroProcessIds = $observed.ZeroProcessIds; automationTimedOut = $observed.AutomationTimedOut; automationError = $observed.AutomationError }
        Check 'Native dialog explains the runtime requirement in English and Spanish' ($text.Contains('SchemaCraft needs the Microsoft Edge WebView2 Runtime') -and $text.Contains('SchemaCraft necesita Microsoft Edge WebView2 Runtime'))
        Check 'The owned native dialog exposes a No button' ([ReleaseNativeDialog]::ChooseNo($dialog))
        Check 'Choosing No closes the application' ($process.WaitForExit(10000))
        $process.Refresh()
        $result.terminationConfirmed = $process.HasExited
        $result.exitCode = $process.ExitCode
        Check 'Missing-runtime application exits with failure' ($null -ne $result.exitCode -and $result.exitCode -is [int] -and $result.exitCode -ne 0)
        $result.passed = $true
    }
    finally {
        $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $oldRuntime
        $env:WEBVIEW2_USER_DATA_FOLDER = $oldProfile
        $env:SCHEMACRAFT_REMOTE_DEBUGGING_PORT = $oldDebug
        if ($null -ne $process) {
            $process.Refresh()
            if (-not $process.HasExited) {
                # Only the exact process launched above is stopped, never a name-wide match.
                Stop-Process -InputObject $process -Force
                $result.terminationConfirmed = $process.WaitForExit(10000)
                $result.passed = $false
            } else { $result.terminationConfirmed = $true }
        }
        if ($result.terminationConfirmed) {
            if ($existed) { Copy-Item -LiteralPath $backup -Destination $PreferenceFile -Force; Check 'Missing-runtime preferences are restored byte for byte' ((Sha256 $PreferenceFile) -eq $originalHash); Remove-Item -LiteralPath $backup }
            elseif (Test-Path -LiteralPath $PreferenceFile) { Remove-Item -LiteralPath $PreferenceFile }
            $result.preferencesRestored = $true
        }
        $script:report.missingRuntime = $result
        $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $directory 'report.json') -Encoding UTF8
    }
}

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    Check 'Worker identity matches the newly created account' ($identity.User.Value -eq $ExpectedSid)
    Check 'Worker is not an administrator and has no Administrators group SID' (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and @($identity.Groups | Where-Object { $_.Value -eq 'S-1-5-32-544' }).Count -eq 0)
    Check 'Expected account name is an isolated acceptance account' ($identity.Name -match '\\scverify[0-9a-f]{12}$')
    $profilePath = [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\') + '\'
    Check 'Roaming and local application data are within the standard account profile' ([IO.Path]::GetFullPath($env:APPDATA).StartsWith($profilePath, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFullPath($env:LOCALAPPDATA).StartsWith($profilePath, [StringComparison]::OrdinalIgnoreCase))
    $report.identity = [ordered]@{ name = $identity.Name; sid = $identity.User.Value; elevated = $false; sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId }
    $os = Get-CimInstance Win32_OperatingSystem
    $report.windows = [ordered]@{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber }
    $report.uacEnabled = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name EnableLUA).EnableLUA
    $installDirectory = Join-Path $env:LOCALAPPDATA 'SchemaCraft'
    $roaming = Join-Path $env:APPDATA $identifier
    $local = Join-Path $env:LOCALAPPDATA $identifier
    $preferences = Join-Path $roaming 'preferences.json'
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SchemaCraft'
    $machineKeys = @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SchemaCraft', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\SchemaCraft')
    Check 'No SchemaCraft process exists before testing' (-not (Get-Process -Name 'schemacraft*' -ErrorAction SilentlyContinue))
    foreach ($path in @($installDirectory, $roaming, $local, $uninstallKey, 'HKCU:\Software\Manuel Soberano\SchemaCraft') + $machineKeys) { Check 'No existing installation, registration or data' (-not (Test-Path -LiteralPath $path)) }
    $shortcuts = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'SchemaCraft.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'SchemaCraft.lnk'))
    foreach ($path in $shortcuts) { Check 'No pre-existing shortcut' (-not (Test-Path -LiteralPath $path)) }
    $hashes = @{}
    foreach ($line in Get-Content -LiteralPath (Join-Path $InputsDirectory 'SHA256SUMS.txt')) {
        if ($line -match '^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)$') { $hashes[$Matches[2].Trim()] = $Matches[1].ToLowerInvariant() }
    }
    $portableName = 'schemacraft-v1.2.0-windows-x64.exe'
    $setupName = 'schemacraft-v1.2.0-windows-x64-setup.exe'
    foreach ($name in @($portableName, $setupName)) { Check ('Downloaded checksum matches ' + $name) ($hashes.ContainsKey($name) -and (Sha256 (Join-Path $InputsDirectory $name)) -eq $hashes[$name]) }
    $portable = Join-Path $InputsDirectory $portableName
    $setup = Join-Path $InputsDirectory $setupName
    $node = Join-Path $InputsDirectory 'node.exe'
    & $node (Join-Path $InputsDirectory 'inspect-pe-manifest.mjs') $setup 'asInvoker' | Set-Content -LiteralPath (Join-Path $ResultsDirectory 'installer-manifest.json') -Encoding UTF8
    Check 'Official installer manifest requests asInvoker' ($LASTEXITCODE -eq 0)
    # Only owned synthetic preferences are created. Every application session preserves them opaquely.
    New-Item -ItemType Directory -Path $roaming | Out-Null
    [IO.File]::WriteAllText($preferences, '{"formatVersion":1,"recentConnections":[],"recentProjects":[]}', (New-Object Text.UTF8Encoding($false)))
    $syntheticPreferenceHash = Sha256 $preferences
    $runtimeBefore = @(RuntimeVersions)
    $report.webview2VersionsBefore = $runtimeBefore
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
    $automationReferences = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.AutomationProperty].Assembly.Location, [System.Windows.DependencyObject].Assembly.Location)
    Add-Type -ReferencedAssemblies $automationReferences -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Automation;
public sealed class ReleaseDialogText {
  public string Text;
  public int AutomationElements;
  public int RejectedProcessIds;
  public int ZeroProcessIds;
  public bool AutomationTimedOut;
  public string AutomationError;
}
public sealed class ReleaseDialogVisibility {
  public bool WasVisible;
  public bool IsVisible;
  public string ClassName;
}
public static class ReleaseNativeDialog {
  delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] static extern IntPtr ReadMessage(IntPtr window, uint message, IntPtr count, StringBuilder text, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  public static IntPtr Find(int process) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((window, parameter) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner != (uint)process) return true;
      var title = new StringBuilder(256); GetWindowText(window, title, title.Capacity);
      if (title.ToString() == "SchemaCraft") { found = window; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  static void AppendBounded(StringBuilder target, string value) {
    if (String.IsNullOrEmpty(value) || target.Length >= 8192) return;
    if (target.Length > 0) target.Append('\n');
    target.Append(value, 0, Math.Min(value.Length, 8192 - target.Length));
  }
  static void RequireOwner(IntPtr window, int process) {
    uint owner; GetWindowThreadProcessId(window, out owner);
    if (owner != (uint)process) throw new InvalidOperationException("The dialog no longer belongs to the owned application process.");
  }
  public static ReleaseDialogVisibility ShowOwnedDialog(IntPtr dialog, int process) {
    RequireOwner(dialog, process);
    var className = new StringBuilder(256);
    GetClassName(dialog, className, className.Capacity);
    var observed = new ReleaseDialogVisibility { WasVisible = IsWindowVisible(dialog), ClassName = className.ToString() };
    // Show only this test dialog on the disposable account's desktop, without activation.
    // The asynchronous form avoids blocking on another process's window procedure.
    if (!observed.WasVisible) {
      ShowWindowAsync(dialog, 4); // SW_SHOWNOACTIVATE.
      var timer = Stopwatch.StartNew();
      while (!IsWindowVisible(dialog) && timer.ElapsedMilliseconds < 2000) {
        RequireOwner(dialog, process);
        Thread.Sleep(50);
      }
    }
    RequireOwner(dialog, process);
    observed.IsVisible = IsWindowVisible(dialog);
    return observed;
  }
  public static ReleaseDialogText ReadText(IntPtr dialog, int process) {
    RequireOwner(dialog, process);
    var timer = Stopwatch.StartNew();
    var all = new StringBuilder();
    int nativeElements = 0;
    EnumChildWindows(dialog, (child, parameter) => {
      if (++nativeElements > 64 || timer.ElapsedMilliseconds >= 1500) return false;
      uint owner; GetWindowThreadProcessId(child, out owner);
      if (owner != (uint)process) return true;
      var text = new StringBuilder(4096); IntPtr messageResult;
      ReadMessage(child, 13, new IntPtr(text.Capacity), text, 2, 250, out messageResult);
      AppendBounded(all, text.ToString());
      return true;
    }, IntPtr.Zero);
    string automationText = null;
    string automationError = null;
    int automationElements = 0;
    int rejectedProcessIds = 0;
    int zeroProcessIds = 0;
    // TaskDialog content can be windowless DirectUI. Read its accessible subtree,
    // never the desktop root, on a bounded MTA thread as recommended by Microsoft.
    var reader = new Thread(() => {
      try {
        RequireOwner(dialog, process);
        var root = AutomationElement.FromHandle(dialog);
        int rootProcess = root.Current.ProcessId;
        if (rootProcess != process) {
          rejectedProcessIds++;
          if (rootProcess == 0) zeroProcessIds++;
          throw new InvalidOperationException("UI Automation returned a different process.");
        }
        var pending = new Queue<AutomationElement>(); pending.Enqueue(root);
        int discoveredElements = 1;
        var text = new StringBuilder();
        var walker = TreeWalker.RawViewWalker;
        while (pending.Count > 0 && automationElements < 64 && timer.ElapsedMilliseconds < 5000) {
          RequireOwner(dialog, process);
          var element = pending.Dequeue();
          automationElements++;
          int elementProcess = element.Current.ProcessId;
          if (elementProcess != process) {
            rejectedProcessIds++;
            if (elementProcess == 0) zeroProcessIds++;
            continue;
          }
          AppendBounded(text, element.Current.Name);
          var child = walker.GetFirstChild(element);
          while (child != null && discoveredElements < 64 && timer.ElapsedMilliseconds < 5000) {
            discoveredElements++;
            int childProcess = child.Current.ProcessId;
            if (childProcess == process) pending.Enqueue(child);
            else { rejectedProcessIds++; if (childProcess == 0) zeroProcessIds++; }
            child = walker.GetNextSibling(child);
          }
        }
        automationText = text.ToString();
      } catch (Exception error) {
        automationError = error.Message.Substring(0, Math.Min(error.Message.Length, 256));
      }
    });
    reader.IsBackground = true;
    reader.SetApartmentState(ApartmentState.MTA);
    reader.Start();
    bool completed = reader.Join((int)Math.Max(1, 5000 - timer.ElapsedMilliseconds));
    var observed = new ReleaseDialogText { Text = all.ToString(), AutomationTimedOut = !completed };
    if (completed) {
      AppendBounded(all, automationText);
      observed.Text = all.ToString();
      observed.AutomationElements = automationElements;
      observed.RejectedProcessIds = rejectedProcessIds;
      observed.ZeroProcessIds = zeroProcessIds;
      observed.AutomationError = automationError;
    }
    return observed;
  }
  public static bool ChooseNo(IntPtr dialog) {
    IntPtr no = IntPtr.Zero;
    EnumChildWindows(dialog, (child, parameter) => { if (GetDlgCtrlID(child) == 7) no = child; return true; }, IntPtr.Zero);
    return no != IntPtr.Zero && PostMessage(no, 245, IntPtr.Zero, IntPtr.Zero);
  }
}
'@
    MissingRuntime $portable ($runtimeBefore.Count -gt 0) $preferences
    Check 'Missing-runtime check completed and preserved preferences' ($report.missingRuntime.passed -and $report.missingRuntime.preferencesRestored)
    if ($runtimeBefore.Count -eq 0) {
        $runtimeSetup = Join-Path $InputsDirectory 'MicrosoftEdgeWebview2Setup.exe'
        $signature = Get-AuthenticodeSignature -LiteralPath $runtimeSetup
        Check 'Runtime prerequisite is signed by Microsoft' ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match 'O=Microsoft Corporation')
        $runtimeExit = RunBounded $runtimeSetup @('/silent', '/install') 300
        $report.runtimeInstall = [ordered]@{ exitCode = $runtimeExit; identity = $identity.Name; source = 'Microsoft official Evergreen bootstrapper'; sha256 = (Sha256 $runtimeSetup) }
        Check 'WebView2 prerequisite installs under the standard account' ($runtimeExit -eq 0 -and @(RuntimeVersions).Count -gt 0)
    }
    $report.webview2VersionsAfter = @(RuntimeVersions)
    # Scheduled tasks normally receive no workflow secrets; enforce that boundary explicitly.
    foreach ($name in @('GH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')) { Remove-Item -LiteralPath ('Env:\' + $name) -ErrorAction SilentlyContinue }
    $env:SCHEMACRAFT_ACCEPTANCE_EPHEMERAL = '1'
    if ($SqlPort -gt 0) { $env:SCHEMACRAFT_ACCEPTANCE_SQL_PORT = [string]$SqlPort }
    & $node (Join-Path $InputsDirectory 'smoke-release-standard-user.mjs') $portable (Join-Path $ResultsDirectory 'portable') '1.2.0'
    Check 'Official portable runs under the standard account' ($LASTEXITCODE -eq 0)
    Check 'Portable session restores preferences' ((Sha256 $preferences) -eq $syntheticPreferenceHash)
    Check 'No application remains before installation' (-not (Get-Process -Name 'schemacraft*' -ErrorAction SilentlyContinue))
    $report.installerExitCode = RunBounded $setup @('/S') 180
    Check 'Current-user silent installer exits successfully' ($report.installerExitCode -eq 0)
    $installedExe = Join-Path $installDirectory 'schemacraft.exe'
    $uninstaller = Join-Path $installDirectory 'uninstall.exe'
    Check 'Installed executable equals the downloaded portable' ((Sha256 $installedExe) -eq $hashes[$portableName])
    Check 'Uninstaller exists' (Test-Path -LiteralPath $uninstaller)
    $registration = Get-ItemProperty -LiteralPath $uninstallKey
    Check 'HKCU registers exact version and current-user location' ($registration.DisplayVersion -eq '1.2.0' -and $registration.InstallLocation.Trim('"', '\') -eq $installDirectory.TrimEnd('\'))
    foreach ($path in $machineKeys) { Check 'No machine-wide application registration was created' (-not (Test-Path -LiteralPath $path)) }
    foreach ($path in $shortcuts) { Check 'Current-user shortcut was installed' (Test-Path -LiteralPath $path) }
    & $node (Join-Path $InputsDirectory 'smoke-release-standard-user.mjs') $installedExe (Join-Path $ResultsDirectory 'installed') '1.2.0'
    Check 'Installed application runs under the standard account' ($LASTEXITCODE -eq 0)
    Check 'Installed session restores preferences' ((Sha256 $preferences) -eq $syntheticPreferenceHash)
    New-Item -ItemType Directory -Path $local -Force | Out-Null
    $markers = @((Join-Path $roaming 'release-acceptance-marker.txt'), (Join-Path $local 'release-acceptance-marker.txt'))
    foreach ($marker in $markers) { 'Synthetic data for default uninstall preservation.' | Set-Content -LiteralPath $marker -Encoding UTF8 }
    $markerHash = Sha256 $markers[0]
    Check 'No application remains before uninstall' (-not (Get-Process -Name 'schemacraft*' -ErrorAction SilentlyContinue))
    $report.uninstallerLauncherExitCode = RunBounded $uninstaller @('/S') 180
    Check 'Uninstaller launcher exits successfully' ($report.uninstallerLauncherExitCode -eq 0)
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    do {
        $removed = -not (Test-Path -LiteralPath $installedExe) -and -not (Test-Path -LiteralPath $uninstaller) -and -not (Test-Path -LiteralPath $uninstallKey)
        if (-not $removed) { Start-Sleep -Milliseconds 500 }
    } while (-not $removed -and [DateTime]::UtcNow -lt $deadline)
    Check 'NSIS child completes: executable, uninstaller and uninstall entry are absent' $removed
    foreach ($path in $shortcuts) { Check 'Installed shortcut was removed' (-not (Test-Path -LiteralPath $path)) }
    foreach ($marker in $markers) { Check 'Default uninstall preserves synthetic app data' ((Sha256 $marker) -eq $markerHash) }
    Check 'Default uninstall preserves synthetic preferences byte for byte' ((Sha256 $preferences) -eq $syntheticPreferenceHash)
    if ($SqlPort -gt 0) {
        Check 'No SchemaCraft process remains before opening the standalone HTML' (-not (Get-Process -Name 'schemacraft*' -ErrorAction SilentlyContinue))
        $edge = @(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        Check 'The hosted image provides Microsoft Edge for the independent HTML check' ([bool]$edge)
        $htmlFile = Join-Path $ResultsDirectory 'installed\diagram.html'
        Check 'The installed application produced the owned HTML file' (Test-Path -LiteralPath $htmlFile -PathType Leaf)
        $browserOutput = Join-Path $ResultsDirectory 'html-viewer'
        $htmlPreferenceBackup = Join-Path $ResultsDirectory 'html-preferences.backup'
        Copy-Item -LiteralPath $preferences -Destination $htmlPreferenceBackup
        Check 'Independent HTML test preference backup is byte-identical' ((Sha256 $htmlPreferenceBackup) -eq $syntheticPreferenceHash)
        try {
            & $node (Join-Path $InputsDirectory 'smoke-release-standard-user.mjs') '--html-viewer' $edge $htmlFile $browserOutput
            $browserExit = $LASTEXITCODE
        }
        finally {
            $browserReport = Join-Path $browserOutput 'report.json'
            $browserResult = if (Test-Path -LiteralPath $browserReport) { Get-Content -LiteralPath $browserReport -Raw | ConvertFrom-Json } else { $null }
            Check 'The exact browser process stopped before restoring preferences' ($null -ne $browserResult -and $browserResult.terminationConfirmed)
            Copy-Item -LiteralPath $htmlPreferenceBackup -Destination $preferences -Force
            Check 'Independent HTML test restores preferences byte for byte' ((Sha256 $preferences) -eq $syntheticPreferenceHash)
            Remove-Item -LiteralPath $htmlPreferenceBackup
        }
        Check 'Exported HTML renders independently after SchemaCraft is uninstalled' ($browserExit -eq 0 -and $browserResult.passed)
        Check 'The independent viewer did not launch SchemaCraft' (-not (Get-Process -Name 'schemacraft*' -ErrorAction SilentlyContinue))
    }
    $report.passed = $true
}
catch { $report.error = $_.Exception.Message; Write-Error $_ -ErrorAction Continue }
finally { $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $resultFile -Encoding UTF8 }
if (-not $report.passed) { exit 1 }
