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
- **Reglas Legibles (amplía 3.2, 3.3 y 3.7)**:
  - El Inspector y el panel de detalle del visor HTML explican en frases, en inglés y en español, las restricciones `CHECK` habituales: comparaciones, listas de valores, rangos, patrones `LIKE`, valores obligatorios (`NOT NULL`), longitudes y sus combinaciones. Una regla sobre una columna que acepta NULL se presenta bajo "Cuando … tiene un valor:", porque SQL Server acepta la fila cuando la columna es NULL, y una regla deshabilitada bajo "Cuando se habilite:"; para ello la extracción registra también si cada `CHECK` está habilitada (amplía 3.2).
  - Las llaves foráneas se explican por filas, nombrando las tablas tal como son y sin convertir sus nombres en sustantivos ("Cada fila de sales.Orders pertenece exactamente a una fila de dbo.Customers"): si la relación es obligatoria (una llave con alguna columna que acepta NULL es opcional, porque SQL Server no comprueba la llave en las filas donde alguna de sus columnas es NULL), cuántas filas pueden apuntar a una misma fila y qué hacen sus acciones `ON DELETE` y `ON UPDATE`. La etiqueta de una relación en el lienzo muestra además qué ocurre al borrar una fila referenciada.
  - La lectura es todo o nada: lo que SchemaCraft no puede leer entero se muestra como SQL, nunca como una frase a medias, y las frases solo afirman lo que SQL Server hace cumplir al escribir los valores; las comparaciones de texto llevan una nota sobre la intercalación de la columna. El SQL queda a un clic, con un botón para copiarlo en la aplicación: la definición almacenada de un `CHECK` o, para una llave, una sentencia generada a partir del catálogo; una llave hacia una tabla no visible no tiene SQL.
  - Señalar una regla con el puntero o con el teclado resalta sus columnas en las tarjetas y en el panel y, si es una llave, su relación en el lienzo, sin cambiar la selección; el visor HTML hace lo mismo sobre el diagrama exportado.
  - Las relaciones se dibujan en la notación estándar de pata de gallo, en el lienzo y en todas las exportaciones: en la tabla que referencia, una pata de gallo, o cero o uno para una llave uno a uno; en la tabla referenciada, una barra, o una barra y un círculo (cero o uno) cuando alguna columna de la llave acepta NULL. Los diagramas y las exportaciones existentes cambian de aspecto.

### 3.9 Ampliaciones de la Versión 1.2
Lo que la versión 1.2 añade al alcance de las secciones 3.1 a 3.8, ya publicadas en la versión 1.1.0.

- **Objetos Programables (amplía 3.2, 3.3 y 3.7)**:
  - La extracción lee, además de las tablas y las vistas, el código de las vistas (su definición, si se creó `WITH CHECK OPTION` y si está indexada), los procedimientos almacenados y las funciones escalares y de tabla, incluidos los escritos en CLR (todos con sus parámetros en orden, y las funciones además con el tipo que devuelven o, si son de tabla, con sus columnas), y los desencadenadores (triggers) DML de tablas y vistas: si se ejecutan `AFTER` o `INSTEAD OF`, qué sentencias los disparan, el orden `First` o `Last` fijado para cada sentencia, si están habilitados y si son `NOT FOR REPLICATION`. Los desencadenadores de base de datos (DDL), los sinónimos, los tipos de tabla y las dependencias entre objetos quedan para una versión posterior.
  - Cada texto de código dice en qué estado está y nunca presenta una ausencia como un hecho: legible, no visible para este inicio de sesión, cifrado (`WITH ENCRYPTION`, cuyo texto SQL Server no devuelve por el catálogo a ningún inicio de sesión, ni siquiera al propietario de la base de datos), CLR (el código está en un ensamblado .NET), no leído (las opciones de la conexión lo dejaron fuera) y no registrado (un proyecto anterior a la 1.2). Un parámetro no muestra valor por defecto, porque SQL Server solo lo guarda dentro del texto del módulo.
  - El diálogo de conexión ofrece dos opciones, activadas por defecto: "Leer procedimientos, funciones y desencadenadores" y "Guardar su código en el proyecto"; la segunda solo se aplica con la primera activada. Al actualizar en la 1.2 un proyecto de la 1.1, SchemaCraft lee y guarda el código salvo que el usuario desmarque las casillas, y la revisión lo dice antes de aplicar. Con la primera opción activada, los esquemas que solo contienen código se ofrecen en el filtro de esquemas cuando el inicio de sesión ve alguna tabla o vista.
  - Si la lectura del código falla o se agota su tiempo, la extracción no falla: las tablas y las vistas se leen igual, el fallo queda registrado y el código guardado se conserva como no comprobado.
  - El panel de entidades pasa a llamarse "Objetos" y añade en cada esquema las secciones Procedimientos y Funciones, plegadas por defecto; la paleta de comandos encuentra objetos de todos los tipos. El Inspector tiene páginas para procedimientos, funciones y desencadenadores, añade a las tablas y vistas una sección de desencadenadores y a las vistas su definición, y muestra el código en un visor propio de solo lectura con números de línea, ajuste de líneas, botón de copiar y búsqueda (Ctrl+F, F3 y Mayús+F3).
  - Cada tarjeta con desencadenadores lleva una insignia con su número en el lienzo y en todas las exportaciones (SVG, PDF, PNG y HTML); las exportaciones estáticas añaden una leyenda y, cuando la extracción no leyó los desencadenadores, una nota que lo dice.
  - Ninguna exportación lleva código. El visor HTML muestra los desencadenadores de los objetos del diagrama sin su texto, y la definición de una vista dice "No incluido en este archivo".
  - Lo que el inicio de sesión ve del código se informa aparte, en el informe de acceso, y no cambia el nivel de acceso de la 1.1, que sigue juzgándose sobre las tablas, las vistas y los textos `CHECK` y `DEFAULT`.
- **Estado de Índices y Restricciones (amplía 3.2)**:
  - La extracción registra si un índice o una clave primaria está deshabilitado, si un índice está filtrado, sus columnas incluidas (`INCLUDE`) y si SQL Server considera confiable cada `CHECK` y cada llave foránea, lo que normalmente significa que comprobó las filas existentes.
  - Una restricción única o una clave primaria cuyo índice no agrupado está deshabilitado ya no hacen que la llave foránea diga que una fila de la tabla referenciada puede estar referenciada como mucho por una fila, ni que se dibuje el marcador uno a uno, lo que corrige la limitación conocida de la versión 1.1.0. Un índice único habilitado y sin filtro, con el que la 1.1 dejaba esa frase fuera, ahora la da y dibuja el marcador uno a uno; uno filtrado la sigue dejando fuera. Al actualizar, algunos diagramas y exportaciones existentes cambian de marcador. Una regla que SQL Server no considera confiable (por ejemplo, creada `WITH NOCHECK`) dice que las filas que ya existen pueden no cumplirla, sin afirmar por qué. Las columnas de la clave de un índice particionado ya no incluyen la columna de partición que SQL Server añade por su cuenta.
  - Un proyecto guardado por la 1.1 conserva la lectura de la 1.1 hasta que una actualización registre ese estado.
- **Actualización del Código (amplía 3.6)**:
  - Actualizar con un inicio de sesión que ve menos nunca presenta como eliminado un procedimiento, una función o un desencadenador que no puede ver: lo conserva y lo marca como no comprobado con la fecha en que se leyó, como hace la 1.1 con las tablas. Solo desactivar la opción quita el código, y la revisión lo muestra como una eliminación.
  - El código se compara sin tener en cuenta los finales de línea ni los espacios al final de cada línea, para que volver a crear un objeto sin cambios no se lea como un cambio. Pasar de legible a cifrado, o al revés, se informa como un cambio de cifrado.
  - La primera actualización de un proyecto de la 1.1 muestra una línea por cada clase de información que registra por primera vez (los objetos programables, su código y el estado de índices y restricciones), en lugar de cientos de altas.
- **Formato `.scraft` 3 (amplía 3.6)**:
  - El archivo puede contener el código de vistas, procedimientos, funciones y desencadenadores. Ese código es lógica de negocio y puede incluir credenciales, así que el archivo debe tratarse como el código fuente de la base de datos; ninguna exportación lo lleva y el README lo advierte.
  - Los proyectos de las versiones 1.0 y 1.1 se abren y se convierten al guardarlos. Lo que esas versiones no registraron queda como "no registrado", nunca como "ninguno" ni como "no".
  - La versión mínima de lector (`minReaderVersion`) sigue siendo 2: la versión 1.1 abre en solo lectura un proyecto guardado por la 1.2, sin su código, y no puede guardarlo ni actualizarlo; la versión 1.0 lo rechaza.
- **SQL Server 2019 y 2022 (amplía 3.1)**: las pruebas de integración se ejecutan contra SQL Server 2019 y 2022 en cada cambio del núcleo. SQL Server 2016 y 2017 se admiten sin pruebas automáticas.
- **Registro de Diagnóstico Local (amplía 4)**: SchemaCraft guarda en el equipo del usuario un registro para informes de errores, un archivo por día y siete como máximo, con versiones, conteos, tiempos, tamaños y tipos y números de error, nunca nombres de servidores, inicios de sesión, bases de datos u objetos, rutas, código ni contraseñas, y nunca lo envía a ningún sitio. "Acerca de" muestra la carpeta y la abre, y la paleta de comandos también la abre.
- **Medición sin Compartir la Base de Datos**: un script T-SQL de solo lectura, que el propietario de una base de datos ejecuta él mismo con el inicio de sesión que usa SchemaCraft, mide lo que SchemaCraft leería de ella y devuelve solo números, nunca nombres ni textos.

---

### 3.10 Support workflow (1.3.0)

- **Report a problem** is available from About and the command palette, in English and Spanish
  and both themes, without requiring an open project or a SQL connection.
- Prepare a local, read-only preview with application version/build, OS family, architecture,
  WebView2 version and UTC generation time, plus up to seven recognized local diagnostic files.
  File selection is nonrecursive and excludes projects, preferences, connection history and
  stored credentials. Large files are bounded and visibly identified as partial.
- Save the exact preview as one readable UTF-8 `.txt` file through the native save dialog.
  Cancellation writes nothing; errors retain the preview and explain how to retry. Empty or
  unavailable logs do not prevent reporting a problem without an attachment.
- Opening the public GitHub bug form is a separate explicit action. Only the application
  version is prefilled; no diagnostic content or file is uploaded. The user decides what to
  attach and submits the issue themselves. Security reports use the existing private channel.
- Closing the support dialog discards its in-memory preview and does not change the project,
  connection, preferences, credentials or release channel. This feature does not change the
  published 1.2.0 binaries or the current Store submission.

### 3.11 Independent project comparison (1.3.0)

- Compare two explicitly selected `.scraft` captures as Reference and Compared, including files
  from different servers or databases of the same engine. Swapping sides reverses the comparison.
  No database connection, DDL execution, active-project update or automatic rename matching occurs.
- Compare tables, columns, keys, indexes, constraints, views, routines, triggers, recorded native
  settings and dependencies by structured identity. PostgreSQL overloads include their input
  type identities. Compare capture observations rather than file-save timestamps or diagram positions.
- Distinguish confirmed differences and proved absence from excluded, invisible, unrecorded,
  retained, failed and unknown facts. A confirmed property difference may coexist with limitations
  elsewhere. Do not claim an addition, removal or complete equality without the necessary evidence.
- Show exact source changes locally on demand, with original whitespace and line endings,
  bounded pages, work limits and cancellation. Distinguish exact text equality from the legacy
  normalization used by refresh; neither establishes semantic SQL equivalence.
- Offer filters, per-side diagram context and an explicit offline HTML report preview. Save only
  the reviewed filtered projection, including visible context diagrams, structural evidence and
  limitations. Exclude module bodies, notes, paths, connection/user details, raw access probes,
  unknown extensions and names outside the included scope. No report is uploaded automatically.

### 3.12 Known catalog dependencies (1.3.0)

- Capture known dependency references independently of module-source storage, with a separate
  option enabled by default. Record the query outcome, selected scope, source coverage,
  observation dates, retained state and discovery limitations. A missing family is unrecorded,
  and an unsuccessful read is never a successfully observed empty list.
- Show incoming and outgoing references for tables, views, routines and triggers. Distinguish
  inspected targets from external, excluded, invisible, unsupported, unresolved, ambiguous and
  caller-dependent references. Do not follow external connections or infer references by running
  SQL, parsing stored bodies or assuming dynamic/application code is known.
- Explore a separate directed map with direction and depth controls, bounded results, search,
  node movement and explicit truncation. Preserve cycles and self-references. Dependency arrows
  mean references and do not alter foreign-key relationships or the saved ERD layout.
- Export the reviewed map as SVG, PNG, single-page PDF or offline interactive HTML. Include
  only its closed projected nodes, edges, evidence dates and limitations; exclude raw external
  server/database names, module source, credentials, notes and unknown data.
- Refresh successful sources and preserve earlier reference evidence when a later read cannot
  verify it. A deliberate capture exclusion is reported separately from lost visibility.

### 3.13 Saved perspectives and shared notes (1.3.0)

- Keep one General diagram and any number of named perspectives over the same captured snapshot.
  Each perspective owns its layout, visibility, collapsed state, viewport, detail level and
  optional description. Create, duplicate, rename and delete perspectives; General remains.
- Switching perspective alone does not mark the project unsaved. The active choice may be stored
  with the next ordinary save. Every perspective and note reopens offline from the same `.scraft`.
- Notes are plain text on a base table or one of its columns, shared across perspectives.
  Descriptions belong to individual perspectives. Neither is HTML or executable content.
  Linked targets preserve schema/name/column components and table kind, including names with dots.
- Refresh every perspective. New objects are shown in General and remain hidden in curated
  perspectives until explicitly included. Observed deletion unlinks notes while retaining their
  text and former target. Reuse of a name does not automatically relink a note; explicit
  reassignment cannot overwrite another linked note. Logical names do not prove physical identity.
- Map management and note edits support undo/redo, with one step per focused text-edit session.
  Refresh clears history. Late layout, save or refresh operations cannot overwrite newer document,
  snapshot, perspective or edit revisions.
- Export only the active perspective. Description and note inclusion starts off on every export;
  the user reviews and checks the individual visible linked notes to include. Hidden and unlinked
  notes, other descriptions, note IDs and unknown properties are excluded. Comparison and
  dependency reports do not include these notes implicitly.

### 3.14 Native PostgreSQL inspection and format 4 (1.3.0)

- Add PostgreSQL 15, 16, 17 and 18 behind the existing inspector strategy, without changing SQL
  Server behavior. Explicitly select the engine; do not refresh one provider's project from another.
- Accept TCP host/port and IPv6, explicit database and case-sensitive role names. Use strict TLS
  certificate-chain and host validation by default, with an optional additional public PEM root;
  reject private keys. Unverified TLS or plaintext requires an explicit literal-local connection
  choice. Support password/SCRAM authentication and provider-qualified remembered credentials.
- Read native metadata without application data or executable calls: tables/partitions,
  ordinary/materialized views, native types, identity/generated columns, primary/foreign keys,
  indexes and their native state, constraints, overloaded routines and DML trigger modes/functions.
  Mark catalog-reconstructed definitions as reconstructed. Preserve native match, validation,
  deferrability, enforcement and uniqueness meanings instead of inventing SQL Server equivalents.
- For each PostgreSQL routine, distinguish native parsed-SQL-body reference tracking from
  signature-only tracking of PL/string bodies, including while saving code is disabled. Show
  recorded/unknown/unrecorded evidence in module details, routine/reference lists and dependency
  maps/exports. Neither mode proves exhaustive dynamic SQL or runtime dependencies; do not save
  a parse tree or module text as part of this evidence.
- Explain visibility using native catalog observations and schema USAGE. No SQL Server GRANT,
  DENY probe or replication/clustering fact is fabricated for PostgreSQL. Unknown and unsupported
  forms remain literal or explicitly limited; every rendering surface uses the same native facts.
- PostgreSQL supports ordinary capture, reviewed refresh, independent comparison, known
  dependencies, perspectives, offline save/reopen and all diagram exports. Apply the same
  default-off module and annotation privacy boundaries across providers.
- Write `.scraft` format 4 with minimum reader 4 for the combined feature release. Migrate earlier
  projects on save, default their provider to SQL Server, keep unknown extension fields, and
  record missing evidence honestly. Published 1.2.0 and earlier readers must reject format-4 files
  safely rather than misread native facts or damage perspective/note content.
- The four features share one branch, one pull request and one final release after all acceptance
  gates. Until that release, published 1.2.0 GitHub and Store packages remain unchanged. The
  portable executable, installer and Store packaging stay independent under ADR-045.

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

- **2026-10-23**: Maintainer acceptance of the combined candidate passed, including Spanish
  review and all four workflows. Version 1.3.0 is assigned to requirements 3.10–3.14 without
  changing their scope or the format-4/minimum-reader-4 boundary. Final artifact and channel
  verification remains separate from feature acceptance.

- **2026-10-23**: Added approved unreleased requirements 3.11–3.14: independent capture comparison,
  known catalog dependencies, shared-snapshot perspectives and plain-text notes, native PostgreSQL
  15–18 inspection and the combined format-4 compatibility boundary. One branch, pull request and
  final release cover all four features; published 1.2.0 artifacts are unchanged.

- **2026-10-13**: Se añade el requisito no funcional 4 (Experiencia de Usuario) y su criterio de aceptación, acordados al cierre del Paso 1 de construcción.
- **2026-10-13**: Se añaden el historial de conexiones recientes (3.1) y los proyectos recientes (3.6), acordados al planificar el Paso 3.
- **2026-10-15**: Se precisa en 2.1 que el ejecutable portable usa el runtime WebView2 de Windows, como ya hace la versión 1.0.0.
- **2026-10-15**: Se crea la sección 3.8 para las ampliaciones de la versión 1.1 y se añade su primera parte: el acceso parcial explicado (comprobación de permisos, informe de acceso) y el formato `.scraft` 2 con lectura compatible hacia adelante.
- **2026-10-16**: Se añade a 3.8 la segunda parte de la versión 1.1: secciones por esquema y tipo en el panel de entidades, y vistas diferenciadas con etiqueta, icono y color propios en el lienzo, la paleta de comandos y todas las exportaciones. 3.4 pasa a llamarse "Niveles de Detalle del Diagrama" y 3.4 y 3.7 dejan de usar "vista" para los niveles de detalle, porque en la interfaz esa palabra nombra únicamente una vista de base de datos.
- **2026-10-16**: Se añade a 3.8 la tercera parte de la versión 1.1: el panel Inspector, que comparte con el panel de detalle del visor HTML un único modelo de datos, los atajos de los niveles de detalle y los comandos de tema e idioma en la paleta. El criterio de la sección 5 sobre los niveles pasa a decir "niveles de detalle (Compacto, Claves, Completo)".
- **2026-10-16**: Se añade a 3.8 la cuarta parte de la versión 1.1: las reglas legibles (restricciones `CHECK` y llaves foráneas explicadas en frases en inglés y español, con sus columnas resaltadas al señalarlas y el SQL a un clic, también en el visor HTML), el registro de si cada `CHECK` está habilitada y la notación estándar de pata de gallo en el lienzo y en todas las exportaciones.
- **2026-10-18**: Se crea la sección 3.9 para las ampliaciones de la versión 1.2: los objetos programables (el código de vistas, procedimientos, funciones y desencadenadores, leído con estados honestos, conservado al actualizar con menos permisos y nunca exportado), el estado de índices y restricciones, que corrige la limitación de la 1.1.0 de la restricción única o la clave primaria cuyo índice está deshabilitado, el formato `.scraft` 3, que la versión 1.1 abre en solo lectura, las pruebas contra SQL Server 2019 y 2022, el registro de diagnóstico local y la medición de una base de datos sin compartirla.
