# Brief de diseño — Organizador Personal IA

> Documento de contexto para pasar a **Claude Design** (herramienta separada de Anthropic). Este archivo es 100% documentación: no se tocó código de la app para producirlo. Las capturas de referencia (desktop + ~375px) se tomaron en vivo, con sesión real, y quedaron mostradas inline en la conversación donde se generó este brief — guardalas desde ahí (click derecho → Guardar imagen) y adjuntalas junto con este documento.

---

## 1. Qué es esta app

**Organizador Personal IA** es una PWA personal (React + Vite + TypeScript) para gestionar notas, ítems y recordatorios, con:
- Soporte **offline-first** completo (lectura y escritura vía IndexedDB + outbox + motor de sincronización con Supabase).
- Un **asistente de IA** (Gemini con function-calling) que propone cambios en lenguaje natural para que el usuario confirme antes de aplicarlos — nunca escribe directo.
- **Recordatorios** con doble vía de aviso: local (app abierta) y push server-side (Edge Function disparada por `pg_cron`, funciona con la app cerrada).

Ver [MAPA_PROYECTO.md](MAPA_PROYECTO.md) para la arquitectura técnica completa (no necesario para el rediseño, pero da contexto de qué es dato en vivo vs. cacheado).

---

## 2. Inventario de pantallas actuales

Todas las pantallas comparten el mismo `<AppNav>` (barra superior) y viven detrás de `<ProtectedRoute>` (redirige a Auth si no hay sesión). Navegación real (`src/App.tsx`), todas rutas planas, sin anidamiento:

| Ruta | Componente | Qué hace | Componentes clave |
|---|---|---|---|
| `/` | `ItemsPage` | Vista principal. Lista de ítems agrupados por tema, con filtro por tema y botón para crear uno nuevo. | `AppNav`, `ItemForm` (crear/editar), `ItemList` (agrupa por tema, renderiza cada tipo de contenido) |
| `/reminders` | `RemindersPage` | Lista plana de recordatorios (no agrupada), clasificados en vencido/próximo/hecho, con acción "Marcar hecho". | `AppNav` |
| `/assistant` | `AssistantPage` | Chat con el asistente de IA. Si la IA está desactivada, muestra un aviso con link a Settings en vez del chat. | `AppNav`, `ProposedActionCard` (preview de create/update/delete), `EstadoBadge` |
| `/settings` | `SettingsPage` | Tres bloques apilados: Configuración de IA, Notificaciones (push), Sincronización. | `AppNav`, `PushSettings`, `SyncSettings` |
| (fuera de rutas, gate) | `AuthPage` | Login/signup con email+contraseña. No tiene `AppNav` — es la única pantalla "sin cáscara". | — |

**Navegación entre pantallas** (real, de `AppNav.tsx`):
- Nav superior fija con 4 links: **Items / Recordatorios / Asistente / Settings**, más brand ("Organizador Personal IA") a la izquierda y email + indicador de sync + "Cerrar sesión" a la derecha.
- El link activo se marca con subrayado color moss (no hay sidebar, no hay tabs secundarios, no hay breadcrumbs).
- El link a **Recordatorios** lleva un badge numérico (rust) con la cantidad de recordatorios pendientes (`useRecordatoriosBadge`).
- El link a **Asistente** es condicional: si la IA no está activada (`useAiEnabled` devuelve `false`), el link queda deshabilitado visualmente y apunta a `/settings` en su lugar, con un tooltip ("Activá la IA en Settings para usar el asistente").
- No hay jerarquía más allá de esto: **todas las pantallas están a un click de distancia entre sí**, siempre vía la nav superior. No existe historial de navegación propio, breadcrumb, ni concepto de "volver".
- El botón "Cerrar sesión" está en la nav, visible en todas las pantallas logueadas.

**Qué NO existe hoy** (importante para no asumir funciones que el rediseño podría dar por sentadas):
- No hay buscador.
- No hay vista de resumen/dashboard — la puerta de entrada siempre es la lista completa de Items.
- No hay forma de ver "solo lo de hoy" sin pasar por Recordatorios.
- El asistente es una página completa, no un panel flotante — para consultarlo hay que abandonar la vista en la que se está.
- Los temas (categorías) son solo texto — no tienen color ni ícono propio, se muestran como encabezado de sección.

---

## 3. Sistema de diseño actual — "fichas de catálogo"

Nombre interno del sistema visual (`PLAN_ORGANIZADOR.md`): reemplaza un look genérico de tarjetas blancas + pastillas por una estética **editorial / de catálogo impreso**, aplicada a toda la app. Fuente de verdad: [`src/index.css`](src/index.css).

### 3.1 Tokens de color (Tailwind v4 `@theme`, no hay `tailwind.config.js`)

| Token | Hex | Uso |
|---|---|---|
| `--color-paper` | `#eef0ec` | Fondo general de la app (`body`, `bg-paper`) |
| `--color-card` | `#f7f8f5` | Fondo de tarjetas/fichas (ítems, recordatorios, formularios) |
| `--color-ink` | `#1e2a22` | Texto principal |
| `--color-ink-soft` | `#4b5750` | Texto secundario, labels, metadatos |
| `--color-line` | `#d7dad2` | Bordes, separadores, hairlines |
| `--color-moss` | `#3d5c41` | Color de acento primario: botones sólidos, nav activa, checkboxes marcados, mensajes del usuario en el chat |
| `--color-moss-ink` | `#eaf0ea` | Texto sobre fondo moss (botones, badges, checkmarks) |
| `--color-rust` | `#9c3b22` | Alertas, prioridad alta, borrar, estado "vencido", errores |
| `--color-gold` | `#b98530` | Prioridad media, estados de advertencia/pendiente (sync, cooldown) |
| `--color-slate` | `#7c8577` | Prioridad baja, texto terciario, estado "hecho"/inactivo |

Todos generan utilidades Tailwind directas: `bg-paper`, `text-ink`, `border-line`, `bg-moss`, etc.

### 3.2 Tipografía

| Fuente | Variable | Uso |
|---|---|---|
| **Fraunces** (serif editorial) | `--font-fraunces` | Brand de la nav, títulos de página, encabezados de tema/sección — el único lugar con voz "cálida" |
| **IBM Plex Sans** | `--font-sans` (default del `body`) | Todo el texto de contenido: notas, ítems, mensajes del chat, párrafos |
| **IBM Plex Mono** | `--font-mono` | Links de nav (uppercase, tracked), labels de formulario, metadatos (tipo, prioridad, fecha, estado), botones, badges — la voz "de catálogo/ficha técnica" |

Patrón consistente: **Fraunces para lo humano/editorial, Plex Mono para lo estructural/metadato**, Plex Sans para el cuerpo. Este contraste es la seña de identidad visual del sistema — cualquier rediseño debería decidir conscientemente si lo conserva o lo reemplaza, no perderlo por accidente.

### 3.3 Elementos distintivos de "ficha de catálogo"

- **Lomo de color por prioridad**: los ítems y recordatorios son tarjetas (`bg-card`) con un **borde izquierdo de 4px** que codifica prioridad/estado — rust (alta/vencido), gold (media/próximo), slate (baja/hecho), sin color (sin prioridad). Es el elemento más reconocible del sistema.
- **Metadatos como texto mono, no pastillas**: tipo de ítem y prioridad se muestran como texto uppercase tracked en Plex Mono, coloreado según el token correspondiente — nunca como badge/pill con fondo relleno (excepto el badge numérico de recordatorios pendientes en la nav, que sí es un pill rust).
- **Encabezado de tema con hairline**: cada grupo de ítems por tema es un `<h2>` Fraunces + contador en mono + una línea horizontal que ocupa el resto del ancho disponible (`::after { flex: 1 }`) — como un separador de sección de catálogo impreso.
- **Tablas reales**: los ítems tipo "tabla" se renderizan como `<table>` real (no texto con pipes) — header con fondo paper y texto mono uppercase, zebra striping sutil, wrapper con `overflow-x: auto` propio para no romper el layout en mobile.
- **Checkboxes custom**: listas usan checkboxes propios (no el nativo del browser) — relleno moss + check blanco al marcar, texto tachado en slate cuando está hecho.
- **Botones**: sólido moss (`btn-moss`, acción primaria), fantasma sin fondo (`btn-ghost`, acción secundaria/cancelar), outline rust (`btn-outline`, acción destructiva/desactivar). Radius mínimo (2px) en todos lados — nada redondeado tipo "app móvil genérica".
- **Responsivo**: los ítems y recordatorios pasan de layout en fila a columna en `max-width: 480px`, con las acciones (Editar/Eliminar) reubicadas al final. La nav envuelve con `flex-wrap`. Las tablas mantienen su propio scroll horizontal en vez de romper el ancho de página.

---

## 4. Funciones pendientes que el rediseño debe poder acomodar

Estas features **no están implementadas todavía** — son trabajo futuro conocido. El rediseño de información/navegación tiene que dejarles un lugar lógico, no diseñarlas él mismo.

| Función | Qué necesitaría a nivel de pantalla/flujo |
|---|---|
| **Captura por foto (Gemini Vision)** | Un flujo de captura/subida de imagen (cámara en mobile, file picker en desktop) + una pantalla/paso de **preview de lo extraído** (qué tipo de ítem detectó, qué contenido, qué tema/prioridad sugiere) antes de guardar — análogo al preview de acciones que ya existe en el Asistente, pero para una imagen en vez de un mensaje de texto. Necesita decidir si vive dentro de "+ Nuevo item" como una opción más, o como entrada propia. |
| **Editor de tabla real** | Hoy las tablas se crean/editan como texto plano con pipes (`Columna1 \| Columna2`) en un textarea — no hay UI de edición inline de filas/columnas como la tiene "lista" (que sí tiene un editor de líneas dedicado en `ItemForm`). Necesitaría un componente de grilla editable: agregar/quitar fila, agregar/quitar columna, editar celda, similar en espíritu al editor de líneas de listas. |
| **Modo oscuro** | Necesita una paleta oscura derivada de los tokens actuales (probablemente invirtiendo paper/ink y reajustando moss/rust/gold/slate para contraste), más el mecanismo de toggle/preferencia (¿sigue `prefers-color-scheme`, o es un switch en Settings?). Ningún componente hoy usa colores hardcodeados fuera del sistema de tokens, así que la superficie de cambio es maso menos contenida al archivo de tokens + revisar contrastes. |
| **Memoria de conversación persistente del asistente** | Hoy el historial del chat vive solo en memoria de React (`useState`) — se pierde al recargar o cambiar de pantalla. Persistir conversaciones necesitaría probablemente una **vista de historial/lista de conversaciones** (¿cuántas? ¿se pueden borrar? ¿tienen título?) más el cambio de "una conversación efímera" a "elegís o continuás una conversación". |

---

## 5. Ideas de reorganización ya planteadas y no implementadas

Estas ideas se conversaron en algún momento pero **no llegaron a construirse ni a documentarse en el código**. Se incluyen tal cual para que Claude Design las tenga sobre la mesa, no como requisitos cerrados:

- **Vista "Hoy"**: un resumen de recordatorios (vencidos + de hoy) como posible pantalla de entrada, en vez de aterrizar siempre en la lista completa de Items.
- **Buscador global**: no existe ninguna forma de buscar hoy — ni por texto de ítems, ni por tema, ni por fecha de recordatorio.
- **Asistente como panel flotante**: en vez de ser una página aparte que exige abandonar la vista actual, podría vivir como un panel/drawer accesible desde cualquier pantalla (relevante también para la futura memoria de conversación — un panel persistente cambia la lógica de "sesión de chat" vs. "página que se resetea al navegar").
- **Temas con color propio**: hoy un tema (`Tema`) es solo un nombre — no tiene color ni ícono. Podrían llevar un color propio que se refleje en el encabezado de sección y quizás en el lomo de los ítems, dando una segunda dimensión de organización visual además de la prioridad.

---

## 6. El objetivo para Claude Design

**No es un lavado de cara visual.** El pedido es repensar la **arquitectura de información completa** de la app — vistas, secciones, colores y navegación general — tomando en cuenta simultáneamente:

1. El inventario real de pantallas y su navegación plana actual (sección 2) — qué conservar, qué fusionar, qué jerarquía nueva tiene sentido.
2. El sistema visual "fichas de catálogo" ya validado (sección 3) — como punto de partida a evolucionar o reemplazar conscientemente, no a ignorar.
3. Las cuatro funciones pendientes conocidas (sección 4) — la nueva arquitectura de información tiene que tener un lugar natural para cada una, incluso antes de que se construyan.
4. Las ideas de reorganización ya planteadas (sección 5) — vista Hoy, buscador global, asistente flotante, temas con color — como candidatas reales a incorporar en la nueva estructura, no descartadas.

Se espera una propuesta de reorganización de vistas/secciones/navegación y de sistema de color, no solo variaciones de componentes sueltos sobre la estructura actual.
