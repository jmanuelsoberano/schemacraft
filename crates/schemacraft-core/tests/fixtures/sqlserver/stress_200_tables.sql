-- Performance fixture: 200 tables chained by foreign keys, each with ten columns and two indexes,
-- plus 200 triggers, 600 procedures, 100 scalar functions, 50 inline functions and 20 views.
-- Executed batch by batch (split on GO) by tests/sqlserver_integration.rs.
IF DB_ID('SchemaCraftStress') IS NOT NULL
BEGIN
    ALTER DATABASE SchemaCraftStress SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SchemaCraftStress;
END
GO
CREATE DATABASE SchemaCraftStress;
GO
USE SchemaCraftStress;
GO
DECLARE @table_number int = 1;
DECLARE @statement nvarchar(max);
WHILE @table_number <= 200
BEGIN
    DECLARE @name nvarchar(20) = N'Table' + CAST(@table_number AS nvarchar(10));
    DECLARE @parent nvarchar(20) = N'Table' + CAST(@table_number - 1 AS nvarchar(10));
    SET @statement = N'CREATE TABLE dbo.' + @name + N' (
        Id int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_' + @name + N' PRIMARY KEY,
        Code varchar(20) NOT NULL,
        Name nvarchar(100) NOT NULL,
        Amount decimal(18, 2) NULL,
        Quantity int NULL,
        CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_' + @name + N'_CreatedAt DEFAULT (sysutcdatetime()),
        IsActive bit NOT NULL CONSTRAINT DF_' + @name + N'_IsActive DEFAULT ((1)),
        Notes nvarchar(max) NULL,
        Ratio float NULL,
        ExternalId uniqueidentifier NULL'
        + CASE WHEN @table_number > 1
               THEN N', ParentId int NULL CONSTRAINT FK_' + @name + N'_Parent REFERENCES dbo.' + @parent + N' (Id)'
               ELSE N'' END
        + N');
        CREATE INDEX IX_' + @name + N'_Code ON dbo.' + @name + N' (Code);
        CREATE UNIQUE INDEX UX_' + @name + N'_ExternalId ON dbo.' + @name + N' (ExternalId) WHERE ExternalId IS NOT NULL;';
    EXEC sp_executesql @statement;
    SET @table_number += 1;
END
GO
-- Keep roughly two million characters of module text in one schema. A comment carries the
-- payload without making the fixture expensive to create or executing any stored module.
DECLARE @number int = 1;
DECLARE @statement nvarchar(max);
DECLARE @padding nvarchar(max) = REPLICATE(CAST(N'x' AS nvarchar(max)), 3200);
WHILE @number <= 600
BEGIN
    SET @statement = N'CREATE PROCEDURE dbo.usp_Stress' + CAST(@number AS nvarchar(10))
        + N' @Id int, @Result int OUTPUT AS /* ' + @padding
        + N' */ SELECT @Result = Id FROM dbo.Table1 WHERE Id = @Id;';
    EXEC sys.sp_executesql @statement;
    SET @number += 1;
END;
SET @number = 1;
WHILE @number <= 200
BEGIN
    SET @statement = N'CREATE TRIGGER dbo.TR_Stress' + CAST(@number AS nvarchar(10))
        + N' ON dbo.Table' + CAST(@number AS nvarchar(10))
        + N' AFTER INSERT AS SET NOCOUNT ON;';
    EXEC sys.sp_executesql @statement;
    SET @number += 1;
END;
SET @number = 1;
WHILE @number <= 100
BEGIN
    SET @statement = N'CREATE FUNCTION dbo.fn_Stress' + CAST(@number AS nvarchar(10))
        + N' (@Amount decimal(18, 2)) RETURNS decimal(18, 2) AS BEGIN RETURN @Amount * 0.16; END;';
    EXEC sys.sp_executesql @statement;
    SET @number += 1;
END;
SET @number = 1;
WHILE @number <= 50
BEGIN
    SET @statement = N'CREATE FUNCTION dbo.fn_StressRows' + CAST(@number AS nvarchar(10))
        + N' (@Id int) RETURNS TABLE AS RETURN SELECT Id, Name FROM dbo.Table1 WHERE Id = @Id;';
    EXEC sys.sp_executesql @statement;
    SET @number += 1;
END;
SET @number = 1;
WHILE @number <= 20
BEGIN
    SET @statement = N'CREATE VIEW dbo.StressView' + CAST(@number AS nvarchar(10))
        + N' AS SELECT Id, Name, Amount FROM dbo.Table1;';
    EXEC sys.sp_executesql @statement;
    SET @number += 1;
END;
GO
