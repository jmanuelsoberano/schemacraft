-- Schema changes applied on top of fixture.sql to exercise "refresh from database".
-- Executed batch by batch (split on GO) against the database selected by the caller.
-- A new table with a foreign key, a dropped view, and changed tables: a new column, a widened
-- column, a dropped index, a disabled index, a CHECK enabled again without checking the rows
-- already there, and a foreign key whose delete rule changes and that is added again without
-- checking them.
CREATE TABLE sales.Invoices (
    InvoiceId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Invoices PRIMARY KEY CLUSTERED,
    OrderId int NOT NULL,
    IssuedAt datetime2(0) NOT NULL CONSTRAINT DF_Invoices_IssuedAt DEFAULT (sysutcdatetime()),
    Total decimal(18, 2) NOT NULL,
    CONSTRAINT FK_Invoices_Orders FOREIGN KEY (OrderId) REFERENCES sales.Orders (OrderId)
);
GO
DROP VIEW sales.RecentOrders;
GO
ALTER TABLE dbo.Customers ADD PhoneNumber varchar(32) NULL;
GO
ALTER TABLE dbo.Customers ALTER COLUMN Name nvarchar(200) NOT NULL;
GO
DROP INDEX IX_Orders_CustomerId ON sales.Orders;
GO
ALTER TABLE sales.Orders DROP CONSTRAINT FK_Orders_Customers;
GO
ALTER TABLE sales.Orders WITH NOCHECK ADD CONSTRAINT FK_Orders_Customers
    FOREIGN KEY (CustomerId) REFERENCES dbo.Customers (CustomerId) ON DELETE CASCADE;
GO
ALTER INDEX UX_Orders_Customer_PlacedAt ON sales.Orders DISABLE;
GO
ALTER TABLE sales.Orders NOCHECK CONSTRAINT CK_Orders_Status;
GO
ALTER TABLE sales.Orders CHECK CONSTRAINT CK_Orders_Status;
GO
