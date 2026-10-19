-- Fixture database with code: views, triggers, procedures and functions of every T-SQL kind the
-- capability probe (probes/capability-probe.sql) counts, on four tables of schema app. It has no
-- CLR module, which needs an assembly, so the probe's CLR counts are 0 here. A database of its
-- own, so the counts of the other fixtures stay as they are.
-- Executed batch by batch (split on GO) as sa by tests/sqlserver_integration.rs. A module's text
-- is its whole batch, so the comments that describe a module sit inside it, after AS, except
-- where a comment before CREATE is the point.
IF DB_ID('SchemaCraftCode') IS NOT NULL
BEGIN
    ALTER DATABASE SchemaCraftCode SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SchemaCraftCode;
END
GO
CREATE DATABASE SchemaCraftCode;
GO
USE SchemaCraftCode;
GO
CREATE SCHEMA app;
GO
-- A schema that holds a procedure and no table or view.
CREATE SCHEMA code_only;
GO
CREATE TABLE app.Customers (
    CustomerId int NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
    Name nvarchar(120) NOT NULL
);
GO
-- The triggers live here. No key of this table cascades, since SQL Server refuses INSTEAD OF
-- DELETE and UPDATE triggers on a table with a cascading key:
-- https://learn.microsoft.com/en-us/sql/t-sql/statements/create-trigger-transact-sql
CREATE TABLE app.Orders (
    OrderId int NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    CustomerId int NOT NULL CONSTRAINT FK_Orders_Customers REFERENCES app.Customers (CustomerId),
    Status char(1) NOT NULL,
    Total decimal(18, 2) NOT NULL
);
GO
CREATE TABLE app.OrderLines (
    OrderId int NOT NULL CONSTRAINT FK_OrderLines_Orders REFERENCES app.Orders (OrderId),
    LineNumber smallint NOT NULL,
    Quantity int NOT NULL,
    CONSTRAINT PK_OrderLines PRIMARY KEY (OrderId, LineNumber)
);
GO
CREATE TABLE app.OrderAudit (
    AuditId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_OrderAudit PRIMARY KEY,
    OrderId int NOT NULL,
    Action char(1) NOT NULL
);
GO
CREATE TYPE app.OrderLineType AS TABLE (
    LineNumber smallint NOT NULL,
    Quantity int NOT NULL
);
GO
CREATE VIEW app.OpenOrders
AS
-- SQL Server refuses an INSTEAD OF trigger on an updatable view WITH CHECK OPTION, so this view
-- has none and OrderSummary carries the view trigger.
SELECT OrderId, CustomerId, Status
FROM app.Orders
WHERE Status = 'O'
WITH CHECK OPTION;
GO
CREATE VIEW app.OrderSummary
AS
SELECT o.OrderId, c.Name AS CustomerName, o.Total
FROM app.Orders AS o
JOIN app.Customers AS c ON c.CustomerId = o.CustomerId;
GO
CREATE TRIGGER app.TR_OrderSummary_Insert ON app.OrderSummary
INSTEAD OF INSERT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO app.Orders (OrderId, CustomerId, Status, Total)
    SELECT i.OrderId, c.CustomerId, 'O', i.Total
    FROM inserted AS i
    JOIN app.Customers AS c ON c.Name = i.CustomerName;
END;
GO
-- An indexed view needs these options when it is created and when its index is:
-- https://learn.microsoft.com/en-us/sql/relational-databases/views/create-indexed-views
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO
CREATE VIEW app.OrderTotals
WITH SCHEMABINDING
AS
SELECT l.OrderId, SUM(l.Quantity) AS Quantity, COUNT_BIG(*) AS LineCount
FROM app.OrderLines AS l
GROUP BY l.OrderId;
GO
CREATE UNIQUE CLUSTERED INDEX UX_OrderTotals ON app.OrderTotals (OrderId);
GO
CREATE VIEW app.SecretView
WITH ENCRYPTION
AS
SELECT CustomerId, Name FROM app.Customers;
GO
CREATE TRIGGER app.TR_Orders_InsertUpdate ON app.Orders
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO app.OrderAudit (OrderId, Action)
    SELECT OrderId, 'W' FROM inserted;
END;
GO
CREATE TRIGGER app.TR_Orders_Delete ON app.Orders
AFTER DELETE
NOT FOR REPLICATION
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO app.OrderAudit (OrderId, Action)
    SELECT OrderId, 'D' FROM deleted;
END;
GO
CREATE TRIGGER app.TR_Orders_Update ON app.Orders
AFTER UPDATE
AS
SET NOCOUNT ON;
GO
-- Three triggers on one table: the first runs First for INSERT, the second Last for DELETE, and
-- the third is disabled. First and Last apply to AFTER triggers only:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-settriggerorder-transact-sql
EXEC sp_settriggerorder @triggername = N'app.TR_Orders_InsertUpdate', @order = N'First',
    @stmttype = N'INSERT';
EXEC sp_settriggerorder @triggername = N'app.TR_Orders_Delete', @order = N'Last',
    @stmttype = N'DELETE';
GO
DISABLE TRIGGER app.TR_Orders_Update ON app.Orders;
GO
CREATE TRIGGER app.TR_OrderAudit_Insert ON app.OrderAudit
WITH ENCRYPTION
AFTER INSERT
AS
SET NOCOUNT ON;
GO
CREATE PROCEDURE app.usp_PlaceOrder
    @CustomerId int,
    @Total decimal(18, 2) = 0,
    @OrderId int OUTPUT
AS
-- Input, OUTPUT and defaulted parameters; SQL Server keeps a default only in this text.
BEGIN
    SET NOCOUNT ON;
    SELECT @OrderId = ISNULL(MAX(OrderId), 0) + 1 FROM app.Orders;
    INSERT INTO app.Orders (OrderId, CustomerId, Status, Total)
    VALUES (@OrderId, @CustomerId, 'O', @Total);
END;
GO
CREATE PROCEDURE app.usp_Secret
WITH ENCRYPTION
AS
SELECT COUNT(*) AS Orders FROM app.Orders;
GO
-- Created under the old settings, which the module keeps.
SET ANSI_NULLS OFF;
SET QUOTED_IDENTIFIER OFF;
GO
CREATE PROCEDURE app.usp_LegacySettings
AS
SELECT OrderId FROM app.Orders WHERE Status = NULL;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE PROCEDURE app.usp_AddLines
    @OrderId int,
    @Lines app.OrderLineType READONLY
AS
INSERT INTO app.OrderLines (OrderId, LineNumber, Quantity)
SELECT @OrderId, LineNumber, Quantity FROM @Lines;
GO
CREATE PROCEDURE app.usp_Search
    @Status char(1),
    @UseExec bit = 0
AS
-- Dynamic SQL in the two forms the text scan counts.
BEGIN
    DECLARE @Sql nvarchar(200) = N'SELECT OrderId FROM app.Orders WHERE Status = @Status';
    IF @UseExec = 1
        EXEC (N'SELECT OrderId FROM app.Orders');
    ELSE
        EXEC sys.sp_executesql @Sql, N'@Status char(1)', @Status = @Status;
END;
GO
-- Created through sp_executesql, so its text has CRLF line ends and trailing spaces, which no
-- line of this file has.
DECLARE @crlf nchar(2) = NCHAR(13) + NCHAR(10);
DECLARE @create nvarchar(max) = N'CREATE PROCEDURE app.usp_Scripted  ' + @crlf
    + N'AS ' + @crlf
    + N'SELECT OrderId FROM app.Orders;' + @crlf;
EXEC sys.sp_executesql @create;
GO
-- Its batch starts with this comment, which its text keeps.
CREATE PROCEDURE app.usp_Commented
    @CustomerId int
AS
SELECT OrderId FROM app.Orders WHERE CustomerId = @CustomerId;
GO
CREATE PROCEDURE app.usp_FormerName
AS
SELECT COUNT(*) AS Customers FROM app.Customers;
GO
-- Renaming leaves the old name in the stored text.
EXEC sp_rename N'app.usp_FormerName', N'usp_Renamed';
GO
CREATE PROCEDURE app.usp_Connect
AS
-- A fake connection string in a comment, for the text scan: Server=example;Uid=demo;Pwd=example;
SELECT 1 AS Connected;
GO
CREATE FUNCTION app.fn_Tax (@Amount decimal(18, 2))
RETURNS decimal(18, 2)
AS
BEGIN
    RETURN @Amount * 0.16;
END;
GO
CREATE FUNCTION app.fn_OrdersOf (@CustomerId int)
RETURNS TABLE
AS
RETURN SELECT OrderId, Status, Total FROM app.Orders WHERE CustomerId = @CustomerId;
GO
CREATE FUNCTION app.fn_LinesOf (@OrderId int)
RETURNS @Lines TABLE (LineNumber smallint NOT NULL, Quantity int DEFAULT (4) NOT NULL)
AS
-- Internal defaults belong to this body; returned-column metadata records structure only.
BEGIN
    INSERT INTO @Lines (LineNumber, Quantity)
    SELECT LineNumber, Quantity FROM app.OrderLines WHERE OrderId = @OrderId;
    RETURN;
END;
GO
CREATE PROCEDURE code_only.usp_Ping
AS
SELECT 1 AS Pong;
GO
CREATE TRIGGER TR_Database_NoOp ON DATABASE
FOR CREATE_TABLE
AS
-- Does nothing, and is created last, so that no statement of this script fires it.
SET NOCOUNT ON;
GO
