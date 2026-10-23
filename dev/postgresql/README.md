# PostgreSQL integration fixtures

Dedicated synthetic PostgreSQL 15–18 servers for the complete capture, refresh, comparison,
dependency, metadata and TLS tests. Docker Desktop must use Linux containers; PowerShell 7
generates ephemeral local certificates through .NET. No certificate is installed globally.
The application uses native Windows TLS rather than requiring libpq or a separate OpenSSL DLL.

From the repository root:

```powershell
./dev/postgresql/Start-Fixtures.ps1
./dev/postgresql/Test-Fixtures.ps1
```

Or use `-Versions 18` on both commands. Tests run sequentially and refuse an existing Cargo
process. The fixture initializes `schemacraft_fixture`; the integration test deliberately
recreates its synthetic schemas and briefly changes/restores catalog permissions inside
these dedicated test servers. Never point its variables at an unrelated server/database.

| Major | Container                  | Loopback port | Data volume within this Compose project |
| ----- | -------------------------- | ------------- | --------------------------------------- |
| 15    | `schemacraft-pg-fixture15` | 15435         | `pg15`                                  |
| 16    | `schemacraft-pg-fixture16` | 15436         | `pg16`                                  |
| 17    | `schemacraft-pg-fixture17` | 15437         | `pg17`                                  |
| 18    | `schemacraft-pg-fixture18` | 15438         | `pg18`                                  |

Database: `schemacraft_fixture`. Synthetic administrator: `postgres` /
`SchemaCraftPgFixture!2026`. Override `SCHEMACRAFT_PG_FIXTURE_PASSWORD` before initializing a
new volume. Metadata-only role: `schemacraft_pg_reader` / `SchemaCraftPgReader!2026`. These
public fixture passwords have no production use. Ports bind only to `127.0.0.1`.

For strict TLS in the app, connect to **localhost**, choose full certificate/hostname
validation and paste `.generated/tls/ca.crt` as the additional public CA. The certificate
deliberately has only a localhost DNS SAN: using `127.0.0.1` exercises hostname rejection.
The matrix verifies a trusted custom CA, untrusted CA, mismatched hostname and bad password.
Generated keys/certificates live in ignored `.generated/tls` and expire after 30 days.
Never commit, distribute or use these keys for any other service. Existing initialized
volumes contain their certificate copy; certificate rotation requires deliberately
reinitializing only this fixture project's volumes.

Images are pinned to the official multi-platform manifest digests verified on 2026-10-23:
[15.19-bookworm](https://github.com/docker-library/repo-info/blob/master/repos/postgres/remote/15.19-bookworm.md),
[16.15-bookworm](https://github.com/docker-library/repo-info/blob/master/repos/postgres/remote/16.15-bookworm.md),
[17.11-bookworm](https://github.com/docker-library/repo-info/blob/master/repos/postgres/remote/17.11-bookworm.md),
[18.6-bookworm](https://github.com/docker-library/repo-info/blob/master/repos/postgres/remote/18.6-bookworm.md).
The Compose volume targets follow the [official image's PostgreSQL 18 data-directory change](https://github.com/docker-library/docs/tree/master/postgres#pgdata).

To stop only these fixtures and keep their data:

```powershell
docker compose --project-name schemacraft-pg-fixtures --file dev/postgresql/compose.yaml --profile pg15 --profile pg16 --profile pg17 --profile pg18 stop
```

Do not stop Docker Desktop or use global prune/reset commands. Other projects are unrelated.
