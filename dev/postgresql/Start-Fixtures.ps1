<# .SYNOPSIS Starts only the requested, dedicated PostgreSQL fixture services. #>
[CmdletBinding()]
param([ValidateSet(15, 16, 17, 18)][int[]] $Versions = @(15, 16, 17, 18))
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'New-TlsFixture.ps1') | Out-Null
$compose = @('compose', '--project-name', 'schemacraft-pg-fixtures', '--file', (Join-Path $PSScriptRoot 'compose.yaml'))
foreach ($major in $Versions) { $compose += @('--profile', "pg$major") }
& docker @compose up --detach --wait
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL fixture startup failed. Inspect only this Compose project.' }
