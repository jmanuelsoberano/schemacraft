# PRD - SchemaCraft v1.0
**Product Requirements Document**  
*Herramienta CASE de Escritorio para Ingeniería Inversa de Bases de Datos y Visualización de Diagramas Entidad-Relación (ERD)*

---

## 1. Resumen Ejecutivo y Visión del Producto

### 1.1 Nombre del Producto (Temporal)
**SchemaCraft** *(Subtítulo: Database Schema Reverse Engineering & Visual CASE Tool)*

### 1.2 Declaración del Problema
Analizar, documentar y comprender arquitecturas de bases de datos medianas y grandes (con decenas o cientos de tablas) es habitualmente un proceso lento y engorroso. Las herramientas actuales caen en extremos desfavorables:
1. **Suites CASE tradicionales y clientes pesados** (ej. SQL Server Management Studio, Erwin, Oracle SQL Developer): consumen excesivos recursos, sus diagramadores son rígidos o anticuados y la experiencia de usuario es tosca.
2. **Clientes livianos y herramientas web**: vuelven a consultar la base de datos cada vez que se requiere ver el diagrama, carecen de vistas jerárquicas dinámicas y exportan en formatos fragmentados o deficientes (documentos Word cortados, PDFs en múltiples páginas inutilizables).

### 1.3 Visión y Objetivo de la Solución
**SchemaCraft** es una herramienta CASE moderna, ultrarrápida, de escritorio y portátil, enfocada en la **ingeniería inversa visual** de bases de datos, con soporte nativo prioritario para **Microsoft SQL Server**.

Permite conectarse a una base de datos mediante autenticación mixta, extraer metadatos completos de esquemas, persistirlos en un archivo de proyecto local portable (evitando consultas redundantes), y manipular visualmente diagramas Entidad-Relación con múltiples vistas, algoritmos de layout avanzados y exportación en alta fidelidad de página única continua (SVG, HTML interactivo standalone y PDF póster).

---

## 2. Decisiones de Arquitectura y Stack Tecnológico

### 2.1 Stack Seleccionado: Tauri + Rust Core
- **Backend / Core Engine (Rust)**:
  - Manejo de conexiones y pools de base de datos a SQL Server (usando crates como `tiberius` sobre `tokio` / Named Pipes / TCP).
  - Consultas optimizadas al catálogo del sistema de SQL Server (`sys.tables`, `sys.columns`, `sys.foreign_keys`, `sys.indexes`).
  - Serialización y deserialización del archivo de proyecto `.scraft` (Serde).
  - Motor de cálculo de diferencias (Schema Diff Engine).
- **Frontend / Canvas Gráfico (Tauri Webview con Canvas/SVG)**:
  - Renderizado fluido a 60+ FPS de grafos con cientos de nodos.
  - Soporte de layouts automáticos mediante librerías de grafos de alta calidad (ej. ELK.js / Dagre / D3 / SvelteFlow o ReactFlow).
  - Interactividad: Zoom semántico, pan infinito, minimap interactivo y selección múltiple.
- **Forma de Distribución**:
  - **Ejecutable Portable Autónomo (`schemacraft.exe`)**: Un solo archivo ejecutable sin requerir instaladores. Usa el runtime Evergreen de Microsoft Edge WebView2, incluido en Windows 11 y en Windows 10 actualizado; si falta, la aplicación lo detecta al arrancar y ofrece la página de descarga.
  - **Instalador MSI/NSIS ligero**: Generado opcionalmente para empaquetado formal del sistema operativo.

---

## 3. Alcance Funcional de la Versión 1.0 (MVP) y Ampliaciones

### 3.1 Conector Prioritario: Microsoft SQL Server
- **Modos de Autenticación Soportados**:
  1. **SQL Server Authentication**: Usuario (`sa` o cuenta SQL) y contraseña.
  2. **Windows Authentication / Integrated Security**: Utiliza las credenciales activas del usuario o dominio de Windows sin requerir contraseña manual.
- **Parámetros de Conexión**:
  - Servidor / Host / Instancia (ej. `localhost`, `localhost\SQLEXPRESS`, `192.168.1.50,1433`).
  - Selección de Base de Datos / Catálogo.
  - Encriptación y validación de certificado (`TrustServerCertificate=true/false`).
  - Capacidad de filtrar por uno o varios esquemas (ej. `dbo`, `sales`, `hr`).
- **Seguridad**: Las contraseñas **nunca** se guardan en texto plano en los archivos de proyecto. Se almacenan temporalmente en memoria o en el Credential Manager del sistema operativo.
- **Historial de conexiones**: La aplicación recuerda las últimas conexiones utilizadas (servidor, base de datos, modo de autenticación y usuario; nunca la contraseña), permite rellenar el diálogo de conexión con un clic y quitar entradas. La opción "Recordar contraseña" guarda la contraseña únicamente en el Credential Manager del sistema operativo.

### 3.2 Introspección y Reverse Engineering (Solo Lectura)
- **Extracción Completa de Metadatos**:
  - Tablas y vistas relacionales.
  - Columnas: Nombre, tipo de datos nativo (`VARCHAR`, `INT`, `DECIMAL(18,2)`, `DATETIME2`, etc.), nulabilidad (`NULL` / `NOT NULL`) y valores por defecto.
  - Claves Primarias (PK).
  - Claves Foráneas (FK) con detección de tablas padre/hijo, columnas involucradas y reglas de integridad referencial.
  - Índices únicos y restricciones.
  - Inferencia de relaciones no foráneas mediante convenciones de nombrado (opcional configurable).

### 3.3 Gestión y Filtrado del Modelo
- **Panel Lateral de Entidades**:
  - Lista de todas las tablas con buscador por texto/prefijo.
  - Checkboxes para incluir u ocultar tablas manualmente (ej. ocultar tablas de logs, auditoría o tablas puente temporales).
  - Contador de tablas y relaciones visibles en el canvas.
- **Aislamiento de Subgrafos (Vecindarios Relacionales)**:
  - Opción de clic derecho en una tabla: "Aislar tabla y relaciones directas" (1 o 2 niveles de profundidad) para analizar módulos específicos sin saturarse con el resto de la base de datos.

### 3.4 Niveles de Detalle del Diagrama
Para facilitar la lectura en bases de datos con muchas tablas, el canvas ofrecerá 3 niveles de detalle (en la interfaz, "vista" nombra únicamente una vista de base de datos):
1. **Nivel Compacto (Header Only)**:
   - Muestra únicamente el nombre de la tabla, esquema y badge con el conteo total de columnas.
   - Ideal para obtener un mapa conceptual macro de la base de datos.
2. **Nivel Estándar (Claves)**:
   - Muestra el encabezado + solo las columnas que son PK o FK con iconos identificadores.
   - Ideal para comprender la topología relacional sin exceso de texto.
3. **Nivel Completo (Full Specification)**:
   - Muestra el encabezado, todas las columnas, tipos de datos completos y badges de nulabilidad/atributos.

### 3.5 Algoritmos de Disposición (Layout Engines)
El usuario puede cambiar la disposición del diagrama con un solo clic:
1. **Jerárquico / Sugiyama (Top-to-Bottom y Left-to-Right)**:
   - Organiza las entidades respetando la jerarquía de dependencias (tablas maestras arriba/izquierda, tablas dependientes/transaccionales abajo/derecha).
2. **Fuerza Dirigida / Orgánico (Force-Directed Clusters)**:
   - Las tablas fuertemente conectadas se agrupan por módulos o clusters naturales de dominio.
3. **Radial / Circular**:
   - Organiza el grafo en círculos concéntricos alrededor de la entidad o cluster central seleccionado.
4. **Manipulación Manual**:
   - Posibilidad de arrastrar cualquier tabla libremente.
   - Las líneas de relación (conectores ortogonales o Bézier) se recalculan dinámicamente sin colisionar con nodos.

### 3.6 Persistencia de Proyectos (Formato Nativo `.scraft`)
- **Regla Fundamental**: El usuario **no debe tener que volver a consultar la base de datos** cada vez que abre la herramienta o desea revisar un diagrama.
- **Proyectos recientes**: La pantalla de bienvenida lista los últimos proyectos `.scraft` abiertos para reabrirlos con un clic.
- **Contenido del archivo de proyecto (`.scraft` / JSON estructurado)**:
  - Metadatos de la conexión (servidor, base de datos, esquema, usuario — sin passwords).
  - Snapshot completo del esquema extraído (fecha y hora de extracción, tablas, columnas, relaciones).
  - Estado del canvas: Posiciones `(x, y)` de cada nodo, estado de colapso/expansión de tablas, nivel de zoom y layout activo.
- **Sincronización Diferencial ("Actualizar desde Base de Datos")**:
  - Compara el snapshot guardado contra el catálogo actual de SQL Server.
  - Muestra un resumen visual de cambios (nuevas tablas, columnas alteradas, relaciones eliminadas).
  - Aplica los cambios estructurales **preservando las posiciones visuales** de las tablas que no sufrieron cambios.

### 3.7 Exportación de Alta Calidad (Página Completa / No Fragmentada)
Se prohíben expresamente exportaciones en múltiples páginas cortadas que requieran unión manual:
1. **SVG Vectorial Continuo**:
   - Canvas vectorial infinito con estilos CSS limpios y texto seleccionable.
2. **HTML Standalone Interactivo**:
   - Archivo único `.html` autocontenido (con scripts y estilos embebidos).
   - Permite a cualquier persona abrir el archivo en su navegador y hacer pan, zoom y cambiar el nivel de detalle (compacto/claves/completo) sin tener SchemaCraft instalado.
3. **PDF Vectorial de Página Única (Póster)**:
   - Un solo lienzo continuo con dimensiones calculadas a partir del tamaño real del diagrama, garantizando nitidez total en cualquier nivel de aumento.
4. **PNG en Ultra-Alta Resolución (1x, 2x, 4x)**:
   - Exportación rasterizada nítida para presentaciones o documentación.

### 3.8 Ampliaciones de la Versión 1.1
Lo que la versión 1.1 añade al alcance de las secciones 3.1 a 3.7, ya publicadas en la versión 1.0.0.

- **Acceso Parcial Explicado (amplía 3.1 y 3.2)**:
  - Al elegir la base de datos, SchemaCraft comprueba qué puede ver el inicio de sesión, con una sola consulta de permisos, y lo indica antes de leer el esquema.
  - Muestra todo lo que el inicio de sesión puede leer. Las expresiones `CHECK` y `DEFAULT` que no puede leer se marcan como "no disponible", nunca como vacías o inexistentes, y las llaves foráneas hacia tablas no visibles para este inicio de sesión se conservan.
  - Con acceso completo no añade nada a la interfaz. Con acceso parcial muestra un indicador discreto en la barra de estado, un aviso descartable sobre la lista de entidades y un informe de acceso con lo que se leyó, lo que falta y por qué.
  - El informe ofrece copiar un script de mínimo privilegio (`GRANT VIEW DEFINITION`) para que un DBA lo ejecute; SchemaCraft nunca lo ejecuta. El script advierte que, desde SQL Server 2022, ese permiso también deja ver usuarios, roles y permisos, y no se ofrece cuando un `DENY` explícito explica lo que falta.
  - Si el inicio de sesión no ve ninguna tabla ni vista, lo explica y no permite leer el esquema. Una base de datos vacía, con permisos completos, sí se lee y muestra un estado vacío neutral.
  - Las exportaciones de una lectura parcial lo indican en una línea.
- **Formato `.scraft` 2 (amplía 3.6)**:
  - El archivo registra qué podía ver el inicio de sesión que leyó el esquema, incluido el nombre del usuario de base de datos, que nunca pasa a las exportaciones.
  - Los proyectos de la versión 1.0 se abren y se convierten al guardarlos; un proyecto guardado con la versión 1.1 necesita la 1.1 o posterior.
  - El encabezado indica también la versión mínima de lector (`minReaderVersion`). Un proyecto guardado por una versión más nueva se abre en solo lectura cuando esa versión lo permite (se puede reorganizar y exportar, pero no guardar ni actualizar) y se rechaza con un mensaje claro en caso contrario.
  - Los datos que esta versión no entiende se conservan al guardar.
- **Actualización con Menos Permisos (amplía 3.6)**: actualizar desde la base de datos con un inicio de sesión que ve menos nunca presenta como eliminado lo que no puede ver: lo conserva, lo marca como no comprobado con la fecha en que se leyó y lo muestra en la revisión. Lo que se vuelve legible, por ejemplo después de conceder `VIEW DEFINITION`, también aparece en la revisión y se guarda al aplicarla.
- **Tablas y Vistas Diferenciadas (amplía 3.3, 3.4 y 3.7)**:
  - El panel lateral agrupa las entidades por esquema y, dentro de cada esquema, en las secciones Tablas y Vistas con su conteo. Un nivel se muestra solo cuando distingue algo: con un único esquema no hay nivel de esquema y con un único tipo no hay nivel de tipo; la forma se decide sobre la lista completa, así no cambia mientras se escribe en el buscador. Los esquemas y las secciones se pliegan con un chevrón, se recuerdan durante la sesión y se muestran todos desplegados mientras hay una búsqueda activa.
  - Las vistas de base de datos se distinguen de las tablas en los tres niveles de detalle con la etiqueta VISTA, un icono y un color propios, nunca con un borde discontinuo. En el nivel Claves una vista aparece como tarjeta compacta con la etiqueta y su número de columnas; el chevrón de plegado aparece solo en las tarjetas que tienen filas que ocultar.
  - La paleta de comandos indica el tipo (tabla o vista) de cada entidad. Todas las exportaciones (SVG, PDF, PNG) y el visor HTML muestran la misma distinción que el lienzo, con la etiqueta en el idioma de la interfaz; la búsqueda del visor indica el tipo de cada resultado.
  - En la interfaz, "vista" nombra únicamente una vista de base de datos: los comandos del encuadre pasan a llamarse "Centrar en pantalla" y "Ajustar el diagrama a la ventana", y compacto, claves y completo son niveles de detalle (3.4 y 3.7 se redactan así).
- **Panel Inspector (amplía 3.3 y 3.7)**:
  - Un panel a la derecha del lienzo muestra los detalles de la tabla o vista seleccionada: columnas (tipo, nulabilidad, identidad, calculada y valor por defecto), clave primaria, índices, restricciones `CHECK` y llaves foráneas en ambos sentidos, y junto a cada dato lo que el inicio de sesión pudo ver: "no disponible" para un texto que no puede leer, "no registrado" en un proyecto convertido de la 1.0, "sin comprobar desde" una fecha para un dato conservado de una lectura anterior y "una tabla no visible para este inicio de sesión" como destino de una llave. Todas las secciones aparecen siempre, en un orden fijo; una sección vacía dice "ninguno" solo cuando la lista es completa, y un enlace "¿Por qué?" abre el informe de acceso.
  - Empieza cerrado y se abre con doble clic en una tarjeta o en una fila del panel de entidades, con Enter sobre una tarjeta enfocada, con Ctrl+I o con "Mostrar detalles" en el menú contextual. Una vez abierto sigue la selección del lienzo: nada o varias entidades seleccionadas muestran un estado vacío, y una entidad oculta en el lienzo no se puede inspeccionar. Abierto desde el teclado toma el foco; Escape devuelve el foco a la tarjeta y deja el panel abierto; Ctrl+I o su botón de cerrar lo cierran. Se redimensiona desde su borde y recuerda su ancho; si estaba abierto no se guarda.
  - Los niveles de detalle tienen atajo (Ctrl+1, Ctrl+2 y Ctrl+3) y, junto con el tema y el idioma, son comandos de la paleta. En español los niveles se llaman Compacto, Claves y Completo.
  - El panel de detalle del visor HTML se construye con el mismo modelo que el Inspector y muestra las mismas secciones, en el mismo orden, con las mismas palabras y los mismos estados, pero solo para lo que está en el diagrama exportado: no lista las relaciones con tablas que quedaron fuera del diagrama, una lista de relaciones vacía dice "Ninguna en el diagrama" y no hay enlaces "¿Por qué?"; el archivo HTML lleva los textos del visor en el idioma de la exportación, y elegir un resultado de la búsqueda o seguir una relación mueve el foco al panel.

---

## 4. Requisitos No Funcionales y Calidad de Código

1. **Rendimiento**:
   - Conexión e introspección de esquemas de 150 tablas en menos de 3 segundos sobre red local.
   - Renderizado del canvas a 60 FPS con zoom y pan fluidos.
2. **Legibilidad y Mantenibilidad**:
   - Código en Rust idiomático, con nombres descriptivos en inglés.
   - Modularidad estricta (Clean Architecture):
     - `core/inspectors`: Implementación de la introspección SQL Server desacoplada vía traits (`DatabaseInspector`).
     - `core/model`: Estructuras de datos puras del esquema relacional.
     - `core/project`: Serialización y gestión del archivo `.scraft`.
     - `core/diff`: Motor de comparación de versiones de esquema.
     - `ui`: Componentes del canvas y barra de herramientas.
3. **Patrones de Diseño Justificados**:
   - **Strategy**: Para el inspector de bases de datos (dejando la puerta abierta para agregar PostgreSQL/MySQL en v2 sin tocar el resto del sistema).
   - **Builder**: Para construir las especificaciones de exportación (SVG, HTML, PDF).
   - **Memento**: Para guardar y restaurar estados del lienzo.
4. **Experiencia de Usuario (UX)**:
   - La calidad de la interfaz es un requisito de producto, no un acabado final: la herramienta debe ser moderna, de buen gusto, fácil de usar y agradable durante sesiones largas de trabajo.
   - Referencia de estilo: minimalista y densa, al estilo de Linear o Figma. El diagrama es el protagonista; el chrome de la interfaz es mínimo y colapsable.
   - Interfaz bilingüe (inglés y español) con selector en la aplicación. Todos los textos viven en catálogos de mensajes tipados, con plurales correctos; una traducción faltante debe fallar en compilación.
   - Tema claro y oscuro derivados de un único conjunto de tokens de diseño, siguiendo el tema del sistema operativo por defecto y con cambio manual.
   - Todo alcanzable con teclado: cada acción tiene un atajo visible en tooltips y menús, el foco es siempre visible y existe una paleta de comandos.
   - Respuesta inmediata: feedback en menos de 100 ms; las operaciones largas (introspección, exportación) muestran progreso real y permiten cancelar.
   - Errores accionables: nunca texto crudo de excepciones; cada error dice qué ocurrió y qué hacer a continuación.
   - **Definición de terminado UX por funcionalidad**: acción registrada con tooltip y atajo; estados de carga, vacío y error; verificada en tema claro y oscuro; verificada en inglés y español; navegable con teclado y con nombres accesibles; sin saltos de layout; contraste WCAG AA.
   - Los principios completos, los flujos clave y el lenguaje visual se mantienen en el repositorio en `docs/ux-principles.md`.

---

## 5. Criterios de Aceptación (Definition of Done)

- [ ] Se conecta a SQL Server usando tanto SQL Server Authentication como Windows Authentication.
- [ ] Extrae esquemas completos con PKs, FKs y tipos de datos nativos.
- [ ] Permite ocultar/mostrar tablas manualmente y aislar vecindarios relacionales.
- [ ] Ofrece al menos 3 niveles de detalle (Compacto, Claves, Completo).
- [ ] Ofrece al menos 2 layouts automáticos (Jerárquico y Orgánico) más posicionamiento manual.
- [ ] Guarda el proyecto en `.scraft` y se vuelve a abrir instantáneamente sin conexión a la BD.
- [ ] Permite refrescar el esquema contra la BD preservando las coordenadas del diagrama.
- [ ] Exporta a SVG, HTML interactivo standalone y PDF póster continuo de página única.
- [ ] Se distribuye y ejecuta como un binario portable `.exe` en Windows.
- [ ] La interfaz es bilingüe (inglés y español), ofrece tema claro y oscuro, y cada funcionalidad cumple la definición de terminado UX de `docs/ux-principles.md`.

---

## 6. Historial de Cambios

- **2026-10-13**: Se añade el requisito no funcional 4 (Experiencia de Usuario) y su criterio de aceptación, acordados al cierre del Paso 1 de construcción.
- **2026-10-13**: Se añaden el historial de conexiones recientes (3.1) y los proyectos recientes (3.6), acordados al planificar el Paso 3.
- **2026-10-15**: Se precisa en 2.1 que el ejecutable portable usa el runtime WebView2 de Windows, como ya hace la versión 1.0.0.
- **2026-10-15**: Se crea la sección 3.8 para las ampliaciones de la versión 1.1 y se añade su primera parte: el acceso parcial explicado (comprobación de permisos, informe de acceso) y el formato `.scraft` 2 con lectura compatible hacia adelante.
- **2026-10-16**: Se añade a 3.8 la segunda parte de la versión 1.1: secciones por esquema y tipo en el panel de entidades, y vistas diferenciadas con etiqueta, icono y color propios en el lienzo, la paleta de comandos y todas las exportaciones. 3.4 pasa a llamarse "Niveles de Detalle del Diagrama" y 3.4 y 3.7 dejan de usar "vista" para los niveles de detalle, porque en la interfaz esa palabra nombra únicamente una vista de base de datos.
- **2026-10-16**: Se añade a 3.8 la tercera parte de la versión 1.1: el panel Inspector, que comparte con el panel de detalle del visor HTML un único modelo de datos, los atajos de los niveles de detalle y los comandos de tema e idioma en la paleta. El criterio de la sección 5 sobre los niveles pasa a decir "niveles de detalle (Compacto, Claves, Completo)".
