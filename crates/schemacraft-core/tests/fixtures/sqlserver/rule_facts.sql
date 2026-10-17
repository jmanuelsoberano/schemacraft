-- Scratch tables for the engine behaviour that the rule reader's sentences rely on.
-- Appended to the script generated from check_forms.json, after `USE SchemaCraftCheckForms`,
-- by tests/sqlserver_integration.rs; the tests add the rows themselves.
CREATE SCHEMA facts;
GO
-- CHECK semantics. Each test row sets one column and leaves the others NULL.
CREATE TABLE facts.CheckedValues (
    ValueId int NOT NULL CONSTRAINT PK_CheckedValues PRIMARY KEY,
    Rating tinyint NULL CONSTRAINT CK_CheckedValues_Rating CHECK (Rating BETWEEN 1 AND 5),
    Status char(1) NULL CONSTRAINT CK_CheckedValues_Status CHECK (Status IN ('A', NULL)),
    Currency char(3) NULL CONSTRAINT CK_CheckedValues_Currency CHECK (Currency NOT IN ('XXX', NULL)),
    Code varchar(10) NULL CONSTRAINT CK_CheckedValues_Code CHECK (Code <> ''),
    Name varchar(10) NULL CONSTRAINT CK_CheckedValues_Name CHECK (LEN(Name) > 0),
    Suffix varchar(10) NULL CONSTRAINT CK_CheckedValues_Suffix CHECK (Suffix LIKE '%-X'),
    Digits varchar(10) NULL CONSTRAINT CK_CheckedValues_Digits CHECK (Digits NOT LIKE '%[^0-9]%'),
    UnicodeSuffix nvarchar(10) NULL
        CONSTRAINT CK_CheckedValues_UnicodeSuffix CHECK (UnicodeSuffix LIKE N'%-X'),
    NationalSuffix varchar(10) NULL
        CONSTRAINT CK_CheckedValues_NationalSuffix CHECK (NationalSuffix LIKE N'%-X'),
    FixedDigits char(5) NULL
        CONSTRAINT CK_CheckedValues_FixedDigits CHECK (FixedDigits NOT LIKE '%[^0-9]%'),
    -- LIKE on char and nchar, which pad a shorter value with spaces up to their length.
    FixedSuffix char(10) NULL CONSTRAINT CK_CheckedValues_FixedSuffix CHECK (FixedSuffix LIKE '%-X'),
    FixedUnicodeSuffix nchar(10) NULL
        CONSTRAINT CK_CheckedValues_FixedUnicodeSuffix CHECK (FixedUnicodeSuffix LIKE '%-X'),
    FixedNationalSuffix char(10) NULL
        CONSTRAINT CK_CheckedValues_FixedNationalSuffix CHECK (FixedNationalSuffix LIKE N'%-X'),
    FixedPrefix nchar(10) NULL CONSTRAINT CK_CheckedValues_FixedPrefix CHECK (FixedPrefix LIKE N'AB%'),
    FixedLetters char(5) NULL
        CONSTRAINT CK_CheckedValues_FixedLetters CHECK (FixedLetters LIKE '[A-Z][A-Z]'),
    FixedUnicodeLetters nchar(5) NULL
        CONSTRAINT CK_CheckedValues_FixedUnicodeLetters CHECK (FixedUnicodeLetters LIKE N'[A-Z][A-Z]'),
    FixedPair char(5) NULL CONSTRAINT CK_CheckedValues_FixedPair CHECK (FixedPair LIKE 'A_'),
    FixedNotPair char(5) NULL CONSTRAINT CK_CheckedValues_FixedNotPair CHECK (FixedNotPair NOT LIKE 'A_'),
    FixedUnicodeNotPair nchar(5) NULL
        CONSTRAINT CK_CheckedValues_FixedUnicodeNotPair CHECK (FixedUnicodeNotPair NOT LIKE N'A_'),
    VariablePair varchar(5) NULL
        CONSTRAINT CK_CheckedValues_VariablePair CHECK (VariablePair LIKE 'A_'),
    UnicodeLetter nvarchar(5) NULL
        CONSTRAINT CK_CheckedValues_UnicodeLetter CHECK (UnicodeLetter IN (N'A', N'B')),
    Letter char(1) COLLATE Latin1_General_CI_AS NULL
        CONSTRAINT CK_CheckedValues_Letter CHECK (Letter IN ('A', 'B')),
    CaseSensitiveLetter char(1) COLLATE Latin1_General_CS_AS NULL
        CONSTRAINT CK_CheckedValues_CaseSensitiveLetter CHECK (CaseSensitiveLetter IN ('A', 'B')),
    LoggedAt datetime NULL CONSTRAINT CK_CheckedValues_LoggedAt CHECK (LoggedAt >= '2000-02-01'),
    Quantity int NULL CONSTRAINT CK_CheckedValues_Quantity CHECK (Quantity > 0)
);
GO
ALTER TABLE facts.CheckedValues NOCHECK CONSTRAINT CK_CheckedValues_Quantity;
GO
-- Foreign key actions. The identity key cannot be updated, so ON UPDATE actions only run
-- through Code.
CREATE TABLE facts.Parents (
    ParentId int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Parents PRIMARY KEY,
    Code char(2) NOT NULL CONSTRAINT UQ_Parents_Code UNIQUE
);
GO
-- One child table per behaviour: SQL Server refuses two cascading paths into one table.
CREATE TABLE facts.NoActionChildren (
    ChildId int NOT NULL CONSTRAINT PK_NoActionChildren PRIMARY KEY,
    ParentCode char(2) NOT NULL CONSTRAINT FK_NoActionChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code)
);
GO
CREATE TABLE facts.CascadeChildren (
    ChildId int NOT NULL CONSTRAINT PK_CascadeChildren PRIMARY KEY,
    ParentCode char(2) NOT NULL CONSTRAINT FK_CascadeChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code) ON DELETE CASCADE ON UPDATE CASCADE
);
GO
CREATE TABLE facts.SetNullChildren (
    ChildId int NOT NULL CONSTRAINT PK_SetNullChildren PRIMARY KEY,
    ParentCode char(2) NULL CONSTRAINT FK_SetNullChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code) ON DELETE SET NULL ON UPDATE SET NULL
);
GO
CREATE TABLE facts.SetDefaultChildren (
    ChildId int NOT NULL CONSTRAINT PK_SetDefaultChildren PRIMARY KEY,
    ParentCode char(2) NULL CONSTRAINT DF_SetDefaultChildren_ParentCode DEFAULT ('P0')
        CONSTRAINT FK_SetDefaultChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code) ON DELETE SET DEFAULT
);
GO
-- SET DEFAULT on a column without a DEFAULT.
CREATE TABLE facts.NoDefaultChildren (
    ChildId int NOT NULL CONSTRAINT PK_NoDefaultChildren PRIMARY KEY,
    ParentCode char(2) NULL CONSTRAINT FK_NoDefaultChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code) ON DELETE SET DEFAULT
);
GO
CREATE TABLE facts.DisabledChildren (
    ChildId int NOT NULL CONSTRAINT PK_DisabledChildren PRIMARY KEY,
    ParentCode char(2) NOT NULL CONSTRAINT FK_DisabledChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code) ON DELETE CASCADE
);
GO
ALTER TABLE facts.DisabledChildren NOCHECK CONSTRAINT FK_DisabledChildren_Parents;
GO
-- No key yet: the test adds a row whose parent row does not exist, as a disabled key lets in,
-- then the key the way the reader scripts a disabled one.
CREATE TABLE facts.UncheckedChildren (
    ChildId int NOT NULL CONSTRAINT PK_UncheckedChildren PRIMARY KEY,
    ParentCode char(2) NOT NULL
);
GO
-- A unique index with a filter does not make the key one-to-one.
CREATE TABLE facts.FilteredChildren (
    ChildId int NOT NULL CONSTRAINT PK_FilteredChildren PRIMARY KEY,
    ParentCode char(2) NOT NULL CONSTRAINT FK_FilteredChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code),
    IsCurrent bit NOT NULL
);
GO
CREATE UNIQUE INDEX UX_FilteredChildren_Current ON facts.FilteredChildren (ParentCode)
    WHERE IsCurrent = 1;
GO
-- Nor does a unique constraint whose index is disabled.
CREATE TABLE facts.DisabledUniqueChildren (
    ChildId int NOT NULL CONSTRAINT PK_DisabledUniqueChildren PRIMARY KEY,
    ParentCode char(2) NOT NULL CONSTRAINT FK_DisabledUniqueChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code)
        CONSTRAINT UQ_DisabledUniqueChildren_ParentCode UNIQUE
);
GO
ALTER INDEX UQ_DisabledUniqueChildren_ParentCode ON facts.DisabledUniqueChildren DISABLE;
GO
-- Two keys to the same table, one of them cascading: NO ACTION is checked once the statement,
-- cascades included, has run.
CREATE TABLE facts.OwnedChildren (
    ChildId int NOT NULL CONSTRAINT PK_OwnedChildren PRIMARY KEY,
    ParentCode char(2) NOT NULL CONSTRAINT FK_OwnedChildren_Parents
        FOREIGN KEY REFERENCES facts.Parents (Code),
    OwnerCode char(2) NOT NULL CONSTRAINT FK_OwnedChildren_Owners
        FOREIGN KEY REFERENCES facts.Parents (Code) ON DELETE CASCADE
);
GO
-- A composite key where one referencing column is nullable.
CREATE TABLE facts.Pairs (
    PairA int NOT NULL,
    PairB int NOT NULL,
    CONSTRAINT PK_Pairs PRIMARY KEY (PairA, PairB)
);
GO
CREATE TABLE facts.PairChildren (
    ChildId int NOT NULL CONSTRAINT PK_PairChildren PRIMARY KEY,
    PairA int NOT NULL,
    PairB int NULL,
    CONSTRAINT FK_PairChildren_Pairs FOREIGN KEY (PairA, PairB) REFERENCES facts.Pairs (PairA, PairB)
);
GO
-- A self-reference.
CREATE TABLE facts.Nodes (
    NodeId int NOT NULL CONSTRAINT PK_Nodes PRIMARY KEY,
    ParentNodeId int NULL CONSTRAINT FK_Nodes_Parent FOREIGN KEY REFERENCES facts.Nodes (NodeId)
);
GO
