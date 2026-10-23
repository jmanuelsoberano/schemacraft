//! Set-based, parameterized PostgreSQL catalog reads. Every referenced function is built in.

use serde::Deserialize;
use serde::de::DeserializeOwned;

use super::session::{Session, field};
use crate::inspectors::InspectorError;
use crate::model::{Column, NotReadReason, Parameter, QualifiedName, SqlDataType};

/// Deserialize one JSON projection per row, keeping driver types out of the pure assembler.
pub(super) async fn read<T: DeserializeOwned>(
    session: &Session,
    label: &'static str,
    sql: &str,
    schemas: &[String],
    views: bool,
) -> Result<Vec<T>, InspectorError> {
    session
        .query(label, sql, &[&schemas, &views])
        .await?
        .iter()
        .map(|row| {
            let value: String = field(row, "item", label)?;
            serde_json::from_str(&value).map_err(|_| InspectorError::UnexpectedCatalogData {
                query: label,
                details: "a catalog projection has an unexpected shape".to_string(),
            })
        })
        .collect()
}

/// Optional reads retain a closed failure reason without parsing or logging driver messages.
pub(super) async fn optional<T: DeserializeOwned>(
    session: &Session,
    sql: &str,
    schemas: &[String],
    views: bool,
) -> Result<Vec<T>, NotReadReason> {
    let rows = session
        .client
        .query(sql, &[&schemas, &views])
        .await
        .map_err(
            |error| match error.code().map(tokio_postgres::error::SqlState::code) {
                Some("42501") => NotReadReason::PermissionDenied,
                Some("57014" | "55P03") => NotReadReason::TimedOut,
                _ => NotReadReason::QueryFailed,
            },
        )?;
    rows.iter()
        .map(|row| {
            let value: String = row
                .try_get("item")
                .map_err(|_| NotReadReason::QueryFailed)?;
            serde_json::from_str(&value).map_err(|_| NotReadReason::QueryFailed)
        })
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ObjectRow {
    pub oid: u32,
    pub name: QualifiedName,
    pub kind: String,
    pub partition: bool,
    pub populated: bool,
    pub check_option: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ColumnRow {
    pub object_oid: u32,
    pub name: String,
    pub ordinal: u32,
    pub type_name: QualifiedName,
    pub type_kind: String,
    pub declaration: String,
    pub precision: Option<u16>,
    pub scale: Option<i16>,
    pub length: Option<u32>,
    pub nullable: bool,
    pub default_expression: Option<String>,
    pub generated: String,
    pub identity: String,
    pub generation_expression: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
// Independent catalog or capture flags retain their native meanings.
#[allow(clippy::struct_excessive_bools)]
pub(super) struct IndexRow {
    pub table_oid: u32,
    pub name: QualifiedName,
    pub method: String,
    pub definition: String,
    pub key_terms: Vec<String>,
    pub key_columns: Vec<Option<String>>,
    pub included_columns: Vec<String>,
    pub predicate: Option<String>,
    pub primary: bool,
    pub unique: bool,
    pub valid: bool,
    pub ready: bool,
    pub live: bool,
    pub nulls_not_distinct: bool,
    pub clustered: bool,
    pub constraint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
// Independent catalog or capture flags retain their native meanings.
#[allow(clippy::struct_excessive_bools)]
pub(super) struct ConstraintRow {
    pub table_oid: u32,
    pub name: String,
    pub kind: String,
    pub definition: String,
    pub expression: Option<String>,
    pub columns: Vec<String>,
    pub referenced_name: Option<QualifiedName>,
    pub referenced_columns: Vec<String>,
    pub on_update: String,
    pub on_delete: String,
    pub validated: bool,
    pub enforced: Option<bool>,
    pub enabled: bool,
    pub deferrable: bool,
    pub initially_deferred: bool,
    pub match_type: String,
    pub delete_set_columns: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RoutineRow {
    pub oid: u32,
    pub name: QualifiedName,
    pub kind: String,
    pub language: String,
    pub parsed_sql_body: bool,
    pub identity_arguments: Vec<QualifiedName>,
    pub parameters: Vec<Parameter>,
    pub returns: Option<SqlDataType>,
    pub returns_set: bool,
    pub columns: Vec<Column>,
    pub argument_modes: Vec<String>,
    pub result: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TriggerRow {
    pub oid: u32,
    pub parent_oid: u32,
    pub name: String,
    pub timing: String,
    pub events: Vec<String>,
    pub level: String,
    pub enabled_mode: String,
    pub function_oid: u32,
    pub function_name: QualifiedName,
    pub constraint: bool,
    pub deferrable: bool,
    pub initially_deferred: bool,
    pub update_columns: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DefinitionRow {
    pub kind: String,
    pub oid: u32,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DependencyRow {
    pub source_class: String,
    pub source_oid: u32,
    pub target_class: String,
    pub target_kind: Option<String>,
    pub target_oid: u32,
    pub target_name: Option<QualifiedName>,
}

pub(super) const OBJECTS: &str = r"
SELECT pg_catalog.jsonb_build_object('oid',c.oid::bigint,'name',pg_catalog.jsonb_build_object('schema',n.nspname,'name',c.relname),
 'kind',c.relkind::text,'partition',c.relispartition,'populated',c.relispopulated,
 'checkOption',CASE WHEN 'check_option=local'=ANY(COALESCE(c.reloptions,ARRAY[]::text[])) THEN 'local'
 WHEN 'check_option=cascaded'=ANY(COALESCE(c.reloptions,ARRAY[]::text[])) THEN 'cascaded' ELSE 'none' END)::text AS item
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[]))
 AND (c.relkind IN ('r','p') OR ($2::bool AND c.relkind IN ('v','m')))
ORDER BY n.nspname,c.relname
";

pub(super) const COLUMNS: &str = r"
SELECT pg_catalog.jsonb_build_object('objectOid',c.oid::bigint,'name',a.attname,'ordinal',a.attnum,
 'typeName',pg_catalog.jsonb_build_object('schema',tn.nspname,'name',t.typname),'typeKind',t.typtype::text,
 'declaration',pg_catalog.format_type(a.atttypid,a.atttypmod),
 'precision',CASE WHEN t.typname='numeric' AND a.atttypmod>=4 THEN ((a.atttypmod-4)>>16)&65535 END,
 'scale',CASE WHEN t.typname='numeric' AND a.atttypmod>=4 THEN (((a.atttypmod-4)&2047)#1024)-1024 END,
 'length',CASE WHEN t.typname IN ('varchar','bpchar') AND a.atttypmod>=4 THEN a.atttypmod-4 END,
 'nullable',NOT(a.attnotnull OR t.typnotnull),
 'defaultExpression',CASE WHEN a.attgenerated='' THEN pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) END,
 'generated',a.attgenerated::text,'identity',a.attidentity::text,
 'generationExpression',CASE WHEN a.attgenerated<>'' THEN pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) END)::text AS item
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 JOIN pg_catalog.pg_type t ON t.oid=a.atttypid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[]))
 AND (c.relkind IN ('r','p') OR ($2::bool AND c.relkind IN ('v','m')))
ORDER BY n.nspname,c.relname,a.attnum
";

pub(super) const INDEXES: &str = r"
SELECT pg_catalog.jsonb_build_object('tableOid',c.oid::bigint,
 'name',pg_catalog.jsonb_build_object('schema',ni.nspname,'name',ic.relname),'method',am.amname,
 'definition',pg_catalog.pg_get_indexdef(i.indexrelid,0,false),
 'keyTerms',ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid,k,false) FROM pg_catalog.generate_series(1,i.indnkeyatts::int) k),
 'keyColumns',ARRAY(SELECT a.attname FROM pg_catalog.unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ord)
 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE k.ord<=i.indnkeyatts ORDER BY k.ord),
 'includedColumns',ARRAY(SELECT a.attname FROM pg_catalog.unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ord)
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE k.ord>i.indnkeyatts ORDER BY k.ord),
 'predicate',pg_catalog.pg_get_expr(i.indpred,i.indrelid,false),'primary',i.indisprimary,'unique',i.indisunique,
 'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'nullsNotDistinct',i.indnullsnotdistinct,
 'clustered',i.indisclustered,'constraint',co.conname)::text AS item
FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
 JOIN pg_catalog.pg_namespace ni ON ni.oid=ic.relnamespace JOIN pg_catalog.pg_am am ON am.oid=ic.relam
 LEFT JOIN pg_catalog.pg_constraint co ON co.conindid=i.indexrelid AND co.contype IN ('p','u','x')
WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[]))
 AND (c.relkind IN ('r','p') OR ($2::bool AND c.relkind IN ('v','m')))
ORDER BY n.nspname,c.relname,ic.relname
";

// PostgreSQL 18 introduced NOT ENFORCED and conenforced. Earlier supported versions
// declare constraints enforced; trigger enablement remains a separate observation below.
// https://www.postgresql.org/docs/18/release-18.html#RELEASE-18-UTILITY
pub(super) const CONSTRAINTS: &str = r"
SELECT pg_catalog.jsonb_build_object('oid',co.oid::bigint,'tableOid',co.conrelid::bigint,'name',co.conname,'kind',co.contype::text,
 'definition',pg_catalog.pg_get_constraintdef(co.oid,false),
 'expression',CASE WHEN co.contype='c' THEN pg_catalog.pg_get_expr(co.conbin,co.conrelid,false) END,
 'columns',ARRAY(SELECT a.attname FROM pg_catalog.unnest(co.conkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_catalog.pg_attribute a ON a.attrelid=co.conrelid AND a.attnum=k.attnum ORDER BY k.ord),
 'referencedTableOid',co.confrelid::bigint,
 'referencedName',CASE WHEN rc.oid IS NOT NULL THEN pg_catalog.jsonb_build_object('schema',rn.nspname,'name',rc.relname) END,
 'referencedColumns',ARRAY(SELECT a.attname FROM pg_catalog.unnest(co.confkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_catalog.pg_attribute a ON a.attrelid=co.confrelid AND a.attnum=k.attnum ORDER BY k.ord),
 'onUpdate',co.confupdtype::text,'onDelete',co.confdeltype::text,'validated',co.convalidated,
 'enforced',CASE WHEN pg_catalog.current_setting('server_version_num')::int<180000 THEN true
 ELSE (pg_catalog.to_jsonb(co)->>'conenforced')::boolean END,
 'enabled',COALESCE((pg_catalog.to_jsonb(co)->>'conenforced')::boolean,true)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger tr WHERE tr.tgconstraint=co.oid AND tr.tgenabled='D'),
 'deferrable',co.condeferrable,'initiallyDeferred',co.condeferred,'matchType',co.confmatchtype::text,
 'deleteSetColumns',ARRAY(SELECT a.attname FROM pg_catalog.unnest(co.confdelsetcols) WITH ORDINALITY k(attnum,ord)
 JOIN pg_catalog.pg_attribute a ON a.attrelid=co.conrelid AND a.attnum=k.attnum ORDER BY k.ord))::text AS item
FROM pg_catalog.pg_constraint co JOIN pg_catalog.pg_class c ON c.oid=co.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_catalog.pg_class rc ON rc.oid=co.confrelid LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=rc.relnamespace
WHERE co.contype IN ('c','f','p','u','x') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[])) AND ($2::bool OR c.relkind IN ('r','p'))
ORDER BY n.nspname,c.relname,co.conname
";

pub(super) const ROUTINES: &str = r"
SELECT pg_catalog.jsonb_build_object('oid',p.oid::bigint,'name',pg_catalog.jsonb_build_object('schema',n.nspname,'name',p.proname),
 'kind',p.prokind::text,'language',l.lanname,'parsedSqlBody',p.prosqlbody IS NOT NULL,'returnsSet',p.proretset,
 'identityArguments',ARRAY(SELECT pg_catalog.jsonb_build_object('schema',tn.nspname,'name',t.typname)
 FROM pg_catalog.unnest(p.proargtypes::oid[]) WITH ORDINALITY a(typid,ord)
 JOIN pg_catalog.pg_type t ON t.oid=a.typid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace ORDER BY a.ord),
 'parameters',ARRAY(SELECT pg_catalog.jsonb_build_object('name',COALESCE(p.proargnames[a.ord],''),'ordinalPosition',a.ord,
 'dataType',pg_catalog.jsonb_build_object('name',t.typname,'length',NULL,'precision',NULL,'scale',NULL,
 'userDefinedTypeName',CASE WHEN tn.nspname<>'pg_catalog' THEN pg_catalog.quote_ident(tn.nspname)||'.'||pg_catalog.quote_ident(t.typname) END,
 'nativeDeclaration',pg_catalog.format_type(t.oid,NULL)),
 'isOutput',COALESCE(p.proargmodes[a.ord]::text,'i') IN ('o','b','t'),'isReadOnly',false)
 FROM pg_catalog.unnest(COALESCE(p.proallargtypes,p.proargtypes::oid[])) WITH ORDINALITY a(typid,ord)
 JOIN pg_catalog.pg_type t ON t.oid=a.typid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace ORDER BY a.ord),
 'returns',CASE WHEN p.prokind<>'p' THEN pg_catalog.jsonb_build_object('name',rt.typname,'length',NULL,'precision',NULL,'scale',NULL,
 'userDefinedTypeName',CASE WHEN rtn.nspname<>'pg_catalog' THEN pg_catalog.quote_ident(rtn.nspname)||'.'||pg_catalog.quote_ident(rt.typname) END,
 'nativeDeclaration',pg_catalog.format_type(rt.oid,NULL)) END,
 'columns',CASE WHEN p.proretset THEN
 CASE WHEN rt.typrelid<>0 THEN ARRAY(SELECT pg_catalog.jsonb_build_object('name',a.attname,'ordinalPosition',a.attnum,
 'dataType',pg_catalog.jsonb_build_object('name',t.typname,'length',NULL,'precision',NULL,'scale',NULL,'userDefinedTypeName',NULL,
 'nativeDeclaration',pg_catalog.format_type(t.oid,a.atttypmod)), 'isNullable',NOT a.attnotnull,'defaultExpression',NULL,'isIdentity',false,'isComputed',false)
 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid WHERE a.attrelid=rt.typrelid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum)
 ELSE ARRAY(SELECT pg_catalog.jsonb_build_object('name',COALESCE(p.proargnames[a.ord],''),'ordinalPosition',a.ord,
 'dataType',pg_catalog.jsonb_build_object('name',t.typname,'length',NULL,'precision',NULL,'scale',NULL,'userDefinedTypeName',NULL,
 'nativeDeclaration',pg_catalog.format_type(t.oid,NULL)), 'isNullable',true,'defaultExpression',NULL,'isIdentity',false,'isComputed',false)
 FROM pg_catalog.unnest(COALESCE(p.proallargtypes,p.proargtypes::oid[])) WITH ORDINALITY a(typid,ord)
 JOIN pg_catalog.pg_type t ON t.oid=a.typid WHERE p.proargmodes[a.ord] IN ('o','b','t') ORDER BY a.ord) END
 ELSE ARRAY[]::jsonb[] END,
 'argumentModes',ARRAY(SELECT COALESCE(p.proargmodes[a.ord]::text,'i') FROM pg_catalog.unnest(COALESCE(p.proallargtypes,p.proargtypes::oid[])) WITH ORDINALITY a(typid,ord) ORDER BY a.ord),
 'result',CASE WHEN p.prokind<>'p' THEN pg_catalog.pg_get_function_result(p.oid) END)::text AS item
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang JOIN pg_catalog.pg_type rt ON rt.oid=p.prorettype
 JOIN pg_catalog.pg_namespace rtn ON rtn.oid=rt.typnamespace
WHERE p.prokind IN ('f','p') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[])) AND ($2::bool OR NOT $2::bool)
ORDER BY n.nspname,p.proname,p.proargtypes
";

pub(super) const TRIGGERS: &str = r"
SELECT pg_catalog.jsonb_build_object('oid',t.oid::bigint,'parentOid',t.tgrelid::bigint,'name',t.tgname,
 'timing',CASE WHEN (t.tgtype::int&64)<>0 THEN 'insteadOf' WHEN (t.tgtype::int&2)<>0 THEN 'before' ELSE 'after' END,
 'events',ARRAY(SELECT event FROM (VALUES(4,'insert'),(8,'delete'),(16,'update'),(32,'truncate')) e(bit,event) WHERE (t.tgtype::int&e.bit)<>0),
 'level',CASE WHEN (t.tgtype::int&1)<>0 THEN 'row' ELSE 'statement' END,
 'enabledMode',CASE t.tgenabled WHEN 'O' THEN 'origin' WHEN 'R' THEN 'replica' WHEN 'A' THEN 'always' ELSE 'disabled' END,
 'functionOid',p.oid::bigint,'functionName',pg_catalog.jsonb_build_object('schema',pn.nspname,'name',p.proname),
 'constraint',t.tgconstraint<>0,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,
 'updateColumns',ARRAY(SELECT a.attname FROM pg_catalog.unnest(t.tgattr::smallint[]) WITH ORDINALITY k(attnum,ord)
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.ord))::text AS item
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[]))
 AND (c.relkind IN ('r','p') OR ($2::bool AND c.relkind IN ('v','m')))
ORDER BY n.nspname,c.relname,t.tgname
";

pub(super) const DEFINITIONS: &str = r"
SELECT pg_catalog.jsonb_build_object('kind','routine','oid',p.oid::bigint,'text',pg_catalog.pg_get_functiondef(p.oid))::text AS item
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind IN ('f','p') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[]))
UNION ALL
SELECT pg_catalog.jsonb_build_object('kind','view','oid',c.oid::bigint,'text',pg_catalog.pg_get_viewdef(c.oid,false))::text
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE $2::bool AND c.relkind IN ('v','m') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[]))
UNION ALL
SELECT pg_catalog.jsonb_build_object('kind','trigger','oid',t.oid::bigint,'text',pg_catalog.pg_get_triggerdef(t.oid,false))::text
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[]))
 AND (c.relkind IN ('r','p') OR ($2::bool AND c.relkind IN ('v','m')))
";

pub(super) const DEPENDENCIES: &str = r"
WITH source_objects AS (
 SELECT 'pg_class'::text cls,c.oid objid,c.oid sourceid,'relation'::text sourceclass,c.relnamespace ns
 FROM pg_catalog.pg_class c WHERE c.relkind IN ('r','p','v','m')
 UNION ALL SELECT 'pg_class',i.indexrelid,i.indrelid,'relation',c.relnamespace
 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
 UNION ALL SELECT 'pg_rewrite',r.oid,r.ev_class,'relation',c.relnamespace FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class
 UNION ALL SELECT 'pg_proc',p.oid,p.oid,'routine',p.pronamespace FROM pg_catalog.pg_proc p WHERE p.prokind IN ('f','p')
 UNION ALL SELECT 'pg_trigger',t.oid,t.oid,'trigger',c.relnamespace FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal
 UNION ALL SELECT 'pg_attrdef',a.oid,a.adrelid,'relation',c.relnamespace FROM pg_catalog.pg_attrdef a JOIN pg_catalog.pg_class c ON c.oid=a.adrelid
 UNION ALL SELECT 'pg_constraint',co.oid,co.conrelid,'relation',c.relnamespace FROM pg_catalog.pg_constraint co JOIN pg_catalog.pg_class c ON c.oid=co.conrelid WHERE co.contype='c'
)
SELECT DISTINCT pg_catalog.jsonb_build_object('sourceClass',s.sourceclass,'sourceOid',s.sourceid::bigint,
 'targetClass',CASE d.refclassid WHEN 'pg_catalog.pg_class'::regclass THEN 'relation' WHEN 'pg_catalog.pg_proc'::regclass THEN 'routine' ELSE d.refclassid::regclass::text END,
 'targetKind',COALESCE(rc.relkind::text,rp.prokind::text),
 'targetOid',d.refobjid::bigint,'targetName',CASE WHEN COALESCE(rc.relname,rp.proname,rt.typname) IS NOT NULL
 THEN pg_catalog.jsonb_build_object('schema',COALESCE(rn.nspname,rpn.nspname,rtn.nspname),'name',COALESCE(rc.relname,rp.proname,rt.typname)) END)::text AS item
FROM source_objects s JOIN pg_catalog.pg_namespace n ON n.oid=s.ns
 JOIN pg_catalog.pg_depend d ON d.classid=('pg_catalog.'||s.cls)::regclass AND d.objid=s.objid AND d.deptype='n'
 LEFT JOIN pg_catalog.pg_class rc ON d.refclassid='pg_catalog.pg_class'::regclass AND rc.oid=d.refobjid
 LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=rc.relnamespace
 LEFT JOIN pg_catalog.pg_proc rp ON d.refclassid='pg_catalog.pg_proc'::regclass AND rp.oid=d.refobjid
 LEFT JOIN pg_catalog.pg_namespace rpn ON rpn.oid=rp.pronamespace
 LEFT JOIN pg_catalog.pg_type rt ON d.refclassid='pg_catalog.pg_type'::regclass AND rt.oid=d.refobjid
 LEFT JOIN pg_catalog.pg_namespace rtn ON rtn.oid=rt.typnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND (pg_catalog.cardinality($1::text[])=0 OR n.nspname=ANY($1::text[])) AND ($2::bool OR NOT $2::bool)
 AND NOT (d.refclassid='pg_catalog.pg_class'::regclass AND s.sourceclass='relation' AND d.refobjid=s.sourceid)
";
