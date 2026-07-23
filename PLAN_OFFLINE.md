# Plan de arquitectura — Soporte offline completo

> **Estado de implementación:**
> - **Ítems 1-4 + `storage.persist()` (ítem 10 adelantado): implementados**
>   (2026-07-22). Dan **lectura offline**.
> - **Ítems 5-6 (outbox de escritura + motor de sync): implementados**
>   (2026-07-22). Con esto **crear / editar / borrar** items, temas y
>   recordatorios funciona **sin conexión** y se sincroniza solo al volver la
>   señal. Archivos nuevos: [`src/lib/repo.ts`](src/lib/repo.ts) (mutaciones →
>   espejo local + outbox), [`src/lib/sync.ts`](src/lib/sync.ts) (flush +
>   reconcile + disparadores + Web Locks) y
>   [`src/lib/syncCore.ts`](src/lib/syncCore.ts) (lógica pura, con
>   [tests](src/lib/syncCore.test.ts)).
> - **Ítem 7 (indicador visual de estado / pendientes): implementado**
>   (2026-07-22). El motor publica un estado observable
>   (`getSyncState`/`subscribeSync`) que pinta
>   [`SyncStatus`](src/components/SyncStatus.tsx) en la nav y
>   [`SyncSettings`](src/components/SyncSettings.tsx) en Settings.
> - **Ítem 9 (gating del asistente): implementado** junto con el 7 (banner +
>   input deshabilitado sin conexión).
> - **Ítem 8 (recordatorios offline): pendiente.** El watcher local sigue
>   sondeando la red, así que sin conexión no dispara avisos.
>
> **Decisiones confirmadas por Raúl** (resuelven §8): **borrado duro** + re-fetch
> completo al reconciliar; **1-2 dispositivos propios** → LWW por `updated_at` con
> reloj de cliente es aceptable; **sí** pedir `storage.persist()`. Temas: por ahora
> sin `updated_at` (no se editan).

## 0. Objetivo y alcance

Hoy la app no tiene **ninguna** capa local de datos: todo item/tema/recordatorio
se lee y escribe directo contra Supabase. Sin conexión, la app carga (el shell
está precacheado por el service worker) pero **no muestra ni deja crear datos**.

Meta: que **crear / editar / borrar** items, temas y recordatorios funcione sin
conexión, con **sincronización automática** al recuperar la señal, y sin sorpresas
(sin perder cambios, sin duplicar, sin romper feo).

---

## 1. Estado actual (lo que hay que respetar)

### 1.1 Capa de datos — acceso directo a Supabase

Cada módulo llama a `supabase.from(...)` directo y las páginas hacen un `load()`
manual con `useState` (no hay React Query / SWR / caché):

- [`src/lib/items.ts`](src/lib/items.ts) — `listItems`, `createItem`, `updateItem`, `deleteItem`.
- [`src/lib/temas.ts`](src/lib/temas.ts) — `listTemas`, `createTema` (no hay update/delete de temas hoy).
- [`src/lib/recordatorios.ts`](src/lib/recordatorios.ts) — `listRecordatorios`, `upsertRecordatorio`, `deleteRecordatoriosForItem`, `marcarHecho`, `marcarEnviado`, conteos.
- Páginas: [`ItemsPage`](src/pages/ItemsPage.tsx), [`RemindersPage`](src/pages/RemindersPage.tsx), [`AssistantPage`](src/pages/AssistantPage.tsx) — todas con el patrón `load()` → `setState`. Ya usan **UI optimista** en algunos lugares (toggle de línea, marcar hecho), así que el patrón "escribí local, revertí si falla" ya existe en el código.

**Implicación:** para offline hay que interponer una **capa local (repositorio)**
entre las páginas y Supabase. Las páginas casi no cambian de forma; cambia a qué
le piden los datos.

### 1.2 Schema (Supabase / Postgres)

Migración: [`20260720120000_schema_inicial.sql`](supabase/migrations/20260720120000_schema_inicial.sql).

| Tabla | PK / ID | `updated_at` | `user_id` propio | Borrado / FK |
|---|---|---|---|---|
| `temas` | `uuid default gen_random_uuid()` | ❌ no tiene | ✅ sí | referenciada por `items.tema_id` (`on delete set null`) |
| `items` | `uuid default gen_random_uuid()` | ✅ sí (trigger `items_set_updated_at` pone `now()` en cada UPDATE) | ✅ sí | `tema_id → temas` (set null); referenciada por `recordatorios` |
| `recordatorios` | `uuid default gen_random_uuid()` | ❌ **no tiene** | ❌ **no** (RLS se valida por join a `items`) | `item_id → items` (`on delete cascade`) |

Puntos clave para offline:

- **Los IDs los genera el servidor** (`default gen_random_uuid()`). Los `insert`
  actuales **no** mandan `id`; lo reciben en el `.select('*').single()` de vuelta.
  Para crear offline hay que generar el UUID **en el cliente** (ver §3.3).
- Los tipos ya **permiten** pasar `id` opcional (`TemaInsert`/`ItemInsert`/
  `RecordatorioInsert` son `... & Partial<Pick<..., 'id'>>`), y el código ya usa
  `crypto.randomUUID()` para IDs de líneas de lista. O sea: generar UUID en
  cliente es un cambio chico, no invasivo.
- **`recordatorios` no tiene `updated_at`** → sin esa columna no hay "gana el más
  reciente" para recordatorios. Hay que agregarla (§3.4).
- **`recordatorios` no tiene `user_id`**: su RLS es un `EXISTS` contra `items`.
  Consecuencia para sync: para insertar un recordatorio en el servidor, **su item
  padre ya tiene que existir en el servidor** (FK + RLS). Esto fija el **orden de
  sincronización**: temas → items → recordatorios (ver §4.2).
- El trigger de `items` **pisa `updated_at` con `now()` en cada UPDATE**. Para
  hacer LWW por tiempo real de edición hay que ajustarlo (§3.4 / §4.3).

### 1.3 Service worker — qué cachea hoy

[`src/sw.ts`](src/sw.ts) (estrategia `injectManifest` de `vite-plugin-pwa`):

- **Precachea assets** (`precacheAndRoute(self.__WB_MANIFEST)`, globs `js/css/html/svg`) → el **shell** de la app abre offline.
- Maneja `push` y `notificationclick` (notificaciones).
- **NO tiene runtime caching de datos**, ni handler de `fetch` para las llamadas
  a la API de Supabase. Es decir: **el shell abre offline, los datos no**.

`registerType: 'autoUpdate'`, `devOptions.enabled: true`.

**Decisión de diseño (importante):** para los **datos** NO vamos a cachear
respuestas HTTP de Supabase en el SW. Los datos viven en **IndexedDB** y la app
los lee de ahí. El SW se queda como está (shell + push). Esto es más simple y
robusto que interceptar `fetch` de `supabase-js` (que además usa POST para RPC y
headers de auth que no querés cachear).

### 1.4 Auth offline — ya es viable

[`AuthContext`](src/lib/AuthContext.tsx) usa `supabase.auth.getSession()`, que
`supabase-js` resuelve **desde localStorage** (no necesita red). O sea: **offline
sabemos quién es el usuario**. La sesión sobrevive; solo el *refresh* del token
necesita red (se resuelve al reconectar). Bien: no hay que inventar auth offline.

### 1.5 Recordatorios y asistente hoy (dependen de red)

- **Watcher local** ([`useLocalReminderWatcher`](src/lib/useLocalReminderWatcher.ts)):
  sondea Supabase cada ~25s, arma `setTimeout` por recordatorio y dispara la
  notificación local; marca `enviado` contra Supabase. **Sondear y marcar
  necesitan red.** Offline, hoy, no dispara nada.
- **Cron del servidor** (`send-reminder-notifications`, cada 1 min) → push cuando
  la app está cerrada. Necesita servidor + que el push llegue al dispositivo.
- **Asistente** ([`AssistantPage`](src/pages/AssistantPage.tsx)): `supabase.functions.invoke('ai-assistant')` → Gemini. Offline, el `invoke` tira error de red; hoy se cae en un mensaje genérico ("No se pudo contactar al asistente"), no en un estado "sin conexión" claro.

---

## 2. Resumen de la propuesta (una pantalla)

```
        páginas (React)
             │  leen/escriben
             ▼
   ┌─────────────────────┐        ┌────────────────────────┐
   │  repositorio local   │  ───►  │  IndexedDB (vía `idb`) │
   │ (items/temas/recs)   │        │  stores espejo + outbox │
   └─────────────────────┘        └────────────────────────┘
             │                                 ▲
             │ encola mutaciones               │ flush + reconcile
             ▼                                 │
   ┌─────────────────────┐   online   ┌────────────────────────┐
   │   motor de sync      │ ─────────► │        Supabase        │
   │ (flush outbox + LWW) │            └────────────────────────┘
   └─────────────────────┘
```

- **IndexedDB** con la librería **`idb`** guarda el espejo local de `temas`,
  `items`, `recordatorios` **+ un store `outbox`** de cambios pendientes.
- Las páginas leen del **repositorio local** (instantáneo, funciona offline) y
  escriben ahí; el repo persiste en IndexedDB y **encola** la mutación en el
  outbox.
- El **motor de sync** vacía el outbox contra Supabase cuando hay red, resuelve
  conflictos por **"gana el más reciente" (`updated_at`)**, y **reconcilia** con
  un re-fetch completo.
- **IDs UUID generados en el cliente** desde el insert → los IDs son estables
  local↔servidor, **no hace falta remapear** nada al sincronizar (clave).

---

## 3. Capa local de datos

### 3.1 Elección de almacenamiento: `idb` sobre IndexedDB

**Recomendación: usar [`idb`](https://github.com/jakearchibald/idb) (~1 KB) sobre IndexedDB.**

| Opción | Veredicto |
|---|---|
| **`localStorage`** | ❌ Síncrono (bloquea el hilo principal), ~5 MB, solo strings, sin índices ni transacciones. Sirve para un flag, no para un dataset que crece con queries. |
| **IndexedDB "a pelo"** | ⚠️ Es el motor correcto (async, transaccional, índices, sin límite práctico para este volumen), pero su API basada en eventos es verbosa y fácil de romper (transacciones que se cierran solas, etc.). |
| **`idb` (recomendada)** | ✅ Wrapper *finito* (promesas) sobre IndexedDB, sin magia: mantenés las semánticas de IDB (stores, índices, transacciones) pero con `async/await`. ~1 KB, ampliamente usada, cero lock-in. Es el punto justo para una app personal. |
| **Dexie** | Alternativa más "gorda" (querys tipo ORM, hooks). Más features de las que necesitamos; la reevaluamos solo si el volumen/las consultas crecen. |
| **Framework de sync (RxDB / WatermelonDB / PowerSync / ElectricSQL)** | ❌ para este alcance. **PowerSync/ElectricSQL** son la respuesta "llave en mano" para offline-sync sobre Supabase, pero suman infraestructura, costo y lock-in. Para una app **personal de un solo usuario**, un outbox hecho a mano con `idb` es proporcionado y auditable. (Vale como nota de "build vs buy" si algún día esto escala a multiusuario colaborativo.) |

**Por qué no cachear en el service worker:** ver §1.3. Los datos van a IndexedDB;
el SW solo hace shell + push.

### 3.2 Esquema local (object stores de IndexedDB)

```
DB: "organizador"  (version 1)

store "temas"           keyPath: id
  index "by_user"       user_id

store "items"           keyPath: id
  index "by_tema"       tema_id
  index "by_updated"    updated_at

store "recordatorios"   keyPath: id
  index "by_item"       item_id
  index "by_estado"     estado
  index "by_fecha"      fecha_hora

store "outbox"          keyPath: seq (autoIncrement)
  index "by_entity"     [entity, entityId]

store "meta"            keyPath: key      // lastSyncAt, syncState, schemaVersion…
```

Cada fila espejo guarda **exactamente las columnas del servidor** más, opcionalmente,
un campo local `_dirty` (tiene cambios sin sincronizar) para pintar un marcador en la UI.

**Store `outbox` (cambios pendientes)** — una fila por mutación offline:

```ts
interface OutboxOp {
  seq: number                 // autoincrement → orden FIFO = orden causal
  entity: 'tema' | 'item' | 'recordatorio'
  op: 'insert' | 'update' | 'delete'
  entityId: string            // UUID (mismo local y servidor)
  payload: Record<string, unknown> | null  // fila/patch a aplicar (null en delete)
  baseUpdatedAt: string | null // updated_at que tenía la fila al empezar a editar (para LWW condicional)
  createdAt: string
  tries: number
  lastError: string | null
}
```

Notas:
- **Coalescing** (implementado en `planOutbox`): las ops del mismo `entityId` se
  pliegan en una sola escritura. `insert` + N `update` → un solo `insert` con el
  estado final; `update` + `update` → un `update` con los patches mergeados, que
  conserva el `baseUpdatedAt` del primero y el `updated_at` del último;
  `update`(s) + `delete` → solo el `delete`. La op resultante recuerda **todas**
  las filas del outbox que cubre (`seqs`), que se borran juntas al aplicarla.
- `insert` seguido de `delete` del mismo id **antes** de sincronizar → se cancelan
  (se elimina del outbox sin tocar el servidor).
  **Matiz que agregamos al implementarlo:** solo se cancelan si el insert
  **nunca se intentó** (`tries === 0`). Si ya se había intentado, pudo haberse
  aplicado en el servidor y haberse perdido la respuesta (*ack perdido*); en ese
  caso cancelar dejaría una fila huérfana que el re-fetch volvería a bajar y el
  usuario vería **reaparecer lo que borró**. Con `tries > 0` se descarta el
  insert pero **se manda el delete**, que es idempotente y barato.

### 3.3 Generación de IDs en el cliente (impacto)

Hoy: el `insert` no manda `id`; Postgres lo genera. Para crear offline necesitamos
el UUID **desde el momento del insert** (para referenciarlo en el outbox, en el
espejo local y en los hijos, p. ej. un recordatorio que apunta a un item recién
creado offline).

**Cambio propuesto:** en `createTema` / `createItem` / `upsertRecordatorio` (y el
insert de recordatorio), generar `id: crypto.randomUUID()` en el cliente y pasarlo
en el `insert`.

**Impacto: bajo.**
- Los tipos ya aceptan `id` opcional (§1.2). No cambian.
- El `default gen_random_uuid()` de Postgres **queda como fallback** para cualquier
  insert que no mande id → **no requiere migración** para esto.
- **Ganancia clave:** como el UUID es el mismo en cliente y servidor, al sincronizar
  **no hay que remapear IDs** (el problema clásico de los IDs autoincrement offline
  desaparece). El outbox, los hijos y el espejo local siguen siendo válidos tal cual
  llegan al servidor.
- **Idempotencia:** hacer el `insert` de sync como **`upsert` por `id`** vuelve la
  operación segura ante "ack perdido" (mandé el insert, se aplicó, pero perdí la
  respuesta por corte → reintento = upsert = no duplica).

### 3.4 Columna `updated_at` / timestamps (impacto de schema)

Para "gana el más reciente" por `updated_at` (§4.3) hace falta un `updated_at`
confiable en las tablas que se editan:

- **`items`** ya lo tiene, pero el **trigger lo pisa con `now()` en cada UPDATE**.
  Para LWW por *tiempo real de edición* hay que **respetar el `updated_at` que
  manda el cliente** en el camino de sync. Opciones:
  1. Ajustar el trigger a "setear `now()` **solo si el cliente no mandó** `updated_at`"
     (`if new.updated_at is not distinct from old.updated_at then new.updated_at = now()`), o
  2. Quitar el trigger y setear `updated_at` **siempre desde el cliente** en cada
     escritura (online y offline).
  → Recomiendo la opción 1 (mantiene el comportamiento online actual para escrituras
  normales y deja que el sync mande su timestamp explícito).
- **`recordatorios`**: **agregar `updated_at timestamptz not null default now()`**
  (migración nueva) + el mismo criterio de trigger. Backfill: `update ... set
  updated_at = created_at`.
- **`temas`**: hoy **no se editan** (solo `createTema`; no hay update/delete de
  temas en la UI). Para el MVP **no necesitan `updated_at`** (un tema o existe o no;
  sus conflictos se reducen a "insert idempotente"). Si más adelante se permite
  renombrar/borrar temas, ahí sí se agrega. Lo dejo anotado, no lo hago ahora.

**Reloj:** el `updated_at` de LWW lo pone el **cliente** en el momento de la
mutación (hora del dispositivo). Riesgo: *clock skew* entre dispositivos. Para una
app personal (1–2 dispositivos del mismo dueño) es aceptable; lo documentamos como
limitación conocida (§7).

### 3.5 ¿Borrado duro o soft-delete?

El caso "item borrado en el servidor mientras se editaba offline" (y viceversa)
es más limpio si el borrado es *un dato sincronizable* más. Dos caminos:

- **A — Borrado duro (recomendado para el MVP):** el `delete` se encola en el
  outbox como cualquier op. Borrar algo ya borrado es **idempotente** (no falla).
  El caso "edité offline algo que el server borró" se detecta en la **escritura
  condicional** (§4.3): el UPDATE afecta 0 filas → el item ya no existe → se
  descarta local + se avisa. **No requiere columnas nuevas.**
- **B — Soft-delete (`deleted_at`):** un borrado pasa a ser un UPDATE más, y la
  reconciliación puede ser **incremental** (traer `updated_at > lastSync`, viendo
  también los borrados como tombstones). Cuesta una columna + filtrar `deleted_at
  is null` en todas las lecturas + limpieza de tombstones. Mejor si algún día
  querés sync incremental o multiusuario.

**Decisión:** arrancar con **A (borrado duro + reconcile por re-fetch completo)**,
que para el volumen de una app personal es trivial y evita el arrastre de
tombstones. Migrar a B queda como upgrade si el dataset crece y el re-fetch
completo empieza a doler.

---

## 4. Estrategia de sincronización

### 4.1 Cuándo se dispara

- Evento **`online`** del navegador (`window.addEventListener('online', ...)`).
- Al **volver el foco / visibilidad** (`visibilitychange`, `focus`) — cubre el caso
  "el `online` no disparó pero volvió la red".
- Al **arrancar la app** si `navigator.onLine`.
- **Después de cada mutación local**, intentar un flush inmediato si hay red
  (así online el outbox casi nunca acumula: se escribe local y se sube al toque).
- **Retry periódico** con backoff (p. ej. cada 30–60 s) mientras el outbox no esté
  vacío y haya red, con backoff exponencial ante errores (evita martillar).
- **Single-flight:** un solo sync a la vez, incluso entre pestañas → **Web Locks
  API** (`navigator.locks.request('sync', ...)`) para no mandar el mismo outbox dos
  veces desde dos pestañas (§7).

### 4.2 Orden de aplicación del outbox

- **FIFO por `seq`** (autoincrement). Como la UI crea el padre antes que el hijo
  (tema → item → recordatorio), el orden FIFO **ya respeta las dependencias
  causales** en el caso normal.
- **Refuerzo por dependencias** (defensivo, por la RLS/FK de `recordatorios` que
  exige el item padre en el servidor): si una op falla por *foreign key / RLS*
  (padre todavía no subió porque su op falló antes), **no se descarta**: se deja en
  el outbox y se reintenta después del padre. En la práctica: procesar en orden,
  y si una op de hijo falla por dependencia, frenar esa cadena y seguir con las
  independientes; reintentar en el próximo ciclo.
- **Idempotencia** (§3.3): `insert`/`update` como **`upsert` por `id`**; `delete`
  idempotente. Así reintentar una op ya aplicada no rompe.
- **Manejo de errores por op:** incrementar `tries`, guardar `lastError`, backoff.
  Un error *permanente* (p. ej. validación 400 que no se va a arreglar sola) se
  marca y se **surface a la UI** para que el usuario decida (reintentar/descartar),
  en vez de bloquear el resto de la cola para siempre.

### 4.3 Resolución de conflictos — "gana el más reciente" (`updated_at`)

Modelo: **Last-Write-Wins por `updated_at`**, con **escritura condicional** para no
pisar un cambio del servidor más nuevo que mi edición offline.

Al subir un `update` de una fila con `baseUpdatedAt` (el `updated_at` que tenía
cuando empecé a editarla offline) y `clientUpdatedAt` (cuándo la edité):

```sql
-- Solo aplica si el servidor NO tiene algo más nuevo que mi edición.
update items
   set ..., updated_at = :clientUpdatedAt
 where id = :id
   and updated_at <= :clientUpdatedAt   -- guard LWW
returning id;
```

- **Afecta 1 fila** → mi cambio ganó (era el más reciente). ✅
- **Afecta 0 filas** → o bien **el servidor tiene algo más nuevo** (otra edición
  ganó → **descarto mi cambio local y refresco desde el server**), o bien **la fila
  ya no existe** (borrada en el server → **elimino el item local + aviso**). Ambos
  se distinguen con un `select` de control.

Casos que pide el enunciado, resueltos:

- **Item borrado en el server mientras lo editaba offline:** el UPDATE condicional
  afecta 0 filas y el `select` confirma que no existe → gana el borrado (más
  reciente), se limpia local y se avisa "se borró en otro lado".
- **Item editado en dos lugares:** gana el `updated_at` mayor. El perdedor se
  descarta y se refresca con el ganador. (Para una app personal, colisión rara.)
- **Recordatorio:** requiere primero **agregarle `updated_at`** (§3.4); con eso, el
  mismo mecanismo aplica (p. ej. `marcarHecho` offline vs. `marcarEnviado` del cron
  → gana el más reciente).

Para que la escritura condicional funcione, el `updated_at` **lo manda el cliente**
y el trigger **no lo pisa** en el camino de sync (§3.4).

> **Alternativa más simple (fallback):** LWW *por orden de llegada al servidor*
> (el último dispositivo que sincroniza gana), sin timestamps ni escritura
> condicional. Es más pobre (no respeta el tiempo real de edición) pero no toca
> triggers ni agrega columnas. **No la recomiendo** dado que el enunciado pide
> explícitamente LWW por `updated_at`, pero queda como plan B si querés minimizar
> cambios de schema.

### 4.4 Reconciliación tras sincronizar

**Recomendado para el MVP: re-fetch completo.**

- Después de vaciar el outbox, traer `listTemas` + `listItems` + `listRecordatorios`
  y **reemplazar** los stores locales. El dataset de una app personal es chico →
  el re-fetch completo es simple y **robusto** (ve borrados del servidor sin
  necesidad de tombstones, cosa que el merge incremental **no** puede con borrado
  duro).
- **Merge incremental** (traer solo `updated_at > lastSyncAt`) es la optimización
  natural cuando el volumen crezca, **pero** exige soft-delete/tombstones (opción B
  de §3.5) para no "resucitar" filas borradas. Queda para una fase posterior.

**Orden fino:** primero **flush del outbox** (subir lo mío), después **re-fetch**
(bajar el estado ya mergeado). Nunca al revés, para no pisar cambios locales aún
no subidos.

---

## 5. UI — qué ve el usuario

1. **Indicador "sin conexión":** una píldora/banner (probablemente en
   [`AppNav`](src/components/AppNav.tsx)) manejada por `navigator.onLine` +
   eventos `online`/`offline`. Estado: *En línea* / *Sin conexión*.
2. **Cambios pendientes de sincronizar:** badge con el **conteo del outbox**
   ("3 sin sincronizar"). Opcional: marcador sutil `●` en cada item/recordatorio
   con cambios en cola (`_dirty`).
3. **Última sincronización:** "Sincronizado hace 2 min" (de `meta.lastSyncAt`),
   y un estado *Sincronizando…* mientras corre el flush.
4. **Errores de sync:** no bloqueantes. Aviso inline/toast + botón **"Reintentar"**.
   Para ops con error *permanente*, tarjeta con el detalle y opción reintentar /
   descartar. Reusa el patrón de estados que ya tiene `ProposedActionCard` del
   asistente (idle/applying/done/error), que en el repo ya es familiar.
5. **Escritura optimista:** como las páginas leen del store local, crear/editar/
   borrar **se refleja al instante** también offline. Si el flush posterior falla,
   el cambio **no se pierde** (queda en el outbox); solo se marca como pendiente.

---

## 6. Riesgos y casos límite

### 6.1 Asistente de IA offline (debe deshabilitarse con gracia)

- Necesita Gemini vía Edge Function → **no funciona offline**, y punto.
- **Propuesta:** en [`AssistantPage`](src/pages/AssistantPage.tsx), detectar
  `navigator.onLine` (y el error de red del `invoke`) y mostrar un estado claro
  tipo el que ya existe para `aiEnabled === false`: banner **"El asistente
  necesita conexión a internet"** + **input deshabilitado**. Nada de mensajes de
  error crudos ni spinners colgados. Al volver la red, se rehabilita solo.
- Sus *acciones* (crear/editar/borrar) igual pasan por el CRUD → una vez que
  exista la capa offline, si el usuario estaba online al proponer y se corta al
  confirmar, la acción se encola como cualquier mutación. Pero **proponer** algo
  requiere red, así que la página entera se gatea offline.

### 6.2 Recordatorios / notificaciones cuando el dispositivo estuvo offline

Este es el caso más espinoso y hay que ser honestos sobre los límites de la web:

- **App abierta, sin red:** hoy el watcher **sondea Supabase** (red) → offline no
  dispara. **Propuesta:** que el watcher lea del **store local** de recordatorios
  (no de la red). Así, **con la app abierta, las notificaciones locales siguen
  disparando offline** (la notificación es local, no necesita servidor). El
  `marcarEnviado` correspondiente se **encola en el outbox**.
- **Dispositivo offline/dormido al momento exacto del disparo, con la app cerrada:**
  **no se puede garantizar** una notificación. Los `setTimeout` mueren al cerrar la
  pestaña, y el push del servidor (que es el mecanismo para "app cerrada") **no
  llega** si el dispositivo no tiene red. Esto es una limitación real de la
  plataforma web, no del diseño. **Mitigación:** al **reabrir** la app, el watcher
  ve en el store local los recordatorios `pendiente` **ya vencidos** y dispara una
  notificación de **catch-up** ("Tenías N recordatorios vencidos"). La ventana del
  watcher ya incluye los vencidos (`lte(fecha_hora, ahora)`), así que el
  comportamiento es mayormente reusable.
- **Doble disparo:** el cron del servidor marca `enviado`; el watcher local marca
  `enviado` al disparar. Offline el watcher no puede marcar en el server hasta
  reconectar → riesgo de que el cron reenvíe al volver la red. **Mitigación:** el
  `marcarEnviado` encolado se sincroniza al reconectar; y como el push del cron
  solo llega si hay red (momento en que el `enviado` ya está por subir), la ventana
  de doble aviso es chica. Documentar; si molesta, dedup por `tag` de la
  notificación (que ya es `recordatorio-${id}`).

### 6.3 Otros casos límite

- **Persistencia del almacenamiento:** IndexedDB puede ser *desalojada* bajo
  presión de espacio. El outbox **no puede perderse**. → Pedir
  `navigator.storage.persist()` (mejora la durabilidad) y avisar si se deniega.
- **Multi-pestaña:** dos pestañas escribiendo el mismo IndexedDB y ambas
  sincronizando → doble envío. → **Web Locks** para single-flight del sync
  (§4.1); IndexedDB ya es compartido entre pestañas del mismo origen, así que el
  espejo es consistente, pero el *flush* debe ser uno solo.
- **Token de auth vencido offline:** las **lecturas** funcionan (salen del store
  local, no de Supabase). El **sync** al reconectar refresca el token; si el
  *refresh token* venció (offline muy largo), el sync falla con error de auth →
  **surface** "Reingresá para sincronizar" **sin perder el outbox** (se sube al
  reloguear).
- **Corte a mitad de sync:** al ser op-por-op idempotente (upsert/borrado
  idempotente) y FIFO, reanudar es seguro; las ya aplicadas no duplican.
- **Recordatorio huérfano:** un recordatorio cuyo item padre falló su insert
  permanentemente → su op queda en error por dependencia (§4.2). Se surface junto
  con el item padre.
- **Migración de esquema de IndexedDB:** versionar la DB (`meta.schemaVersion`) y
  manejar `upgrade` de `idb` desde el día 1, para poder evolucionar los stores sin
  romper datos locales existentes.
- **`crypto.randomUUID`:** disponible en contexto seguro (https/localhost). La app
  ya lo usa, así que no hay regresión; anotarlo igual.

---

## 7. División del trabajo (de lo más chico/seguro a lo más grande)

Cada paso es **enviable y reversible** por separado. El orden lleva
**offline-lectura antes que offline-escritura**, y deja el motor de sync para
cuando ya hay dónde apoyarlo.

| # | Ítem | Riesgo | Qué entrega | Toca |
|---|---|---|---|---|
| **1** ✅ | **UUID en cliente en todos los inserts** (`createItem`/`createTema`/insert de recordatorio pasan `id: crypto.randomUUID()`). Sin cambio visible; sigue todo online. | Muy bajo | Prepara IDs estables para el outbox. | `items.ts`, `temas.ts`, `recordatorios.ts`, `ItemForm`, `AssistantPage` |
| **2** ✅ | **Migración: `recordatorios.updated_at`** + backfill + ajuste de triggers (`items` y `recordatorios`) para respetar `updated_at` del cliente. Online-only, sin cambio de comportamiento. | Bajo | Habilita LWW por `updated_at` en las 3 tablas relevantes. | `supabase/migrations/*`, tipos |
| **3** ✅ | **Capa IndexedDB con `idb`** (`db.ts`): definición de stores + `upgrade` versionado. Sin wiring todavía. | Bajo | Base de almacenamiento local. | nuevo `src/lib/db.ts` |
| **4** ✅ | **Caché read-through**: en cada `load()`, escribir lo que llega del server en IndexedDB; al abrir, **hidratar desde IndexedDB primero** (instantáneo) y luego refrescar de red. | Bajo-medio | **Lectura offline** (los datos ya se ven sin red). Escritura sigue necesitando red. | repos + páginas |
| **5** ✅ | **Repositorio + outbox (escritura offline)**: las mutaciones escriben local + encolan en `outbox`; offline no fallan. | Medio | **Crear/editar/borrar offline** (sin subir todavía). | `repo.ts`, `db.ts` |
| **6** ✅ | **Motor de sync**: flush del outbox (FIFO + dependencias), **upsert idempotente**, **LWW condicional** (§4.3), disparadores (`online`/foco/visibilidad/intervalo/post-mutación), **Web Locks**, y **reconcile por re-fetch**. | Alto | **Sincronización automática** al reconectar. | `sync.ts`, `syncCore.ts` |
| **7** ✅ | **UI de estado**: indicador sin conexión, conteo de pendientes, última sync, reintentar/errores. | Bajo-medio | Feedback al usuario. | `AppNav`, componente nuevo |
| **8** | **Recordatorios offline**: watcher lee del store local (dispara offline), `marcarEnviado` al outbox, catch-up de vencidos al reabrir. | Medio | Notificaciones locales sin red (con app abierta) + catch-up. | `useLocalReminderWatcher`, repos |
| **9** ✅ | **Asistente: gating offline** (banner + input deshabilitado). | Muy bajo | Que no falle feo sin red. | `AssistantPage` |
| **10** | **Endurecimiento**: `storage.persist()`, manejo de auth vencido, dedup multi-pestaña, y **tests unitarios** de la lógica pura de sync (orden del outbox, LWW, cancelación insert+delete) — al estilo de `reminderScheduling.test.ts` / `actions.test.ts`. | Medio | Robustez + red de seguridad. | `sync.ts`, tests |

**Recomendación de corte de release:** los pasos **1–4** ya dan un salto grande
(lectura offline instantánea) con riesgo bajo y se pueden mergear rápido. **5–6**
son el corazón (escritura + sync) y conviene hacerlos con los tests del paso 10
en paralelo. **7–9** son la capa de experiencia. Sugiero pedir luz verde por
tramos: primero **1–4**, revisar en vivo, y recién ahí seguir con **5–6**.

---

## 7 bis. Cómo quedaron implementados los ítems 5-6

### Módulos

| Archivo | Rol |
|---|---|
| [`src/lib/db.ts`](src/lib/db.ts) | Almacenamiento puro sobre IndexedDB: espejo (`temas`/`items`/`recordatorios`), `outbox`, `meta`. Escrituras fila a fila para las mutaciones y reemplazo total del store para la reconciliación. |
| [`src/lib/repo.ts`](src/lib/repo.ts) | **Todas** las mutaciones de la app. Cada una: (1) escribe el espejo local → UI optimista instantánea, (2) encola la op en el `outbox`, (3) pide un sync. Ninguna falla por falta de red. |
| [`src/lib/syncCore.ts`](src/lib/syncCore.ts) | Lógica **pura** y testeada: `planOutbox` (FIFO + coalescing + cancelación), `resolveConditionalUpdate` (LWW), `classifySyncError`, `blockedByParent`, `backoffDelayMs`. |
| [`src/lib/sync.ts`](src/lib/sync.ts) | El motor con efectos: flush del outbox contra Supabase, reconciliación por re-fetch, disparadores y Web Locks. |
| [`src/components/SyncEngine.tsx`](src/components/SyncEngine.tsx) | Monta/desmonta el motor con la sesión (una sola vez, en la raíz). |

`items.ts` / `temas.ts` / `recordatorios.ts` quedaron **solo de lectura** contra
el servidor: sus funciones de mutación se eliminaron para que no haya forma de
saltarse el motor por accidente. Lo único que usa esas lecturas es el re-fetch
de reconciliación.

### Ciclo de sync

1. **Flush.** `planOutbox` agrupa el outbox por entidad, pliega las ops
   redundantes y devuelve el plan en orden FIFO (el `seq` más viejo de cada
   grupo), que es el orden causal tema → item → recordatorio.
   - `insert` → `upsert` por `id` (idempotente ante ack perdido).
   - `update` → escritura condicional con `updated_at <= :clientUpdatedAt`
     (§4.3). 0 filas + `select` de control resuelve *server-newer* (descarto mi
     cambio) vs *deleted-on-server* (borro la fila local).
   - `delete` → borrado duro idempotente.
   - Cada op aplicada sale del outbox; una que falla se queda con `tries++` y
     `lastError`. Si falla un item, sus recordatorios se saltean en ese ciclo
     (`blockedByParent`) y se reintentan en el siguiente.
   - Un error de red o de auth corta el ciclo entero (no tiene sentido seguir);
     uno permanente se marca y el resto de la cola sigue.
2. **Reconcile.** Solo si el outbox quedó **vacío**: re-fetch completo de
   temas/items/recordatorios y reemplazo del espejo. Si mientras bajábamos entró
   una mutación nueva, se aborta el reemplazo (no pisamos una escritura optimista
   sin subir) y reconcilia el ciclo siguiente.

### Disparadores

Evento `online`, `focus` y `visibilitychange` de la pestaña, intervalo de 30 s,
arranque de la app, y cada mutación nueva (con 200 ms de debounce para que una
ráfaga suba en un solo ciclo). Todo pasa por
`navigator.locks.request('organizador-sync', { ifAvailable: true })`: **un solo
sync a la vez entre todas las pestañas**. Backoff exponencial (5 s → 5 min) tras
ciclos fallidos, que se resetea al volver la red.

### Lo que las pantallas ven

Las páginas leen **siempre** del espejo local y se resuscriben a
`subscribeSyncSettled` para releer cuando el motor termina un ciclo. Por eso la
UI se siente igual online que offline.

---

## 7 ter. Indicador de estado (ítem 7)

El motor publica un estado observable —`getSyncState()` / `subscribeSync()`, que
[`useSyncStatus`](src/lib/useSyncStatus.ts) expone a React vía
`useSyncExternalStore`— con cinco campos: `online`, `running`, `pending`
(operaciones en el outbox), `lastSyncAt` y `error`.

**En la nav** ([`SyncStatus`](src/components/SyncStatus.tsx)): una píldora en
mono uppercase con un punto de color, que **solo aparece cuando tiene algo que
decir**. Con todo al día no dibuja nada, para no dejar un adorno permanente en
la barra. Precedencia:

| Estado | Color | Texto |
|---|---|---|
| Sin conexión | slate | `Sin conexión` (+ `· N sin sincronizar` si hay cola) |
| Error de sync | rust | `No se pudo sincronizar` / `Sesión vencida — reingresá` |
| Subiendo la cola | gold, punto con latido | `Sincronizando…` |
| Cambios en cola | gold | `N sin sincronizar` |

`Sincronizando…` sale **solo si `pending > 0`**: el re-fetch periódico con la
cola vacía es invisible a propósito, si no el indicador parpadearía cada 30 s
sin que pase nada. El `title` de la píldora lleva la última sincronización.

**En Settings** ([`SyncSettings`](src/components/SyncSettings.tsx)): el detalle
completo (conexión, pendientes, última sincronización con
`formatHaceCuanto`, error) y un botón **Sincronizar ahora** que saltea el
backoff (`forceSyncNow`).

**Errores:** un fallo aislado de red no se muestra (puede ser un parpadeo); se
reporta recién al **segundo ciclo fallido seguido**. El de auth se muestra desde
el primero, porque reintentar no lo arregla. Además, `flushOutbox` ahora
distingue las ops trabadas por un error **permanente** y las reporta: antes una
op así dejaba el contador clavado en "N sin sincronizar" sin explicación, porque
el ciclo terminaba "bien" (no lanzaba) y nadie se enteraba.

**Asistente sin conexión (ítem 9):** banner con borde rust arriba del chat,
input y botón deshabilitados con placeholder explicativo, y la guarda de
`navigator.onLine` en el envío como red de seguridad por si la señal se cae
entre que se escribe y se manda.

---

## 8. Preguntas abiertas para Raúl (antes de implementar)

1. **¿Alcance de "editar/borrar temas" offline?** Hoy los temas solo se crean.
   Si no vas a editarlos/borrarlos, `temas` se queda sin `updated_at` (más simple).
   ¿Lo dejamos así o preparamos el terreno para renombrar/borrar temas?
2. **¿Borrado duro (A) u soft-delete (B)?** Recomiendo A para el MVP (§3.5).
   Confirmame si estás de acuerdo con re-fetch completo al reconciliar.
3. **¿Cuántos dispositivos en simultáneo?** Si es 1–2 tuyos, LWW por `updated_at`
   con reloj del cliente alcanza. Si prevés más, conviene pensar en tiempo del
   servidor / vector clocks (fuera de este MVP).
4. **¿Pedimos `storage.persist()`** (puede mostrar un prompt del navegador) o lo
   dejamos best-effort silencioso?
