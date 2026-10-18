-- SchemaCraft capability probe, version 1.
--
-- Measures what SchemaCraft would read from the current database and returns numbers only, so
-- that the result can be shared when the database cannot. Open the script with the database to
-- measure as the current database and run it (F5 in SSMS, or Execute Query in the MSSQL
-- extension for Visual Studio Code), or with sqlcmd:
--   sqlcmd -S <server> -d <database> -U <login> -i capability-probe.sql -s "," -W -r1 > <folder outside the repository>\probe.csv
-- Write the result outside the repository: it describes the measured database.
-- -r1 sends sqlcmd's messages, which can name the server, the database or the login, to the
-- screen and only the result to the file; with -o they would land in the file:
-- https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-utility
-- If sqlcmd prints anything, the run failed: share nothing.
-- Run it with the login SchemaCraft connects with: every count is what that login can see.
--
-- What it returns: one result set of rows (section, metric, value). Section and metric are labels
-- written in this script, and value is a bigint: a count, a sum or maximum of DATALENGTH in bytes,
-- a server property as a number, milliseconds, or a capability as 1 (yes), 0 (no) or -1 (the
-- server did not answer). No name of any object, schema, column, parameter, principal, login,
-- database, collation, server or file is returned, and neither is any definition text: the
-- script reads names and texts on the server only to turn them into numbers, by measuring their
-- size in bytes, checking a permission, comparing them with a fixed word or pattern, or counting
-- them. Type codes become labels through fixed lists. A section that fails returns only the
-- number of its error, as the metric error_number, never the message.
--
-- What it does: SELECT statements on catalog views and system functions that fill the table
-- variable below, under a lock timeout of 5 seconds, then one SELECT of that variable. It reads no
-- table data, calls no procedure, changes nothing on the server, writes no file and is one batch
-- without GO.
--
-- Text scan: with @scan_text = 1, SQL Server searches the text of the views, procedures,
-- functions and triggers this login can read for credential-like words and dynamic SQL, and the
-- section text returns how many modules match each pattern. No text leaves the server. To skip
-- the scan, change the 1 below to 0.
DECLARE @scan_text bit = 1;

SET NOCOUNT ON;
-- A catalog query that waits longer than 5 seconds for a lock fails its section with error 1222
-- instead of waiting: https://learn.microsoft.com/en-us/sql/t-sql/statements/set-lock-timeout-transact-sql
-- Another session's uncommitted schema change, such as an open transaction that created or
-- altered any object in this database, holds such locks until it ends and can fail most
-- sections. If sections return error_number 1222, run the probe again once that transaction has
-- committed or rolled back.
SET LOCK_TIMEOUT 5000;

DECLARE @result TABLE (
    row_id int IDENTITY(1, 1) NOT NULL PRIMARY KEY,
    section nvarchar(32) NOT NULL,
    metric nvarchar(64) NOT NULL,
    value bigint NOT NULL
);
DECLARE @started datetime2(7) = SYSDATETIME();
DECLARE @mark datetime2(7);
DECLARE @sink bigint;
DECLARE @me int = DATABASE_PRINCIPAL_ID();

INSERT INTO @result (section, metric, value)
VALUES (N'probe', N'version', 1),
       (N'probe', N'scan_text', CASE WHEN @scan_text = 1 THEN 1 ELSE 0 END);

-- Server and database. SERVERPROPERTY answers NULL for a property the version does not know:
-- https://learn.microsoft.com/en-us/sql/t-sql/functions/serverproperty-transact-sql
-- ComparisonStyle is a bit mask; 1 ignores case and 2 ignores accents:
-- https://learn.microsoft.com/en-us/sql/t-sql/functions/collation-functions-collationproperty-transact-sql
-- product_update_level is the number of the cumulative update (CU), 0 without one and -1 for any
-- other answer.
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'server', facts.metric, facts.value
    FROM (
        SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS int) AS major_version,
               CAST(SERVERPROPERTY('ProductMinorVersion') AS int) AS minor_version,
               CAST(SERVERPROPERTY('ProductBuild') AS int) AS build,
               CAST(SERVERPROPERTY('ProductUpdateLevel') AS nvarchar(128)) AS update_level,
               CAST(SERVERPROPERTY('EngineEdition') AS int) AS engine_edition,
               CAST(d.compatibility_level AS int) AS compatibility_level,
               CAST(COLLATIONPROPERTY(d.collation_name, 'ComparisonStyle') AS int) AS comparison_style,
               (SELECT CAST(c.value_in_use AS int)
                FROM sys.configurations AS c
                WHERE c.name = N'clr enabled') AS clr_enabled
        FROM sys.databases AS d
        WHERE d.database_id = DB_ID()
    ) AS p
    CROSS APPLY (VALUES
        (1, N'product_major_version', ISNULL(p.major_version, -1)),
        (2, N'product_minor_version', ISNULL(p.minor_version, -1)),
        (3, N'product_build', ISNULL(p.build, -1)),
        (4, N'product_update_level',
            CASE WHEN p.update_level IS NULL THEN 0
                 WHEN p.update_level LIKE N'CU[0-9]%'
                      AND SUBSTRING(p.update_level, 3, 10) NOT LIKE N'%[^0-9]%'
                     THEN CAST(SUBSTRING(p.update_level, 3, 10) AS int)
                 ELSE -1 END),
        (5, N'engine_edition', ISNULL(p.engine_edition, -1)),
        (6, N'compatibility_level', ISNULL(p.compatibility_level, -1)),
        (7, N'case_insensitive', ISNULL(p.comparison_style & 1, -1)),
        (8, N'accent_insensitive', ISNULL((p.comparison_style & 2) / 2, -1)),
        (9, N'clr_enabled', ISNULL(p.clr_enabled, -1))
    ) AS facts (position, metric, value)
    ORDER BY facts.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'server', N'error_number', ERROR_NUMBER());
END CATCH;

-- Permissions of this login in this database, as SchemaCraft's access probe reads them.
-- HAS_PERMS_BY_NAME answers NULL (here -1) for a permission the version does not know, such as
-- VIEW SECURITY DEFINITION before SQL Server 2022:
-- https://learn.microsoft.com/en-us/sql/t-sql/functions/has-perms-by-name-transact-sql
-- Denials are counted for the login's user and its roles at the database, schema and object
-- level, and never for dbo, to which SQL Server applies none. The schemas are those
-- SchemaCraft lists, plus any holding an object; code_only_schemas hold procedures or functions
-- and no table or view. expression_dependencies_select is SELECT on
-- sys.sql_expression_dependencies, which that view also needs besides VIEW DEFINITION:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-sql-expression-dependencies-transact-sql
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'access', facts.metric, facts.value
    FROM (
        SELECT HAS_PERMS_BY_NAME(NULL, N'DATABASE', N'VIEW DEFINITION') AS view_definition,
               HAS_PERMS_BY_NAME(NULL, N'DATABASE', N'SELECT') AS select_permission,
               HAS_PERMS_BY_NAME(NULL, N'DATABASE', N'VIEW SECURITY DEFINITION') AS view_security_definition,
               IS_ROLEMEMBER(N'db_owner') AS db_owner,
               HAS_PERMS_BY_NAME(N'sys.sql_expression_dependencies', N'OBJECT', N'SELECT') AS dependencies_select,
               (SELECT COUNT_BIG(*)
                FROM sys.database_permissions AS dp
                WHERE @me <> 1 AND dp.state = 'D'
                  AND (dp.class IN (0, 3) OR (dp.class = 1 AND dp.minor_id = 0))
                  AND dp.permission_name IN (N'VIEW DEFINITION', N'SELECT', N'CONTROL')
                  AND (dp.grantee_principal_id = @me
                       OR IS_MEMBER(USER_NAME(dp.grantee_principal_id)) = 1)) AS denials,
               (SELECT COUNT_BIG(*)
                FROM sys.database_permissions AS dp
                WHERE @me <> 1 AND dp.state = 'D'
                  AND (dp.class IN (0, 3) OR (dp.class = 1 AND dp.minor_id = 0))
                  AND dp.permission_name = N'EXECUTE'
                  AND (dp.grantee_principal_id = @me
                       OR IS_MEMBER(USER_NAME(dp.grantee_principal_id)) = 1)) AS execute_denials
    ) AS p
    CROSS JOIN (
        SELECT COUNT_BIG(*) AS schemas,
               ISNULL(SUM(per_schema.view_definition), 0) AS with_view_definition,
               ISNULL(SUM(per_schema.select_permission), 0) AS with_select,
               ISNULL(SUM(per_schema.denied), 0) AS denied,
               ISNULL(SUM(per_schema.code_only), 0) AS code_only
        FROM (
            SELECT CASE WHEN HAS_PERMS_BY_NAME(QUOTENAME(s.name), N'SCHEMA', N'VIEW DEFINITION') = 1
                        THEN 1 ELSE 0 END AS view_definition,
                   CASE WHEN HAS_PERMS_BY_NAME(QUOTENAME(s.name), N'SCHEMA', N'SELECT') = 1
                        THEN 1 ELSE 0 END AS select_permission,
                   CASE WHEN @me <> 1
                             AND EXISTS (SELECT 1 FROM sys.database_permissions AS dp
                                         WHERE dp.class = 3 AND dp.major_id = s.schema_id
                                           AND dp.state = 'D'
                                           AND dp.permission_name IN (N'VIEW DEFINITION', N'SELECT', N'CONTROL')
                                           AND (dp.grantee_principal_id = @me
                                                OR IS_MEMBER(USER_NAME(dp.grantee_principal_id)) = 1))
                        THEN 1 ELSE 0 END AS denied,
                   CASE WHEN EXISTS (SELECT 1 FROM sys.objects AS o
                                     WHERE o.schema_id = s.schema_id AND o.is_ms_shipped = 0
                                       AND o.type IN ('P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF'))
                             AND NOT EXISTS (SELECT 1 FROM sys.objects AS o
                                             WHERE o.schema_id = s.schema_id AND o.is_ms_shipped = 0
                                               AND o.type IN ('U', 'V'))
                        THEN 1 ELSE 0 END AS code_only
            FROM sys.schemas AS s
            WHERE s.schema_id NOT IN (3, 4)
              AND ((s.schema_id <> 2 AND s.schema_id < 16384)
                   OR EXISTS (SELECT 1 FROM sys.objects AS o
                              WHERE o.schema_id = s.schema_id AND o.is_ms_shipped = 0))
        ) AS per_schema
    ) AS listed
    CROSS APPLY (VALUES
        (1, N'view_definition', ISNULL(p.view_definition, -1)),
        (2, N'select', ISNULL(p.select_permission, -1)),
        (3, N'view_security_definition', ISNULL(p.view_security_definition, -1)),
        (4, N'db_owner', ISNULL(p.db_owner, -1)),
        (5, N'denials', p.denials),
        (6, N'execute_denials', p.execute_denials),
        (7, N'schemas', listed.schemas),
        (8, N'schemas_with_view_definition', listed.with_view_definition),
        (9, N'schemas_with_select', listed.with_select),
        (10, N'schemas_denied', listed.denied),
        (11, N'code_only_schemas', listed.code_only),
        (12, N'expression_dependencies_select', ISNULL(p.dependencies_select, -1))
    ) AS facts (position, metric, value)
    ORDER BY facts.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'access', N'error_number', ERROR_NUMBER());
END CATCH;

-- Visible objects per sys.objects type code; other counts every remaining type except the
-- constraints of a table. Database DDL triggers are only in sys.triggers, with parent_class 0:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-objects-transact-sql
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-triggers-transact-sql
-- The sys.objects row of a table type (TT) is marked is_ms_shipped, so table types are counted in
-- sys.table_types:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-table-types-transact-sql
-- OBJECTPROPERTY answers NULL for TableIsMemoryOptimized before SQL Server 2014.
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'objects', listed.metric, listed.value
    FROM (
        SELECT kinds.position, kinds.code AS metric, ISNULL(found.objects, 0) AS value
        FROM (VALUES (1, N'U'), (2, N'V'), (3, N'P'), (4, N'PC'), (5, N'FN'), (6, N'FS'),
                     (7, N'IF'), (8, N'TF'), (9, N'FT'), (10, N'AF'), (11, N'TR'), (12, N'TA'),
                     (13, N'SN'), (14, N'SO')) AS kinds (position, code)
        LEFT JOIN (SELECT o.type, COUNT_BIG(*) AS objects
                   FROM sys.objects AS o
                   WHERE o.is_ms_shipped = 0
                   GROUP BY o.type) AS found ON found.type = kinds.code
        UNION ALL
        SELECT 15, N'TT', COUNT_BIG(*)
        FROM sys.table_types AS tt
        WHERE tt.is_user_defined = 1
        UNION ALL
        SELECT 16, N'other', COUNT_BIG(*)
        FROM sys.objects AS o
        WHERE o.is_ms_shipped = 0
          AND o.type NOT IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF', 'TR', 'TA',
                             'SN', 'SO', 'TT')
          AND NOT (o.type IN ('C', 'D', 'EC', 'F', 'PK', 'UQ') AND o.parent_object_id <> 0)
        UNION ALL
        SELECT 17, N'ddl_triggers', COUNT_BIG(*)
        FROM sys.triggers AS t
        WHERE t.parent_class = 0 AND t.is_ms_shipped = 0
        UNION ALL
        SELECT 18, N'memory_optimized_tables', COUNT_BIG(*)
        FROM sys.tables AS t
        WHERE t.is_ms_shipped = 0 AND OBJECTPROPERTY(t.object_id, 'TableIsMemoryOptimized') = 1
        UNION ALL
        SELECT 19, N'partitioned_tables', COUNT_BIG(DISTINCT i.object_id)
        FROM sys.indexes AS i
        JOIN sys.tables AS t ON t.object_id = i.object_id AND t.is_ms_shipped = 0
        JOIN sys.data_spaces AS ds ON ds.data_space_id = i.data_space_id
        WHERE i.index_id IN (0, 1) AND ds.type = 'PS'
    ) AS listed
    ORDER BY listed.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'objects', N'error_number', ERROR_NUMBER());
END CATCH;

-- Module texts per kind, as metric <kind>.<measure>. A text is NULL when the module is encrypted
-- or the login lacks VIEW DEFINITION on it; OBJECTPROPERTY IsEncrypted tells the two apart:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-sql-modules-transact-sql
-- https://learn.microsoft.com/en-us/sql/t-sql/functions/objectproperty-transact-sql
-- Sizes are DATALENGTH in bytes, two per character:
-- https://learn.microsoft.com/en-us/sql/t-sql/functions/datalength-transact-sql
-- with_cr counts texts holding a carriage return, with_trailing_space texts with a space or a tab
-- right before a line end; these look at line ends only and run whatever @scan_text says. TR is
-- the DML triggers.
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'modules', kinds.code + N'.' + measures.measure, measures.value
    FROM (VALUES (1, N'V'), (2, N'P'), (3, N'FN'), (4, N'IF'), (5, N'TF'), (6, N'TR'))
         AS kinds (position, code)
    OUTER APPLY (
        SELECT COUNT_BIG(*) AS modules,
               ISNULL(SUM(CASE WHEN m.definition IS NOT NULL THEN 1 ELSE 0 END), 0) AS readable,
               ISNULL(SUM(CASE WHEN m.definition IS NULL
                                    AND OBJECTPROPERTY(o.object_id, 'IsEncrypted') = 1
                               THEN 1 ELSE 0 END), 0) AS encrypted,
               ISNULL(SUM(CASE WHEN m.definition IS NULL
                                    AND ISNULL(OBJECTPROPERTY(o.object_id, 'IsEncrypted'), 0) <> 1
                               THEN 1 ELSE 0 END), 0) AS not_visible,
               ISNULL(SUM(ISNULL(CAST(DATALENGTH(m.definition) AS bigint), 0)), 0) AS bytes_total,
               ISNULL(MAX(ISNULL(CAST(DATALENGTH(m.definition) AS bigint), 0)), 0) AS bytes_max,
               ISNULL(SUM(CASE WHEN DATALENGTH(m.definition) > 131072 THEN 1 ELSE 0 END), 0) AS over_128kb,
               ISNULL(SUM(CASE WHEN DATALENGTH(m.definition) > 262144 THEN 1 ELSE 0 END), 0) AS over_256kb,
               ISNULL(SUM(CASE WHEN CHARINDEX(NCHAR(13), m.definition COLLATE Latin1_General_BIN2) > 0
                               THEN 1 ELSE 0 END), 0) AS with_cr,
               ISNULL(SUM(CASE WHEN CHARINDEX(N' ' + NCHAR(13), m.definition COLLATE Latin1_General_BIN2) > 0
                                 OR CHARINDEX(N' ' + NCHAR(10), m.definition COLLATE Latin1_General_BIN2) > 0
                                 OR CHARINDEX(NCHAR(9) + NCHAR(13), m.definition COLLATE Latin1_General_BIN2) > 0
                                 OR CHARINDEX(NCHAR(9) + NCHAR(10), m.definition COLLATE Latin1_General_BIN2) > 0
                               THEN 1 ELSE 0 END), 0) AS with_trailing_space
        FROM sys.objects AS o
        LEFT JOIN sys.sql_modules AS m ON m.object_id = o.object_id
        WHERE o.is_ms_shipped = 0 AND o.type = kinds.code
    ) AS stats
    CROSS APPLY (VALUES
        (1, N'modules', stats.modules),
        (2, N'readable', stats.readable),
        (3, N'encrypted', stats.encrypted),
        (4, N'not_visible', stats.not_visible),
        (5, N'bytes_total', stats.bytes_total),
        (6, N'bytes_max', stats.bytes_max),
        (7, N'over_128kb', stats.over_128kb),
        (8, N'over_256kb', stats.over_256kb),
        (9, N'with_cr', stats.with_cr),
        (10, N'with_trailing_space', stats.with_trailing_space)
    ) AS measures (position, measure, value)
    ORDER BY kinds.position, measures.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'modules', N'error_number', ERROR_NUMBER());
END CATCH;

-- Text scan, counted in modules, never in occurrences or excerpts. The texts are compared case
-- and accent insensitive; the assignments and EXEC( are looked for with spaces, tabs and line
-- breaks removed. In LIKE, [_] stands for the underscore itself.
IF @scan_text = 1
BEGIN
    BEGIN TRY
        SET @mark = SYSDATETIME();
        INSERT INTO @result (section, metric, value)
        SELECT N'text', measures.measure, measures.value
        FROM (
            SELECT COUNT_BIG(*) AS modules,
                   ISNULL(SUM(CASE WHEN scanned.body LIKE N'%password%' OR scanned.body LIKE N'%passwd%'
                                     OR scanned.body LIKE N'%pwd%'
                                   THEN 1 ELSE 0 END), 0) AS password_words,
                   ISNULL(SUM(CASE WHEN scanned.squeezed LIKE N'%pwd=%' OR scanned.squeezed LIKE N'%password=%'
                                   THEN 1 ELSE 0 END), 0) AS password_assignments,
                   ISNULL(SUM(CASE WHEN scanned.body LIKE N'%openrowset%' OR scanned.body LIKE N'%opendatasource%'
                                   THEN 1 ELSE 0 END), 0) AS external_data,
                   ISNULL(SUM(CASE WHEN scanned.body LIKE N'%sp[_]addlinkedsrvlogin%'
                                   THEN 1 ELSE 0 END), 0) AS linked_server_logins,
                   ISNULL(SUM(CASE WHEN scanned.body LIKE N'%sp[_]executesql%'
                                   THEN 1 ELSE 0 END), 0) AS dynamic_sql,
                   ISNULL(SUM(CASE WHEN scanned.squeezed LIKE N'%exec(%' OR scanned.squeezed LIKE N'%execute(%'
                                   THEN 1 ELSE 0 END), 0) AS exec_string
            FROM sys.objects AS o
            JOIN sys.sql_modules AS m ON m.object_id = o.object_id
            CROSS APPLY (
                SELECT m.definition COLLATE Latin1_General_CI_AI AS body,
                       REPLACE(REPLACE(REPLACE(REPLACE(m.definition COLLATE Latin1_General_BIN2,
                           N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')
                           COLLATE Latin1_General_CI_AI AS squeezed
            ) AS scanned
            WHERE o.is_ms_shipped = 0 AND o.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR')
              AND m.definition IS NOT NULL
        ) AS found
        CROSS APPLY (VALUES
            (1, N'modules_scanned', found.modules),
            (2, N'password_words', found.password_words),
            (3, N'password_assignments', found.password_assignments),
            (4, N'openrowset_or_opendatasource', found.external_data),
            (5, N'sp_addlinkedsrvlogin', found.linked_server_logins),
            (6, N'sp_executesql', found.dynamic_sql),
            (7, N'exec_string', found.exec_string)
        ) AS measures (position, measure, value)
        ORDER BY measures.position;
        INSERT INTO @result (section, metric, value)
        VALUES (N'text', N'elapsed_ms', DATEDIFF(millisecond, @mark, SYSDATETIME()));
    END TRY
    BEGIN CATCH
        INSERT INTO @result (section, metric, value) VALUES (N'text', N'error_number', ERROR_NUMBER());
    END CATCH;
END;

-- DML triggers. First and Last marks are per event in sys.trigger_events and apply to AFTER
-- triggers only; a view can carry INSTEAD OF triggers only:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-trigger-events-transact-sql
-- https://learn.microsoft.com/en-us/sql/t-sql/statements/create-trigger-transact-sql
-- tables_with_several_after_per_event counts tables with two or more AFTER triggers, enabled or
-- not, for one of INSERT, UPDATE or DELETE.
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'triggers', facts.metric, facts.value
    FROM (
        SELECT ISNULL(SUM(CASE WHEN parent.type = 'U' THEN 1 ELSE 0 END), 0) AS on_tables,
               ISNULL(SUM(CASE WHEN parent.type = 'V' THEN 1 ELSE 0 END), 0) AS on_views,
               ISNULL(SUM(CASE WHEN t.is_instead_of_trigger = 1 THEN 1 ELSE 0 END), 0) AS instead_of,
               ISNULL(SUM(CASE WHEN t.is_disabled = 1 THEN 1 ELSE 0 END), 0) AS disabled,
               ISNULL(SUM(CASE WHEN t.is_not_for_replication = 1 THEN 1 ELSE 0 END), 0) AS not_for_replication,
               ISNULL(SUM(CASE WHEN t.type = 'TA' THEN 1 ELSE 0 END), 0) AS clr
        FROM sys.triggers AS t
        JOIN sys.objects AS parent ON parent.object_id = t.parent_id
        WHERE t.parent_class = 1 AND t.is_ms_shipped = 0
    ) AS dml
    CROSS JOIN (
        SELECT ISNULL(SUM(per_object.with_first), 0) AS with_first,
               ISNULL(SUM(per_object.with_last), 0) AS with_last
        FROM (SELECT MAX(CASE WHEN e.is_first = 1 THEN 1 ELSE 0 END) AS with_first,
                     MAX(CASE WHEN e.is_last = 1 THEN 1 ELSE 0 END) AS with_last
              FROM sys.trigger_events AS e
              JOIN sys.triggers AS t ON t.object_id = e.object_id
              WHERE t.parent_class = 1 AND t.is_ms_shipped = 0
              GROUP BY t.parent_id) AS per_object
    ) AS marks
    CROSS JOIN (
        SELECT COUNT_BIG(*) AS objects,
               ISNULL(MAX(per_object.triggers), 0) AS max_per_object,
               ISNULL(SUM(CASE WHEN per_object.enabled > 0 AND per_object.disabled > 0
                               THEN 1 ELSE 0 END), 0) AS mixing_states
        FROM (SELECT t.parent_id, COUNT_BIG(*) AS triggers,
                     SUM(CASE WHEN t.is_disabled = 0 THEN 1 ELSE 0 END) AS enabled,
                     SUM(CASE WHEN t.is_disabled = 1 THEN 1 ELSE 0 END) AS disabled
              FROM sys.triggers AS t
              WHERE t.parent_class = 1 AND t.is_ms_shipped = 0
              GROUP BY t.parent_id) AS per_object
    ) AS objects
    CROSS JOIN (
        SELECT COUNT_BIG(DISTINCT per_event.parent_id) AS tables
        FROM (SELECT t.parent_id
              FROM sys.trigger_events AS e
              JOIN sys.triggers AS t ON t.object_id = e.object_id
              JOIN sys.objects AS parent ON parent.object_id = t.parent_id AND parent.type = 'U'
              WHERE t.parent_class = 1 AND t.is_ms_shipped = 0 AND t.is_instead_of_trigger = 0
              GROUP BY t.parent_id, e.type
              HAVING COUNT_BIG(*) >= 2) AS per_event
    ) AS several
    CROSS APPLY (VALUES
        (1, N'dml_on_tables', dml.on_tables),
        (2, N'dml_on_views', dml.on_views),
        (3, N'instead_of', dml.instead_of),
        (4, N'disabled', dml.disabled),
        (5, N'not_for_replication', dml.not_for_replication),
        (6, N'clr', dml.clr),
        (7, N'objects_with_first', marks.with_first),
        (8, N'objects_with_last', marks.with_last),
        (9, N'objects_with_triggers', objects.objects),
        (10, N'max_per_object', objects.max_per_object),
        (11, N'objects_mixing_states', objects.mixing_states),
        (12, N'tables_with_several_after_per_event', several.tables)
    ) AS facts (position, metric, value)
    ORDER BY facts.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'triggers', N'error_number', ERROR_NUMBER());
END CATCH;

-- Views: WITH CHECK OPTION, and indexed views, whose clustered index has index_id 1:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-views-transact-sql
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'views', facts.metric, facts.value
    FROM (
        SELECT ISNULL(SUM(per_view.with_check_option), 0) AS with_check_option,
               ISNULL(SUM(per_view.indexed), 0) AS indexed
        FROM (SELECT CASE WHEN v.with_check_option = 1 THEN 1 ELSE 0 END AS with_check_option,
                     CASE WHEN EXISTS (SELECT 1 FROM sys.indexes AS i
                                       WHERE i.object_id = v.object_id AND i.index_id = 1)
                          THEN 1 ELSE 0 END AS indexed
              FROM sys.views AS v
              WHERE v.is_ms_shipped = 0) AS per_view
    ) AS p
    CROSS APPLY (VALUES
        (1, N'with_check_option', p.with_check_option),
        (2, N'indexed', p.indexed)
    ) AS facts (position, metric, value)
    ORDER BY facts.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'views', N'error_number', ERROR_NUMBER());
END CATCH;

-- Procedures and functions. parameter_id 0 is the return value of a scalar function:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-parameters-transact-sql
-- A parameter whose type this login cannot see has a user-defined type, since every system type
-- is visible. The result columns of table functions are in sys.columns.
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'routines', facts.metric, facts.value
    FROM (
        SELECT COUNT_BIG(*) AS parameters,
               ISNULL(SUM(CASE WHEN p.is_output = 1 THEN 1 ELSE 0 END), 0) AS output_parameters,
               ISNULL(SUM(CASE WHEN p.is_readonly = 1 THEN 1 ELSE 0 END), 0) AS readonly_parameters,
               ISNULL(SUM(CASE WHEN ISNULL(ty.is_user_defined, 1) = 1 THEN 1 ELSE 0 END), 0) AS user_type_parameters
        FROM sys.parameters AS p
        JOIN sys.objects AS o ON o.object_id = p.object_id
        LEFT JOIN sys.types AS ty ON ty.user_type_id = p.user_type_id
        WHERE o.is_ms_shipped = 0 AND o.type IN ('P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF')
          AND p.parameter_id > 0
    ) AS params
    CROSS JOIN (
        SELECT ISNULL(MAX(per_routine.parameters), 0) AS max_per_routine
        FROM (SELECT COUNT_BIG(*) AS parameters
              FROM sys.parameters AS p
              JOIN sys.objects AS o ON o.object_id = p.object_id
              WHERE o.is_ms_shipped = 0 AND o.type IN ('P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF')
                AND p.parameter_id > 0
              GROUP BY p.object_id) AS per_routine
    ) AS widest
    CROSS JOIN (
        SELECT COUNT_BIG(*) AS scalar_returns
        FROM sys.parameters AS p
        JOIN sys.objects AS o ON o.object_id = p.object_id
        WHERE o.is_ms_shipped = 0 AND o.type IN ('FN', 'FS') AND p.parameter_id = 0
    ) AS scalar
    CROSS JOIN (
        SELECT COUNT_BIG(*) AS columns
        FROM sys.columns AS c
        JOIN sys.objects AS o ON o.object_id = c.object_id
        WHERE o.is_ms_shipped = 0 AND o.type IN ('IF', 'TF', 'FT')
    ) AS function_columns
    CROSS JOIN (
        SELECT ISNULL(MAX(per_schema.routines), 0) AS max_per_schema
        FROM (SELECT COUNT_BIG(*) AS routines
              FROM sys.objects AS o
              WHERE o.is_ms_shipped = 0 AND o.type IN ('P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF')
              GROUP BY o.schema_id) AS per_schema
    ) AS schemas
    CROSS APPLY (VALUES
        (1, N'parameters', params.parameters),
        (2, N'max_parameters_per_routine', widest.max_per_routine),
        (3, N'output_parameters', params.output_parameters),
        (4, N'readonly_parameters', params.readonly_parameters),
        (5, N'user_type_parameters', params.user_type_parameters),
        (6, N'scalar_returns', scalar.scalar_returns),
        (7, N'table_function_columns', function_columns.columns),
        (8, N'max_routines_per_schema', schemas.max_per_schema)
    ) AS facts (position, metric, value)
    ORDER BY facts.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'routines', N'error_number', ERROR_NUMBER());
END CATCH;

-- Indexes of tables and views, per type code, then their state:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-indexes-transact-sql
-- A partition column that is neither a key nor an included column comes back with key_ordinal 0
-- and is_included_column 0:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-index-columns-transact-sql
-- unique_on_foreign_key_disabled_or_filtered counts the unique indexes and constraints that are
-- disabled or filtered and whose key columns are all referencing columns of one foreign key of
-- the same table.
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'indexes', listed.metric, listed.value
    FROM (
        SELECT kinds.position, kinds.label AS metric, ISNULL(found.indexes, 0) AS value
        FROM (VALUES (1, 0, N'heap'), (2, 1, N'clustered'), (3, 2, N'nonclustered'), (4, 3, N'xml'),
                     (5, 4, N'spatial'), (6, 5, N'clustered_columnstore'),
                     (7, 6, N'nonclustered_columnstore'), (8, 7, N'nonclustered_hash'),
                     (9, 9, N'json')) AS kinds (position, code, label)
        LEFT JOIN (SELECT i.type, COUNT_BIG(*) AS indexes
                   FROM sys.indexes AS i
                   JOIN sys.objects AS o ON o.object_id = i.object_id AND o.type IN ('U', 'V')
                        AND o.is_ms_shipped = 0
                   WHERE i.is_hypothetical = 0
                   GROUP BY i.type) AS found ON found.type = kinds.code
        UNION ALL
        SELECT states.position, states.metric, states.value
        FROM (
            SELECT ISNULL(SUM(per_index.disabled), 0) AS disabled,
                   ISNULL(SUM(per_index.disabled_clustered_primary_key), 0) AS disabled_clustered_primary_keys,
                   ISNULL(SUM(per_index.disabled_nonclustered_primary_key), 0) AS disabled_nonclustered_primary_keys,
                   ISNULL(SUM(per_index.disabled_unique_constraint), 0) AS disabled_unique_constraints,
                   ISNULL(SUM(per_index.disabled_unique_index), 0) AS disabled_unique_indexes,
                   ISNULL(SUM(per_index.filtered), 0) AS filtered,
                   ISNULL(SUM(per_index.filtered_unique), 0) AS filtered_unique,
                   ISNULL(SUM(per_index.with_included_columns), 0) AS with_included_columns,
                   ISNULL(SUM(per_index.with_implicit_partition_column), 0) AS with_implicit_partition_column,
                   ISNULL(SUM(per_index.unique_on_foreign_key), 0) AS unique_on_foreign_key
            FROM (
                SELECT CASE WHEN i.is_disabled = 1 THEN 1 ELSE 0 END AS disabled,
                       CASE WHEN i.is_disabled = 1 AND i.is_primary_key = 1 AND i.type = 1
                            THEN 1 ELSE 0 END AS disabled_clustered_primary_key,
                       CASE WHEN i.is_disabled = 1 AND i.is_primary_key = 1 AND i.type = 2
                            THEN 1 ELSE 0 END AS disabled_nonclustered_primary_key,
                       CASE WHEN i.is_disabled = 1 AND i.is_unique_constraint = 1
                            THEN 1 ELSE 0 END AS disabled_unique_constraint,
                       CASE WHEN i.is_disabled = 1 AND i.is_unique = 1 AND i.is_primary_key = 0
                                 AND i.is_unique_constraint = 0
                            THEN 1 ELSE 0 END AS disabled_unique_index,
                       CASE WHEN i.has_filter = 1 THEN 1 ELSE 0 END AS filtered,
                       CASE WHEN i.has_filter = 1 AND i.is_unique = 1 THEN 1 ELSE 0 END AS filtered_unique,
                       CASE WHEN i.type IN (1, 2)
                                 AND EXISTS (SELECT 1 FROM sys.index_columns AS ic
                                             WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                                               AND ic.is_included_column = 1)
                            THEN 1 ELSE 0 END AS with_included_columns,
                       CASE WHEN i.type IN (1, 2)
                                 AND EXISTS (SELECT 1 FROM sys.index_columns AS ic
                                             WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                                               AND ic.partition_ordinal > 0 AND ic.key_ordinal = 0
                                               AND ic.is_included_column = 0)
                            THEN 1 ELSE 0 END AS with_implicit_partition_column,
                       CASE WHEN i.is_unique = 1 AND (i.is_disabled = 1 OR i.has_filter = 1)
                                 AND EXISTS (
                                     SELECT 1 FROM sys.foreign_keys AS fk
                                     WHERE fk.parent_object_id = i.object_id
                                       AND NOT EXISTS (
                                           SELECT 1 FROM sys.index_columns AS ic
                                           WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                                             AND ic.key_ordinal > 0
                                             AND NOT EXISTS (
                                                 SELECT 1 FROM sys.foreign_key_columns AS fkc
                                                 WHERE fkc.constraint_object_id = fk.object_id
                                                   AND fkc.parent_column_id = ic.column_id)))
                            THEN 1 ELSE 0 END AS unique_on_foreign_key
                FROM sys.indexes AS i
                JOIN sys.objects AS o ON o.object_id = i.object_id AND o.type IN ('U', 'V')
                     AND o.is_ms_shipped = 0
                WHERE i.is_hypothetical = 0
            ) AS per_index
        ) AS p
        CROSS APPLY (VALUES
            (10, N'disabled', p.disabled),
            (11, N'disabled_clustered_primary_keys', p.disabled_clustered_primary_keys),
            (12, N'disabled_nonclustered_primary_keys', p.disabled_nonclustered_primary_keys),
            (13, N'disabled_unique_constraints', p.disabled_unique_constraints),
            (14, N'disabled_unique_indexes', p.disabled_unique_indexes),
            (15, N'filtered', p.filtered),
            (16, N'filtered_unique', p.filtered_unique),
            (17, N'with_included_columns', p.with_included_columns),
            (18, N'with_implicit_partition_column', p.with_implicit_partition_column),
            (19, N'unique_on_foreign_key_disabled_or_filtered', p.unique_on_foreign_key)
        ) AS states (position, metric, value)
    ) AS listed
    ORDER BY listed.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'indexes', N'error_number', ERROR_NUMBER());
END CATCH;

-- CHECK constraints and foreign keys. A disabled constraint is also untrusted, so untrusted
-- counts the enabled ones only:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-check-constraints-transact-sql
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-foreign-keys-transact-sql
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'constraints', facts.metric, facts.value
    FROM (
        SELECT COUNT_BIG(*) AS total,
               ISNULL(SUM(CASE WHEN cc.is_disabled = 1 THEN 1 ELSE 0 END), 0) AS disabled,
               ISNULL(SUM(CASE WHEN cc.is_disabled = 0 AND cc.is_not_trusted = 1 THEN 1 ELSE 0 END), 0) AS untrusted,
               ISNULL(SUM(CASE WHEN cc.is_not_for_replication = 1 THEN 1 ELSE 0 END), 0) AS not_for_replication
        FROM sys.check_constraints AS cc
        WHERE cc.is_ms_shipped = 0
    ) AS checks
    CROSS JOIN (
        SELECT COUNT_BIG(*) AS total,
               ISNULL(SUM(CASE WHEN fk.is_disabled = 1 THEN 1 ELSE 0 END), 0) AS disabled,
               ISNULL(SUM(CASE WHEN fk.is_disabled = 0 AND fk.is_not_trusted = 1 THEN 1 ELSE 0 END), 0) AS untrusted,
               ISNULL(SUM(CASE WHEN fk.is_not_for_replication = 1 THEN 1 ELSE 0 END), 0) AS not_for_replication
        FROM sys.foreign_keys AS fk
        WHERE fk.is_ms_shipped = 0
    ) AS keys
    CROSS APPLY (VALUES
        (1, N'checks', checks.total),
        (2, N'checks_disabled', checks.disabled),
        (3, N'checks_untrusted', checks.untrusted),
        (4, N'checks_not_for_replication', checks.not_for_replication),
        (5, N'foreign_keys', keys.total),
        (6, N'foreign_keys_disabled', keys.disabled),
        (7, N'foreign_keys_untrusted', keys.untrusted),
        (8, N'foreign_keys_not_for_replication', keys.not_for_replication)
    ) AS facts (position, metric, value)
    ORDER BY facts.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'constraints', N'error_number', ERROR_NUMBER());
END CATCH;

-- Computed columns of tables:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-computed-columns-transact-sql
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'columns', facts.metric, facts.value
    FROM (
        SELECT COUNT_BIG(*) AS computed,
               ISNULL(SUM(CASE WHEN cc.is_persisted = 1 THEN 1 ELSE 0 END), 0) AS persisted
        FROM sys.computed_columns AS cc
        JOIN sys.objects AS o ON o.object_id = cc.object_id AND o.type = 'U' AND o.is_ms_shipped = 0
    ) AS p
    CROSS APPLY (VALUES
        (1, N'computed', p.computed),
        (2, N'computed_persisted', p.persisted)
    ) AS facts (position, metric, value)
    ORDER BY facts.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'columns', N'error_number', ERROR_NUMBER());
END CATCH;

-- Extended properties: MS_Description on tables, views and their columns (class 1, minor_id 0
-- for the object itself), then the other property names, counted, of every class:
-- https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/extended-properties-catalog-views-sys-extended-properties
BEGIN TRY
    INSERT INTO @result (section, metric, value)
    SELECT N'properties', facts.metric, facts.value
    FROM (
        SELECT ISNULL(SUM(CASE WHEN ep.name = N'MS_Description' AND ep.minor_id = 0 AND o.type = 'U'
                               THEN 1 ELSE 0 END), 0) AS on_tables,
               ISNULL(SUM(CASE WHEN ep.name = N'MS_Description' AND ep.minor_id = 0 AND o.type = 'V'
                               THEN 1 ELSE 0 END), 0) AS on_views,
               ISNULL(SUM(CASE WHEN ep.name = N'MS_Description' AND ep.minor_id > 0 AND o.type IN ('U', 'V')
                               THEN 1 ELSE 0 END), 0) AS on_columns
        FROM sys.extended_properties AS ep
        JOIN sys.objects AS o ON o.object_id = ep.major_id AND o.is_ms_shipped = 0
        WHERE ep.class = 1
    ) AS descriptions
    CROSS JOIN (
        SELECT COUNT_BIG(*) AS properties, COUNT_BIG(DISTINCT ep.name) AS names
        FROM sys.extended_properties AS ep
        WHERE ep.name <> N'MS_Description'
    ) AS others
    CROSS APPLY (VALUES
        (1, N'ms_description_tables', descriptions.on_tables),
        (2, N'ms_description_views', descriptions.on_views),
        (3, N'ms_description_columns', descriptions.on_columns),
        (4, N'other_properties', others.properties),
        (5, N'other_property_names', others.names)
    ) AS facts (position, metric, value)
    ORDER BY facts.position;
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'properties', N'error_number', ERROR_NUMBER());
END CATCH;

-- Timings in milliseconds, measured on the server, of queries shaped like the ones SchemaCraft
-- 1.2 runs for code. Each one reads the columns such a query returns and keeps only a number in
-- @sink, which is never returned; the texts are summed with DATALENGTH, so they are read too.
BEGIN TRY
    SET @mark = SYSDATETIME();
    SELECT @sink = COUNT_BIG(*)
                   + ISNULL(SUM(CAST(DATALENGTH(s.name) + DATALENGTH(o.name) AS bigint)
                                + ISNULL(CAST(m.uses_ansi_nulls AS int), 0)
                                + ISNULL(CAST(m.uses_quoted_identifier AS int), 0)
                                + ISNULL(CAST(m.is_schema_bound AS int), 0)
                                + ISNULL(m.execute_as_principal_id, 0)
                                + ISNULL(OBJECTPROPERTY(o.object_id, 'IsEncrypted'), 0)), 0)
    FROM sys.objects AS o
    JOIN sys.schemas AS s ON s.schema_id = o.schema_id
    LEFT JOIN sys.sql_modules AS m ON m.object_id = o.object_id
    WHERE o.is_ms_shipped = 0 AND o.type IN ('V', 'P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF', 'TR', 'TA');
    INSERT INTO @result (section, metric, value)
    VALUES (N'timings', N'code_objects_ms', DATEDIFF(millisecond, @mark, SYSDATETIME()));

    SET @mark = SYSDATETIME();
    SELECT @sink = COUNT_BIG(*)
                   + ISNULL(SUM(CAST(DATALENGTH(t.name) AS bigint) + e.type
                                + CAST(t.is_disabled AS int) + CAST(t.is_instead_of_trigger AS int)
                                + CAST(t.is_not_for_replication AS int)
                                + CAST(e.is_first AS int) + CAST(e.is_last AS int)), 0)
    FROM sys.triggers AS t
    JOIN sys.trigger_events AS e ON e.object_id = t.object_id
    WHERE t.is_ms_shipped = 0;
    INSERT INTO @result (section, metric, value)
    VALUES (N'timings', N'triggers_ms', DATEDIFF(millisecond, @mark, SYSDATETIME()));

    SET @mark = SYSDATETIME();
    SELECT @sink = COUNT_BIG(*)
                   + ISNULL(SUM(CAST(DATALENGTH(p.name) AS bigint) + ISNULL(DATALENGTH(ty.name), 0)
                                + p.max_length + p.precision + p.scale
                                + CAST(p.is_output AS int) + CAST(p.is_readonly AS int)), 0)
    FROM sys.parameters AS p
    JOIN sys.objects AS o ON o.object_id = p.object_id
    LEFT JOIN sys.types AS ty ON ty.user_type_id = p.user_type_id
    WHERE o.is_ms_shipped = 0 AND o.type IN ('P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF');
    INSERT INTO @result (section, metric, value)
    VALUES (N'timings', N'parameters_ms', DATEDIFF(millisecond, @mark, SYSDATETIME()));

    SET @mark = SYSDATETIME();
    SELECT @sink = ISNULL(SUM(ISNULL(CAST(DATALENGTH(m.definition) AS bigint), 0)), 0)
    FROM sys.objects AS o
    JOIN sys.sql_modules AS m ON m.object_id = o.object_id
    WHERE o.is_ms_shipped = 0 AND o.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR');
    INSERT INTO @result (section, metric, value)
    VALUES (N'timings', N'module_texts_ms', DATEDIFF(millisecond, @mark, SYSDATETIME()));

    INSERT INTO @result (section, metric, value)
    VALUES (N'timings', N'probe_ms', DATEDIFF(millisecond, @started, SYSDATETIME()));
END TRY
BEGIN CATCH
    INSERT INTO @result (section, metric, value) VALUES (N'timings', N'error_number', ERROR_NUMBER());
END CATCH;

SELECT section, metric, value
FROM @result
ORDER BY row_id;

/*
Optional, by hand: how long the module texts take to reach this computer. This query is not part
of the probe and returns every readable text, so run it only in SSMS with Query > Query Options >
Results > "Discard results after execution" and Query > "Include Client Statistics" both on.
Select the three lines below, run them (F5), and share only "Bytes received from server" and
"Total execution time" from the Client Statistics tab.

SELECT m.definition
FROM sys.objects AS o JOIN sys.sql_modules AS m ON m.object_id = o.object_id
WHERE o.is_ms_shipped = 0 AND o.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR');
*/
