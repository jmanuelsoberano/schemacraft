<#
.SYNOPSIS
    Manages the SQL Server containers used by the integration tests.

.DESCRIPTION
    start   Creates (or restarts) the container and waits until it accepts logins.
    stop    Stops the container; data is kept until it is removed.
    remove  Stops and deletes the container.
    env     Prints the environment variables the integration tests read.

    -Version picks the server: 2022 (the default) runs as schemacraft-mssql on port 14333, and
    2019 as schemacraft-mssql2019 on port 14334, so both can run side by side, as they do in CI.

    The sa password is for the local containers only. Override it with
    SCHEMACRAFT_TEST_MSSQL_PASSWORD before running the script.

.EXAMPLE
    .\scripts\dev-sqlserver.ps1 start
    .\scripts\dev-sqlserver.ps1 env | Invoke-Expression
    cargo test -p schemacraft-core --test sqlserver_integration

.EXAMPLE
    .\scripts\dev-sqlserver.ps1 start -Version 2019
    .\scripts\dev-sqlserver.ps1 env -Version 2019 | Invoke-Expression
    cargo test -p schemacraft-core --test sqlserver_integration --test sqlserver_permissions --test diagnostics_privacy --test sqlserver_code
#>
param(
    [ValidateSet('start', 'stop', 'remove', 'env')]
    [string] $Action = 'start',

    [ValidateSet('2019', '2022')]
    [string] $Version = '2022'
)

$ErrorActionPreference = 'Stop'

# The major version is what SERVERPROPERTY('ProductMajorVersion') answers; the tests check it.
$Servers = @{
    '2022' = @{ ContainerName = 'schemacraft-mssql'; Port = 14333; MajorVersion = 16 }
    '2019' = @{ ContainerName = 'schemacraft-mssql2019'; Port = 14334; MajorVersion = 15 }
}
$ContainerName = $Servers[$Version].ContainerName
$Port = $Servers[$Version].Port
$MajorVersion = $Servers[$Version].MajorVersion
$Image = "mcr.microsoft.com/mssql/server:$Version-latest"
$Password = if ($env:SCHEMACRAFT_TEST_MSSQL_PASSWORD) { $env:SCHEMACRAFT_TEST_MSSQL_PASSWORD } else { 'SchemaCraft!Dev2026' }

function Test-ContainerExists {
    $names = docker ps -a --format '{{.Names}}'
    return ($names -split "`n") -contains $ContainerName
}

function Wait-ForSqlServer {
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        docker exec $ContainerName /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P $Password -C -Q 'SELECT 1' *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "SQL Server $Version is accepting logins on localhost,$Port"
            return
        }
        Start-Sleep -Seconds 3
    }
    throw "SQL Server $Version did not become ready in time; check ``docker logs $ContainerName``."
}

switch ($Action) {
    'start' {
        if (Test-ContainerExists) {
            docker start $ContainerName | Out-Null
        }
        else {
            docker run -d --name $ContainerName `
                -e 'ACCEPT_EULA=Y' -e "MSSQL_SA_PASSWORD=$Password" -e 'MSSQL_PID=Developer' `
                -p "${Port}:1433" $Image | Out-Null
        }
        Wait-ForSqlServer
    }
    'stop' {
        docker stop $ContainerName | Out-Null
        Write-Host "Stopped $ContainerName"
    }
    'remove' {
        docker rm -f $ContainerName | Out-Null
        Write-Host "Removed $ContainerName"
    }
    'env' {
        Write-Output "`$env:SCHEMACRAFT_TEST_MSSQL_HOST = 'localhost'"
        Write-Output "`$env:SCHEMACRAFT_TEST_MSSQL_PORT = '$Port'"
        Write-Output "`$env:SCHEMACRAFT_TEST_MSSQL_USER = 'sa'"
        Write-Output "`$env:SCHEMACRAFT_TEST_MSSQL_PASSWORD = '$Password'"
        Write-Output "`$env:SCHEMACRAFT_TEST_MSSQL_MAJOR = '$MajorVersion'"
    }
}
