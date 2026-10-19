//! The access probe: what the login may see in the current database, read in one round trip.
//!
//! It runs when a database is selected, so the connection dialog can warn before anything is
//! read, and again next to the catalog queries of an inspection, so the snapshot records the
//! permissions it was read with. The facts stay raw here; [`AccessProfile`] turns them into a
//! level and a coverage.
//!
//! [`AccessProfile`]: crate::model::AccessProfile

use tiberius::Row;

use super::catalog::{
    CatalogQuery, CatalogSession, optional, optional_text, required, required_text, run_batch,
};
use super::pool::{SqlServerConnection, checkout_error};
use crate::diagnostics;
use crate::inspectors::{InspectionProgress, InspectionStage, InspectorError, ProgressReporter};
use crate::model::{AccessProbe, SchemaAccess};

/// Two result sets: one row of database-wide facts, then one row per schema.
///
/// * Explicit denials are counted for the login's user and every role it belongs to, at the
///   database (class 0), object (class 1, the object itself and not one of its columns) and
///   schema (class 3) level, for the permissions that hide an object or its texts. A schema
///   denial must be counted: `DENY VIEW DEFINITION ON SCHEMA::x` hides every object of `x` from
///   a login that may still `SELECT` from it.
/// * No denial is counted for `dbo` (principal 1), which members of `sysadmin` and the owner
///   of the database enter as: SQL Server checks no permission for it, so a `DENY` to `public`
///   or to one of its Windows groups hides nothing from it.
/// * The database user is named only when the login has a user of its own; reaching the
///   database through `guest` or a Windows group gives no name to grant to.
/// * `INFORMATION_SCHEMA` and `sys` are left out; `guest` and the schemas of fixed roles only
///   count when they hold a visible table or view.
const ACCESS_PROBE: CatalogQuery = CatalogQuery {
    name: "access probe",
    sql: "DECLARE @me int = DATABASE_PRINCIPAL_ID();
SELECT HAS_PERMS_BY_NAME(NULL, 'DATABASE', 'VIEW DEFINITION') AS view_definition,
       HAS_PERMS_BY_NAME(NULL, 'DATABASE', 'SELECT') AS select_permission,
       HAS_PERMS_BY_NAME(NULL, 'DATABASE', 'VIEW SECURITY DEFINITION') AS view_security_definition,
       CASE WHEN @me = 1 THEN 0
            ELSE (SELECT COUNT(*)
                  FROM sys.database_permissions AS p
                  WHERE p.state = 'D'
                    AND (p.class IN (0, 3) OR (p.class = 1 AND p.minor_id = 0))
                    AND p.permission_name IN ('VIEW DEFINITION', 'SELECT', 'CONTROL')
                    AND (p.grantee_principal_id = @me
                         OR IS_MEMBER(USER_NAME(p.grantee_principal_id)) = 1))
       END AS explicit_denials,
       CAST(CASE WHEN EXISTS (SELECT 1 FROM sys.objects AS o
                              WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0)
                 THEN 1 ELSE 0 END AS bit) AS sees_objects,
       (SELECT dp.name
        FROM sys.database_principals AS dp
        WHERE dp.principal_id = @me AND dp.principal_id <> 2
          AND dp.type IN ('S', 'U', 'E')) AS database_user;
SELECT s.name AS schema_name,
       HAS_PERMS_BY_NAME(QUOTENAME(s.name), 'SCHEMA', 'VIEW DEFINITION') AS view_definition,
       HAS_PERMS_BY_NAME(QUOTENAME(s.name), 'SCHEMA', 'SELECT') AS select_permission,
       CAST(CASE WHEN @me <> 1
                  AND EXISTS (SELECT 1 FROM sys.database_permissions AS p
                              WHERE p.class = 3 AND p.major_id = s.schema_id AND p.state = 'D'
                                AND p.permission_name IN ('VIEW DEFINITION', 'SELECT', 'CONTROL')
                                AND (p.grantee_principal_id = @me
                                     OR IS_MEMBER(USER_NAME(p.grantee_principal_id)) = 1))
                 THEN 1 ELSE 0 END AS bit) AS is_denied,
       CAST(CASE WHEN EXISTS (SELECT 1 FROM sys.objects AS o
                              WHERE o.schema_id = s.schema_id AND o.type IN ('U', 'V')
                                AND o.is_ms_shipped = 0)
                 THEN 1 ELSE 0 END AS bit) AS has_visible_objects
FROM sys.schemas AS s
WHERE s.schema_id NOT IN (3, 4)
  AND ((s.schema_id <> 2 AND s.schema_id < 16384)
       OR EXISTS (SELECT 1 FROM sys.objects AS o
                  WHERE o.schema_id = s.schema_id AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0))
ORDER BY s.name;",
};

/// The database-wide row of the probe as the server returned it. `HAS_PERMS_BY_NAME` answers
/// `NULL` for a permission the server does not know, such as `VIEW SECURITY DEFINITION` before
/// SQL Server 2022, and `1` only when the permission is held.
#[derive(Debug, Clone, PartialEq, Eq)]
struct DatabaseAccessRow {
    view_definition: Option<i32>,
    select_permission: Option<i32>,
    view_security_definition: Option<i32>,
    explicit_denials: i32,
    sees_objects: bool,
    database_user: Option<String>,
}

impl DatabaseAccessRow {
    fn into_probe(self, schemas: Vec<SchemaAccess>) -> AccessProbe {
        let explicit_denials = self.visible_denials();
        AccessProbe {
            can_read_definitions: is_granted(self.view_definition),
            can_read_data: is_granted(self.select_permission),
            explicit_denials,
            // The probe does not count EXECUTE denials: not recorded, so some may exist.
            execute_denials: None,
            sees_objects: self.sees_objects,
            schemas,
            database_user: self.database_user,
        }
    }

    /// The denial count, or `None` when the login cannot see its own denials. Permission rows
    /// need `VIEW SECURITY DEFINITION`, which `VIEW DEFINITION` includes from SQL Server 2022
    /// on; holding the second without the first means it was denied, and the rows, denials
    /// included, are hidden. Without `VIEW DEFINITION` a login still sees the rows it is the
    /// grantee of, and before 2022 the permission does not exist, so the count stands.
    fn visible_denials(&self) -> Option<u32> {
        if is_granted(self.view_definition) && self.view_security_definition == Some(0) {
            None
        } else {
            u32::try_from(self.explicit_denials).ok()
        }
    }
}

/// Whether `HAS_PERMS_BY_NAME` reported the permission as held. An unknown answer is not a
/// grant.
fn is_granted(answer: Option<i32>) -> bool {
    answer == Some(1)
}

/// Reads the access facts of the login in the database the session is in.
pub(super) async fn fetch_access_probe(
    connection: &mut SqlServerConnection,
) -> Result<AccessProbe, InspectorError> {
    let query = ACCESS_PROBE.name;
    let result_sets = run_batch(connection, &ACCESS_PROBE).await?;
    let [database_rows, schema_rows] = result_sets.as_slice() else {
        return Err(InspectorError::UnexpectedCatalogData {
            query,
            details: format!("expected 2 result sets, got {}", result_sets.len()),
        });
    };
    let database = database_rows
        .first()
        .ok_or_else(|| InspectorError::UnexpectedCatalogData {
            query,
            details: "the server returned no database row".to_string(),
        })
        .and_then(map_database_row)?;
    let schemas = schema_rows
        .iter()
        .map(map_schema_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(database.into_probe(schemas))
}

/// Borrows a session for the probe during an inspection and reports the stage when it is done.
pub(super) async fn fetch_access_stage(
    session: &CatalogSession<'_>,
    progress: &dyn ProgressReporter,
) -> Result<AccessProbe, InspectorError> {
    let started = std::time::Instant::now();
    let mut connection = session
        .pool
        .get()
        .await
        .map_err(|error| checkout_error(error, session.target, session.connect_timeout))?;

    let probe = fetch_access_probe(&mut connection).await?;
    diagnostics::catalog_query(ACCESS_PROBE.name, probe.schemas.len(), started.elapsed());
    progress.report(InspectionProgress::stage(InspectionStage::CheckingAccess));
    Ok(probe)
}

fn map_database_row(row: &Row) -> Result<DatabaseAccessRow, InspectorError> {
    let query = ACCESS_PROBE.name;
    Ok(DatabaseAccessRow {
        view_definition: optional(row, "view_definition", query)?,
        select_permission: optional(row, "select_permission", query)?,
        view_security_definition: optional(row, "view_security_definition", query)?,
        explicit_denials: required(row, "explicit_denials", query)?,
        sees_objects: required(row, "sees_objects", query)?,
        database_user: optional_text(row, "database_user", query)?,
    })
}

fn map_schema_row(row: &Row) -> Result<SchemaAccess, InspectorError> {
    let query = ACCESS_PROBE.name;
    Ok(SchemaAccess {
        name: required_text(row, "schema_name", query)?,
        can_read_definitions: is_granted(optional(row, "view_definition", query)?),
        can_read_data: is_granted(optional(row, "select_permission", query)?),
        is_denied: required(row, "is_denied", query)?,
        has_visible_objects: required(row, "has_visible_objects", query)?,
        // The probe does not ask; `false` is what a profile without these facts says.
        has_visible_programmability: false,
        is_execute_denied: false,
    })
}

#[cfg(test)]
mod tests {
    use super::{DatabaseAccessRow, is_granted};

    fn row(view_definition: i32, view_security_definition: Option<i32>) -> DatabaseAccessRow {
        DatabaseAccessRow {
            view_definition: Some(view_definition),
            select_permission: Some(1),
            view_security_definition,
            explicit_denials: 2,
            sees_objects: true,
            database_user: Some("reporting".to_string()),
        }
    }

    #[test]
    fn denials_are_unknown_when_view_definition_comes_without_its_security_part() {
        assert_eq!(row(1, Some(0)).visible_denials(), None);
    }

    #[test]
    fn denials_are_counted_when_the_login_can_see_them() {
        // SQL Server 2022 and later: VIEW DEFINITION includes VIEW SECURITY DEFINITION.
        assert_eq!(row(1, Some(1)).visible_denials(), Some(2));
        // Earlier versions do not know the permission and answer NULL.
        assert_eq!(row(1, None).visible_denials(), Some(2));
        // Without VIEW DEFINITION a login still sees the denials made to it.
        assert_eq!(row(0, Some(0)).visible_denials(), Some(2));
    }

    #[test]
    fn maps_the_database_row_into_a_probe() {
        let probe = row(0, Some(0)).into_probe(vec![]);
        assert!(!probe.can_read_definitions);
        assert!(probe.can_read_data);
        assert_eq!(probe.explicit_denials, Some(2));
        assert!(probe.sees_objects);
        assert_eq!(probe.database_user.as_deref(), Some("reporting"));
    }

    #[test]
    fn only_an_explicit_yes_is_a_grant() {
        assert!(is_granted(Some(1)));
        assert!(!is_granted(Some(0)));
        assert!(!is_granted(None));
    }
}
