# Graph Report - Organizador  (2026-07-24)

## Corpus Check
- 86 files · ~172,990 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 731 nodes · 1484 edges · 54 communities (38 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `04b8dbd6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Motor de sincronizacion offline (db/outbox/sync)
- Gestion de items (ItemForm/ItemList)
- Layout, ruteo y estado de sync de la app
- Asistente IA - acciones propuestas
- Config ESLint y devDependencies
- Recordatorios y watcher local
- Config TypeScript (app)
- package.json - dependencias
- Notificaciones push
- Config TypeScript (node)
- Config TypeScript (worker)
- CRUD items/temas y handler asistente IA
- PWA manifest
- Documentacion raiz / planes / auth context
- Edge Function manage-ai-key
- Edge Function send-reminder-notifications
- Imagen de diseno (Code_Generated_Image)
- Decisiones offline (LWW, hard-delete, RLS)
- Imagen de diseno (Gemini_Generated_Image)
- tsconfig raiz
- Iconos SVG de la app
- Encriptacion de clave Gemini
- Service worker push
- Decision: eleccion de idb
- Decision: storage.persist()
- ItemsPage.tsx
- Brief de diseño — Organizador Personal IA
- Handoff: Rediseño de arquitectura de información — Organizador Personal IA
- Brief de diseño — Organizador Personal IA
- Adoption of react-router-dom for /settings Route
- @eslint/js
- eslint-plugin-react-hooks
- tailwindcss
- @tailwindcss/vite
- @types/react
- @types/react-dom
- vite
- vite-plugin-pwa
- @vitejs/plugin-react
- Outbox Pattern for Offline Mutations
- AssistantDrawer.tsx
- extract-from-photo/index.ts
- 6. Ítems de trabajo, ordenados
- Mapa del proyecto
- Estructura de carpetas y responsabilidad de cada módulo
- Diagramas
- 5. Clasificación: qué se puede hacer ya, qué no
- 2. Navegación
- 3. Sistema visual: ¿evoluciona o reemplaza?
- eslint

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 28 edges
2. `getDB()` - 23 edges
3. `Item` - 23 edges
4. `HoyPage()` - 18 edges
5. `Tema` - 18 edges
6. `ItemsPage()` - 17 edges
7. `compilerOptions` - 17 edges
8. `flushOutbox()` - 14 edges
9. `compilerOptions` - 14 edges
10. `ItemForm()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `useLocalReminderWatcher()` --shares_data_with--> `listRecordatoriosParaDisparo`  [INFERRED]
  src/lib/useLocalReminderWatcher.ts → PLAN_OFFLINE.md
- `marcarHecho` --shares_data_with--> `RemindersPage()`  [INFERRED]
  PLAN_ORGANIZADOR.md → src/pages/RemindersPage.tsx
- `SyncEngine()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncEngine.tsx → PLAN_OFFLINE.md
- `SyncSettings()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncSettings.tsx → PLAN_OFFLINE.md
- `SyncStatus()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncStatus.tsx → PLAN_OFFLINE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Offline Sync Pipeline (repo -> db -> sync engine)** — src_lib_repo_repo, src_lib_db_db, src_lib_synccore_planoutbox, src_lib_sync_sync, src_components_syncengine_syncengine [EXTRACTED 1.00]
- **Sync Status Indicator UI Group** — src_components_syncstatus_syncstatus, src_components_syncsettings_syncsettings, src_lib_sync_sync [EXTRACTED 0.95]
- **Dual-Path Reminder Delivery (local watcher + server cron)** — src_lib_uselocalreminderwatcher_uselocalreminderwatcher, supabase_functions_send_reminder_notifications_index_handlesend, src_lib_reminderscheduling_splitstalereminders [INFERRED 0.85]

## Communities (54 total, 16 thin omitted)

### Community 0 - "Motor de sincronizacion offline (db/outbox/sync)"
Cohesion: 0.06
Nodes (60): Hard Delete + Full Re-fetch Reconciliation (vs Soft-Delete), Last-Write-Wins via updated_at + Conditional Update, Sync Trigger Events (online/focus/visibility/interval/post-mutation), Trigger Adjustment to Respect Client-Sent updated_at, Web Locks API Single-Flight Sync, RLS Design: Join-Based Policies for recordatorios, Database Schema (temas/items/recordatorios), SyncEngine() (+52 more)

### Community 1 - "Gestion de items (ItemForm/ItemList)"
Cohesion: 0.15
Nodes (27): aFilasEditables(), FilaEditable, ItemForm(), nuevaLinea(), PRIORIDADES, TIPOS, aGrilla(), cell() (+19 more)

### Community 2 - "Layout, ruteo y estado de sync de la app"
Cohesion: 0.07
Nodes (38): AbrirAsistenteContext, AppShell(), AssistantRedirect(), Destino, DESTINOS, TRAZO, AssistantDrawer(), NuevoItemSheet() (+30 more)

### Community 3 - "Asistente IA - acciones propuestas"
Cohesion: 0.07
Nodes (29): Multi-Action Parallel Function-Calling, AccionBorrar, AccionCrear, AccionEditar, AccionPropuesta, allFunctionCalls(), CambiosUpdate, collectProposedActions() (+21 more)

### Community 4 - "Config ESLint y devDependencies"
Cohesion: 0.15
Nodes (13): eslint-plugin-react-refresh, globals, devDependencies, eslint-plugin-react-refresh, globals, supabase, @tailwindcss/vite, typescript (+5 more)

### Community 5 - "Recordatorios y watcher local"
Cohesion: 0.09
Nodes (24): Catch-up Notification for Stale Reminders, Notification Tag Dedup between Local Watcher and Cron Push, Two-Way Reminder Notifications (Local + Cron), LocalReminderWatcher(), listRecordatoriosParaDisparo, marcarEnviado, ArmedTimer, ArmInstruction (+16 more)

### Community 6 - "Config TypeScript (app)"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, src, src/**/*.test.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx (+17 more)

### Community 7 - "package.json - dependencias"
Cohesion: 0.18
Nodes (11): idb, dependencies, idb, react, react-dom, react-router-dom, @supabase/supabase-js, react (+3 more)

### Community 8 - "Notificaciones push"
Cohesion: 0.07
Nodes (43): ItemFormProps, armarGrupos(), Grupo, ItemContent(), ItemList(), ItemListProps, parseLista(), PRIORIDAD_LABEL (+35 more)

### Community 9 - "Config TypeScript (node)"
Cohesion: 0.11
Nodes (17): ES2023, vite.config.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection (+9 more)

### Community 10 - "Config TypeScript (worker)"
Cohesion: 0.12
Nodes (15): WebWorker, compilerOptions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+7 more)

### Community 11 - "CRUD items/temas y handler asistente IA"
Cohesion: 0.18
Nodes (11): Client-Generated UUIDs for Stable Cross-Sync IDs, Propose/Confirm Pattern for AI-Driven Mutations, Spanish-Translated Gemini Error Messages, Fix: Gemini Candidate without parts (MAX_TOKENS), Adaptive Rate-Limit Learning from Gemini 429 Body, createItem, deleteItem, updateItem (+3 more)

### Community 12 - "PWA manifest"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 13 - "Documentacion raiz / planes / auth context"
Cohesion: 0.10
Nodes (47): aplicarAccionCrear(), borradorDeAccionCrear(), contenidoDeAccionCrear(), resolverTemaId(), tablaATexto(), countOutbox(), deleteLocalRow(), deleteOps() (+39 more)

### Community 14 - "Edge Function manage-ai-key"
Cohesion: 0.40
Nodes (3): bytesToBase64(), CORS_HEADERS, encryptApiKey()

### Community 16 - "Imagen de diseno (Code_Generated_Image)"
Cohesion: 0.50
Nodes (5): Organizador App Icon (Notepad + Bell), Clipboard with three checked-off checklist items, Three-column data table below checklist, Notification bell badge (orange bell, green dot, dark circle) overlaid top-right, Pencil icon beside the notepad, symbolizing editing/note-taking

### Community 17 - "Decisiones offline (LWW, hard-delete, RLS)"
Cohesion: 0.18
Nodes (11): 0. Veredicto en una página, 1.1 Mapa de correspondencias, 1.2 Lo que la propuesta simplifica de más, 1. Vistas: propuesta vs. estado real, 4. Las 4 funciones pendientes, 7. Decisiones que necesito de vos antes de empezar, 8. Auditoría de contraste (ítem 2), Dos cosas que quiero dejar dichas, no preguntadas (+3 more)

### Community 18 - "Imagen de diseno (Gemini_Generated_Image)"
Cohesion: 1.00
Nodes (3): App icon mockup: notebook with checklist and notification bell, Checklist/notebook motif (ring-bound notepad, green checkmarks, pencil, table grid), Notification bell badge element (top-right circular badge with bell icon and green dot)

### Community 29 - "ItemsPage.tsx"
Cohesion: 0.10
Nodes (42): Organizador Catalog-Style Mockup (HTML), App HTML Shell (Vite entry), Adoption of react-router-dom for /settings Route, Render Static Site Deployment, Catalog Card Visual Design System, Render Static Site Blueprint (organizador-ia), RecordatorioRow(), loadItemsFromCache() (+34 more)

### Community 30 - "Brief de diseño — Organizador Personal IA"
Cohesion: 0.20
Nodes (10): 1. Qué es esta app, 2. Inventario de pantallas actuales, 3.1 Tokens de color (Tailwind v4 `@theme`, no hay `tailwind.config.js`), 3.2 Tipografía, 3.3 Elementos distintivos de "ficha de catálogo", 3. Sistema de diseño actual — "fichas de catálogo", 4. Funciones pendientes que el rediseño debe poder acomodar, 5. Ideas de reorganización ya planteadas y no implementadas (+2 more)

### Community 31 - "Handoff: Rediseño de arquitectura de información — Organizador Personal IA"
Cohesion: 0.11
Nodes (17): 1. Hoy (vista de entrada — reemplaza a Items como landing), 2. Biblioteca (reemplaza Items — resuelve el desorden), 3. Recordatorios, 4. Nuevo ítem (sheet / modal), 5. Asistente (drawer flotante), 6. Ajustes, About the Design Files, Assets (+9 more)

### Community 32 - "Brief de diseño — Organizador Personal IA"
Cohesion: 0.18
Nodes (10): 1. Qué es esta app, 2. Inventario de pantallas actuales, 3.1 Tokens de color (Tailwind v4 `@theme`, no hay `tailwind.config.js`), 3.2 Tipografía, 3.3 Elementos distintivos de "ficha de catálogo", 3. Sistema de diseño actual — "fichas de catálogo", 4. Funciones pendientes que el rediseño debe poder acomodar, 5. Ideas de reorganización ya planteadas y no implementadas (+2 more)

### Community 33 - "Adoption of react-router-dom for /settings Route"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, preview, type (+1 more)

### Community 37 - "@tailwindcss/vite"
Cohesion: 0.26
Nodes (14): Decision: No Runtime Caching of Supabase Data in Service Worker, Web Push via VAPID Keys + pg_cron, PushSettings(), getPushStatus(), isPushSupported(), keyToBase64(), PushStatus, subscribeToPush() (+6 more)

### Community 43 - "Outbox Pattern for Offline Mutations"
Cohesion: 0.33
Nodes (7): Graphify Project Rules, Outbox Pattern for Offline Mutations, Offline Support Architecture Plan, Organizador Personal IA - Master Plan, AuthContext, db.ts (IndexedDB store layer), repo.ts (local mutation repository)

### Community 44 - "AssistantDrawer.tsx"
Cohesion: 0.09
Nodes (24): FaseFoto, Vista, contenidoTexto(), EstadoAccion, PendingAction, ProposedActionCard(), BorradorItem, extraerDeFoto() (+16 more)

### Community 45 - "extract-from-photo/index.ts"
Cohesion: 0.09
Nodes (25): AccionCrear, buildPrompt(), esPrioridad(), esTipo(), Extraccion, filasArray(), normalizarExtraccion(), parseJsonLaxo() (+17 more)

### Community 46 - "6. Ítems de trabajo, ordenados"
Cohesion: 0.29
Nodes (7): 6. Ítems de trabajo, ordenados, Fase 0 — Base (nada se rompe, nada cambia de lugar) — ✅ HECHA, Fase 1 — Reestilado y reorganización dentro de las páginas actuales — ✅ HECHA, Fase 2 — Modelo de datos — ✅ HECHA, Fase 3 — Navegación (el bloque riesgoso), Fase 4 — Funciones pendientes, Resumen de orden

### Community 47 - "Mapa del proyecto"
Cohesion: 0.40
Nodes (3): God nodes (módulos centrales según Graphify), Mapa del proyecto, Qué es el proyecto

### Community 48 - "Estructura de carpetas y responsabilidad de cada módulo"
Cohesion: 0.33
Nodes (6): Estructura de carpetas y responsabilidad de cada módulo, `src/components/` y `src/pages/`, `src/lib/` — lógica de dominio y offline, `src/sw.ts`, `supabase/functions/` — Edge Functions (Deno), `supabase/migrations/`

### Community 49 - "Diagramas"
Cohesion: 0.40
Nodes (5): 1. Arquitectura general, 2. Flujo de datos offline, 3. Flujo del asistente de IA, 4. Flujo de notificaciones (local vs. servidor + dedup), Diagramas

### Community 50 - "5. Clasificación: qué se puede hacer ya, qué no"
Cohesion: 0.40
Nodes (5): 5.1 Implementable directo (reorganizar/restylear lo que ya existe), 5.2 Depende de features que todavía no existen, 5.3 Ambiguo o incompleto en la propuesta, 5.4 Dos detalles técnicos que conviene fijar ahora, 5. Clasificación: qué se puede hacer ya, qué no

### Community 51 - "2. Navegación"
Cohesion: 0.50
Nodes (4): 2.1 Qué cambia, 2.2 El punto crítico: el prototipo no tiene router, 2.3 Detalle menor a reconciliar, 2. Navegación

### Community 52 - "3. Sistema visual: ¿evoluciona o reemplaza?"
Cohesion: 0.50
Nodes (4): 3.1 Evoluciona. Continuidad casi total., 3.2 Las tres desviaciones reales (a aprobar, §6-D2), 3.3 Lo que el sistema visual propuesto no cubre, 3. Sistema visual: ¿evoluciona o reemplaza?

## Ambiguous Edges - Review These
- `Graphify Project Rules` → `Organizador Personal IA - Master Plan`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **267 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+262 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Graphify Project Rules` and `Organizador Personal IA - Master Plan`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `useAuth()` connect `Layout, ruteo y estado de sync de la app` to `Motor de sincronizacion offline (db/outbox/sync)`, `@tailwindcss/vite`, `Recordatorios y watcher local`, `AssistantDrawer.tsx`, `Documentacion raiz / planes / auth context`, `ItemsPage.tsx`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `Item` connect `Notificaciones push` to `Gestion de items (ItemForm/ItemList)`, `Layout, ruteo y estado de sync de la app`, `AssistantDrawer.tsx`, `Documentacion raiz / planes / auth context`, `ItemsPage.tsx`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `ItemsPage()` connect `ItemsPage.tsx` to `Notificaciones push`, `Gestion de items (ItemForm/ItemList)`, `Layout, ruteo y estado de sync de la app`, `Documentacion raiz / planes / auth context`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _267 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Motor de sincronizacion offline (db/outbox/sync)` be split into smaller, more focused modules?**
  _Cohesion score 0.06196291270918137 - nodes in this community are weakly interconnected._
- **Should `Gestion de items (ItemForm/ItemList)` be split into smaller, more focused modules?**
  _Cohesion score 0.14795008912655971 - nodes in this community are weakly interconnected._