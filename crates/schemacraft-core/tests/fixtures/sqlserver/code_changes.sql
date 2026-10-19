-- Changes applied to a separate copy of code.sql by tests/sqlserver_code.rs.
-- The base fixture stays unchanged so captures and the capability probe can run independently.
ALTER PROCEDURE app.usp_PlaceOrder
    @CustomerId int,
    @Total decimal(18, 2) = 0,
    @OrderId int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT @OrderId = ISNULL(MAX(OrderId), 0) + 10 FROM app.Orders;
    INSERT INTO app.Orders (OrderId, CustomerId, Status, Total)
    VALUES (@OrderId, @CustomerId, 'O', @Total);
END;
GO
-- Recreate with the same CREATE spelling and body, but LF and no trailing spaces. Using ALTER
-- here would itself change the stored text and would not test line-ending normalisation alone.
DROP PROCEDURE app.usp_Scripted;
GO
CREATE PROCEDURE app.usp_Scripted
AS
SELECT OrderId FROM app.Orders;
GO
-- ALTER loses the First order set for INSERT, even though the trigger still handles both events.
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-settriggerorder-transact-sql
ALTER TRIGGER app.TR_Orders_InsertUpdate ON app.Orders
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO app.OrderAudit (OrderId, Action)
    SELECT OrderId, 'W' FROM inserted;
END;
GO
DISABLE TRIGGER app.TR_Orders_Delete ON app.Orders;
ENABLE TRIGGER app.TR_Orders_Update ON app.Orders;
GO
-- This view has no INSTEAD OF trigger, which SQL Server forbids with WITH CHECK OPTION.
ALTER VIEW app.OpenOrders
AS
SELECT OrderId, CustomerId, Status
FROM app.Orders
WHERE Status = 'O';
GO
DROP FUNCTION app.fn_LinesOf;
GO
CREATE PROCEDURE app.usp_Added
AS
SELECT COUNT(*) AS LineCount FROM app.OrderLines;
GO
