-- Logins for tests/sqlserver_permissions.rs, one per kind of access, and their users in the
-- databases of permissions.sql, which must run first.
-- $(PASSWORD) is replaced by the test with a value generated for the run, so no password is
-- committed. Logins outlive the databases, so an existing one only gets the new password.
-- Executed batch by batch (split on GO) as sa.
USE master;
GO
IF SUSER_ID(N'schemacraft_owner') IS NULL
    CREATE LOGIN schemacraft_owner WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_owner WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
IF SUSER_ID(N'schemacraft_reader') IS NULL
    CREATE LOGIN schemacraft_reader WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_reader WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
IF SUSER_ID(N'schemacraft_viewdef') IS NULL
    CREATE LOGIN schemacraft_viewdef WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_viewdef WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
IF SUSER_ID(N'schemacraft_sales_vd') IS NULL
    CREATE LOGIN schemacraft_sales_vd WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_sales_vd WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
IF SUSER_ID(N'schemacraft_two_tables') IS NULL
    CREATE LOGIN schemacraft_two_tables WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_two_tables WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
IF SUSER_ID(N'schemacraft_connect') IS NULL
    CREATE LOGIN schemacraft_connect WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_connect WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
IF SUSER_ID(N'schemacraft_vd_deny_audit') IS NULL
    CREATE LOGIN schemacraft_vd_deny_audit WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_vd_deny_audit WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
IF SUSER_ID(N'schemacraft_reader_deny_audit') IS NULL
    CREATE LOGIN schemacraft_reader_deny_audit WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_reader_deny_audit WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
IF SUSER_ID(N'schemacraft_reader_deny_column') IS NULL
    CREATE LOGIN schemacraft_reader_deny_column WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN schemacraft_reader_deny_column WITH PASSWORD = N'$(PASSWORD)', CHECK_POLICY = OFF;
GO
USE SchemaCraftPermissions;
GO
-- Everything.
CREATE USER schemacraft_owner FOR LOGIN schemacraft_owner;
ALTER ROLE db_owner ADD MEMBER schemacraft_owner;
-- Every table and view, no text.
CREATE USER schemacraft_reader FOR LOGIN schemacraft_reader;
ALTER ROLE db_datareader ADD MEMBER schemacraft_reader;
-- Every object and every text, no data.
CREATE USER schemacraft_viewdef FOR LOGIN schemacraft_viewdef;
GRANT VIEW DEFINITION TO schemacraft_viewdef;
-- Every object; the texts of sales only.
CREATE USER schemacraft_sales_vd FOR LOGIN schemacraft_sales_vd;
ALTER ROLE db_datareader ADD MEMBER schemacraft_sales_vd;
GRANT VIEW DEFINITION ON SCHEMA::sales TO schemacraft_sales_vd;
-- Two tables, whose keys point to tables it cannot see.
CREATE USER schemacraft_two_tables FOR LOGIN schemacraft_two_tables;
GRANT SELECT ON sales.Orders TO schemacraft_two_tables;
GRANT SELECT ON sales.OrderLines TO schemacraft_two_tables;
-- Nothing but CONNECT, which CREATE USER grants.
CREATE USER schemacraft_connect FOR LOGIN schemacraft_connect;
-- Every text, except that audit is hidden by a schema denial.
CREATE USER schemacraft_vd_deny_audit FOR LOGIN schemacraft_vd_deny_audit;
GRANT VIEW DEFINITION TO schemacraft_vd_deny_audit;
DENY VIEW DEFINITION ON SCHEMA::audit TO schemacraft_vd_deny_audit;
-- SELECT everywhere, yet audit is hidden: the denial wins over the role's SELECT.
CREATE USER schemacraft_reader_deny_audit FOR LOGIN schemacraft_reader_deny_audit;
ALTER ROLE db_datareader ADD MEMBER schemacraft_reader_deny_audit;
DENY VIEW DEFINITION ON SCHEMA::audit TO schemacraft_reader_deny_audit;
-- A column denial hides data, not objects: it must not make the object list partial.
CREATE USER schemacraft_reader_deny_column FOR LOGIN schemacraft_reader_deny_column;
ALTER ROLE db_datareader ADD MEMBER schemacraft_reader_deny_column;
DENY SELECT ON dbo.Customers (Name) TO schemacraft_reader_deny_column;
GO
USE SchemaCraftPermissionsEmpty;
GO
CREATE USER schemacraft_owner FOR LOGIN schemacraft_owner;
ALTER ROLE db_owner ADD MEMBER schemacraft_owner;
CREATE USER schemacraft_reader FOR LOGIN schemacraft_reader;
ALTER ROLE db_datareader ADD MEMBER schemacraft_reader;
GO
USE SchemaCraftPermissionsPublicDeny;
GO
CREATE USER schemacraft_reader FOR LOGIN schemacraft_reader;
ALTER ROLE db_datareader ADD MEMBER schemacraft_reader;
GO
