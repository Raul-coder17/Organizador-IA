# Graph Report - Organizador  (2026-07-24)

## Corpus Check
- 92 files · ~182,406 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 750 nodes · 1522 edges · 46 communities (30 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1717d99b`
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
- Brief de diseño — Organizador Personal IA
- Handoff: Rediseño de arquitectura de información — Organizador Personal IA
- Brief de diseño — Organizador Personal IA
- Adoption of react-router-dom for /settings Route
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
- Diagramas
- @eslint/js

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
- `Web Push via VAPID Keys + pg_cron` --references--> `PushSettings()`  [EXTRACTED]
  PLAN_ORGANIZADOR.md → src/components/PushSettings.tsx
- `SyncEngine()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncEngine.tsx → PLAN_OFFLINE.md
- `SyncSettings()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncSettings.tsx → PLAN_OFFLINE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Offline Sync Pipeline (repo -> db -> sync engine)** — src_lib_repo_repo, src_lib_db_db, src_lib_synccore_planoutbox, src_lib_sync_sync, src_components_syncengine_syncengine [EXTRACTED 1.00]
- **Sync Status Indicator UI Group** — src_components_syncstatus_syncstatus, src_components_syncsettings_syncsettings, src_lib_sync_sync [EXTRACTED 0.95]
- **Dual-Path Reminder Delivery (local watcher + server cron)** — src_lib_uselocalreminderwatcher_uselocalreminderwatcher, supabase_functions_send_reminder_notifications_index_handlesend, src_lib_reminderscheduling_splitstalereminders [INFERRED 0.85]

## Communities (46 total, 16 thin omitted)

### Community 0 - "Motor de sincronizacion offline (db/outbox/sync)"
Cohesion: 0.06
Nodes (60): Hard Delete + Full Re-fetch Reconciliation (vs Soft-Delete), Last-Write-Wins via updated_at + Conditional Update, Sync Trigger Events (online/focus/visibility/interval/post-mutation), Trigger Adjustment to Respect Client-Sent updated_at, Web Locks API Single-Flight Sync, RLS Design: Join-Based Policies for recordatorios, Database Schema (temas/items/recordatorios), SyncEngine() (+52 more)

### Community 1 - "Gestion de items (ItemForm/ItemList)"
Cohesion: 0.14
Nodes (28): aFilasEditables(), FilaEditable, ItemForm(), nuevaLinea(), PRIORIDADES, TIPOS, contarItemsDeTema(), aGrilla() (+20 more)

### Community 2 - "Layout, ruteo y estado de sync de la app"
Cohesion: 0.06
Nodes (50): Organizador Catalog-Style Mockup (HTML), App HTML Shell (Vite entry), Adoption of react-router-dom for /settings Route, Render Static Site Deployment, Catalog Card Visual Design System, Render Static Site Blueprint (organizador-ia), AbrirAsistenteContext, AppShell() (+42 more)

### Community 3 - "Asistente IA - acciones propuestas"
Cohesion: 0.06
Nodes (32): Multi-Action Parallel Function-Calling, AccionBorrar, AccionCrear, AccionEditar, AccionPropuesta, allFunctionCalls(), CambiosUpdate, collectProposedActions() (+24 more)

### Community 4 - "Config ESLint y devDependencies"
Cohesion: 0.15
Nodes (13): eslint, eslint-plugin-react-refresh, globals, devDependencies, eslint, eslint-plugin-react-refresh, globals, supabase (+5 more)

### Community 5 - "Recordatorios y watcher local"
Cohesion: 0.08
Nodes (28): Catch-up Notification for Stale Reminders, Notification Tag Dedup between Local Watcher and Cron Push, Decision: No Runtime Caching of Supabase Data in Service Worker, Two-Way Reminder Notifications (Local + Cron), Web Push via VAPID Keys + pg_cron, LocalReminderWatcher(), listRecordatoriosParaDisparo, marcarEnviado (+20 more)

### Community 6 - "Config TypeScript (app)"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, src, src/**/*.test.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx (+17 more)

### Community 7 - "package.json - dependencias"
Cohesion: 0.18
Nodes (11): idb, dependencies, idb, react, react-dom, react-router-dom, @supabase/supabase-js, react (+3 more)

### Community 8 - "Notificaciones push"
Cohesion: 0.06
Nodes (48): armarGrupos(), Grupo, ItemContent(), ItemList(), ItemListProps, parseLista(), PRIORIDAD_LABEL, TIPO_LABEL (+40 more)

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
Cohesion: 0.14
Nodes (40): countOutbox(), deleteLocalRow(), deleteOps(), deleteOpsForEntity(), enqueueOp(), getDB(), getLocalItem(), getLocalRecordatorio() (+32 more)

### Community 14 - "Edge Function manage-ai-key"
Cohesion: 0.40
Nodes (3): bytesToBase64(), CORS_HEADERS, encryptApiKey()

### Community 16 - "Imagen de diseno (Code_Generated_Image)"
Cohesion: 0.50
Nodes (5): Organizador App Icon (Notepad + Bell), Clipboard with three checked-off checklist items, Three-column data table below checklist, Notification bell badge (orange bell, green dot, dark circle) overlaid top-right, Pencil icon beside the notepad, symbolizing editing/note-taking

### Community 17 - "Decisiones offline (LWW, hard-delete, RLS)"
Cohesion: 0.06
Nodes (32): 0. Veredicto en una página, 1.1 Mapa de correspondencias, 1.2 Lo que la propuesta simplifica de más, 1. Vistas: propuesta vs. estado real, 2.1 Qué cambia, 2.2 El punto crítico: el prototipo no tiene router, 2.3 Detalle menor a reconciliar, 2. Navegación (+24 more)

### Community 18 - "Imagen de diseno (Gemini_Generated_Image)"
Cohesion: 1.00
Nodes (3): App icon mockup: notebook with checklist and notification bell, Checklist/notebook motif (ring-bound notepad, green checkmarks, pencil, table grid), Notification bell badge element (top-right circular badge with bell icon and green dot)

### Community 30 - "Brief de diseño — Organizador Personal IA"
Cohesion: 0.08
Nodes (24): 1. Qué es esta app, 2. Inventario de pantallas actuales, 3.1 Tokens de color (Tailwind v4 `@theme`, no hay `tailwind.config.js`), 3.2 Tipografía, 3.3 Elementos distintivos de "ficha de catálogo", 3. Sistema de diseño actual — "fichas de catálogo", 4. Funciones pendientes que el rediseño debe poder acomodar, 5. Ideas de reorganización ya planteadas y no implementadas (+16 more)

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
Cohesion: 0.09
Nodes (34): ProtectedRoute(), PushSettings(), AuthContextValue, AuthProvider(), leerNombre(), readCachedSession(), ensurePersistentStorage(), getPushStatus() (+26 more)

### Community 43 - "Outbox Pattern for Offline Mutations"
Cohesion: 0.33
Nodes (7): Graphify Project Rules, Outbox Pattern for Offline Mutations, Offline Support Architecture Plan, Organizador Personal IA - Master Plan, AuthContext, db.ts (IndexedDB store layer), repo.ts (local mutation repository)

### Community 44 - "AssistantDrawer.tsx"
Cohesion: 0.08
Nodes (34): ItemFormProps, FaseFoto, Vista, contenidoTexto(), EstadoAccion, PendingAction, ProposedActionCard(), aplicarAccionCrear() (+26 more)

### Community 45 - "extract-from-photo/index.ts"
Cohesion: 0.07
Nodes (30): AccionCrear, buildPrompt(), esPrioridad(), esTipo(), Extraccion, filasArray(), normalizarExtraccion(), parseJsonLaxo() (+22 more)

## Ambiguous Edges - Review These
- `Graphify Project Rules` → `Organizador Personal IA - Master Plan`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **269 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+264 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Graphify Project Rules` and `Organizador Personal IA - Master Plan`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `useAuth()` connect `Layout, ruteo y estado de sync de la app` to `Motor de sincronizacion offline (db/outbox/sync)`, `Recordatorios y watcher local`, `AssistantDrawer.tsx`, `@tailwindcss/vite`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `Item` connect `Notificaciones push` to `Gestion de items (ItemForm/ItemList)`, `Layout, ruteo y estado de sync de la app`, `@tailwindcss/vite`, `AssistantDrawer.tsx`, `Documentacion raiz / planes / auth context`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `ItemsPage()` connect `Layout, ruteo y estado de sync de la app` to `Notificaciones push`, `Gestion de items (ItemForm/ItemList)`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _269 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Motor de sincronizacion offline (db/outbox/sync)` be split into smaller, more focused modules?**
  _Cohesion score 0.05834464043419267 - nodes in this community are weakly interconnected._
- **Should `Gestion de items (ItemForm/ItemList)` be split into smaller, more focused modules?**
  _Cohesion score 0.13949579831932774 - nodes in this community are weakly interconnected._