# Graph Report - Organizador  (2026-07-27)

## Corpus Check
- 119 files · ~225,225 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 935 nodes · 2028 edges · 76 communities (60 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 40 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `64651f60`
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
- theme.ts
- syncCore.ts
- @eslint/js
- @types/react
- HoyPage.tsx
- ItemList.tsx
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
- useLocalReminderWatcher.ts
- ProposedActionCard.tsx
- ItemForm
- Web Push via VAPID Keys + pg_cron
- RemindersPage
- Adoption of react-router-dom for /settings Route
- notification-actions.d.ts
- eslint-plugin-react-hooks

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 30 edges
2. `Item` - 26 edges
3. `getDB()` - 24 edges
4. `Tema` - 21 edges
5. `ItemForm()` - 19 edges
6. `HoyPage()` - 18 edges
7. `ItemsPage()` - 17 edges
8. `compilerOptions` - 17 edges
9. `loadItemsFromCache()` - 15 edges
10. `supabase` - 15 edges

## Surprising Connections (you probably didn't know these)
- `SyncSettings()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncSettings.tsx → PLAN_OFFLINE.md
- `SyncStatus()` --shares_data_with--> `sync.ts (sync engine)`  [INFERRED]
  src/components/SyncStatus.tsx → PLAN_OFFLINE.md
- `useLocalReminderWatcher()` --shares_data_with--> `listRecordatoriosParaDisparo`  [INFERRED]
  src/lib/useLocalReminderWatcher.ts → PLAN_OFFLINE.md
- `Adoption of react-router-dom for /settings Route` --references--> `ItemsPage()`  [EXTRACTED]
  PLAN_ORGANIZADOR.md → src/pages/ItemsPage.tsx
- `marcarHecho` --shares_data_with--> `RemindersPage()`  [INFERRED]
  PLAN_ORGANIZADOR.md → src/pages/RemindersPage.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Offline Sync Pipeline (repo -> db -> sync engine)** — src_lib_repo_repo, src_lib_db_db, src_lib_synccore_planoutbox, src_lib_sync_sync, src_components_syncengine_syncengine [EXTRACTED 1.00]
- **Sync Status Indicator UI Group** — src_components_syncstatus_syncstatus, src_components_syncsettings_syncsettings, src_lib_sync_sync [EXTRACTED 0.95]
- **Dual-Path Reminder Delivery (local watcher + server cron)** — src_lib_uselocalreminderwatcher_uselocalreminderwatcher, supabase_functions_send_reminder_notifications_index_handlesend, src_lib_reminderscheduling_splitstalereminders [INFERRED 0.85]

## Communities (76 total, 16 thin omitted)

### Community 0 - "Motor de sincronizacion offline (db/outbox/sync)"
Cohesion: 0.14
Nodes (34): deleteLocalRow(), deleteOpsForEntity(), enqueueOp(), getDB(), getLocalItem(), getLocalRecordatorio(), getLocalRecordatoriosByItem(), getLocalTema() (+26 more)

### Community 1 - "Gestion de items (ItemForm/ItemList)"
Cohesion: 0.15
Nodes (9): DictadoRecognition, DictadoRecognitionAlternative, DictadoRecognitionConstructor, DictadoRecognitionErrorEvent, DictadoRecognitionEvent, DictadoRecognitionResult, DictadoRecognitionResultList, DictadoVoz (+1 more)

### Community 3 - "Asistente IA - acciones propuestas"
Cohesion: 0.10
Nodes (16): callGemini(), CORS_HEADERS, FUNCTION_DECLARATIONS, GeminiError, logJson(), logRespuestaGemini(), mensajeCuotaCorta(), mensajeCuotaDiaria() (+8 more)

### Community 4 - "Config ESLint y devDependencies"
Cohesion: 0.15
Nodes (13): eslint, eslint-plugin-react-refresh, globals, devDependencies, eslint, eslint-plugin-react-refresh, globals, supabase (+5 more)

### Community 5 - "Recordatorios y watcher local"
Cohesion: 0.18
Nodes (9): AssistantRedirect(), ProtectedRoute(), UpdateBanner(), AuthContextValue, AuthProvider(), leerNombre(), readCachedSession(), ensurePersistentStorage() (+1 more)

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
Cohesion: 0.19
Nodes (9): AssistantDrawer(), ExportarDatos(), FaseFoto, NuevoItemSheet(), Vista, useAuth(), readAiEnabledCache(), useAiEnabled() (+1 more)

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
Cohesion: 0.06
Nodes (70): Hard Delete + Full Re-fetch Reconciliation (vs Soft-Delete), Last-Write-Wins via updated_at + Conditional Update, Sync Trigger Events (online/focus/visibility/interval/post-mutation), Trigger Adjustment to Respect Client-Sent updated_at, Web Locks API Single-Flight Sync, RLS Design: Join-Based Policies for recordatorios, Database Schema (temas/items/recordatorios), SyncEngine() (+62 more)

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
Cohesion: 0.06
Nodes (56): ItemFormProps, armarGrupos(), Grupo, ItemContent(), ItemList(), ItemListProps, parseLista(), PRIORIDAD_LABEL (+48 more)

### Community 35 - "eslint-plugin-react-hooks"
Cohesion: 0.15
Nodes (15): AuthCard(), borrarCuenta(), consumirAvisoCuentaBorrada(), limpiarStorageLocal(), mensajeDeError(), ResultadoBorrado, wipeLocalDatabase(), supabase (+7 more)

### Community 37 - "AssistantDrawer.tsx"
Cohesion: 0.12
Nodes (9): AbrirAsistenteContext, AppShell(), Destino, DESTINOS, TRAZO, countRecordatoriosPendientesHoy(), medir(), useIsWide() (+1 more)

### Community 38 - "ItemForm.tsx"
Cohesion: 0.27
Nodes (12): applyTheme(), getTheme(), isTheme(), listeners, prefersDark(), readStoredTheme(), resolveInitialTheme(), setTheme() (+4 more)

### Community 43 - "Outbox Pattern for Offline Mutations"
Cohesion: 0.33
Nodes (7): Graphify Project Rules, Outbox Pattern for Offline Mutations, Offline Support Architecture Plan, Organizador Personal IA - Master Plan, AuthContext, db.ts (IndexedDB store layer), repo.ts (local mutation repository)

### Community 44 - "AppShell.tsx"
Cohesion: 0.15
Nodes (24): aFilasEditables(), FilaEditable, ItemForm(), nuevaLinea(), PRIORIDADES, TIPOS, DIA_CORTO, DIA_LARGO (+16 more)

### Community 45 - "extract-from-photo/index.ts"
Cohesion: 0.07
Nodes (30): AccionCrear, buildPrompt(), esPrioridad(), esTipo(), Extraccion, filasArray(), normalizarExtraccion(), parseJsonLaxo() (+22 more)

### Community 46 - "reminderScheduling.ts"
Cohesion: 0.10
Nodes (22): Catch-up Notification for Stale Reminders, Two-Way Reminder Notifications (Local + Cron), LocalReminderWatcher(), listRecordatoriosParaDisparo, marcarEnviado, ArmedTimer, ArmInstruction, computeDelayMs() (+14 more)

### Community 47 - "recordatorios.ts"
Cohesion: 0.21
Nodes (13): RecordatorioRow(), resumenContenido(), ESTADO_LABEL, EstadoRecordatorio, mismoDia(), TIPO_LABEL, marcarHecho(), Filtro (+5 more)

### Community 48 - "historial.ts"
Cohesion: 0.16
Nodes (17): PROPOSE_TOOLS, AccionHistorial, buildContents(), callDeAccion(), esEstado(), EstadoAccionHistorial, GeminiContent, GeminiPart (+9 more)

### Community 49 - "theme.ts"
Cohesion: 0.38
Nodes (11): PushSettings(), getPushStatus(), isPushSupported(), keyToBase64(), PushStatus, subscribeToPush(), swReadyOrNull(), unsubscribeFromPush() (+3 more)

### Community 50 - "syncCore.ts"
Cohesion: 0.26
Nodes (12): BorrarCuenta(), SyncSettings(), SyncStatus(), confirmacionValida(), forceSyncNow(), getSyncState(), subscribeSync(), SyncState (+4 more)

### Community 53 - "HoyPage.tsx"
Cohesion: 0.27
Nodes (17): loadItemsFromCache(), loadRecordatoriosFromCache(), loadTemasFromCache(), useItemSheet(), clasificar(), joinRecordatoriosConItems(), marcarHecho, listRecordatoriosParaDisparo() (+9 more)

### Community 54 - "ItemList.tsx"
Cohesion: 0.19
Nodes (17): borradorDeAccionCrear(), BorradorItem, contenidoDeAccionCrear(), tablaATexto(), Recurrencia, AccionCrear, AccionEditar, AiUsage (+9 more)

### Community 55 - "exportarDatos.ts"
Cohesion: 0.22
Nodes (16): item(), aItemExport(), aRecordatorioExport(), CABECERAS_CSV, celdaCSV(), DatosExport, descargar(), exportarCSV() (+8 more)

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
Nodes (11): EstadoAccion, PendingAction, AccionBorrar, AccionEnHistorial, AccionPropuesta, AssistantResponse, AssistantUsage, CallPropuesta (+3 more)

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

### Community 68 - "useLocalReminderWatcher.ts"
Cohesion: 0.36
Nodes (5): ACCIONES_POSPONER, contenidoNotificacion, itemTexto, recSimple, mapaNombresTema()

### Community 69 - "ProposedActionCard.tsx"
Cohesion: 0.25
Nodes (10): contenidoTexto(), fechaCambioRecordatorio(), ProposedActionCard(), RecordatorioLinea(), textoRepeticion(), formatFechaHora(), horaDeDatetimeLocal(), proximaFechaConHora() (+2 more)

### Community 70 - "ItemForm"
Cohesion: 0.32
Nodes (7): isoToDatetimeLocal(), extraerDeFoto(), ExtraerOpts, FotoPreparada, leerComoDataUrl(), prepararFoto(), PhotoExtractResponse

### Community 71 - "Web Push via VAPID Keys + pg_cron"
Cohesion: 0.33
Nodes (6): Notification Tag Dedup between Local Watcher and Cron Push, Decision: No Runtime Caching of Supabase Data in Service Worker, Web Push via VAPID Keys + pg_cron, sw.ts (service worker), send-reminder-notifications Edge Function handler, push_subscriptions migration

### Community 72 - "RemindersPage"
Cohesion: 1.00
Nodes (3): Organizador Catalog-Style Mockup (HTML), App HTML Shell (Vite entry), Catalog Card Visual Design System

### Community 73 - "Adoption of react-router-dom for /settings Route"
Cohesion: 0.67
Nodes (3): Adoption of react-router-dom for /settings Route, Render Static Site Deployment, Render Static Site Blueprint (organizador-ia)

## Ambiguous Edges - Review These
- `Graphify Project Rules` → `Organizador Personal IA - Master Plan`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **314 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+309 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Graphify Project Rules` and `Organizador Personal IA - Master Plan`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `useAuth()` connect `Documentacion raiz / planes / auth context` to `buscar.test.ts`, `useLocalReminderWatcher.ts`, `Recordatorios y watcher local`, `AssistantDrawer.tsx`, `reminderScheduling.ts`, `recordatorios.ts`, `theme.ts`, `syncCore.ts`, `HoyPage.tsx`, `Service worker push`, `AssistantDrawer.tsx`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `Item` connect `buscar.test.ts` to `Motor de sincronizacion offline (db/outbox/sync)`, `eslint-plugin-react-hooks`, `useLocalReminderWatcher.ts`, `ProposedActionCard.tsx`, `AssistantDrawer.tsx`, `AppShell.tsx`, `Documentacion raiz / planes / auth context`, `recordatorios.ts`, `exportarDatos.ts`, `ItemList.tsx`, `Service worker push`, `HoyPage.tsx`, `AssistantDrawer.tsx`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `supabase` connect `eslint-plugin-react-hooks` to `Recordatorios y watcher local`, `AssistantDrawer.tsx`, `ItemForm`, `Documentacion raiz / planes / auth context`, `recordatorios.ts`, `theme.ts`, `syncCore.ts`, `Service worker push`, `AssistantDrawer.tsx`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _314 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Motor de sincronizacion offline (db/outbox/sync)` be split into smaller, more focused modules?**
  _Cohesion score 0.14114114114114115 - nodes in this community are weakly interconnected._
- **Should `Asistente IA - acciones propuestas` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._