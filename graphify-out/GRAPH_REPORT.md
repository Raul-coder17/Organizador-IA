# Graph Report - Organizador  (2026-07-23)

## Corpus Check
- 73 files · ~146,972 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 625 nodes · 1208 edges · 34 communities (27 shown, 7 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 34 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b19bf39e`
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

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 26 edges
2. `getDB()` - 23 edges
3. `HoyPage()` - 17 edges
4. `compilerOptions` - 17 edges
5. `flushOutbox()` - 14 edges
6. `ItemsPage()` - 14 edges
7. `compilerOptions` - 14 edges
8. `RemindersPage()` - 13 edges
9. `Tema` - 13 edges
10. `Item` - 13 edges

## Surprising Connections (you probably didn't know these)
- `SyncEngine()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncEngine.tsx → PLAN_OFFLINE.md
- `useLocalReminderWatcher()` --shares_data_with--> `listRecordatoriosParaDisparo`  [INFERRED]
  src/lib/useLocalReminderWatcher.ts → PLAN_OFFLINE.md
- `Propose/Confirm Pattern for AI-Driven Mutations` --references--> `AssistantPage()`  [EXTRACTED]
  PLAN_ORGANIZADOR.md → src/pages/AssistantPage.tsx
- `marcarHecho` --shares_data_with--> `RemindersPage()`  [INFERRED]
  PLAN_ORGANIZADOR.md → src/pages/RemindersPage.tsx
- `SyncSettings()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncSettings.tsx → PLAN_OFFLINE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Offline Sync Pipeline (repo -> db -> sync engine)** — src_lib_repo_repo, src_lib_db_db, src_lib_synccore_planoutbox, src_lib_sync_sync, src_components_syncengine_syncengine [EXTRACTED 1.00]
- **Sync Status Indicator UI Group** — src_components_syncstatus_syncstatus, src_components_syncsettings_syncsettings, src_lib_sync_sync [EXTRACTED 0.95]
- **Dual-Path Reminder Delivery (local watcher + server cron)** — src_lib_uselocalreminderwatcher_uselocalreminderwatcher, supabase_functions_send_reminder_notifications_index_handlesend, src_lib_reminderscheduling_splitstalereminders [INFERRED 0.85]

## Communities (34 total, 7 thin omitted)

### Community 0 - "Motor de sincronizacion offline (db/outbox/sync)"
Cohesion: 0.06
Nodes (58): Hard Delete + Full Re-fetch Reconciliation (vs Soft-Delete), Last-Write-Wins via updated_at + Conditional Update, Sync Trigger Events (online/focus/visibility/interval/post-mutation), Trigger Adjustment to Respect Client-Sent updated_at, Web Locks API Single-Flight Sync, RLS Design: Join-Based Policies for recordatorios, Database Schema (temas/items/recordatorios), SyncSettings() (+50 more)

### Community 1 - "Gestion de items (ItemForm/ItemList)"
Cohesion: 0.13
Nodes (41): countOutbox(), deleteLocalRow(), deleteOps(), deleteOpsForEntity(), enqueueOp(), getDB(), getLocalItem(), getLocalRecordatorio() (+33 more)

### Community 2 - "Layout, ruteo y estado de sync de la app"
Cohesion: 0.09
Nodes (21): Destino, DESTINOS, NUEVO_ITEM, TRAZO, applyTheme(), getTheme(), isTheme(), listeners (+13 more)

### Community 3 - "Asistente IA - acciones propuestas"
Cohesion: 0.07
Nodes (29): Multi-Action Parallel Function-Calling, AccionBorrar, AccionCrear, AccionEditar, AccionPropuesta, allFunctionCalls(), CambiosUpdate, collectProposedActions() (+21 more)

### Community 4 - "Config ESLint y devDependencies"
Cohesion: 0.06
Nodes (31): eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, eslint, @eslint/js (+23 more)

### Community 5 - "Recordatorios y watcher local"
Cohesion: 0.09
Nodes (24): Catch-up Notification for Stale Reminders, Notification Tag Dedup between Local Watcher and Cron Push, Two-Way Reminder Notifications (Local + Cron), LocalReminderWatcher(), listRecordatoriosParaDisparo, marcarEnviado, ArmedTimer, ArmInstruction (+16 more)

### Community 6 - "Config TypeScript (app)"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, src, src/**/*.test.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx (+17 more)

### Community 7 - "package.json - dependencias"
Cohesion: 0.10
Nodes (20): idb, dependencies, idb, react, react-dom, react-router-dom, @supabase/supabase-js, name (+12 more)

### Community 8 - "Notificaciones push"
Cohesion: 0.26
Nodes (14): Decision: No Runtime Caching of Supabase Data in Service Worker, Web Push via VAPID Keys + pg_cron, PushSettings(), getPushStatus(), isPushSupported(), keyToBase64(), PushStatus, subscribeToPush() (+6 more)

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
Cohesion: 0.06
Nodes (61): ItemForm(), ItemFormProps, nuevaLinea(), PRIORIDADES, TIPOS, cell(), Grupo, ItemContent() (+53 more)

### Community 14 - "Edge Function manage-ai-key"
Cohesion: 0.40
Nodes (3): bytesToBase64(), CORS_HEADERS, encryptApiKey()

### Community 16 - "Imagen de diseno (Code_Generated_Image)"
Cohesion: 0.50
Nodes (5): Organizador App Icon (Notepad + Bell), Clipboard with three checked-off checklist items, Three-column data table below checklist, Notification bell badge (orange bell, green dot, dark circle) overlaid top-right, Pencil icon beside the notepad, symbolizing editing/note-taking

### Community 17 - "Decisiones offline (LWW, hard-delete, RLS)"
Cohesion: 0.06
Nodes (31): 0. Veredicto en una página, 1.1 Mapa de correspondencias, 1.2 Lo que la propuesta simplifica de más, 1. Vistas: propuesta vs. estado real, 2.1 Qué cambia, 2.2 El punto crítico: el prototipo no tiene router, 2.3 Detalle menor a reconciliar, 2. Navegación (+23 more)

### Community 18 - "Imagen de diseno (Gemini_Generated_Image)"
Cohesion: 1.00
Nodes (3): App icon mockup: notebook with checklist and notification bell, Checklist/notebook motif (ring-bound notepad, green checkmarks, pencil, table grid), Notification bell badge element (top-right circular badge with bell icon and green dot)

### Community 29 - "ItemsPage.tsx"
Cohesion: 0.08
Nodes (48): Organizador Catalog-Style Mockup (HTML), App HTML Shell (Vite entry), Adoption of react-router-dom for /settings Route, Render Static Site Deployment, Catalog Card Visual Design System, Render Static Site Blueprint (organizador-ia), AppShell(), armarGrupos() (+40 more)

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
Cohesion: 0.33
Nodes (7): Graphify Project Rules, Outbox Pattern for Offline Mutations, Offline Support Architecture Plan, Organizador Personal IA - Master Plan, AuthContext, db.ts (IndexedDB store layer), repo.ts (local mutation repository)

## Ambiguous Edges - Review These
- `Graphify Project Rules` → `Organizador Personal IA - Master Plan`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **244 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+239 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Graphify Project Rules` and `Organizador Personal IA - Master Plan`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `AssistantPage()` connect `ItemsPage.tsx` to `Motor de sincronizacion offline (db/outbox/sync)`, `Adoption of react-router-dom for /settings Route`, `Asistente IA - acciones propuestas`, `CRUD items/temas y handler asistente IA`, `Documentacion raiz / planes / auth context`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `Multi-Action Parallel Function-Calling` connect `Asistente IA - acciones propuestas` to `ItemsPage.tsx`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `ItemsPage.tsx` to `Notificaciones push`, `Layout, ruteo y estado de sync de la app`, `Recordatorios y watcher local`, `Documentacion raiz / planes / auth context`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _244 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Motor de sincronizacion offline (db/outbox/sync)` be split into smaller, more focused modules?**
  _Cohesion score 0.06001984126984127 - nodes in this community are weakly interconnected._
- **Should `Gestion de items (ItemForm/ItemList)` be split into smaller, more focused modules?**
  _Cohesion score 0.12956810631229235 - nodes in this community are weakly interconnected._