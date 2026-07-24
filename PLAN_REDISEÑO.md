# Plan de rediseño — análisis de la propuesta de Claude Design

> **Estado: Fases 0-2 implementadas** (ítems 1-6) **y Fase 3 en curso**
> (ítems 7, 8 y 8.1 hechos), 2026-07-23. Decisiones
> tomadas: **D2** radius 2→3-4px y chips en píldora aceptados, sombra sólo en lo
> que flota; **D3** "recordatorio" se agrega al segmented de tipo; **D4** color de
> tema automático al crear con opción de cambiarlo, ya implementado.
> **D1 resuelta: se conserva `react-router`.** La Fase 3 va en la rama
> `rediseno-fase-3`: ítems 7 (chasis), 8 (vista Hoy) y 8.1 (nombre de perfil +
> asistente sin conexión) implementados ahí.
> Detalle de lo implementado en [PLAN_ORGANIZADOR.md](PLAN_ORGANIZADOR.md).

> Documento de análisis y planificación. **No se tocó código para producirlo.**
> Fuentes: `design_handoff_organizador_ia/Organizador.dc.html` (prototipo hifi, 853 líneas),
> `design_handoff_organizador_ia/README.md` (handoff), contrastados contra
> [DISENO_BRIEF.md](DISENO_BRIEF.md), [MAPA_PROYECTO.md](MAPA_PROYECTO.md) y verificación puntual
> de `src/App.tsx`, `src/index.css`, `src/types/database.ts`, `src/components/ItemForm.tsx`,
> `src/components/ItemList.tsx`, `src/pages/ItemsPage.tsx`, `src/lib/useRecordatoriosBadge.ts`.

---

## 0. Veredicto en una página

La propuesta es **buena y mayormente implementable**. Es lo que se pidió: reorganización de
arquitectura de información, no un lavado de cara. Tres cosas destacan:

1. **No abandona "fichas de catálogo" — lo extiende.** Los 10 tokens de color actuales están
   idénticos (mismos hex), las 3 fuentes se mantienen con el mismo reparto de roles, el lomo de
   4px por prioridad sigue siendo el elemento central, y los metadatos siguen siendo texto mono
   y no pastillas. Agrega 5 tokens nuevos y una paleta oscura completa. **No hay conflicto de
   fondo acá** — sí tres desviaciones de detalle que conviene aprobar explícitamente (§5.1).
2. **Respeta el principio de confirmación de la IA.** La tarjeta de propuesta con
   CONFIRMAR/CANCELAR está, y el flujo de foto la replica ("REVISÁ ANTES DE GUARDAR"). El único
   problema es que la modela como **una sola** propuesta, cuando el código real maneja N acciones
   con confirmar-una/confirmar-todas y estado por acción (§5.2).
3. **Le da lugar a las 4 funciones pendientes**, las cuatro, con superficie concreta.

Lo que la propuesta **no cubre** y hay que resolver nosotros: la pantalla de Auth (no existe en
el prototipo), los flujos reales de configuración de IA y de push (muestra solo estados finales,
no el flujo de activar/ingresar key/pedir permiso), los estados de carga/error/offline, y el modo
edición del sheet de ítem.

El riesgo real del proyecto está concentrado en **un ítem**: el reemplazo del chasis de
navegación (§4, ítem 7). Todo lo demás se puede hacer antes, incremental y sin romper flujos.

---

## 1. Vistas: propuesta vs. estado real

### 1.1 Mapa de correspondencias

| Hoy (real) | Propuesta | Naturaleza del cambio |
|---|---|---|
| — | **Hoy** (nueva landing) | **Vista nueva.** Fecha + saludo, 3 tarjetas de stats (Vencidos/Para hoy/Ítems), fila de accesos rápidos (NUEVO/FOTO/PREGUNTAR), sección Vencidos, sección Para hoy, grid "Tus temas". |
| `/` `ItemsPage` — lista plana agrupada por tema | **Biblioteca** | Misma vista, reorganizada: dos niveles de filtro (segmented por tipo + chips por tema) y **secciones colapsables** por tema. Resuelve el desorden reportado. |
| `/reminders` `RemindersPage` — lista plana | **Recordatorios** | Se agrupa por estado (Vencidos/Hoy/Próximos/Hechos) + segmented de filtro. |
| `/assistant` `AssistantPage` — página completa | **Asistente** | **Deja de ser una ruta**: pasa a drawer flotante (derecha en desktop, bottom-sheet en mobile), accesible desde cualquier vista. + botón de historial. |
| `/settings` `SettingsPage` | **Ajustes** | Misma estructura + bloque **Apariencia** (Claro/Oscuro) nuevo. |
| `AuthPage` (gate, fuera de rutas) | — | **No contemplada.** Ver §3.3-A. |
| `ItemForm` inline en ItemsPage | **Nuevo ítem** (sheet/modal) | **Superficie nueva**: modal 540px en desktop, bottom-sheet en mobile. Menú inicial de 3 opciones (Escribir / Desde una foto / Pedirle a la IA) → modo formulario o modo foto. |

**Balance:** 5 pantallas actuales → 4 destinos de nav + 2 overlays. Neto: +1 vista real (Hoy),
+2 superficies overlay (asistente, sheet de ítem), −1 ruta (asistente).

### 1.2 Lo que la propuesta simplifica de más

El prototipo usa datos mock y, en Ajustes, dibuja **solo estados finales**:

- IA: muestra `ACTIVA` + botón "DESACTIVAR / QUITAR KEY". **No hay UI para ingresar la API key,
  validarla, ni el estado "IA desactivada"** — que es exactamente el flujo que existe hoy
  (`manage-ai-key`, `useAiEnabled`) y el que gobierna si el asistente está disponible.
- Notificaciones: muestra `RECHAZADAS` + un texto. No hay botón de pedir permiso / suscribir /
  desuscribir, que es lo que hace `PushSettings` hoy.
- Sincronización: muestra conexión / pendientes / última sync + "SINCRONIZAR AHORA". Esto sí
  mapea casi 1:1 con `SyncSettings`.

No es un error de diseño (es un prototipo con mock), pero significa que **el bloque de Ajustes
no se puede "recrear fielmente": hay que conservar los componentes reales y solo reenmarcarlos.**

---

## 2. Navegación

### 2.1 Qué cambia

**Sigue siendo plana** en cuanto a jerarquía: 4 destinos, todos a un click, sin anidamiento ni
breadcrumbs. Lo que cambia es el **chasis** y la **cantidad de superficies simultáneas**:

| | Hoy | Propuesta |
|---|---|---|
| Desktop | Nav superior fija, 4 links mono uppercase, activo con subrayado moss | **Sidebar izquierda 264px**: brand, buscador, nav vertical, botón "+ NUEVO ITEM", botón "Asistente IA", bloque de cuenta al pie. Activo = fondo `--moss-tint`. |
| Mobile | La misma nav con `flex-wrap` | **Barra superior sticky** (brand + toggle de tema + buscador) + **tab bar inferior de 5 celdas** (Hoy · Biblio · FAB "+" central · Recor · Ajustes) + **FAB del asistente** flotante sobre la tab bar. Activo = color `--moss`. |
| Breakpoint | `max-width:480px` para ítems, wrap de nav | **Único breakpoint en 900px**, resuelto en JS con listener de `resize` (`window.innerWidth >= 900`) |
| Buscador | No existe | Siempre visible; al escribir **reemplaza el contenido de la vista** por resultados |
| Asistente | Ruta `/assistant` | Overlay desde cualquier vista |
| Badge recordatorios | En el link, rust | Igual en sidebar (`margin-left:auto`) y como badge absoluto sobre el ícono en la tab bar |

### 2.2 El punto crítico: el prototipo no tiene router

El prototipo maneja la navegación con `state.screen` (`'hoy' | 'items' | 'rem' | 'ajustes'`) y
un método `go(s)` que además resetea `query` y cierra overlays. **No hay URLs.**

Traducirlo literal significaría sacar `react-router-dom`, y eso rompe cosas concretas:

- `useRecordatoriosBadge` depende de `useLocation()` para recalcular al cambiar de ruta
  (`src/lib/useRecordatoriosBadge.ts:14,35`).
- `AssistantPage` linkea a `/settings` cuando la IA está desactivada.
- Se pierde deep-linking, botón atrás y refresh-en-la-misma-vista — en una PWA instalada, el
  botón atrás del sistema es lo que la gente usa para cerrar un drawer.

**Recomendación:** conservar `react-router` y mapear el modelo del prototipo sobre rutas
(`/` → Hoy, `/biblioteca` → Biblioteca, `/reminders`, `/settings`), con el asistente y el sheet
como estado de UI del shell — idealmente con el botón atrás cerrándolos. Es una decisión que
necesito confirmada antes del ítem 7 (§6, decisión D1).

### 2.3 Detalle menor a reconciliar

El badge del prototipo cuenta `vencido + hoy + proximo` (`Organizador.dc.html:665`). El badge real
cuenta **vencidos + de hoy** (`countRecordatoriosPendientesHoy`). Mantener el comportamiento
actual: "pendientes que ya te tocan" es más útil que "todos los pendientes que existen".

---

## 3. Sistema visual: ¿evoluciona o reemplaza?

### 3.1 Evoluciona. Continuidad casi total.

**Idéntico** (verificado hex por hex contra `src/index.css:8-23`):

- Los 10 tokens de color: `paper #eef0ec`, `card #f7f8f5`, `ink #1e2a22`, `ink-soft #4b5750`,
  `line #d7dad2`, `moss #3d5c41`, `moss-ink #eaf0ea`, `rust #9c3b22`, `gold #b98530`,
  `slate #7c8577`. **Ninguno cambia.**
- Las 3 fuentes con el mismo reparto: Fraunces (editorial/humano), Plex Sans (cuerpo),
  Plex Mono (metadato/estructural, uppercase + tracking).
- El **lomo izquierdo de 4px por prioridad** (rust/gold/slate/none) en ítems y recordatorios.
- Metadatos como texto mono coloreado, **no** como pastillas rellenas.
- Encabezado de tema Fraunces + contador mono + hairline que ocupa el resto del ancho.
- Tablas reales con header `--card-2` mono uppercase, zebra striping y `overflow-x` propio.
- Checkboxes custom moss + tachado slate.
- Botones: sólido moss / fantasma / outline rust.

**Agrega:**

| Token nuevo | Claro | Para qué |
|---|---|---|
| `--card-2` | `#e9ece5` | Fondo de segmented controls, headers de tabla, zebra |
| `--ink-mute` | `#8a938a` | Cuarto nivel de texto (placeholders, estados vacíos) |
| `--line-soft` | `#e4e7e0` | Separadores internos (filas de tabla) |
| `--moss-tint` | `#e3eae1` | Fondo del ítem de nav activo, botón del asistente |
| `--shadow` | `0 1px 2px rgba(30,42,34,.04), 0 8px 24px -16px rgba(30,42,34,.18)` | Elevación de tarjetas |

Más la **paleta oscura completa** (13 tokens en `[data-theme="dark"]`) y la **dimensión de color
por tema** en oklch frío, con una regla de sistema explícita y buena:

> **prioridad = cálido (lomo de tarjeta); tema = frío (punto/chip). Nunca usar el color de tema
> en el lomo.**

Esa regla es la que evita que la segunda dimensión de color destruya la legibilidad de la primera.
Vale la pena escribirla en `index.css` como comentario.

### 3.2 Las tres desviaciones reales (a aprobar, §6-D2)

| | Hoy | Propuesta | Comentario |
|---|---|---|---|
| Radius | 2px en todo ("nada redondeado tipo app móvil genérica") | 3–4px en tarjetas y controles | Cambio chico, pero es una decisión explícita del sistema actual |
| Sombras | **No hay ninguna** | `--shadow` en tarjetas, stats, chips activos, FAB | Es lo que más se aleja del "catálogo impreso" — el papel no proyecta sombra |
| Píldoras | "nunca badge/pill con fondo relleno" (excepto badge de nav) | Chips de tema con `border-radius:999px` y, al activarse, fondo `--ink` sólido | Defendible: son **controles de filtro**, no metadatos. Pero rompe la letra de la regla |

Mi lectura: las tres son aceptables, la sombra es la única que me haría dudar. Una alternativa
conservadora es mantener `--shadow` solo para elementos que **flotan de verdad** (drawer, sheet,
FAB, chip activo del segmented) y dejar las tarjetas de ítem planas con su borde de 1px, como hoy.

### 3.3 Lo que el sistema visual propuesto no cubre

- **A. AuthPage.** El prototipo no la incluye. Hoy es la única pantalla sin cáscara. Con sidebar
  y tab bar nuevas hay que decidir cómo se ve el login (probablemente: sigue sin cáscara, centrada,
  y hereda tokens + modo oscuro gratis).
- **B. Estados de carga / error / vacío-por-primera-vez.** El prototipo tiene estados vacíos por
  filtro ("No hay ítems con este filtro") pero no el "Cargando…" ni el "todavía no tenés items"
  que ItemsPage maneja hoy con la lógica de `hasSyncSettled()`.
- **C. Indicador de sync en mobile.** En desktop vive en el bloque de cuenta del sidebar
  ("EN LÍNEA · SYNC OK"). En mobile **no hay lugar para él** salvo entrar a Ajustes — hoy está
  siempre visible en la nav. Es una regresión funcional para una app offline-first.

---

## 4. Las 4 funciones pendientes

Las cuatro tienen lugar. Calidad de la solución, una por una:

| Función | ¿Tiene lugar? | Dónde | Qué falta definir |
|---|---|---|---|
| **Captura por foto** | ✅ Sí, bien | Opción 2 del menú "+ Nuevo ítem" + acceso rápido "FOTO" en Hoy. Modo foto = dropzone → "ANALIZAR IMAGEN" → tarjeta de preview con tipo/tema/prioridad/contenido → Guardar / Editar | Todo el backend: endpoint de Vision, manejo de la imagen, cuota, qué pasa offline (¿se puede encolar?), estado de "analizando" |
| **Editor de tabla** | ✅ Sí, bien | Modo formulario, tipo "Tabla": grilla con headers y celdas editables + botones "COLUMNA" y "FILA" | Quitar columna/fila (el prototipo solo agrega), y el formato de guardado (§5.4) |
| **Modo oscuro** | ✅ Sí, completo | Paleta dark completa + segmented Claro/Oscuro en Ajustes + botón sol en el header mobile | Mecanismo (`data-theme` en qué nodo, persistencia, ¿respeta `prefers-color-scheme` la primera vez?) y auditoría de contraste |
| **Memoria del asistente** | ⚠️ Sí, pero superficial | Botón historial en el header del drawer → lista de conversaciones (título, preview, fecha, borrar) + "NUEVA CONVERSACIÓN" | El modelo de datos entero: dónde se persiste (¿tabla Supabase? ¿IndexedDB? ¿ambos vía outbox?), cómo se genera el título, cuántas se guardan, si se sincronizan entre dispositivos |

---

## 5. Clasificación: qué se puede hacer ya, qué no

### 5.1 Implementable directo (reorganizar/restylear lo que ya existe)

Todo esto usa datos y lógica que ya están en la app:

- **Tokens nuevos + sombra + paleta oscura** → solo agrega a `index.css`, no rompe nada.
- **Vista Hoy** → `loadRecordatoriosFromCache` + `loadItemsFromCache` + `loadTemasFromCache` ya
  dan todo: conteo de vencidos, de hoy, total de ítems, temas con contador. El saludo y la fecha
  son triviales. La clasificación vencido/hoy/próximo ya vive en `RemindersPage`.
- **Biblioteca: filtro por tipo + secciones colapsables + chips de tema** → filtrado en cliente
  sobre el array de `items` que la página ya tiene en memoria. Cero backend.
- **Recordatorios agrupados por estado + segmented** → reagrupar lo que `RemindersPage` ya
  clasifica.
- **Buscador** → filtro en cliente sobre `items` en memoria (el prototipo busca en tema, tipo,
  contenido, líneas y celdas).
- **Sidebar / tab bar / FAB** → puro layout y CSS.
- **Asistente como drawer** → toda la lógica de `AssistantPage` (chat, envío, propuestas,
  confirmación, cooldown, usage) se mueve tal cual; cambia el contenedor, no el motor.
- **Sheet "+ Nuevo ítem"** → `ItemForm` ya hace todo lo del modo formulario (tipo, tema con
  "+ crear tema nuevo", prioridad, editor de líneas para listas, toggle de recordatorio con
  `datetime-local`). Lo nuevo es el menú de 3 opciones y el contenedor modal/sheet.
- **Ajustes con bloque Apariencia** → `PushSettings` y `SyncSettings` se conservan intactos,
  se les cambia el marco visual.

### 5.2 Depende de features que todavía no existen

| Lo que la propuesta asume | Realidad | Trabajo que implica |
|---|---|---|
| ~~Cada tema tiene un color propio~~ ✅ **hecho (Fase 2)** | `Tema` era `{id, user_id, nombre, created_at}` — no había campo color | Resuelto: migración `temas.color` (+ `updated_at`), paleta de 7 slugs fríos, asignación automática en `repo.createTema()` y selector en el `ItemForm`. Ver ítem 6 |
| Existe modo oscuro | No existe | Los tokens viven en `@theme` de Tailwind v4, que genera utilidades estáticas. Hay que decidir cómo hacerlos conmutables (redefinir las CSS vars bajo `[data-theme="dark"]`) + persistencia + auditar contraste de los ~13 tokens dark |
| Existe editor de tabla | El form guarda tablas como `{texto}` con pipes (`ItemForm.tsx:294`) mientras `ItemList` **ya sabe leer** `{columnas, filas}` (`ItemList.tsx:46-60`) | El editor debe escribir la forma estructurada; hay que decidir compatibilidad con los ítems tabla ya guardados como texto |
| Existe captura por foto | No existe nada | Gemini Vision (Edge Function nueva o extensión de `ai-assistant`), upload/manejo de imagen, cuota, comportamiento offline |
| Existe historial de conversaciones | El chat vive en `useState` y se pierde al navegar | Persistencia nueva de punta a punta. Si tiene que ser offline-first como el resto, pasa por `repo.ts` + outbox + tabla nueva + RLS |
| ~~El buscador encuentra "ítems, temas, recordatorios"~~ ✅ **resuelto (ítem 9)** | El prototipo **solo busca ítems** (`Organizador.dc.html:748`) | Resuelto: el buscador cubre **ítems + nombre de tema**, no la tabla `recordatorios` (un recordatorio no tiene texto propio; su texto es el del ítem, buscarlo aparte lo duplicaría). Los ítems de tipo `recordatorio` sí se buscan, porque son ítems. Ver ítem 9 |

### 5.3 Ambiguo o incompleto en la propuesta

1. **Router sí o no** (§2.2). Bloqueante para el ítem 7.
2. **El tipo de ítem `recordatorio` desaparece.** `TipoItem` es
   `'nota' | 'recordatorio' | 'lista' | 'tabla'` y el form ofrece los 4. El segmented de la
   propuesta ofrece **tres** (Nota/Lista/Tabla), y el filtro de Biblioteca también. ¿Se elimina
   del modelo, se oculta del form, o se agrega un cuarto botón?
3. **Los ítems sin tema desaparecen.** `tema_id` es nullable y `ItemsPage` hoy tiene filtro
   "Sin tema". La Biblioteca del prototipo agrupa **solo** por los temas existentes: un ítem con
   `tema_id: null` no aparecería en ninguna sección. Hace falta un grupo "Sin tema".
4. **El sheet no tiene modo edición.** `onEdit` abre el sheet en modo form
   (`Organizador.dc.html:698`) pero el título sigue siendo "Nuevo ítem" y el botón "GUARDAR"
   (no "Guardar cambios"). Falta definir el modo edición completo, incluido el "ELIMINAR".
5. **¿El drawer del asistente preserva el chat al cerrarse?** Es media la razón de sacarlo de
   una ruta. El prototipo no lo dice; su estado vive en el componente raíz, así que
   implícitamente sí. Vale definirlo explícito.
6. **Flujo de activación de IA y de push ausentes** (§1.2).
7. **Modo oscuro: ¿respeta `prefers-color-scheme` al inicio?** El prototipo solo tiene toggle
   manual.
8. **Nada sobre `prefers-reduced-motion`.** El prototipo define 3 animaciones
   (`om-rise`, `om-fade`, `om-sheet`) y transiciones de tema de 0.3s. El proyecto ya respeta
   reduced-motion en el latido del sync (`index.css:158`); habría que mantener esa coherencia.
9. **La tarjeta de propuesta es singular** (§5.4).

### 5.4 Dos detalles técnicos que conviene fijar ahora

**Propuestas del asistente.** El prototipo modela `proposal` como un objeto único con
CONFIRMAR/CANCELAR. El código real maneja `pending: PendingAction[]` — N acciones, cada una con
su estado (`idle | applying | done | cancelled | error`), confirmar-una y confirmar-todas.
**Recrear el prototipo literalmente sería una regresión funcional.** La tarjeta nueva hay que
diseñarla para N acciones, tomando el estilo visual del prototipo (lomo moss, header mono
"PROPUESTA · CREAR ÍTEM") pero conservando el comportamiento actual.

**Formato de tablas.** Hoy hay una asimetría: `ItemList.parseTabla` ya lee
`{columnas|headers, filas|rows}`, pero `ItemForm` escribe `{texto}` con pipes. El editor de
grilla debería escribir la forma estructurada, y hace falta decidir qué pasa con las tablas ya
guardadas como texto (lo más seguro: al abrir en el editor, parsear los pipes y convertir al
guardar).

---

## 6. Ítems de trabajo, ordenados

Etiquetas: **[V]** solo visual/estilos · **[D]** toca modelo de datos/backend ·
**[N]** toca navegación/routing (riesgoso — puede romper flujos existentes).

### Fase 0 — Base (nada se rompe, nada cambia de lugar) — ✅ HECHA

**1. Tokens nuevos y sombra.** `[V]` · riesgo nulo — ✅ **implementado**
Agregar `--card-2`, `--ink-mute`, `--line-soft`, `--moss-tint`, `--shadow` a `@theme` en
`index.css`. Documentar en comentario la regla "prioridad = cálido / tema = frío". Solo agrega.

> Hecho en [`src/index.css`](src/index.css). El token de sombra se llama
> **`--shadow-float`**, no `--shadow`: en Tailwind v4 el namespace de utilidades es
> `--shadow-*`, así que con ese nombre además queda disponible la utilidad
> `shadow-float` para el drawer/sheet/FAB de la Fase 3. La regla de las dos
> dimensiones de color quedó como comentario de cabecera del `@theme`.

**2. Modo oscuro.** `[V]` · riesgo bajo — ✅ **implementado** — *cierra una de las 4 pendientes*
Paleta dark en `[data-theme="dark"]`, mecanismo de toggle + persistencia, bloque "Apariencia" en
`SettingsPage`. Auditar contraste de los 13 tokens. Como ningún componente usa colores fuera del
sistema de tokens, la superficie es contenida. Se hace primero porque **todo lo que venga después
nace ya compatible con dark** en vez de tener que retrofitearlo.

> Hecho: 14 tokens bajo `:root[data-theme="dark"]`, módulo
> [`src/lib/theme.ts`](src/lib/theme.ts) (localStorage + `useSyncExternalStore`),
> script inline en [`index.html`](index.html) para que no haya fogonazo claro al
> abrir en oscuro, y bloque "Apariencia" en
> [`SettingsPage`](src/pages/SettingsPage.tsx).
> **Precedencia:** preferencia guardada > `prefers-color-scheme` > claro. Era el
> punto ambiguo §5.3-7; se resolvió por lo menos sorprendente y el segmented
> muestra siempre el tema efectivo.
> **Auditoría de contraste: ver §8** — la paleta oscura salió mejor que la clara.

### Fase 1 — Reestilado y reorganización dentro de las páginas actuales — ✅ HECHA

Todo esto pasa **sin mover ninguna ruta**: las páginas siguen donde están, cambia lo de adentro.

**3. Ficha de ítem nueva.** `[V]` · riesgo bajo — ✅ **implementado**
Aplicar a `ItemList`: radius, sombra (según lo decidido en D2), fila meta con recordatorio
(campana + fecha), footer de acciones EDITAR/ELIMINAR alineado a la derecha.

> Hecho en [`ItemList`](src/components/ItemList.tsx) + `index.css`. Radius 4px,
> **sin sombra** (D2: la ficha no flota). La campana + fecha salen de un
> `Map<item_id, Recordatorio>` que arma `ItemsPage`; si el recordatorio está
> vencido la línea va en rust. Las acciones pasaron de columna lateral a pie
> alineado a la derecha, lo que **eliminó el media query de 480px** de `.item`:
> ahora la ficha se comporta igual en desktop y en móvil.

**4. Recordatorios agrupados.** `[V]` · riesgo bajo — ✅ **implementado**
Dentro de `RemindersPage`: segmented Todos/Vencidos/Próximos/Hechos + grupos con hairline
(Vencidos rust · Hoy · Próximos · Hechos), lomo por estado.

> Hecho en [`RemindersPage`](src/pages/RemindersPage.tsx). `clasificar()` ganó el
> estado **`hoy`** (pendiente, no vencido, del día en curso). El filtro
> "Próximos" incluye `hoy` — separarlos pediría un quinto botón para una
> distinción que ya hacen los grupos. Lomo: rust vencido, **gold hoy y próximo**
> (antes próximo era moss), slate hecho.

**5. Biblioteca: filtros y secciones colapsables.** `[V]` · riesgo bajo-medio — ✅ **implementado**
Dentro de `ItemsPage` (todavía en `/`): segmented por tipo, chips por tema reemplazando el
`<select>`, secciones colapsables con chevron. **Incluir el grupo "Sin tema"** (§5.3-3).
Es el ítem que resuelve el problema central reportado — y se puede tener antes de tocar nav.

> Hecho en [`ItemsPage`](src/pages/ItemsPage.tsx) + `ItemList`. Segmented de 5
> opciones (Todos · Notas · Listas · Tablas · **Recordatorios**, por D3), chips de
> tema con "Todos los temas" + un chip por tema + **"Sin tema"**, y grupos
> colapsables con chevron (`aria-expanded` maneja la rotación desde CSS).
> Los dos filtros se combinan. El armado de grupos es explícito y ordenado —
> temas, después "Sin tema", después "Tema eliminado" para huérfanos — así que
> **ningún ítem puede quedar fuera de la vista**, que era la regresión de §5.3-3.
> El estado de plegado vive en `ItemList`: es estado de vista, no del dominio.

### Fase 2 — Modelo de datos — ✅ HECHA

**6. Color por tema.** `[D]` · riesgo medio — ✅ **implementado**
Migración `temas.color`, tipo `Tema`, cache IndexedDB, ruta de escritura por `repo.ts` + outbox,
asignación (default automático + selector), y aplicación: punto en chips, headers de sección,
tarjetas de tema. Va después de la Fase 1 porque los lugares donde se muestra el punto ya
existirían.

> Paleta de **siete** matices fríos en oklch, cada ~26° entre verde-agua (168°) y
> ciruela (325°): el arco que queda lejos del rust/gold de prioridad y arranca
> después del moss de la marca. Lo que se guarda en la columna es el **slug**, no
> el color — el valor sale de los tokens `--color-tema-*`, que se redefinen en
> oscuro, así que la paleta se retoca en CSS sin migrar filas.
> La migración le agregó además **`updated_at` a `temas`**: al volverse
> editables desde la UI, sin columna de tiempo el motor de sync no podía
> resolver conflictos por LWW.
> Asignación automática en [`temaColores.ts`](src/lib/temaColores.ts) (módulo
> puro, 11 tests): menos usado → descarta el del último tema creado → desempata
> por hash del nombre. **El default vive en `repo.createTema()`, no en el form**,
> que es lo que garantiza que ni el asistente de IA cree temas sin color.
> El cambio de color pasa por `repo.updateTemaColor()` (espejo local + outbox):
> **anda igual sin conexión**, como todo lo demás.
> El selector quedó en el `ItemForm`, debajo del `<select>` de tema — no hay
> pantalla de "gestionar temas" y no valía inventarla justo antes de que la
> Fase 3 reorganice la navegación; y el chip de Biblioteca ya es un control de
> filtro, meterle un segundo gesto lo volvía ambiguo.
> El punto se aplicó en los chips y en los encabezados de grupo. El tercer lugar
> previsto —las tarjetas de tema de la vista **Hoy**— espera a la Fase 3, que es
> cuando esa vista existe.
> Detalle completo en [PLAN_ORGANIZADOR.md](PLAN_ORGANIZADOR.md).

### Fase 3 — Navegación (el bloque riesgoso)

> Todo lo de esta fase toca cómo se llega a las pantallas. Conviene hacerla de corrido, en rama
> aparte, y con la decisión D1 (§7) ya tomada.

**7. Chasis nuevo: AppShell.** `[N]` · **riesgo alto** — ✅ **implementado** (rama `rediseno-fase-3`)
Reemplazar `AppNav` por un shell con sidebar 264px / tab bar + FAB, breakpoint 900px. Toca las 4
páginas. Puntos de cuidado: `useRecordatoriosBadge` depende de `useLocation`; el indicador de
sync necesita lugar en mobile (§3.3-C); mantener el estado deshabilitado del asistente cuando la
IA está apagada.

> Hecho en [`AppShell`](src/components/AppShell.tsx) + [`useIsWide`](src/lib/useIsWide.ts).
> `AppNav` se eliminó.
>
> **El shell es un layout route, no un componente por página.** Antes cada
> página importaba y dibujaba su propia `<AppNav>`, así que al navegar la nav
> se desmontaba y se volvía a montar. Ahora se monta una vez y las páginas
> entran por su `<Outlet>`; cada una sólo aporta su `<main className="shell-main">`.
> Eso es lo que hace que el badge y el estado de sync no parpadeen al cambiar de vista.
>
> **Breakpoint.** `useIsWide` (listener de `resize` + `window.innerWidth >= 900`)
> decide qué piezas se **montan**: en ancho no existe la tab bar en el DOM, y en
> angosto no existe el sidebar. No es `display:none` sobre las dos, porque eso
> duplicaría el buscador y los cuatro links en el árbol de accesibilidad. El
> mismo 900px vive además en un `@media` de `index.css`, pero sólo para el
> padding del contenido, que sí es puro estilo.
>
> **§3.3-C resuelto — dónde va el indicador de sync.** En ancho, en el bloque de
> cuenta del sidebar, bajo el email: es donde el prototipo dibuja
> "EN LÍNEA · SYNC OK". En angosto, en la **barra superior sticky**, entre la
> marca y el toggle de tema. La alternativa era mandarlo a Ajustes y era una
> regresión: en una app offline-first, "esto todavía no subió" tiene que verse
> sin ir a buscarlo. Como la barra es sticky y la nav vieja no lo era, ahora se
> ve *más* que antes. Y `SyncStatus` sigue sin dibujar nada cuando todo está al
> día, así que en el caso normal no ocupa lugar en ninguno de los dos lados.
>
> **Badge.** Sin cambios de comportamiento: sigue siendo `useRecordatoriosBadge`
> (vencidos + de hoy, §2.3), y sigue dependiendo de `useLocation`, que existe
> porque conservamos el router (D1). Cambia sólo dónde se dibuja: pastilla con
> `margin-left:auto` en el sidebar, y badge encimado al ícono en la tab bar.
>
> **Asistente.** Mismo criterio que la nav vieja: mientras `useAiEnabled` carga
> (`null`) y cuando la IA está apagada, el ítem se ve apagado y lleva a Ajustes
> con el `title` de siempre. Sigue siendo la ruta `/assistant` hasta el ítem 10.
>
> **Dos cosas provisorias, las dos por el orden de los ítems:**
> - "Hoy" apunta a `/` (la vista no existe hasta el ítem 8). Para que dos
>   destinos no se marquen activos a la vez, la Biblioteca ya tiene su ruta:
>   `/` y `/biblioteca` renderizan `ItemsPage` por ahora. En el ítem 8, `/` pasa
>   a ser Hoy y el shell no se toca.
> - El "+ Nuevo item" del shell no tiene sheet propio hasta el ítem 11, así que
>   navega a la Biblioteca con `state.nuevoItem` y abre el `ItemForm` de ahí. Es
>   la única línea de este ítem que entra en una página en vez del shell.
> - El buscador se dibuja **deshabilitado** (ítem 9): un input que acepta texto
>   y no busca miente más que uno que se declara apagado.
>
> **Un arreglo que no estaba previsto:** "cerrar sesión" sólo existía en la nav.
> Con el chasis nuevo vive en el sidebar, que en móvil no se monta — un teléfono
> se quedaba sin forma de salir de la sesión. Se agregó un bloque **Cuenta**
> (email + cerrar sesión) al final de Ajustes.

**8. Vista Hoy como landing.** `[N]` · riesgo medio — ✅ **implementado** (rama `rediseno-fase-3`)
Vista nueva + Biblioteca pasa a su propia ruta. Es el cambio que más se nota para el usuario:
la puerta de entrada deja de ser la lista completa.

> Hecho en [`HoyPage`](src/pages/HoyPage.tsx). `/` → Hoy, `/biblioteca` →
> `ItemsPage` (la ruta ya existía desde el ítem 7, que la había separado
> justamente para esto).
>
> **Nada de lógica nueva de clasificación.** `clasificar`, `mismoDia`,
> `ESTADO_LABEL` y `TIPO_LABEL` salieron de `RemindersPage` y viven ahora en
> [`lib/recordatorios.ts`](src/lib/recordatorios.ts); las dos pantallas importan
> de ahí. Era la única forma de que "vencido" signifique lo mismo en los dos
> lugares: el usuario ve el conteo de Hoy y la lista de /reminders en la misma
> sesión, y dos definiciones habrían dado dos números que se contradicen.
> `clasificar` además pasó a pedir sólo `{estado, fecha_hora}` en vez de un
> `RecordatorioConItem`, así sirve igual para la fila plana de la caché.
>
> **La fila de recordatorio también se compartió.** Se extrajo a
> [`RecordatorioRow`](src/components/RecordatorioRow.tsx): mismo lomo por
> estado, mismo meta (incluido "● Notificado") y misma acción "Marcar hecho" en
> las dos pantallas. `/reminders` perdió ~30 líneas de JSX y no cambió de
> comportamiento.
>
> **Offline por construcción.** Todo el contenido —las tres cifras, Vencidos,
> Para hoy y el grid de temas— sale de `load*FromCache` (IndexedDB) y se
> recalcula con `subscribeSyncSettled`, igual que la Biblioteca y Recordatorios.
> "Marcar hecho" pasa por `repo.marcarHecho` (espejo local + outbox), así que
> también anda sin señal. La única llamada a Supabase de la vista es
> `useAiEnabled`, heredada del shell, y sólo decide a dónde apunta PREGUNTAR:
> sin red queda en `null` y el botón lleva a Ajustes, que es exactamente lo que
> ya hace el botón del asistente del sidebar.
>
> **Grid de temas.** Punto de color por tema (los mismos tokens `--color-tema-*`
> de la Fase 2 — es el tercer lugar que el ítem 6 había dejado pendiente,
> esperando justamente a que esta vista existiera) + contador de ítems. Al
> tocar una tarjeta se navega a la Biblioteca ya filtrada por ese tema. Hay
> también una tarjeta **"Sin tema"** cuando corresponde, por la misma razón que
> el grupo homónimo de la Biblioteca (§5.3-3): con `tema_id` nullable, mostrar
> sólo los temas dejaría ítems sin ninguna puerta de entrada.
>
> El contrato de esa navegación es `state.temaId`, con `null` = "los que no
> tienen tema". Hoy no conoce el nombre interno del filtro (`'sin-tema'`): cómo
> se llama es asunto de la Biblioteca.
>
> **Accesos rápidos.** NUEVO abre el `ItemForm` de la Biblioteca (mismo camino
> que el "+" del shell, hasta el ítem 11). PREGUNTAR va al asistente con el
> mismo criterio de IA apagada que el shell. **FOTO va deshabilitado con
> `title`**: la captura por foto es el ítem 14 y no existe. Se deja visible y
> apagado en vez de oculto — el lugar de la función ya está decidido y
> esconderlo lo volvería a poner en discusión.
>
> **El saludo no usa nombre.** ~~Sale de la hora (buenos días / buenas tardes /
> buenas noches). Lo único que tenemos del usuario es el email, y recortarlo
> para fabricar un nombre acierta poco.~~ — **revisado, ver 8.1.** La conclusión
> de que el email no sirve sigue en pie; lo que cambió es que ahora hay un
> nombre de verdad, puesto por el usuario.

**8.1. Nombre de perfil + asistente sin conexión.** `[N]` · riesgo bajo — ✅ **implementado**
(rama `rediseno-fase-3`)
Dos ajustes sobre el ítem 8, antes del buscador: el saludo de Hoy pasa a usar un nombre elegido
por el usuario, y el estado de la IA deja de apagarse solo cuando no hay red.

> **A — Nombre de perfil.** Campo "Nombre" en Ajustes → Cuenta
> ([`NombrePerfil`](src/pages/SettingsPage.tsx)), guardado con
> `supabase.auth.updateUser({ data: { nombre } })`.
>
> **Sin tabla nueva, a propósito.** Va en `user_metadata` de Supabase Auth. No
> es sólo ahorrarse tabla + RLS + outbox para un dato de una línea: los
> metadatos **viajan dentro de la sesión**, y la sesión cacheada que
> `readCachedSession` levanta de localStorage para arrancar sin red ya los trae.
> El saludo funciona offline sin una línea de código extra. Una tabla propia
> habría necesitado su espejo en IndexedDB y su lugar en el sync para llegar al
> mismo lado.
>
> El nombre se normaliza una sola vez, en `leerNombre` de
> [`AuthContext`](src/lib/AuthContext.tsx), que lo expone como `nombre: string | null`:
> un campo en blanco vale lo mismo que no haber configurado nada, o el saludo
> saldría con una coma colgando. `updateUser` emite USER_UPDATED, que el
> listener del contexto ya escuchaba, así que al guardar el saludo se actualiza
> solo, sin recargar.
>
> **Qué dice el saludo.** Se mantiene la franja horaria y se le suma el nombre:
> "Buenas tardes, Raúl". Sin nombre configurado queda "Buenas tardes" a secas.
> Del email no se deriva nada, que es lo que el ítem 8 ya había decidido y sigue
> valiendo. Guardar el nombre **sí necesita conexión** (es una escritura contra
> Auth, no pasa por el outbox como los ítems): sin señal el botón se apaga y lo
> dice, en vez de dejar fallar `updateUser` con un error de red genérico.
>
> **B — El estado de la IA se recuerda.** El bug: `useAiEnabled` leía
> `user_ai_settings` y, ante la consulta fallada, hacía `data?.ai_enabled ?? false`.
> Sin red eso **apagaba el asistente** aunque el usuario lo tuviera activo — el
> botón llevaba a Ajustes a activar una IA que ya estaba activa. Ahora cada
> lectura exitosa se guarda en localStorage por usuario
> (`organizador:aiEnabled:<id>`) y sin red se usa ese último valor conocido.
> Sólo se cachea el dato bueno: `error` presente = nos quedamos con el viejo;
> `error` ausente y sin fila = `false` legítimo (nunca la activó) y se cachea.
>
> localStorage y no el store `meta` de IndexedDB **porque es síncrono**: el
> primer render ya sale con el valor cacheado. Con una lectura asíncrona habría
> un parpadeo de "apagado" en cada arranque, que es justo lo que se venía a
> arreglar. Mismo criterio que [`lib/theme.ts`](src/lib/theme.ts). La clave
> lleva el id de usuario para que dos cuentas en el mismo navegador no se
> hereden el estado.
>
> Ajustes escribe la caché al activar/desactivar, y también la lee: sin red
> muestra el último estado conocido con una nota que lo aclara, en vez de decir
> "Inactiva" y ofrecer cargar una key que tampoco podría validar.
>
> **C — Y por eso el asistente ahora avisa.** Es la contracara obligatoria de B:
> si el botón se dibuja habilitado sin red, la pantalla del asistente tiene que
> explicar por qué no responde. `AvisoSinConexion` es un banner arriba de todo —
> **"No hay conexión — el asistente no está disponible ahora mismo"** — y no un
> error genérico ni un rebote a Ajustes: el problema no es la configuración de
> la IA, es que no hay internet, y son dos arreglos distintos. Va en las **dos**
> salidas de la página (IA apagada y chat normal), porque sin señal el estado de
> IA que mostramos es el último conocido y el hecho que manda es la falta de red.
>
> **Un arreglo de contraste que salió de verificar esto.** La bajada del banner
> venía con `text-slate` a 12px: medido sobre la tarjeta en claro da **3.6:1**,
> abajo del 4.5:1 de AA (§8 ya había avisado que la paleta clara es la que
> sufre). Pasa a `text-ink-soft` — 7.1:1 en claro, 7.7:1 en oscuro — y se sigue
> leyendo como secundaria. Se toleraba como meta decorativa; no como la
> explicación de por qué el asistente no contesta.

**9. Buscador global.** `[N]` · riesgo medio — ✅ **implementado** (rama `rediseno-fase-3`)
Input en sidebar/header; al escribir reemplaza el contenido de la vista. Definir si cubre
recordatorios o solo ítems (§5.2).

> **La presentación: se reusa la Biblioteca, no se inventa una pantalla.** El
> input del shell no dibuja resultados: al escribir navega a
> `/biblioteca?q=…` y es [`ItemsPage`](src/pages/ItemsPage.tsx) la que filtra y
> agrupa. Se reusa tal cual el layout de grupos por tema, el estado vacío y los
> chips de filtro, que era lo que el ítem pedía priorizar. La consulta viaja en
> la URL (no en un estado compartido) porque el input está en el shell y los
> resultados en la página: la URL es el único lugar que los dos ya miran, y de
> paso un resultado queda enlazable y sobrevive a un F5.
>
> **Qué cubre (la pregunta abierta de §5.2).** Ítems y **nombre de tema** —
> buscar "finanzas" trae los ítems de ese tema aunque ninguno diga la palabra.
> No la tabla `recordatorios`: un recordatorio no tiene texto propio, su texto
> es el del ítem al que cuelga, así que buscarlo aparte devolvería el mismo ítem
> dos veces. Los ítems de tipo `recordatorio` sí se buscan, porque son ítems. El
> placeholder ("Buscar en todo…") no promete de más.
>
> **El motor es un módulo puro.** Toda la lógica —qué texto de cada tipo de ítem
> es buscable (nota→texto, lista→líneas, tabla→encabezados y celdas, incluida la
> tabla vieja con pipes), normalización sin tildes ni mayúsculas, varias
> palabras en AND— vive en [`lib/buscar.ts`](src/lib/buscar.ts), sin IndexedDB
> ni DOM, con 14 tests (`buscar.test.ts`) al estilo de `temaColores.ts`. La
> página sólo le pasa lo que ya tenía en memoria: **cero backend, offline por
> construcción** (lee del mismo espejo de IndexedDB que la Biblioteca; nunca
> toca Supabase).
>
> **Un detalle de comportamiento.** Una búsqueda global llega con los filtros de
> tipo y tema en neutro, para que "Buscar en todo" no dependa de en qué estado
> quedó la Biblioteca la última vez. Los chips siguen visibles y se pueden
> volver a aplicar para acotar; el estado vacío distingue "sin resultados" de
> "sin resultados con los filtros puestos".
>
> **Debounce** de 250 ms y navegación con `replace` mientras se tipea en la
> Biblioteca, para no llenar el historial de estados intermedios. El input es
> el mismo componente en sidebar (desktop) y barra superior (mobile), así que
> funciona igual en los dos layouts.

**10. Asistente como drawer.** `[N]` · riesgo medio-alto — ✅ **implementado** (rama `rediseno-fase-3`)
Sacar `/assistant` de las rutas, montar el panel en el shell. **La lógica de chat y propuestas se
mueve sin tocarse.** Definir preservación del chat al cerrar y el estado "IA desactivada".
Redirigir `/assistant` a la vista actual con el drawer abierto, para no romper links viejos.

> **El motor se movió sin tocarse.** Todo `AssistantPage` —chat, envío,
> `confirmOne`/`confirmAll`/`cancelOne`, `applyAction`, cooldown, usage,
> `AvisoSinConexion`, `ProposedActionCard`— pasó tal cual a
> [`AssistantDrawer`](src/components/AssistantDrawer.tsx). Lo único que cambió es
> el contenedor: las tres salidas que devolvían un `<main class="shell-main">`
> ahora son el cuerpo de un panel con cabecera (título + cerrar). Ni una línea de
> la lógica de IA se reescribió. `AssistantPage.tsx` se borró.
>
> **Drawer / bottom-sheet, mismo breakpoint que el resto.** ≥900px entra desde
> la derecha a alto completo; <900px es un bottom-sheet que sube desde abajo con
> el borde superior redondeado. Como el chrome es idéntico, la diferencia la
> resuelven las media queries de `index.css` (el mismo 900 de `useIsWide`), sin
> ramas en JS. El banner de "sin conexión" quedó adentro del panel, no como
> página suelta (tarea 5). *Una trampa que saltó verificando:* la media query
> del sheet comparte especificidad con `.asistente-drawer--open` y, al venir
> después, dejaba el sheet fuera de pantalla en móvil; se arregló re-afirmando
> `transform: none` dentro del media query.
>
> **Preservación del chat (tarea 3).** El estado vive en el `useState` del
> `AssistantDrawer`, y AppShell lo **monta una sola vez** (lazy: recién al primer
> abrir) y ya no lo desmonta — cerrar sólo baja una clase de CSS. Por eso reabrir
> conserva la conversación, las propuestas pendientes y el cooldown. Antes, al
> ser una ruta, navegar afuera lo desmontaba y se perdía todo. El montaje lazy
> además evita que quien nunca abre el asistente pague su `loadData`/sync al
> arrancar.
>
> **Los botones abren, ya no navegan.** El "Asistente IA" del sidebar y el FAB
> móvil ahora hacen toggle del panel (mismo criterio de `useAiEnabled`, con el
> fix de caché offline del ítem 8.1: con la IA apagada o cargando siguen siendo
> un link a Ajustes con su explicación). El FAB se oculta con el sheet abierto,
> que ya trae su botón de cerrar. `Escape` y click en el telón también cierran.
>
> **Compatibilidad (tarea 4).** `/assistant` sigue siendo una ruta, pero ahora
> es [`AssistantRedirect`](src/components/AppShell.tsx): abre el drawer (vía un
> contexto que el shell provee alrededor del `<Outlet>`) y hace `Navigate` a la
> landing. Un favorito viejo no da 404 ni pantalla en blanco. "La vista actual"
> para una entrada en frío es Hoy: no hay otra pantalla debajo del asistente de
> la que se pueda venir.

**11. Sheet "+ Nuevo ítem".** `[N]` · riesgo medio
Mover `ItemForm` a modal/bottom-sheet + menú de 3 opciones. **Incluye definir el modo edición**
(§5.3-4). La opción "Desde una foto" queda visible pero deshabilitada hasta el ítem 14 — o se
oculta; a decidir.

### Fase 4 — Funciones pendientes

**12. Editor de tabla inline.** `[D]` · riesgo medio — *cierra una de las 4 pendientes*
Grilla editable con agregar/quitar fila y columna, escribiendo `{columnas, filas}`, con
compatibilidad hacia atrás para las tablas guardadas como texto con pipes (§5.4).

**13. Historial de conversaciones.** `[D]` · riesgo medio-alto — *cierra una de las 4 pendientes*
Persistencia de conversaciones (tabla + RLS + IndexedDB + outbox si va offline-first), títulos,
borrado, "nueva conversación". Depende del ítem 10.

**14. Captura por foto.** `[D]` · riesgo alto — *cierra una de las 4 pendientes*
Gemini Vision + upload + preview de extracción con confirmación. Depende del ítem 11. El más
grande de todos: es la única de las 4 pendientes que necesita backend nuevo de punta a punta.

### Resumen de orden

```
Fase 0:  1 [V] ✅ · 2 [V] ✅                 → base + dark mode
Fase 1:  3 [V] ✅ · 4 [V] ✅ · 5 [V] ✅       → resuelve el desorden, sin tocar rutas
Fase 2:  6 [D] ✅                          → color por tema
Fase 3:  7 [N] ✅ · 8 [N] ✅ · 8.1 [N] ✅ · 9 [N] ✅ · 10 [N] ✅ · 11 [N]  ← el bloque riesgoso (D1 tomada)
Fase 4:  12 [D] · 13 [D] · 14 [D]         → las 3 pendientes restantes
```

Un corte natural para evaluar: **después de la Fase 1** ya se ve gran parte del rediseño y está
resuelto el problema que lo originó, con riesgo casi nulo. Si en ese punto la dirección no
convence, se descartó poco.

---

## 7. Decisiones que necesito de vos antes de empezar

**D1 — ¿Se conserva `react-router` y las URLs?** — ✅ **resuelta: se conserva**
El prototipo navega por estado, sin rutas. Mi recomendación: conservar el router y mapear las
vistas a rutas, con el asistente y el sheet como overlays del shell. Motivo: `useRecordatoriosBadge`
depende de `useLocation`, y en una PWA instalada el botón atrás del sistema es como se cierran los
paneles.

**D2 — ¿Se aceptan las tres desviaciones del sistema "fichas de catálogo"?** (§3.2)
Radius 2px → 3-4px · sombras nuevas en tarjetas · chips de filtro como píldoras redondeadas.
Mi recomendación: aceptar radius y píldoras; limitar la sombra a lo que **flota de verdad**
(drawer, sheet, FAB, chip activo) y dejar las tarjetas de ítem planas, como hoy.

**D3 — ¿Qué pasa con el tipo de ítem `recordatorio`?** (§5.3-2)
Existe en el modelo y en el form; la propuesta lo omite. ¿Se elimina, se oculta, o se agrega al
segmented?

**D4 — Colores de tema: ¿automáticos o elegidos?** — ✅ **resuelta e implementada**
El prototipo hardcodea 5 colores fríos y no ofrece UI de asignación. ¿Asignación automática al
crear el tema (con opción de cambiar), o selector explícito?

> Automática al crear, con selector para cambiarla después (Fase 2, ítem 6). La
> paleta pasó de 5 a **7** colores para que la asignación automática pueda
> repartir sin repetir en temas seguidos.

**D5 — ¿Se corta el alcance en algún punto?**
Las Fases 0-2 son 6 ítems de riesgo bajo que ya entregan la mayor parte del rediseño visible.
Las Fases 3-4 son 8 ítems más grandes. Es una decisión válida hacer 0-2 ahora y evaluar.

### Dos cosas que quiero dejar dichas, no preguntadas

- **La propuesta no abandona "fichas de catálogo"** — lo conserva casi entero y lo extiende con
  una segunda dimensión de color bien pensada. No hay conflicto de fondo acá.
- **El principio de confirmación de la IA está respetado** en la propuesta, incluido el flujo
  nuevo de foto. La única corrección necesaria es que la tarjeta soporte **N acciones**, como hoy,
  y no una sola (§5.4). Eso lo trato como requisito, no como pregunta.

---

## 8. Auditoría de contraste (ítem 2)

Contraste WCAG 2.1 calculado sobre las dos paletas, para los pares que
efectivamente se usan. Umbral AA para texto normal y para el mono de ~10.5px de
los metadatos: **4.5**. Bordes y hairlines no son texto y no se miden con esa vara.

### El resultado inesperado: la paleta oscura contrasta mejor que la clara

| | Fallos AA | Detalle |
|---|---|---|
| **Oscuro** (nueva) | **2** | sólo `ink-mute` (4.07 sobre paper, 3.73 sobre card) |
| **Claro** (ya en producción) | **6** | `ink-mute` (2.77 / 2.98), `slate` (3.34 / 3.60), `gold` (2.83 / 3.05) |

Todo lo demás pasa con margen en las dos: `ink` 12.3–15.3, `ink-soft` 6.3–8.4,
`moss` 5.1–7.0, `rust` 5.0–6.4, `moss-ink` sobre `moss` 5.8–6.5, y el chip de
tema activo (invertido) 13.0–15.3.

### Lo que esto significa

**`slate` y `gold` fallan AA en modo claro y ya estaban así antes de este
trabajo** — son tokens aprobados y en producción, y codifican prioridad
baja/media y estado próximo/hecho en mono de 10.5px. No los toqué: cambiarlos
altera la identidad visual ya validada y es una decisión tuya, no mía. Queda
como **decisión D6** abierta.

Valores mínimos que sí pasarían 4.5 sobre `card` (el fondo más claro, peor caso),
conservando el matiz:

| Token | Hoy | Mínimo que pasa | Sobre paper |
|---|---|---|---|
| `gold` | `#b98530` | `#946a26` | 4.21 |
| `slate` | `#7c8577` | `#6c7468` | 4.22 |
| `ink-mute` | `#8a938a` | `#6d746d` | 4.19 |

**`ink-mute` es nuevo, así que sí me hice cargo:** el token queda con el valor
que pide el diseño, pero **no lo usé para ningún texto que importe**. Los estados
vacíos y los mensajes de "no hay ítems con este filtro" siguen en `ink-soft`
(6.6–7.1). `ink-mute` queda reservado para lo decorativo. Es decir: la fase no
agrega ningún fallo de contraste nuevo a la app.

El script de la auditoría es reproducible y está en el scratchpad de la sesión;
si querés que quede versionado, decilo y lo muevo a `scripts/`.

**D6 — ¿ajustamos `gold` y `slate` en modo claro para que pasen AA?** Es un
cambio chico de hex con impacto visual real en toda la app (prioridad media,
prioridad baja, estado hecho y próximo). En oscuro ya pasan bien y no habría que
tocarlos.
