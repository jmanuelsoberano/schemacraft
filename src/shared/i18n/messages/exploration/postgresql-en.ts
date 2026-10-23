export const englishPostgresqlMessages = {
  "module.native.tracking.title": "Routine dependency evidence",
  "module.native.tracking.parsedSqlBody": "Parsed SQL body",
  "module.native.tracking.parsedSqlBody.hint":
    "PostgreSQL stores a parsed SQL body, so its catalog can track body references. Dynamic SQL and runtime references are still not exhaustive.",
  "module.native.tracking.signatureOnly": "Signature only",
  "module.native.tracking.signatureOnly.hint":
    "The catalog tracks the routine signature, not references inside its PL or text body. An empty list does not establish that the body has no dependencies.",
  "module.native.tracking.unknown": "Tracking unknown",
  "module.native.tracking.unknown.hint":
    "This reader does not understand the recorded routine-body tracking evidence.",
  "module.native.tracking.notRecorded": "Tracking not recorded",
  "module.native.tracking.notRecorded.hint":
    "This capture did not record whether PostgreSQL tracks references inside this routine body.",
  "connection.provider": "Database engine",
  "connection.postgresql.server.placeholder": "localhost:5432 or [::1]:5432",
  "connection.postgresql.server.hint":
    "Host and optional TCP port. IPv6 ports require brackets; connection URIs and named instances are not accepted.",
  "connection.postgresql.server.invalid": "Enter a PostgreSQL host and valid optional TCP port.",
  "connection.postgresql.encryption.verifyFull": "TLS: verify CA and host (recommended)",
  "connection.postgresql.encryption.require":
    "TLS without certificate verification (local development only)",
  "connection.postgresql.encryption.disable": "Plaintext (local development only)",
  "connection.postgresql.encryption.hint":
    "Remote connections require verified TLS. Exceptions apply only to localhost or loopback IPs.",
  "connection.postgresql.encryption.localOnly":
    "This transport exception is allowed only for a local development server.",
  "connection.postgresql.rootCertificate": "Additional public root CA (PEM, optional)",
  "connection.postgresql.rootCertificate.hint":
    "Paste a public CA certificate, never a private key. Leave blank to use system trust.",
  "connection.postgresql.rootCertificate.invalid":
    "Use a public CA certificate; private keys are not accepted.",
  "access.postgresql.title": "PostgreSQL catalog evidence",
  "access.postgresql.description":
    "Catalog visibility and schema USAGE do not imply permission to read table data or exhaustive routine dependencies.",
  "access.postgresql.objectCatalog": "Object catalog read",
  "access.postgresql.programmabilityCatalog": "Routine and trigger catalog read",
  "access.postgresql.usage": "Schema USAGE",
  "access.postgresql.definitionState": "Definition read",
  "access.postgresql.visibility":
    "The capture does not establish complete metadata visibility. Review catalog evidence and schema USAGE with the database administrator.",
  "access.postgresql.noEvidence": "Native permission evidence was not recorded.",
  "access.code.permissionDenied": "Catalog permission was denied.",
  "trigger.notRead.permissionDenied":
    "Trigger catalog permission was denied. Review native access evidence.",
  "dependencies.reason.permissionDenied":
    "Dependency catalog permission was denied. Other schema families remain usable.",
  "objects.notice.permissionDenied": "Routine catalog permission was denied.",
} as const;
