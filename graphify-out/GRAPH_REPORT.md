# Graph Report - Organizador  (2026-07-27)

## Corpus Check
- 122 files · ~235,983 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 962 nodes · 2119 edges · 70 communities (54 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.71)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8d7fa32f`
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
- SettingsPage.tsx
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
- HoyPage.tsx
- Brief de diseño — Organizador Personal IA
- Handoff: Rediseño de arquitectura de información — Organizador Personal IA
- Brief de diseño — Organizador Personal IA
- Adoption of react-router-dom for /settings Route
- buscar.test.ts
- eslint-plugin-react-hooks
- tailwindcss
- AssistantDrawer.tsx
- ItemForm.tsx
- @types/react-dom
- vite
- vite-plugin-pwa
- @vitejs/plugin-react
- Outbox Pattern for Offline Mutations
- AppShell.tsx
- extract-from-photo/index.ts
- reminderScheduling.ts
- recordatorios.ts
- historial.ts
- supabase.ts
- useSyncStatus
- @eslint/js
- @types/react
- HoyPage.tsx
- borrarCuenta.ts
- exportarDatos.ts
- 6. Ítems de trabajo, ordenados
- Mapa del proyecto
- Estructura de carpetas y responsabilidad de cada módulo
- Diagramas
- AssistantDrawer.tsx
- 5. Clasificación: qué se puede hacer ya, qué no
- ai-assistant/rpm.ts
- 2. Navegación
- 3. Sistema visual: ¿evoluciona o reemplaza?
- 8. Auditoría de contraste (ítem 2)
- lib/recurrencia.ts
- accionesPropuestas.ts
- eslint-plugin-react-hooks
- notification-actions.d.ts

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 30 edges
2. `Item` - 28 edges
3. `getDB()` - 24 edges
4. `Tema` - 23 edges
5. `ItemForm()` - 19 edges
6. `HoyPage()` - 18 edges
7. `Recordatorio` - 18 edges
8. `compilerOptions` - 17 edges
9. `ItemsPage()` - 16 edges
10. `loadItemsFromCache()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `SyncEngine()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncEngine.tsx → PLAN_OFFLINE.md
- `planOutbox()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/lib/syncCore.ts → PLAN_OFFLINE.md
- `useLocalReminderWatcher()` --shares_data_with--> `listRecordatoriosParaDisparo`  [INFERRED]
  src/lib/useLocalReminderWatcher.ts → PLAN_OFFLINE.md
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

## Communities (70 total, 16 thin omitted)

### Community 0 - "Motor de sincronizacion offline (db/outbox/sync)"
Cohesion: 0.20
Nodes (15): ExportarDatos(), applyTheme(), getTheme(), isTheme(), listeners, prefersDark(), readStoredTheme(), resolveInitialTheme() (+7 more)

### Community 1 - "Gestion de items (ItemForm/ItemList)"
Cohesion: 0.15
Nodes (9): DictadoRecognition, DictadoRecognitionAlternative, DictadoRecognitionConstructor, DictadoRecognitionErrorEvent, DictadoRecognitionEvent, DictadoRecognitionResult, DictadoRecognitionResultList, DictadoVoz (+1 more)

### Community 3 - "Asistente IA - acciones propuestas"
Cohesion: 0.10
Nodes (18): bloqueTemas(), buildSystemInstruction(), callGemini(), CORS_HEADERS, FUNCTION_DECLARATIONS, GeminiError, logJson(), logRespuestaGemini() (+10 more)

### Community 4 - "Config ESLint y devDependencies"
Cohesion: 0.15
Nodes (13): eslint, eslint-plugin-react-refresh, globals, devDependencies, eslint, eslint-plugin-react-refresh, globals, supabase (+5 more)

### Community 5 - "Recordatorios y watcher local"
Cohesion: 0.17
Nodes (17): aFilasEditables(), FilaEditable, ItemForm(), nuevaLinea(), PRIORIDADES, TIPOS, fechaCambioRecordatorio(), formatFechaHora() (+9 more)

### Community 6 - "Config TypeScript (app)"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, src, src/**/*.test.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx (+17 more)

### Community 7 - "package.json - dependencias"
Cohesion: 0.18
Nodes (11): idb, dependencies, idb, react, react-dom, react-router-dom, @supabase/supabase-js, react (+3 more)

### Community 9 - "Config TypeScript (node)"
Cohesion: 0.11
Nodes (17): ES2023, vite.config.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection (+9 more)

### Community 10 - "Config TypeScript (worker)"
Cohesion: 0.11
Nodes (17): src/types/notification-actions.d.ts, src/vite-env.d.ts, WebWorker, compilerOptions, isolatedModules, lib, module, moduleDetection (+9 more)

### Community 11 - "CRUD items/temas y handler asistente IA"
Cohesion: 0.18
Nodes (11): Client-Generated UUIDs for Stable Cross-Sync IDs, Propose/Confirm Pattern for AI-Driven Mutations, Spanish-Translated Gemini Error Messages, Fix: Gemini Candidate without parts (MAX_TOKENS), Adaptive Rate-Limit Learning from Gemini 429 Body, createItem, deleteItem, updateItem (+3 more)

### Community 12 - "PWA manifest"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 13 - "Documentacion raiz / planes / auth context"
Cohesion: 0.15
Nodes (11): FaseFoto, Vista, EstadoAccion, extraerDeFoto(), ExtraerOpts, FotoPreparada, leerComoDataUrl(), prepararFoto() (+3 more)

### Community 14 - "Edge Function manage-ai-key"
Cohesion: 0.40
Nodes (3): bytesToBase64(), CORS_HEADERS, encryptApiKey()

### Community 15 - "Edge Function send-reminder-notifications"
Cohesion: 0.11
Nodes (24): RecordatorioRow, SubRow, avanzarUnaVuelta(), DIA_CORTO, DIAS_ORDEN, diasUtcALocalesArgentina(), etiquetaDias(), marcaRecurrenciaCorta() (+16 more)

### Community 16 - "Imagen de diseno (Code_Generated_Image)"
Cohesion: 0.50
Nodes (5): Organizador App Icon (Notepad + Bell), Clipboard with three checked-off checklist items, Three-column data table below checklist, Notification bell badge (orange bell, green dot, dark circle) overlaid top-right, Pencil icon beside the notepad, symbolizing editing/note-taking

### Community 17 - "Decisiones offline (LWW, hard-delete, RLS)"
Cohesion: 0.25
Nodes (8): 0. Veredicto en una página, 1.1 Mapa de correspondencias, 1.2 Lo que la propuesta simplifica de más, 1. Vistas: propuesta vs. estado real, 4. Las 4 funciones pendientes, 7. Decisiones que necesito de vos antes de empezar, Dos cosas que quiero dejar dichas, no preguntadas, Plan de rediseño — análisis de la propuesta de Claude Design

### Community 18 - "Imagen de diseno (Gemini_Generated_Image)"
Cohesion: 1.00
Nodes (3): App icon mockup: notebook with checklist and notification bell, Checklist/notebook motif (ring-bound notepad, green checkmarks, pencil, table grid), Notification bell badge element (top-right circular badge with bell icon and green dot)

### Community 22 - "Service worker push"
Cohesion: 0.05
Nodes (98): Hard Delete + Full Re-fetch Reconciliation (vs Soft-Delete), Last-Write-Wins via updated_at + Conditional Update, Trigger Adjustment to Respect Client-Sent updated_at, RLS Design: Join-Based Policies for recordatorios, Database Schema (temas/items/recordatorios), SyncEngine(), countOutbox(), deleteLocalRow() (+90 more)

### Community 29 - "HoyPage.tsx"
Cohesion: 0.14
Nodes (20): Multi-Action Parallel Function-Calling, AccionBorrar, AccionCrear, AccionEditar, AccionPropuesta, allFunctionCalls(), CambiosUpdate, collectProposals() (+12 more)

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

### Community 34 - "buscar.test.ts"
Cohesion: 0.05
Nodes (80): Organizador Catalog-Style Mockup (HTML), App HTML Shell (Vite entry), Adoption of react-router-dom for /settings Route, Render Static Site Deployment, Catalog Card Visual Design System, Render Static Site Blueprint (organizador-ia), ItemFormProps, armarGrupos() (+72 more)

### Community 35 - "eslint-plugin-react-hooks"
Cohesion: 0.18
Nodes (9): AssistantRedirect(), ProtectedRoute(), UpdateBanner(), AuthContextValue, AuthProvider(), leerNombre(), readCachedSession(), ensurePersistentStorage() (+1 more)

### Community 37 - "AssistantDrawer.tsx"
Cohesion: 0.12
Nodes (14): AbrirAsistenteContext, AppShell(), Destino, DESTINOS, TRAZO, AssistantDrawer(), NuevoItemSheet(), useAuth() (+6 more)

### Community 38 - "ItemForm.tsx"
Cohesion: 0.25
Nodes (15): Decision: No Runtime Caching of Supabase Data in Service Worker, Web Push via VAPID Keys + pg_cron, PushSettings(), getPushStatus(), isPushSupported(), keyToBase64(), PushStatus, subscribeToPush() (+7 more)

### Community 43 - "Outbox Pattern for Offline Mutations"
Cohesion: 0.33
Nodes (7): Graphify Project Rules, Outbox Pattern for Offline Mutations, Offline Support Architecture Plan, Organizador Personal IA - Master Plan, AuthContext, db.ts (IndexedDB store layer), repo.ts (local mutation repository)

### Community 44 - "AppShell.tsx"
Cohesion: 0.11
Nodes (29): borradorDeAccionCrear(), borradorDeAccionEditar(), BorradorItem, contenidoDeAccionCrear(), datosFinalesDeItem(), lineaNueva(), lineasConCambios(), lineasDeItem() (+21 more)

### Community 45 - "extract-from-photo/index.ts"
Cohesion: 0.07
Nodes (30): AccionCrear, buildPrompt(), esPrioridad(), esTipo(), Extraccion, filasArray(), normalizarExtraccion(), parseJsonLaxo() (+22 more)

### Community 46 - "reminderScheduling.ts"
Cohesion: 0.09
Nodes (24): Catch-up Notification for Stale Reminders, Notification Tag Dedup between Local Watcher and Cron Push, Two-Way Reminder Notifications (Local + Cron), LocalReminderWatcher(), listRecordatoriosParaDisparo, marcarEnviado, ArmedTimer, ArmInstruction (+16 more)

### Community 47 - "recordatorios.ts"
Cohesion: 0.16
Nodes (17): CLAVES_NO_BUSCABLES, esObjeto(), filtrarItems(), filtrarTemas(), indiceDe(), ItemConTema, juntarStrings(), normalizar() (+9 more)

### Community 48 - "historial.ts"
Cohesion: 0.15
Nodes (18): PROPOSE_TOOLS, AccionHistorial, buildContents(), callDeAccion(), esEstado(), EstadoAccionHistorial, GeminiContent, GeminiPart (+10 more)

### Community 49 - "supabase.ts"
Cohesion: 0.18
Nodes (10): AuthCard(), consumirAvisoCuentaBorrada(), supabase, ACCION, AuthPage(), Modo, SUBTITULO, errorEnLaUrl() (+2 more)

### Community 50 - "useSyncStatus"
Cohesion: 0.24
Nodes (12): Sync Trigger Events (online/focus/visibility/interval/post-mutation), Web Locks API Single-Flight Sync, SyncSettings(), SyncStatus(), forceSyncNow(), getSyncState(), subscribeSync(), sync.ts (sync engine) (+4 more)

### Community 53 - "HoyPage.tsx"
Cohesion: 0.31
Nodes (13): aGrilla(), cell(), contenidoDeGrilla(), Grilla, grillaDesdeContenido(), grillaDesdeTexto(), grillaVacia(), leerTabla() (+5 more)

### Community 54 - "borrarCuenta.ts"
Cohesion: 0.39
Nodes (7): BorrarCuenta(), borrarCuenta(), confirmacionValida(), limpiarStorageLocal(), mensajeDeError(), ResultadoBorrado, wipeLocalDatabase()

### Community 55 - "exportarDatos.ts"
Cohesion: 0.13
Nodes (23): descargar(), descargarCSV(), descargarJSON(), fechaArchivo(), aItemExport(), aRecordatorioExport(), armarDatosExport(), CABECERAS_CSV (+15 more)

### Community 56 - "6. Ítems de trabajo, ordenados"
Cohesion: 0.29
Nodes (7): 6. Ítems de trabajo, ordenados, Fase 0 — Base (nada se rompe, nada cambia de lugar) — ✅ HECHA, Fase 1 — Reestilado y reorganización dentro de las páginas actuales — ✅ HECHA, Fase 2 — Modelo de datos — ✅ HECHA, Fase 3 — Navegación (el bloque riesgoso), Fase 4 — Funciones pendientes, Resumen de orden

### Community 57 - "Mapa del proyecto"
Cohesion: 0.40
Nodes (3): God nodes (módulos centrales según Graphify), Mapa del proyecto, Qué es el proyecto

### Community 58 - "Estructura de carpetas y responsabilidad de cada módulo"
Cohesion: 0.33
Nodes (6): Estructura de carpetas y responsabilidad de cada módulo, `src/components/` y `src/pages/`, `src/lib/` — lógica de dominio y offline, `src/sw.ts`, `supabase/functions/` — Edge Functions (Deno), `supabase/migrations/`

### Community 59 - "Diagramas"
Cohesion: 0.40
Nodes (5): 1. Arquitectura general, 2. Flujo de datos offline, 3. Flujo del asistente de IA, 4. Flujo de notificaciones (local vs. servidor + dedup), Diagramas

### Community 60 - "AssistantDrawer.tsx"
Cohesion: 0.16
Nodes (10): contenidoTexto(), PendingAction, ProposedActionCard(), RecordatorioLinea(), textoRepeticion(), RECURRENCIA_LABEL, AccionPropuesta, AssistantResponse (+2 more)

### Community 61 - "5. Clasificación: qué se puede hacer ya, qué no"
Cohesion: 0.40
Nodes (5): 5.1 Implementable directo (reorganizar/restylear lo que ya existe), 5.2 Depende de features que todavía no existen, 5.3 Ambiguo o incompleto en la propuesta, 5.4 Dos detalles técnicos que conviene fijar ahora, 5. Clasificación: qué se puede hacer ya, qué no

### Community 62 - "ai-assistant/rpm.ts"
Cohesion: 0.50
Nodes (3): reserveRpmSlot(), decideRpmSlot(), RpmDecision

### Community 63 - "2. Navegación"
Cohesion: 0.50
Nodes (4): 2.1 Qué cambia, 2.2 El punto crítico: el prototipo no tiene router, 2.3 Detalle menor a reconciliar, 2. Navegación

### Community 64 - "3. Sistema visual: ¿evoluciona o reemplaza?"
Cohesion: 0.50
Nodes (4): 3.1 Evoluciona. Continuidad casi total., 3.2 Las tres desviaciones reales (a aprobar, §6-D2), 3.3 Lo que el sistema visual propuesto no cubre, 3. Sistema visual: ¿evoluciona o reemplaza?

### Community 65 - "8. Auditoría de contraste (ítem 2)"
Cohesion: 0.50
Nodes (4): 8. Auditoría de contraste (ítem 2), D6 resuelta (2026-07-24), El resultado inesperado: la paleta oscura contrasta mejor que la clara, Lo que esto significa

### Community 66 - "lib/recurrencia.ts"
Cohesion: 0.26
Nodes (15): ajustarADiaMarcado(), avanzarUnaVuelta(), corrimientoDiaUtc(), diasLocalesAUtc(), diasUtcALocales(), etiquetaDias(), marcaRecurrencia(), parseDiasSemana() (+7 more)

### Community 67 - "accionesPropuestas.ts"
Cohesion: 0.42
Nodes (8): primeraVezDeAccionCrear(), fechaQueGuardaAplicarAccionCrear(), aplicarAccionCrear(), fechaLocalDeAccion(), primeraVuelta(), resolverTemaId(), datetimeLocalToIso(), prepararRecurrencia()

## Ambiguous Edges - Review These
- `Graphify Project Rules` → `Organizador Personal IA - Master Plan`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **316 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+311 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Graphify Project Rules` and `Organizador Personal IA - Master Plan`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `useAuth()` connect `AssistantDrawer.tsx` to `Motor de sincronizacion offline (db/outbox/sync)`, `buscar.test.ts`, `eslint-plugin-react-hooks`, `ItemForm.tsx`, `Documentacion raiz / planes / auth context`, `reminderScheduling.ts`, `useSyncStatus`, `Service worker push`, `AssistantDrawer.tsx`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `Item` connect `buscar.test.ts` to `Recordatorios y watcher local`, `AssistantDrawer.tsx`, `AppShell.tsx`, `Documentacion raiz / planes / auth context`, `recordatorios.ts`, `supabase.ts`, `Service worker push`, `exportarDatos.ts`, `AssistantDrawer.tsx`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `Tema` connect `buscar.test.ts` to `Recordatorios y watcher local`, `AppShell.tsx`, `Documentacion raiz / planes / auth context`, `recordatorios.ts`, `supabase.ts`, `Service worker push`, `exportarDatos.ts`, `AssistantDrawer.tsx`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _316 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Asistente IA - acciones propuestas` be split into smaller, more focused modules?**
  _Cohesion score 0.09846153846153846 - nodes in this community are weakly interconnected._
- **Should `Config TypeScript (app)` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._