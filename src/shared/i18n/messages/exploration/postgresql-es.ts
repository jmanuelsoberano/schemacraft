export const spanishPostgresqlMessages = {
  "module.native.tracking.title": "Evidencia de dependencias de la rutina",
  "module.native.tracking.parsedSqlBody": "Cuerpo SQL analizado",
  "module.native.tracking.parsedSqlBody.hint":
    "PostgreSQL guarda un cuerpo SQL analizado y su catálogo puede registrar referencias del cuerpo. El SQL dinámico y las referencias en ejecución siguen sin ser exhaustivos.",
  "module.native.tracking.signatureOnly": "Solo la firma",
  "module.native.tracking.signatureOnly.hint":
    "El catálogo registra la firma de la rutina, no las referencias dentro de su cuerpo PL o de texto. Una lista vacía no demuestra que el cuerpo no tenga dependencias.",
  "module.native.tracking.unknown": "Seguimiento desconocido",
  "module.native.tracking.unknown.hint":
    "Este lector no entiende la evidencia registrada sobre el seguimiento del cuerpo de la rutina.",
  "module.native.tracking.notRecorded": "Seguimiento sin registrar",
  "module.native.tracking.notRecorded.hint":
    "Esta captura no registró si PostgreSQL sigue las referencias dentro del cuerpo de esta rutina.",
  "connection.provider": "Motor de base de datos",
  "connection.postgresql.server.placeholder": "localhost:5432 o [::1]:5432",
  "connection.postgresql.server.hint":
    "Servidor y puerto TCP opcional. Los puertos IPv6 requieren corchetes; no se aceptan URI de conexión ni instancias con nombre.",
  "connection.postgresql.server.invalid":
    "Escribe un servidor PostgreSQL y un puerto TCP opcional válido.",
  "connection.postgresql.encryption.verifyFull": "TLS: verificar CA y servidor (recomendado)",
  "connection.postgresql.encryption.require":
    "TLS sin verificar certificado (solo desarrollo local)",
  "connection.postgresql.encryption.disable": "Sin cifrado (solo desarrollo local)",
  "connection.postgresql.encryption.hint":
    "Las conexiones remotas requieren TLS verificado. Las excepciones se limitan a localhost o direcciones de bucle local.",
  "connection.postgresql.encryption.localOnly":
    "Esta excepción de transporte solo se permite para un servidor de desarrollo local.",
  "connection.postgresql.rootCertificate": "CA raíz pública adicional (PEM, opcional)",
  "connection.postgresql.rootCertificate.hint":
    "Pega un certificado público de CA, nunca una clave privada. Déjalo vacío para usar la confianza del sistema.",
  "connection.postgresql.rootCertificate.invalid":
    "Usa un certificado público de CA; no se aceptan claves privadas.",
  "access.postgresql.title": "Evidencia del catálogo de PostgreSQL",
  "access.postgresql.description":
    "Ver el catálogo y tener USAGE en el esquema no implica permiso de lectura de datos ni conocer todas las dependencias de las rutinas.",
  "access.postgresql.objectCatalog": "Catálogo de objetos leído",
  "access.postgresql.programmabilityCatalog": "Catálogo de rutinas y desencadenadores leído",
  "access.postgresql.usage": "USAGE en el esquema",
  "access.postgresql.definitionState": "Lectura de definiciones",
  "access.postgresql.visibility":
    "La captura no prueba visibilidad completa de metadatos. Revisa la evidencia del catálogo y USAGE en los esquemas con quien administra la base.",
  "access.postgresql.noEvidence": "No se registró evidencia de permisos nativos.",
  "access.code.permissionDenied": "Se denegó el permiso del catálogo.",
  "trigger.notRead.permissionDenied":
    "Se denegó el permiso del catálogo de desencadenadores. Revisa la evidencia de acceso.",
  "dependencies.reason.permissionDenied":
    "Se denegó el permiso del catálogo de dependencias. Las demás familias de la captura siguen disponibles.",
  "objects.notice.permissionDenied": "Se denegó el permiso del catálogo de rutinas.",
} as const;
