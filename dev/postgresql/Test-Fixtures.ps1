<# .SYNOPSIS Runs the real PostgreSQL integration matrix with one Cargo process at a time. #>
[CmdletBinding()]
param([ValidateSet(15, 16, 17, 18)][int[]] $Versions = @(15, 16, 17, 18))
$ErrorActionPreference = 'Stop'
if (Get-Process -Name cargo -ErrorAction SilentlyContinue) { throw 'Another Cargo process is active. Finish it before running the matrix.' }
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$variableNames = @('HOST', 'PORT', 'USER', 'PASSWORD', 'MAJOR', 'REQUIRE_SERVER', 'CA', 'REQUIRE_TLS') | ForEach-Object { "SCHEMACRAFT_TEST_PG_$_" }
$previous = @{}
foreach ($name in $variableNames) { $previous[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location -LiteralPath $workspace
try {
    $env:SCHEMACRAFT_TEST_PG_HOST = '127.0.0.1'
    $env:SCHEMACRAFT_TEST_PG_USER = 'postgres'
    $env:SCHEMACRAFT_TEST_PG_PASSWORD = if ($env:SCHEMACRAFT_PG_FIXTURE_PASSWORD) { $env:SCHEMACRAFT_PG_FIXTURE_PASSWORD } else { 'SchemaCraftPgFixture!2026' }
    $env:SCHEMACRAFT_TEST_PG_REQUIRE_SERVER = '1'
    $env:SCHEMACRAFT_TEST_PG_REQUIRE_TLS = '1'
    $env:SCHEMACRAFT_TEST_PG_CA = Join-Path $PSScriptRoot '.generated/tls/ca.crt'
    foreach ($major in $Versions) {
        $env:SCHEMACRAFT_TEST_PG_PORT = [string](15420 + $major)
        $env:SCHEMACRAFT_TEST_PG_MAJOR = [string]$major
        & cargo test -p schemacraft-core --test postgresql_integration -- --test-threads=1
        if ($LASTEXITCODE -ne 0) { throw "PostgreSQL $major integration failed." }
    }
} finally {
    Pop-Location
    foreach ($name in $variableNames) { [System.Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
