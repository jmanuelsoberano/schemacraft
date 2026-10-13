import type { MessageCatalog } from "./en";

export const spanishMessages: MessageCatalog = {
  "app.name": "SchemaCraft",
  "app.tagline": "Ingeniería inversa de esquemas SQL Server en diagramas vivos.",

  "project.untitled": "Proyecto sin título",

  "action.connect": "Conectar a SQL Server",
  "action.openProject": "Abrir proyecto",
  "action.saveProject": "Guardar proyecto",
  "action.refreshFromDatabase": "Actualizar desde la base de datos",
  "action.autoLayout": "Disposición automática",
  "action.export": "Exportar diagrama",
  "action.toggleSidebar": "Mostrar u ocultar el panel de entidades",

  "toolbar.connect": "Conectar",

  "common.comingSoon": "Disponible en un próximo hito",

  "menu.theme": "Tema",
  "theme.system": "Sistema",
  "theme.light": "Claro",
  "theme.dark": "Oscuro",

  "menu.language": "Idioma",
  "language.en": "English",
  "language.es": "Español",

  "viewMode.label": "Nivel de detalle",
  "viewMode.compact": "Compacta",
  "viewMode.compact.hint": "Solo encabezados de tabla",
  "viewMode.keys": "Claves",
  "viewMode.keys.hint": "Claves primarias y foráneas",
  "viewMode.full": "Completa",
  "viewMode.full.hint": "Todas las columnas y tipos",

  "sidebar.title": "Entidades",
  "sidebar.search": "Buscar tablas",
  "sidebar.search.noMatches": 'Ninguna entidad coincide con "{query}"',
  "sidebar.empty.title": "Aún no hay entidades",
  "sidebar.empty.description":
    "Conéctate a una base de datos o abre un proyecto .scraft para listar sus tablas aquí.",

  "entity.table": "Tabla",
  "entity.view": "Vista",
  "entity.columns.one": "{count} columna",
  "entity.columns.other": "{count} columnas",

  "welcome.title": "Te damos la bienvenida a SchemaCraft",
  "welcome.description":
    "Conéctate a Microsoft SQL Server, extrae el esquema y explóralo como un diagrama entidad-relación interactivo.",
  "welcome.connect": "Conectar a SQL Server",
  "welcome.openProject": "Abrir proyecto .scraft",

  "canvas.loaded.one": "{count} entidad cargada. El diagrama llega en el próximo hito.",
  "canvas.loaded.other": "{count} entidades cargadas. El diagrama llega en el próximo hito.",

  "statusBar.notConnected": "Sin conexión",
  "statusBar.connected": "{target} · {database}",
  "statusBar.tables.one": "{count} tabla",
  "statusBar.tables.other": "{count} tablas",
  "statusBar.views.one": "{count} vista",
  "statusBar.views.other": "{count} vistas",
  "statusBar.relations.one": "{count} relación",
  "statusBar.relations.other": "{count} relaciones",
  "statusBar.zoom": "Zoom {percent} %",
  "statusBar.version": "v{version}",
  "statusBar.versionUnavailable": "versión no disponible",
  "statusBar.devBuild": "dev",

  "connection.dialog.title": "Conectar a SQL Server",
  "connection.dialog.description":
    "Acceso de solo lectura al catálogo. La contraseña se mantiene en memoria y nunca se guarda.",
  "connection.section.server": "Servidor",
  "connection.section.database": "Base de datos",
  "connection.field.server": "Servidor",
  "connection.field.server.placeholder": "localhost\\SQLEXPRESS o 192.168.1.50,1433",
  "connection.field.server.hint": "Host, host\\instancia o host,puerto. Usa . para este equipo.",
  "connection.field.server.errorEmpty": "Escribe el nombre del servidor.",
  "connection.field.server.errorPort": "El puerto debe ser un número entre 1 y 65535.",
  "connection.field.authentication": "Autenticación",
  "connection.authentication.integrated": "Windows",
  "connection.authentication.integrated.hint": "Credenciales del usuario actual de Windows",
  "connection.authentication.sqlLogin": "SQL Server",
  "connection.authentication.sqlLogin.hint": "Un inicio de sesión de SQL Server y su contraseña",
  "connection.field.username": "Inicio de sesión",
  "connection.field.username.errorEmpty": "Escribe el nombre de inicio de sesión.",
  "connection.field.password": "Contraseña",
  "connection.field.encryption": "Cifrado",
  "connection.encryption.mandatory": "Obligatorio",
  "connection.encryption.optional": "Opcional",
  "connection.encryption.strict": "Estricto (TDS 8.0)",
  "connection.field.trustCertificate": "Confiar en el certificado del servidor",
  "connection.field.trustCertificate.description":
    "Omite la validación del certificado. Solo para servidores que controlas.",
  "connection.field.database": "Base de datos",
  "connection.field.database.placeholder": "Elige una base de datos",
  "connection.field.database.hint":
    "Prueba la conexión para listar las bases de datos que puedes abrir.",
  "connection.field.schemas": "Esquemas",
  "connection.schemas.all": "Todos los esquemas",
  "connection.schemas.loading": "Cargando esquemas…",
  "connection.field.includeViews": "Incluir vistas",
  "connection.action.test": "Probar conexión",
  "connection.action.connect": "Leer esquema",
  "connection.action.cancel": "Cancelar",
  "connection.action.close": "Cerrar",
  "connection.action.trustAndRetry": "Confiar en el certificado y reintentar",
  "connection.action.retry": "Reintentar",
  "connection.status.testing": "Probando la conexión…",
  "connection.status.tested.title": "Conectado a {server}",
  "connection.status.tested.detail": "{product} · {edition}",
  "connection.progress.title": "Leyendo el esquema de {database}",
  "connection.progress.description":
    "Las consultas al catálogo corren en paralelo, así que las etapas pueden terminar en cualquier orden.",
  "connection.progress.cancelling": "Cancelando…",
  "connection.stage.connecting": "Conectando",
  "connection.stage.readingObjects": "Tablas y vistas",
  "connection.stage.readingColumns": "Columnas y tipos",
  "connection.stage.readingIndexes": "Claves e índices",
  "connection.stage.readingForeignKeys": "Claves foráneas",
  "connection.stage.readingConstraints": "Restricciones check",
  "connection.stage.assembling": "Ensamblando el snapshot",

  "error.invalidSettings.title": "Parámetros de conexión no válidos",
  "error.invalidSettings.hint": "Revisa los campos de servidor, inicio de sesión y base de datos.",
  "error.unreachable.title": "No se puede alcanzar el servidor",
  "error.unreachable.hint":
    "Comprueba el nombre del servidor, que SQL Server esté en ejecución, que TCP/IP esté habilitado y que el firewall permita el puerto 1433, o UDP 1434 para instancias con nombre.",
  "error.timeout.title": "La conexión superó el tiempo de espera",
  "error.timeout.hint":
    "El servidor no respondió a tiempo. Comprueba la ruta de red y el nombre de la instancia.",
  "error.authenticationFailed.title": "El inicio de sesión fue rechazado",
  "error.authenticationFailed.hint":
    "Comprueba el nombre de inicio de sesión y la contraseña, o usa autenticación de Windows si tu cuenta tiene acceso.",
  "error.authenticationFailed.hint.integrated":
    "El servidor no aceptó tu cuenta de Windows. Comprueba que tenga un inicio de sesión allí o cambia a autenticación de SQL Server.",
  "error.untrustedCertificate.title": "El certificado del servidor no es de confianza",
  "error.untrustedCertificate.hint":
    "El servidor usa un certificado que este equipo no puede verificar, algo habitual en instancias de desarrollo. Confía en él para esta conexión o instala su autoridad certificadora.",
  "error.databaseUnavailable.title": "La base de datos no está disponible",
  "error.databaseUnavailable.hint":
    "No existe, está fuera de línea o el inicio de sesión no puede abrirla.",
  "error.connectionRefused.title": "El servidor rechazó la sesión",
  "error.connectionRefused.hint":
    "La conexión de red funcionó, pero el servidor rechazó la secuencia de inicio de sesión. Los detalles pueden indicar el motivo.",
  "error.queryFailed.title": "No se pudo leer el catálogo",
  "error.queryFailed.hint":
    "Falló una consulta al catálogo. Los detalles pueden indicar el motivo; repórtalo si persiste.",
  "error.unexpectedCatalogData.title": "Datos de catálogo inesperados",
  "error.unexpectedCatalogData.hint":
    "El servidor devolvió datos que SchemaCraft no entiende. Repórtalo junto con los detalles.",
  "error.cancelled.title": "Cancelado",
  "error.cancelled.hint": "La operación se detuvo antes de terminar.",
  "error.unsupportedOnPlatform.title": "No compatible con esta plataforma",
  "error.unsupportedOnPlatform.hint":
    "La autenticación de Windows solo está disponible en Windows.",
  "error.unknownJob.title": "Nada que cancelar",
  "error.unknownJob.hint": "La operación ya había terminado.",
  "error.ipcUnavailable.title": "Las funciones de escritorio no están disponibles",
  "error.ipcUnavailable.hint":
    "Esta ventana se ejecuta fuera de la aplicación de escritorio. Conéctate desde SchemaCraft.",
  "error.unexpected.title": "Algo salió mal",
  "error.unexpected.hint": "Inténtalo de nuevo. Si se repite, repórtalo junto con los detalles.",
};
