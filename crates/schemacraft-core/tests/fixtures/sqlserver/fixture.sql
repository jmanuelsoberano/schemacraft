-- Fixture database for the SQL Server inspector integration tests.
-- Executed batch by batch (split on GO) by tests/sqlserver_integration.rs.
IF DB_ID('SchemaCraftFixture') IS NOT NULL
BEGIN
    ALTER DATABASE SchemaCraftFixture SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SchemaCraftFixture;
END
GO
CREATE DATABASE SchemaCraftFixture;
GO
USE SchemaCraftFixture;
GO
CREATE SCHEMA sales;
GO
CREATE SCHEMA hr;
GO
-- An empty schema has nothing to filter and must not be offered.
CREATE SCHEMA staging;
GO
-- Real databases re-own fixed-role schemas; ownership must not drive the schema list.
ALTER AUTHORIZATION ON SCHEMA::db_datareader TO dbo;
GO
CREATE TYPE dbo.Money2 FROM decimal(19, 4) NOT NULL;
GO
CREATE TABLE dbo.Customers (
    CustomerId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Customers PRIMARY KEY CLUSTERED,
    Name nvarchar(120) NOT NULL,
    Email varchar(254) NOT NULL CONSTRAINT UQ_Customers_Email UNIQUE,
    Notes nvarchar(max) NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_Customers_CreatedAt DEFAULT (sysutcdatetime()),
    IsActive bit NOT NULL CONSTRAINT DF_Customers_IsActive DEFAULT ((1)),
    CONSTRAINT CK_Customers_Email CHECK (Email LIKE '%@%')
);
GO
CREATE TABLE dbo.Tags (
    TagId int NOT NULL CONSTRAINT PK_Tags PRIMARY KEY,
    Label nvarchar(50) NOT NULL
);
GO
CREATE TABLE dbo.CustomerTags (
    CustomerId int NOT NULL CONSTRAINT FK_CustomerTags_Customers
        FOREIGN KEY REFERENCES dbo.Customers (CustomerId) ON DELETE CASCADE,
    TagId int NOT NULL CONSTRAINT FK_CustomerTags_Tags FOREIGN KEY REFERENCES dbo.Tags (TagId),
    CONSTRAINT PK_CustomerTags PRIMARY KEY (CustomerId, TagId)
);
GO
CREATE TABLE hr.Employees (
    EmployeeId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Employees PRIMARY KEY,
    FullName nvarchar(200) NOT NULL,
    ManagerId int NULL,
    HiredOn date NOT NULL,
    Salary dbo.Money2 NOT NULL,
    CONSTRAINT FK_Employees_Manager FOREIGN KEY (ManagerId) REFERENCES hr.Employees (EmployeeId)
);
GO
CREATE TABLE sales.Orders (
    OrderId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    CustomerId int NOT NULL CONSTRAINT FK_Orders_Customers
        FOREIGN KEY REFERENCES dbo.Customers (CustomerId) ON UPDATE CASCADE,
    SalesRepId int NULL CONSTRAINT FK_Orders_Employees
        FOREIGN KEY REFERENCES hr.Employees (EmployeeId) ON DELETE SET NULL,
    PlacedAt datetime2(7) NOT NULL CONSTRAINT DF_Orders_PlacedAt DEFAULT (sysutcdatetime()),
    Status char(1) NOT NULL CONSTRAINT DF_Orders_Status DEFAULT ('N'),
    Subtotal decimal(18, 2) NOT NULL,
    TaxRate decimal(5, 4) NOT NULL,
    Total AS (Subtotal * (1 + TaxRate)) PERSISTED,
    CONSTRAINT CK_Orders_Status CHECK (Status IN ('N', 'P', 'S', 'C'))
);
GO
CREATE INDEX IX_Orders_CustomerId ON sales.Orders (CustomerId) INCLUDE (PlacedAt);
GO
CREATE UNIQUE INDEX UX_Orders_Customer_PlacedAt ON sales.Orders (CustomerId, PlacedAt DESC);
GO
CREATE INDEX IX_Orders_Open ON sales.Orders (Status) WHERE Status = 'N';
GO
CREATE TABLE sales.OrderLines (
    OrderId int NOT NULL,
    LineNumber smallint NOT NULL,
    ProductCode varchar(32) NOT NULL,
    Quantity int NOT NULL CONSTRAINT CK_OrderLines_Quantity CHECK (Quantity > 0),
    UnitPrice money NOT NULL,
    Discount real NULL,
    Payload varbinary(max) NULL,
    RowVersion rowversion NOT NULL,
    CONSTRAINT PK_OrderLines PRIMARY KEY (OrderId, LineNumber),
    CONSTRAINT FK_OrderLines_Orders FOREIGN KEY (OrderId) REFERENCES sales.Orders (OrderId) ON DELETE CASCADE
);
GO
CREATE TABLE sales.Shipments (
    ShipmentId uniqueidentifier NOT NULL CONSTRAINT PK_Shipments PRIMARY KEY
        CONSTRAINT DF_Shipments_ShipmentId DEFAULT (newid()),
    OrderId int NOT NULL,
    LineNumber smallint NOT NULL,
    ShippedAt datetimeoffset(0) NULL,
    Carrier nvarchar(60) NULL,
    CONSTRAINT FK_Shipments_OrderLines FOREIGN KEY (OrderId, LineNumber)
        REFERENCES sales.OrderLines (OrderId, LineNumber),
    CONSTRAINT FK_Shipments_Orders_Disabled FOREIGN KEY (OrderId) REFERENCES sales.Orders (OrderId)
);
GO
ALTER TABLE sales.Shipments NOCHECK CONSTRAINT FK_Shipments_Orders_Disabled;
GO
CREATE VIEW sales.RecentOrders AS
SELECT o.OrderId, c.Name AS CustomerName, o.PlacedAt, o.Total
FROM sales.Orders AS o
JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId;
GO
