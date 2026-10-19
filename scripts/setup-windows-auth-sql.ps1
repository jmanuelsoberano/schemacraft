#requires -Version 5.1
# Run only in Windows PowerShell on a disposable GitHub-hosted runner.
# Installs a dedicated Windows-authentication-only SQL Server 2022 Express instance.
# No password is created or accepted for SQL authentication.
# Installation parameters: https://learn.microsoft.com/en-us/sql/database-engine/install-windows/install-sql-server-from-the-command-prompt
# Listener semantics: https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/configure-a-server-to-listen-on-a-specific-tcp-port
param(
    [Parameter(Mandatory = $true)][string]$TestAccount,
    [Parameter(Mandatory = $true)][string]$FixtureDirectory,
    [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
    [Parameter(Mandatory = $true)][switch]$ConfirmDisposableHostedRunner
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
if (-not $ConfirmDisposableHostedRunner -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This setup is restricted to a disposable GitHub-hosted runner.'
}
if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) {
    throw 'Use 64-bit Windows PowerShell (powershell.exe), which includes System.Data.SqlClient.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The isolated SQL setup requires the runner administrator.'
}
$accountPattern = '^' + [regex]::Escape($env:COMPUTERNAME) + '\\scverify[0-9a-f]{12}$'
if ($TestAccount -notmatch $accountPattern) { throw 'The account must be the generated local scverify account.' }
$localName = $TestAccount.Split('\')[1]
$testUser = Get-LocalUser -Name $localName
if (-not $testUser.Enabled) { throw 'The standard test account is not enabled.' }
if (@(Get-Service -Name 'MSSQL*' -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Refusing to install beside an existing SQL Server service.'
}
if (@(Get-NetTCPConnection -LocalPort 14335 -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'The dedicated SQL port 14335 is already in use.'
}
$fixturePaths = @('code.sql', 'stress_200_tables.sql') | ForEach-Object {
    (Get-Item -LiteralPath (Join-Path $FixtureDirectory $_)).FullName
}
$evidencePath = [IO.Path]::GetFullPath($EvidenceDirectory)
$temporaryRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if (-not $evidencePath.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'EvidenceDirectory must be inside RUNNER_TEMP.'
}
New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
$workPath = Join-Path $evidencePath ('sql-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workPath | Out-Null
$mediaPath = Join-Path $workPath 'SQLEXPR_x64_ENU.exe'
$mediaUrl = 'https://download.microsoft.com/download/3/8/d/38de7036-2433-4207-8eae-06e247e17b25/SQLEXPR_x64_ENU.exe'
Write-Host 'Downloading official SQL Server 2022 Express media.'
Invoke-WebRequest -UseBasicParsing -Uri $mediaUrl -OutFile $mediaPath
$signature = Get-AuthenticodeSignature -LiteralPath $mediaPath
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
    throw 'The SQL installation media does not have a valid Microsoft signature.'
}
$mediaVersion = (Get-Item -LiteralPath $mediaPath).VersionInfo
if ($mediaVersion.ProductMajorPart -ne 16) { throw 'The SQL installation media is not version 2022.' }
$mediaHash = (Get-FileHash -LiteralPath $mediaPath -Algorithm SHA256).Hash
$extractPath = Join-Path $workPath 'media'
$setupStarted = Get-Date
$setupPhase = 'extraction'
$connection = $null
$lastConnectionError = $null
try {
    Write-Host 'Extracting signature-checked SQL Server media.'
    $extract = Start-Process -FilePath $mediaPath -ArgumentList @('/Q', ('/X:"' + $extractPath + '"')) -WindowStyle Hidden -PassThru
    if (-not $extract.WaitForExit(300000)) { throw 'SQL media extraction exceeded its five-minute deadline; the disposable runner must be discarded.' }
    $extract.Refresh()
    if ($extract.ExitCode -ne 0) { throw "SQL media extraction failed with exit code $($extract.ExitCode)." }
    $setup = Join-Path $extractPath 'setup.exe'
    if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw 'Extracted SQL setup.exe is missing.' }
    $setupArgs = @(
        '/Q', '/ACTION=Install', '/FEATURES=SQLENGINE', '/INSTANCENAME=SCACCEPT', '/INSTANCEID=SCACCEPT',
        '/IACCEPTSQLSERVERLICENSETERMS', '/SUPPRESSPRIVACYSTATEMENTNOTICE', '/UPDATEENABLED=False',
        '/USEMICROSOFTUPDATE=False', '/TCPENABLED=0', '/NPENABLED=0', '/BROWSERSVCSTARTUPTYPE=Disabled',
        '/SQLSVCACCOUNT="NT Service\MSSQL$SCACCEPT"', '/SQLSVCSTARTUPTYPE=Manual',
        ('/SQLSYSADMINACCOUNTS="' + $identity.Name + '"')
    )
    $setupPhase = 'installation'
    Write-Host 'Installing the dedicated Windows-authentication-only SQL instance.'
    $install = Start-Process -FilePath $setup -ArgumentList $setupArgs -WindowStyle Hidden -PassThru
    if (-not $install.WaitForExit(1200000)) { throw 'SQL setup exceeded its 20-minute deadline; the disposable runner must be discarded.' }
    $install.Refresh()
    if ($install.ExitCode -notin @(0, 3010)) { throw "SQL setup failed with exit code $($install.ExitCode)." }
    Write-Host 'SQL setup completed; configuring the loopback listener.'
    $setupPhase = 'listener-configuration'

    # The engine was installed with TCP disabled. Configure only this new instance before enabling it.
    $serviceName = 'MSSQL$SCACCEPT'
    Stop-Service -Name $serviceName
    $instanceMap = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
    $instanceId = $instanceMap.SCACCEPT
    if ($instanceId -ne 'MSSQL16.SCACCEPT') { throw 'Unexpected SQL instance registry mapping.' }
    $tcpPath = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\' + $instanceId + '\MSSQLServer\SuperSocketNetLib\Tcp'
    Set-ItemProperty -LiteralPath $tcpPath -Name Enabled -Value 1
    Set-ItemProperty -LiteralPath $tcpPath -Name ListenOnAllIPs -Value 0
    $loopbacks = 0
    foreach ($addressKey in @(Get-ChildItem -LiteralPath $tcpPath | Where-Object { $_.PSChildName -match '^IP\d+$' })) {
        $addressSettings = Get-ItemProperty -LiteralPath $addressKey.PSPath
        $loopback = $addressSettings.IpAddress -in @('127.0.0.1', '::1')
        Set-ItemProperty -LiteralPath $addressKey.PSPath -Name Enabled -Value ([int]$loopback)
        Set-ItemProperty -LiteralPath $addressKey.PSPath -Name TcpDynamicPorts -Value ''
        Set-ItemProperty -LiteralPath $addressKey.PSPath -Name TcpPort -Value $(if ($loopback) { '14335' } else { '' })
        if ($loopback) { $loopbacks++ }
    }
    if ($loopbacks -eq 0) { throw 'SQL setup did not expose a configurable loopback address.' }
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    Add-Type -AssemblyName System.Data
    # Native SNI rewrites localhost to the computer name, which can omit loopback addresses.
    # https://github.com/dotnet/SqlClient/issues/2075#issuecomment-1635093044
    $connection = New-Object System.Data.SqlClient.SqlConnection('Server=tcp:127.0.0.1,14335;Database=master;Integrated Security=SSPI;Encrypt=True;TrustServerCertificate=True;Connect Timeout=3;Pooling=False')
    $connected = $false
    $setupPhase = 'local-connection'
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { $connection.Open(); $connected = $true; break }
        catch {
            $connectionException = $_.Exception
            while ($connectionException -isnot [System.Data.SqlClient.SqlException] -and $null -ne $connectionException.InnerException) {
                $connectionException = $connectionException.InnerException
            }
            $lastConnectionError = [ordered]@{
                type = $connectionException.GetType().FullName
                message = $connectionException.Message
                sqlErrors = @()
            }
            if ($connectionException -is [System.Data.SqlClient.SqlException]) {
                $lastConnectionError.sqlErrors = @($connectionException.Errors | ForEach-Object {
                    [ordered]@{ number = $_.Number; state = $_.State; class = $_.Class; message = $_.Message }
                })
            }
            Start-Sleep -Seconds 2
        }
    }
    if (-not $connected) { throw 'The dedicated local Windows-authenticated SQL connection did not become ready.' }
    $setupPhase = 'fixture-provisioning'
    $listeners = @(Get-NetTCPConnection -LocalPort 14335 -State Listen)
    if ($listeners.Count -eq 0 -or @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count -gt 0) {
        throw 'SQL is not restricted to loopback listeners.'
    }
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 120
    $command.CommandText = "SELECT CASE WHEN SERVERPROPERTY('ProductMajorVersion') = '16' AND SERVERPROPERTY('IsIntegratedSecurityOnly') = 1 AND CONNECTIONPROPERTY('net_transport') = 'TCP' AND CONNECTIONPROPERTY('auth_scheme') IN ('NTLM', 'KERBEROS') THEN 1 ELSE 0 END;"
    if ([int]$command.ExecuteScalar() -ne 1) { throw 'The server version, transport or Windows-only authentication is incorrect.' }
    foreach ($fixturePath in $fixturePaths) {
        $connection.ChangeDatabase('master')
        $fixture = [IO.File]::ReadAllText($fixturePath)
        foreach ($batch in [regex]::Split($fixture, '(?im)^[ \t]*GO[ \t]*(?:--[^\r\n]*)?\r?$')) {
            if ([string]::IsNullOrWhiteSpace($batch)) { continue }
            $command.CommandText = $batch
            [void]$command.ExecuteNonQuery()
        }
    }
    Write-Host 'Synthetic SQL fixtures are ready; granting the standard test account read access.'
    $connection.ChangeDatabase('master')
    $quotedAccount = '[' + $TestAccount.Replace(']', ']]') + ']'
    $command.CommandText = 'CREATE LOGIN ' + $quotedAccount + ' FROM WINDOWS;'
    [void]$command.ExecuteNonQuery()
    foreach ($database in @('SchemaCraftCode', 'SchemaCraftStress')) {
        $connection.ChangeDatabase($database)
        $command.CommandText = 'CREATE USER [AcceptanceUser] FOR LOGIN ' + $quotedAccount + '; ALTER ROLE [db_datareader] ADD MEMBER [AcceptanceUser]; GRANT VIEW DEFINITION TO [AcceptanceUser];'
        [void]$command.ExecuteNonQuery()
    }
    $command.CommandText = "SELECT IS_SRVROLEMEMBER('sysadmin', @login);"
    [void]$command.Parameters.AddWithValue('@login', $TestAccount)
    if ([int]$command.ExecuteScalar() -ne 0) { throw 'The standard account unexpectedly has SQL sysadmin privileges.' }
    $command.Parameters.Clear()
    $command.CommandText = "SELECT CONVERT(nvarchar(50), SERVERPROPERTY('ProductVersion'));"
    $engineVersion = [string]$command.ExecuteScalar()
    $result = [ordered]@{
        passed = $true
        mediaUrl = $mediaUrl
        mediaSha256 = $mediaHash
        mediaSignatureVerified = $true
        mediaProductVersion = $mediaVersion.ProductVersion
        engineVersion = $engineVersion
        instance = 'SCACCEPT'
        endpoint = 'localhost,14335'
        provisioningEndpoint = '127.0.0.1,14335'
        loopbackOnly = $true
        windowsAuthenticationOnly = $true
        standardAccountProvisioned = $true
        standardAccountIsSqlSysadmin = $false
        databases = @('SchemaCraftCode', 'SchemaCraftStress')
        installerExitCode = $install.ExitCode
    }
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidencePath 'windows-auth-sql-setup.json') -Encoding UTF8
    $result | ConvertTo-Json -Depth 5
} catch {
    $setupError = $_
    Write-Host ('SQL setup failed during ' + $setupPhase + ': ' + $setupError.Exception.Message)
    if ($null -ne $lastConnectionError) {
        Write-Host ('Last local connection error: ' + $lastConnectionError.message)
        foreach ($sqlError in $lastConnectionError.sqlErrors) {
            Write-Host ('SQL error ' + $sqlError.number + ', state ' + $sqlError.state + ', class ' + $sqlError.class + ': ' + $sqlError.message)
        }
    }
    # Collect only this execution's SQL setup logs and the exact owned instance's diagnostics.
    # https://learn.microsoft.com/en-us/sql/database-engine/install-windows/view-and-read-sql-server-setup-log-files
    $logFiles = @()
    $summaryPath = Join-Path $env:ProgramFiles 'Microsoft SQL Server\160\Setup Bootstrap\Log\Summary.txt'
    if (Test-Path -LiteralPath $summaryPath -PathType Leaf) { $logFiles += Get-Item -LiteralPath $summaryPath }
    $logFiles += @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'sqlsetup*.log' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $setupStarted } | Sort-Object LastWriteTime -Descending | Select-Object -First 2)
    $logs = @($logFiles | Where-Object { $_.LastWriteTime -ge $setupStarted } | ForEach-Object {
        # Windows PowerShell attaches provider metadata to Get-Content strings; do not serialize it.
        [ordered]@{ file = $_.Name.ToString(); tail = @(Get-Content -LiteralPath $_.FullName -Tail 200 -ErrorAction SilentlyContinue | ForEach-Object { $_.ToString() }) }
    })
    $ownedTcpPath = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL16.SCACCEPT\MSSQLServer\SuperSocketNetLib\Tcp'
    $tcpConfiguration = $null
    if (Test-Path -LiteralPath $ownedTcpPath) {
        $protocolValues = Get-ItemProperty -LiteralPath $ownedTcpPath
        $tcpConfiguration = [ordered]@{
            protocol = [ordered]@{ enabled = [int]$protocolValues.Enabled; listenOnAllIPs = [int]$protocolValues.ListenOnAllIPs }
            addresses = @(Get-ChildItem -LiteralPath $ownedTcpPath | Where-Object { $_.PSChildName -match '^IP(?:\d+|All)$' } | ForEach-Object {
                $addressValues = Get-ItemProperty -LiteralPath $_.PSPath
                $address = [ordered]@{ name = $_.PSChildName.ToString() }
                foreach ($propertyName in @('Enabled', 'Active', 'IpAddress', 'TcpDynamicPorts', 'TcpPort')) {
                    $property = $addressValues.PSObject.Properties[$propertyName]
                    $address[$propertyName] = if ($null -ne $property -and $null -ne $property.Value) { $property.Value.ToString() } else { $null }
                }
                $address
            })
        }
    }
    $engineLog = Join-Path $env:ProgramFiles 'Microsoft SQL Server\MSSQL16.SCACCEPT\MSSQL\Log\ERRORLOG'
    $engineLogTail = @()
    if (Test-Path -LiteralPath $engineLog -PathType Leaf) { $engineLogTail = @(Get-Content -LiteralPath $engineLog -Tail 200 -ErrorAction SilentlyContinue | ForEach-Object { $_.ToString() }) }
    [ordered]@{
        passed = $false
        phase = $setupPhase
        error = $setupError.Exception.Message
        mediaUrl = $mediaUrl
        mediaSha256 = $mediaHash
        mediaSignatureVerified = $true
        mediaProductVersion = $mediaVersion.ProductVersion
        setupLogs = $logs
        lastConnectionError = $lastConnectionError
        listeners = @(Get-NetTCPConnection -LocalPort 14335 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
            [ordered]@{ localAddress = $_.LocalAddress.ToString(); localPort = [int]$_.LocalPort; owningProcess = [int]$_.OwningProcess }
        })
        tcpConfiguration = $tcpConfiguration
        engineLogTail = $engineLogTail
    } | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $evidencePath 'windows-auth-sql-setup.json') -Encoding UTF8
    throw $setupError
} finally {
    if ($null -ne $connection) { $connection.Dispose() }
}
