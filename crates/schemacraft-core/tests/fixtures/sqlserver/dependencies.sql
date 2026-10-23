-- Synthetic dependency fixture; the dedicated database is owned only by this test suite.
IF DB_ID(N'SchemaCraftDependencies') IS NOT NULL
BEGIN
    ALTER DATABASE SchemaCraftDependencies SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SchemaCraftDependencies;
END
GO
CREATE DATABASE SchemaCraftDependencies;
GO
USE SchemaCraftDependencies;
GO
CREATE SCHEMA app;
GO
CREATE SCHEMA [odd.schema];
GO
CREATE SCHEMA odd;
GO
CREATE TYPE app.OrderCode FROM int NOT NULL;
GO
CREATE TABLE app.Customers (Id int NOT NULL PRIMARY KEY);
CREATE TABLE app.Orders (Id int NOT NULL PRIMARY KEY, CustomerId int NOT NULL,
    Code app.OrderCode NOT NULL,
    CONSTRAINT FK_Orders_Customers FOREIGN KEY (CustomerId) REFERENCES app.Customers(Id));
CREATE TABLE app.OrderAudit (Id int NOT NULL);
CREATE TABLE [odd.schema].Orders (Id int NOT NULL);
CREATE TABLE odd.[schema.Orders] (Id int NOT NULL);
GO
CREATE VIEW app.OrderSummary AS SELECT Id, CustomerId FROM app.Orders;
GO
CREATE VIEW app.OrderOverview AS SELECT Id FROM app.OrderSummary;
GO
CREATE VIEW [odd.schema].Overview AS SELECT Id FROM [odd.schema].Orders;
GO
CREATE VIEW odd.[schema.Overview] AS SELECT Id FROM odd.[schema.Orders];
GO
CREATE FUNCTION app.fn_CustomerCount() RETURNS int AS
BEGIN RETURN (SELECT COUNT(*) FROM app.Customers); END;
GO
-- CHECK and DEFAULT references belong to their constraint IDs in the catalog.
-- The object-level graph must attribute both to the parent table and deduplicate them.
CREATE TABLE app.DependencyConstraints (
    Id int NOT NULL CONSTRAINT DF_DependencyConstraints DEFAULT app.fn_CustomerCount(),
    CONSTRAINT CK_DependencyConstraints CHECK (Id <= app.fn_CustomerCount()));
GO
CREATE PROCEDURE app.usp_ReadOrders AS SELECT Id FROM app.OrderOverview;
GO
CREATE PROCEDURE app.usp_Unresolved AS SELECT Id FROM app.MissingTable;
GO
CREATE PROCEDURE app.usp_CallerDependent AS EXEC usp_Deferred;
GO
CREATE PROCEDURE app.usp_CycleA AS EXEC app.usp_CycleB;
GO
CREATE PROCEDURE app.usp_CycleB AS EXEC app.usp_CycleA;
GO
CREATE SYNONYM app.OrderAlias FOR app.Orders;
GO
CREATE PROCEDURE app.usp_ReadAlias AS SELECT Id FROM app.OrderAlias;
GO
CREATE TRIGGER app.tr_Orders_Audit ON app.Orders AFTER INSERT AS
    INSERT INTO app.OrderAudit(Id) SELECT Id FROM inserted;
GO
CREATE USER schemacraft_code_reader FOR LOGIN schemacraft_code_reader;
ALTER ROLE db_datareader ADD MEMBER schemacraft_code_reader;
GRANT VIEW DEFINITION TO schemacraft_code_reader;
-- An explicit denial is deterministic even if a database role grants catalog SELECT.
DENY SELECT ON OBJECT::sys.sql_expression_dependencies TO schemacraft_code_reader;
GO
