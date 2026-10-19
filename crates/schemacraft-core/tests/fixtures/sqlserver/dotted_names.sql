-- Dedicated identifier fixture: each pair has the same unescaped dotted spelling.
IF DB_ID('SchemaCraftDottedNames') IS NOT NULL
BEGIN
    ALTER DATABASE SchemaCraftDottedNames SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SchemaCraftDottedNames;
END
GO
CREATE DATABASE SchemaCraftDottedNames;
GO
USE SchemaCraftDottedNames;
GO
CREATE SCHEMA [a.b];
GO
CREATE SCHEMA [a];
GO
CREATE TABLE dbo.Parents (Id int NOT NULL PRIMARY KEY);
CREATE TABLE [a.b].[c] (
    SchemaParentId int NOT NULL,
    CONSTRAINT [FK.Shared] FOREIGN KEY (SchemaParentId) REFERENCES dbo.Parents (Id)
);
CREATE TABLE [a].[b.c] (
    ObjectParentId int NOT NULL,
    CONSTRAINT [FK.Shared] FOREIGN KEY (ObjectParentId) REFERENCES dbo.Parents (Id)
);
GO
CREATE VIEW [a.b].[v] AS SELECT SchemaParentId FROM [a.b].[c];
GO
CREATE VIEW [a].[b.v] AS SELECT ObjectParentId FROM [a].[b.c];
GO
CREATE PROCEDURE [a.b].[run] AS SELECT 1 AS SchemaSide;
GO
CREATE PROCEDURE [a].[b.run] AS SELECT 2 AS ObjectSide;
GO
CREATE TRIGGER [a.b].[TR.Shared] ON [a.b].[c] AFTER INSERT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @schemaSide int = 1;
END;
GO
CREATE TRIGGER [a].[TR.Shared] ON [a].[b.c] INSTEAD OF INSERT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @objectSide int = 2;
END;
GO
