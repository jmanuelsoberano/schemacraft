-- Fixture databases for tests/sqlserver_permissions.rs: one schema read by logins with
-- different rights (permission_logins.sql), an empty database, and a database with a denial
-- made to public.
-- Executed batch by batch (split on GO) as sa. Never touches the other fixture databases.
IF DB_ID('SchemaCraftPermissions') IS NOT NULL
BEGIN
    ALTER DATABASE SchemaCraftPermissions SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SchemaCraftPermissions;
END
GO
IF DB_ID('SchemaCraftPermissionsEmpty') IS NOT NULL
BEGIN
    ALTER DATABASE SchemaCraftPermissionsEmpty SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SchemaCraftPermissionsEmpty;
END
GO
IF DB_ID('SchemaCraftPermissionsPublicDeny') IS NOT NULL
BEGIN
    ALTER DATABASE SchemaCraftPermissionsPublicDeny SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SchemaCraftPermissionsPublicDeny;
END
GO
CREATE DATABASE SchemaCraftPermissions;
GO
-- Holds no table or view: logins that may see everything must call it empty.
CREATE DATABASE SchemaCraftPermissionsEmpty;
GO
USE SchemaCraftPermissions;
GO
CREATE SCHEMA sales;
GO
CREATE SCHEMA audit;
GO
-- Five CHECK constraints and three DEFAULT constraints, so a login without VIEW DEFINITION has
-- texts to miss in every schema.
CREATE TABLE dbo.Customers (
    CustomerId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
    Name nvarchar(120) NOT NULL CONSTRAINT CK_Customers_Name CHECK (len(Name) > 0),
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_Customers_CreatedAt DEFAULT (sysutcdatetime())
);
GO
CREATE TABLE dbo.Products (
    ProductId int NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    Price decimal(10, 2) NOT NULL CONSTRAINT CK_Products_Price CHECK (Price >= 0)
);
GO
CREATE TABLE sales.Orders (
    OrderId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    CustomerId int NOT NULL CONSTRAINT FK_Orders_Customers REFERENCES dbo.Customers (CustomerId),
    Status char(1) NOT NULL CONSTRAINT DF_Orders_Status DEFAULT ('N')
        CONSTRAINT CK_Orders_Status CHECK (Status IN ('N', 'S'))
);
GO
CREATE TABLE sales.OrderLines (
    OrderId int NOT NULL CONSTRAINT FK_OrderLines_Orders
        REFERENCES sales.Orders (OrderId) ON DELETE CASCADE,
    LineNumber smallint NOT NULL,
    ProductId int NOT NULL CONSTRAINT FK_OrderLines_Products REFERENCES dbo.Products (ProductId),
    Quantity int NOT NULL CONSTRAINT CK_OrderLines_Quantity CHECK (Quantity > 0),
    CONSTRAINT PK_OrderLines PRIMARY KEY (OrderId, LineNumber)
);
GO
CREATE TABLE audit.ChangeLog (
    ChangeId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ChangeLog PRIMARY KEY,
    OrderId int NOT NULL CONSTRAINT FK_ChangeLog_Orders REFERENCES sales.Orders (OrderId),
    Action varchar(10) NOT NULL
        CONSTRAINT CK_ChangeLog_Action CHECK (Action IN ('INSERT', 'UPDATE', 'DELETE')),
    ChangedAt datetime2(3) NOT NULL CONSTRAINT DF_ChangeLog_ChangedAt DEFAULT (sysutcdatetime())
);
GO
-- Index and constraint state, which every login that sees the table reads: a filtered index, a
-- disabled index with an included column, and a CHECK enabled again without checking the rows
-- already there, so it is not trusted.
CREATE INDEX IX_Orders_Open ON sales.Orders (CustomerId) WHERE Status = 'N';
GO
CREATE INDEX IX_OrderLines_Product ON sales.OrderLines (ProductId) INCLUDE (Quantity);
GO
ALTER INDEX IX_OrderLines_Product ON sales.OrderLines DISABLE;
GO
ALTER TABLE dbo.Products NOCHECK CONSTRAINT CK_Products_Price;
GO
ALTER TABLE dbo.Products CHECK CONSTRAINT CK_Products_Price;
GO
-- A legacy bound default: no row in sys.default_constraints, readable with OBJECT_DEFINITION.
CREATE DEFAULT dbo.LegacyZero AS 0;
GO
CREATE TABLE dbo.Legacy (
    LegacyId int NOT NULL CONSTRAINT PK_Legacy PRIMARY KEY,
    Amount int NULL
);
GO
EXEC sp_bindefault N'dbo.LegacyZero', N'dbo.Legacy.Amount';
GO
CREATE VIEW sales.OrderSummary AS
SELECT o.OrderId, o.Status, COUNT(l.LineNumber) AS LineCount
FROM sales.Orders AS o
LEFT JOIN sales.OrderLines AS l ON l.OrderId = o.OrderId
GROUP BY o.OrderId, o.Status;
GO
-- Code in two schemas, for the capability probe as each login: procedures, an encrypted one,
-- functions of two kinds and a trigger on a table and on a view. No table, view, CHECK or
-- DEFAULT, so what the inspector reads stays the same.
CREATE PROCEDURE sales.usp_PlaceOrder
    @CustomerId int,
    @OrderId int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO sales.Orders (CustomerId) VALUES (@CustomerId);
    SET @OrderId = CAST(SCOPE_IDENTITY() AS int);
END;
GO
CREATE PROCEDURE sales.usp_Secret
WITH ENCRYPTION
AS
SELECT COUNT(*) AS Orders FROM sales.Orders;
GO
CREATE PROCEDURE dbo.usp_Maintenance
AS
SELECT COUNT(*) AS Customers FROM dbo.Customers;
GO
CREATE FUNCTION dbo.fn_Tax (@Amount decimal(10, 2))
RETURNS decimal(10, 2)
AS
BEGIN
    RETURN @Amount * 0.16;
END;
GO
CREATE FUNCTION sales.fn_OrdersOf (@CustomerId int)
RETURNS TABLE
AS
RETURN SELECT OrderId, Status FROM sales.Orders WHERE CustomerId = @CustomerId;
GO
CREATE TRIGGER sales.TR_Orders_Insert ON sales.Orders
AFTER INSERT
AS
SET NOCOUNT ON;
GO
CREATE TRIGGER sales.TR_OrderSummary_Insert ON sales.OrderSummary
INSTEAD OF INSERT
AS
SET NOCOUNT ON;
GO
-- Denials made to public reach every user, yet never dbo: sa and the database owner enter as
-- dbo, for which SQL Server checks no permission.
CREATE DATABASE SchemaCraftPermissionsPublicDeny;
GO
USE SchemaCraftPermissionsPublicDeny;
GO
CREATE SCHEMA hr;
GO
-- The one table a db_datareader member still sees.
CREATE TABLE dbo.Departments (
    DepartmentId int NOT NULL CONSTRAINT PK_Departments PRIMARY KEY,
    Name nvarchar(60) NOT NULL
);
GO
CREATE TABLE dbo.Payroll (
    PayrollId int NOT NULL CONSTRAINT PK_Payroll PRIMARY KEY,
    Amount decimal(10, 2) NOT NULL
);
GO
CREATE TABLE hr.Salaries (
    SalaryId int NOT NULL CONSTRAINT PK_Salaries PRIMARY KEY,
    Amount decimal(10, 2) NOT NULL
);
GO
DENY SELECT ON dbo.Payroll TO public;
DENY VIEW DEFINITION ON SCHEMA::hr TO public;
GO
