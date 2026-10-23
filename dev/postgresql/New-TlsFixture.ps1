<#
.SYNOPSIS
Creates an ephemeral local test CA and a localhost-only PostgreSQL server certificate.
.DESCRIPTION
Uses PowerShell 7/.NET. Nothing is installed in the Windows trust store. Generated private
keys are test-only, remain in ignored .generated/tls, and are never application assets.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$fixtureDirectory = Join-Path $PSScriptRoot '.generated/tls'
$certificateFiles = @('ca.crt', 'server.crt', 'server.key')
$present = @($certificateFiles | Where-Object { Test-Path -LiteralPath (Join-Path $fixtureDirectory $_) })
if ($present.Count -eq 3) { Write-Output $fixtureDirectory; return }
if ($present.Count -ne 0) { throw 'The TLS fixture is incomplete. Inspect .generated/tls and restore or regenerate it explicitly.' }
[System.IO.Directory]::CreateDirectory($fixtureDirectory) | Out-Null
$hash = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
$caKey = [System.Security.Cryptography.RSA]::Create(3072)
$serverKey = [System.Security.Cryptography.RSA]::Create(3072)
try {
    $caRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=SchemaCraft Synthetic Fixture CA', $caKey, $hash, $padding)
    $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
    $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign, $true))
    $notBefore = [System.DateTimeOffset]::UtcNow.AddMinutes(-10)
    $notAfter = [System.DateTimeOffset]::UtcNow.AddDays(30)
    $ca = $caRequest.CreateSelfSigned($notBefore, $notAfter)
    try {
        $serverRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $serverKey, $hash, $padding)
        $serverRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
        $serverRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment, $true))
        $usage = [System.Security.Cryptography.OidCollection]::new()
        $usage.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
        $serverRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usage, $true))
        $names = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $names.AddDnsName('localhost')
        $serverRequest.CertificateExtensions.Add($names.Build())
        $serial = [byte[]]::new(16)
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($serial)
        $server = $serverRequest.Create($ca, $notBefore, $notAfter.AddMinutes(-1), $serial)
        try {
            [System.IO.File]::WriteAllText((Join-Path $fixtureDirectory 'ca.crt'), $ca.ExportCertificatePem())
            [System.IO.File]::WriteAllText((Join-Path $fixtureDirectory 'server.crt'), $server.ExportCertificatePem())
            [System.IO.File]::WriteAllText((Join-Path $fixtureDirectory 'server.key'), $serverKey.ExportPkcs8PrivateKeyPem())
        } finally { $server.Dispose() }
    } finally { $ca.Dispose() }
} finally { $caKey.Dispose(); $serverKey.Dispose() }
Write-Output $fixtureDirectory
