-- The login of tests/sqlserver_permissions.rs that needs SQL Server 2022 or later, where
-- VIEW SECURITY DEFINITION exists; earlier versions reject the DENY below. The test runs this
-- script after permission_logins.sql, and only when SERVERPROPERTY('ProductMajorVersion') is 16
-- or more: https://learn.microsoft.com/en-us/sql/relational-databases/security/permissions-database-engine
-- $(PASSWORD) is replaced by the test, as in permission_logins.sql.
-- Executed batch by batch (split on GO) as sa.
USE master;
GO
IF SUSER_ID(N'schemacraft_vd_deny_vsd') IS NULL
    CREATE LOGIN schemacraft_vd_deny_vsd WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_vd_deny_vsd WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
GO
USE SchemaCraftPermissions;
GO
-- Every object and every text, without the security part of VIEW DEFINITION: the permission
-- rows, its own denials included, are hidden from it, so it cannot count them.
CREATE USER schemacraft_vd_deny_vsd FOR LOGIN schemacraft_vd_deny_vsd;
GRANT VIEW DEFINITION TO schemacraft_vd_deny_vsd;
DENY VIEW SECURITY DEFINITION TO schemacraft_vd_deny_vsd;
GO
