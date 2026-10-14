<#
.SYNOPSIS
    Manages the SQL Server 2022 container used by the integration tests.

.DESCRIPTION
    start   Creates (or restarts) the container and waits until it accepts logins.
    stop    Stops the container; data is kept until it is removed.
    remove  Stops and deletes the container.
    env     Prints the environment variables the integration tests read.

    The sa password is for the local container only. Override it with
    SCHEMACRAFT_TEST_MSSQL_PASSWORD before running the script.

.EXAMPLE
    .\scripts\dev-sqlserver.ps1 start
    .\scripts\dev-sqlserver.ps1 env | Invoke-Expression
    cargo test -p schemacraft-core --test sqlserver_integration
#>
param(
    [ValidateSet('start', 'stop', 'remove', 'env')]
    [string] $Action = 'start'
)

$ErrorActionPreference = 'Stop'

$ContainerName = 'schemacraft-mssql'
$Image = 'mcr.microsoft.com/mssql/server:2022-latest'
$Port = 14333
$Password = if ($env:SCHEMACRAFT_TEST_MSSQL_PASSWORD) { $env:SCHEMACRAFT_TEST_MSSQL_PASSWORD } else { 'SchemaCraft!Dev2026' }

function Test-ContainerExists {
    $names = docker ps -a --format '{{.Names}}'
    return ($names -split "`n") -contains $ContainerName
}

function Wait-ForSqlServer {
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        docker exec $ContainerName /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P $Password -C -Q 'SELECT 1' *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "SQL Server is accepting logins on localhost,$Port"
            return
        }
        Start-Sleep -Seconds 3
    }
    throw 'SQL Server did not become ready in time; check `docker logs schemacraft-mssql`.'
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
    }
}
