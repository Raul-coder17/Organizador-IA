# Graph Report - .  (2026-07-23)

## Corpus Check
- 68 files · ~106,778 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 468 nodes · 917 edges · 29 communities (22 shown, 7 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.82)
- Token cost: 337,936 input · 0 output

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

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 23 edges
2. `getDB()` - 22 edges
3. `compilerOptions` - 17 edges
4. `flushOutbox()` - 14 edges
5. `RemindersPage()` - 14 edges
6. `compilerOptions` - 14 edges
7. `supabase` - 12 edges
8. `reconcile()` - 12 edges
9. `Item` - 12 edges
10. `enqueue()` - 11 edges

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

## Communities (29 total, 7 thin omitted)

### Community 0 - "Motor de sincronizacion offline (db/outbox/sync)"
Cohesion: 0.06
Nodes (73): Sync Trigger Events (online/focus/visibility/interval/post-mutation), Web Locks API Single-Flight Sync, Database Schema (temas/items/recordatorios), SyncSettings(), SyncStatus(), countOutbox(), deleteLocalRow(), deleteOps() (+65 more)

### Community 1 - "Gestion de items (ItemForm/ItemList)"
Cohesion: 0.07
Nodes (64): ItemForm(), ItemFormProps, nuevaLinea(), PRIORIDADES, TIPOS, cell(), ItemContent(), ItemList() (+56 more)

### Community 2 - "Layout, ruteo y estado de sync de la app"
Cohesion: 0.10
Nodes (37): Organizador Catalog-Style Mockup (HTML), App HTML Shell (Vite entry), Adoption of react-router-dom for /settings Route, Render Static Site Deployment, Catalog Card Visual Design System, Render Static Site Blueprint (organizador-ia), App(), AppNav() (+29 more)

### Community 3 - "Asistente IA - acciones propuestas"
Cohesion: 0.07
Nodes (29): Multi-Action Parallel Function-Calling, AccionBorrar, AccionCrear, AccionEditar, AccionPropuesta, allFunctionCalls(), CambiosUpdate, collectProposedActions() (+21 more)

### Community 4 - "Config ESLint y devDependencies"
Cohesion: 0.06
Nodes (31): eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, eslint, @eslint/js (+23 more)

### Community 5 - "Recordatorios y watcher local"
Cohesion: 0.11
Nodes (22): Catch-up Notification for Stale Reminders, Two-Way Reminder Notifications (Local + Cron), LocalReminderWatcher(), listRecordatoriosParaDisparo, marcarEnviado, ArmedTimer, ArmInstruction, computeDelayMs() (+14 more)

### Community 6 - "Config TypeScript (app)"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, src, src/**/*.test.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx (+17 more)

### Community 7 - "package.json - dependencias"
Cohesion: 0.10
Nodes (20): idb, dependencies, idb, react, react-dom, react-router-dom, @supabase/supabase-js, name (+12 more)

### Community 8 - "Notificaciones push"
Cohesion: 0.22
Nodes (16): Notification Tag Dedup between Local Watcher and Cron Push, Decision: No Runtime Caching of Supabase Data in Service Worker, Web Push via VAPID Keys + pg_cron, PushSettings(), getPushStatus(), isPushSupported(), keyToBase64(), PushStatus (+8 more)

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
Cohesion: 0.33
Nodes (7): Graphify Project Rules, Outbox Pattern for Offline Mutations, Offline Support Architecture Plan, Organizador Personal IA - Master Plan, AuthContext, db.ts (IndexedDB store layer), repo.ts (local mutation repository)

### Community 14 - "Edge Function manage-ai-key"
Cohesion: 0.40
Nodes (3): bytesToBase64(), CORS_HEADERS, encryptApiKey()

### Community 16 - "Imagen de diseno (Code_Generated_Image)"
Cohesion: 0.50
Nodes (5): Organizador App Icon (Notepad + Bell), Clipboard with three checked-off checklist items, Three-column data table below checklist, Notification bell badge (orange bell, green dot, dark circle) overlaid top-right, Pencil icon beside the notepad, symbolizing editing/note-taking

### Community 17 - "Decisiones offline (LWW, hard-delete, RLS)"
Cohesion: 0.40
Nodes (5): Hard Delete + Full Re-fetch Reconciliation (vs Soft-Delete), Last-Write-Wins via updated_at + Conditional Update, Trigger Adjustment to Respect Client-Sent updated_at, RLS Design: Join-Based Policies for recordatorios, schema_inicial migration (temas/items/recordatorios)

### Community 18 - "Imagen de diseno (Gemini_Generated_Image)"
Cohesion: 1.00
Nodes (3): App icon mockup: notebook with checklist and notification bell, Checklist/notebook motif (ring-bound notepad, green checkmarks, pencil, table grid), Notification bell badge element (top-right circular badge with bell icon and green dot)

## Ambiguous Edges - Review These
- `Graphify Project Rules` → `Organizador Personal IA - Master Plan`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **170 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+165 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Graphify Project Rules` and `Organizador Personal IA - Master Plan`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `AssistantPage()` connect `Layout, ruteo y estado de sync de la app` to `Motor de sincronizacion offline (db/outbox/sync)`, `Gestion de items (ItemForm/ItemList)`, `Asistente IA - acciones propuestas`, `CRUD items/temas y handler asistente IA`, `Documentacion raiz / planes / auth context`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **Why does `Multi-Action Parallel Function-Calling` connect `Asistente IA - acciones propuestas` to `Layout, ruteo y estado de sync de la app`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _170 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Motor de sincronizacion offline (db/outbox/sync)` be split into smaller, more focused modules?**
  _Cohesion score 0.05981012658227848 - nodes in this community are weakly interconnected._
- **Should `Gestion de items (ItemForm/ItemList)` be split into smaller, more focused modules?**
  _Cohesion score 0.0661189358372457 - nodes in this community are weakly interconnected._
- **Should `Layout, ruteo y estado de sync de la app` be split into smaller, more focused modules?**
  _Cohesion score 0.09728506787330317 - nodes in this community are weakly interconnected._