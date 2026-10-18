-- The login of tests/diagnostics_privacy.rs whose catalog query is denied: a db_datareader
-- member of SchemaCraftPermissions that may not read sys.check_constraints, so an inspection
-- fails with error 229 on the check constraints query, whose message names the catalog view.
-- permissions.sql and permission_logins.sql must run first.
-- $(PASSWORD) is replaced by the test, as in permission_logins.sql.
-- Executed batch by batch (split on GO) as sa.
USE master;
GO
IF SUSER_ID(N'schemacraft_no_checks') IS NULL
    CREATE LOGIN schemacraft_no_checks WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_no_checks WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
GO
USE SchemaCraftPermissions;
GO
CREATE USER schemacraft_no_checks FOR LOGIN schemacraft_no_checks;
ALTER ROLE db_datareader ADD MEMBER schemacraft_no_checks;
DENY SELECT ON sys.check_constraints TO schemacraft_no_checks;
GO
