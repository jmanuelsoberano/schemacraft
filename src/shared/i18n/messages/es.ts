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
  "sidebar.empty.title": "Aún no hay entidades",
  "sidebar.empty.description":
    "Conéctate a una base de datos o abre un proyecto .scraft para listar sus tablas aquí.",

  "welcome.title": "Te damos la bienvenida a SchemaCraft",
  "welcome.description":
    "Conéctate a Microsoft SQL Server, extrae el esquema y explóralo como un diagrama entidad-relación interactivo.",
  "welcome.connect": "Conectar a SQL Server",
  "welcome.openProject": "Abrir proyecto .scraft",

  "statusBar.notConnected": "Sin conexión",
  "statusBar.tables.one": "{count} tabla",
  "statusBar.tables.other": "{count} tablas",
  "statusBar.relations.one": "{count} relación",
  "statusBar.relations.other": "{count} relaciones",
  "statusBar.zoom": "Zoom {percent} %",
  "statusBar.version": "v{version}",
  "statusBar.versionUnavailable": "versión no disponible",
  "statusBar.devBuild": "dev",
};
