# Handoff: Rediseño de arquitectura de información — Organizador Personal IA

## Overview
Rediseño completo de la arquitectura de información de **Organizador Personal IA** (PWA personal: notas, ítems y recordatorios, offline-first, con asistente Gemini y recordatorios push). No es un lavado de cara: cambia vistas, secciones, navegación y sistema de color, y deja lugar para las funciones pendientes (captura por foto, editor de tabla, modo oscuro, historial del asistente).

Problema central que resuelve: **el desorden de la vista de entrada actual** (se veía toda la lista de ítems mezclada, sin separación por tipo ni por tema).

## About the Design Files
El archivo `Organizador.dc.html` de este bundle es una **referencia de diseño creada en HTML** — un prototipo funcional que muestra el aspecto y el comportamiento buscados, **no** código de producción para copiar y pegar. La tarea es **recrear este diseño en el codebase real** (React + Vite + TypeScript + Tailwind v4, según el proyecto existente) usando sus patrones y componentes ya establecidos (`AppNav`, `ItemForm`, `ItemList`, `PushSettings`, `SyncSettings`, motor de sync/outbox, IndexedDB, etc.).

> Cómo abrir el prototipo: es un Design Component. Abrilo en un navegador directamente, o mirá los screenshots si los adjuntamos. La lógica vive en el `<script>` final del archivo (clase `Component`); el markup es el template. Los estilos son inline + variables CSS en `<head>`.

## Fidelity
**Alta fidelidad (hifi).** Colores, tipografías, espaciados e interacciones son definitivos. Recrear la UI de forma fiel usando las librerías del codebase. Los datos son de muestra (mock) — reemplazar por los reales.

---

## Modelo de navegación (nuevo)

Reemplaza la nav superior plana de 4 links por una estructura responsiva:

- **Desktop (≥900px):** sidebar izquierda fija de **264px** con: brand, buscador, nav vertical (Hoy / Biblioteca / Recordatorios / Ajustes), botón "+ NUEVO ITEM", botón "Asistente IA" y bloque de cuenta abajo.
- **Mobile (<900px):** barra superior sticky (brand + toggle de tema + buscador) + **barra inferior de tabs** (Hoy · Biblioteca · **FAB central "+"** · Recordatorios · Ajustes) + **botón flotante del asistente** (esquina inferior derecha, sobre la tab bar).
- El breakpoint se resuelve con un listener de `resize` (`window.innerWidth >= 900`).
- **Buscador siempre visible**; al escribir, reemplaza el contenido de la vista por resultados agrupados.
- **Asistente** = drawer flotante (derecha en desktop, bottom-sheet en mobile), accesible desde cualquier vista — ya no es una página.
- La barra de Recordatorios lleva un **badge numérico rust** con la cantidad de pendientes.

---

## Screens / Views

### 1. Hoy (vista de entrada — reemplaza a Items como landing)
- **Propósito:** resumen accionable del día. Es la pantalla a la que se aterriza al abrir la app.
- **Layout:** columna, `padding` 34px/40px desktop, 18px/16px mobile, `max-width` 900px.
- **Componentes (de arriba a abajo):**
  - Fecha en mono uppercase (`--slate`) + saludo grande en Fraunces 30px/600 ("Buenas, Raúl").
  - **3 tarjetas de stats** en grid (Vencidos / Para hoy / Ítems): número Fraunces 26px (color `--rust` / `--gold` / `--ink`), label mono 10px. Fondo `--card`, borde `--line`, radius 4px, sombra.
  - **Fila de accesos rápidos** (scroll horizontal): "NUEVO" (sólido moss), "FOTO" (outline), "PREGUNTAR" (outline, ícono sparkle). Mono 11.5px.
  - **Sección "Vencidos"** (título Fraunces 17px color `--rust` + hairline): tarjetas de recordatorio con lomo izquierdo rust 4px, meta mono, botón "HECHO".
  - **Sección "Para hoy"** (lomo gold). Estado vacío: caja punteada "Nada más para hoy".
  - **Sección "Tus temas"**: grid de tarjetas por tema (auto-fill minmax 150px) con punto de color del tema + nombre Fraunces + contador; navegan a Biblioteca filtrada por ese tema.

### 2. Biblioteca (reemplaza Items — resuelve el desorden)
- **Propósito:** explorar todos los ítems, ordenados y filtrables. Sustituye la lista plana mezclada.
- **Layout:** título "Biblioteca" (Fraunces 26px) + contador ("7 ÍTEMS · 5 TEMAS"); botón "NUEVO" a la derecha en desktop.
- **Filtros (dos niveles):**
  - **Segmented por tipo** (fondo `--card-2`, píldora activa `--card` con sombra): Todos · Notas · Listas · Tablas. Mono 11px.
  - **Chips por tema** (scroll horizontal, píldoras redondeadas): "Todos los temas" + un chip por tema con su punto de color. Chip activo = fondo `--ink`, texto `--paper`.
- **Contenido:** **secciones colapsables por tema**. Header de sección = punto de color + nombre Fraunces 18px + contador mono + chevron (rota -90° al colapsar) + hairline. Al filtrar por un tipo, la lista se acota; al filtrar por un tema, sólo se muestra esa sección.
- **Tarjeta de ítem** (`--card`, radius 4px, sombra, **lomo izquierdo 4px por prioridad**):
  - Fila meta: TIPO (mono 10.5px `--ink-soft`) + PRIORIDAD (mono coloreada) + recordatorio (ícono campana + fecha) si aplica.
  - Cuerpo según tipo:
    - **nota:** texto 14.5px, `line-height` 1.5, `text-wrap: pretty`.
    - **lista:** checkboxes custom (marcado = relleno `--moss` + check `--moss-ink`; texto tachado `--slate` cuando done).
    - **tabla:** `<table>` real, header fondo `--card-2` mono uppercase, zebra striping (`--card-2` en filas impares), `overflow-x:auto` propio con `min-width` 340px.
  - Footer: acciones "EDITAR" (`--ink-soft`) y "ELIMINAR" (`--rust`), mono 11px, alineadas a la derecha.
- Estado vacío: caja punteada "No hay ítems con este filtro".

### 3. Recordatorios
- **Propósito:** todos los recordatorios agrupados por estado (antes era lista plana).
- **Filtros:** segmented Todos · Vencidos · Próximos · Hechos.
- **Grupos** (con hairline): Vencidos (título `--rust`) · Hoy · Próximos · Hechos. Cada tarjeta con lomo por estado (rust/gold/slate), meta mono coloreada, contenido (tachado + `--slate` si hecho), botón "HECHO" si está pendiente.

### 4. Nuevo ítem (sheet / modal)
- Desktop: modal centrado 540px. Mobile: bottom-sheet (radius superior 14px, `animation` slide-up).
- **Menú inicial (3 opciones):**
  - **Escribir** — nota/lista/tabla a mano.
  - **Desde una foto** — captura Gemini Vision.
  - **Pedirle a la IA** — abre el asistente.
- **Modo formulario:** segmented de tipo (Nota/Lista/Tabla), selects de Tema y Prioridad, y editor según tipo:
  - nota → textarea.
  - lista → **editor de líneas** (checkbox + input + borrar por fila, botón "AGREGAR LÍNEA" punteado).
  - tabla → **editor de grilla inline** (headers y celdas editables, botones "COLUMNA" y "FILA" para agregar) — cubre la función pendiente "editor de tabla real".
  - Toggle "AGREGAR RECORDATORIO" + `datetime-local`.
  - Acciones "GUARDAR" (moss) / "VOLVER".
- **Modo foto:** dropzone punteado con fondo rayado (placeholder), botón "ANALIZAR IMAGEN", y **tarjeta de preview de lo detectado** (tipo/tema/prioridad/contenido con lomo moss, "REVISÁ ANTES DE GUARDAR") → Guardar / Editar. Análogo al preview de acciones del asistente.

### 5. Asistente (drawer flotante)
- Header: ícono sparkle + "Asistente" + botón historial + cerrar.
- **Chat:** burbujas (usuario = `--moss`/`--moss-ink` alineado derecha; asistente = `--card` alineado izquierda). **Tarjeta de propuesta** (lomo moss): "PROPUESTA · CREAR ÍTEM" con tipo/tema/prioridad/contenido + "CONFIRMAR"/"CANCELAR" (nunca escribe sin confirmar). Input + "ENVIAR" abajo (Enter envía).
- **Historial** (función pendiente): botón "NUEVA CONVERSACIÓN" + lista de conversaciones (título, preview, fecha, borrar). Cubre la memoria de conversación persistente.

### 6. Ajustes
- **Apariencia** (nuevo): toggle segmentado Claro/Oscuro — cubre la función pendiente de modo oscuro.
- **Asistente IA:** estado ACTIVA + "DESACTIVAR / QUITAR KEY" (outline rust).
- **Notificaciones:** estado + explicación.
- **Sincronización:** conexión / cambios pendientes / última sync + "SINCRONIZAR AHORA".
- "CERRAR SESIÓN" al pie.

---

## Interactions & Behavior
- **Navegación:** cambiar de vista resetea la búsqueda y cierra overlays. En mobile la tab activa se colorea `--moss`.
- **Colapsar secciones** de Biblioteca: click en el header togglea; chevron rota.
- **Búsqueda:** filtra ítems por tema/tipo/contenido/celdas; muestra resultados con dot de tema + snippet; estado sin-resultados.
- **Asistente:** enviar agrega mensaje de usuario + respuesta + tarjeta de propuesta; confirmar la aplica; el historial permite abrir/borrar conversaciones.
- **Foto:** "ANALIZAR" revela el preview de extracción.
- **Tema:** claro/oscuro conmuta `data-theme` en el contenedor raíz; transición de 0.3s en background/color.
- **Animaciones:** `om-rise` (14px, 0.35s) al entrar a vistas; `om-fade` para backdrops; `om-sheet` (24px slide-up, 0.28s) para bottom-sheets. Backdrop `rgba(15,20,13,.42)`.
- **Responsive:** único breakpoint en 900px (sidebar ↔ tab bar). Tablas y chips con scroll horizontal propio.

## State Management
Variables de estado del prototipo (traducir al store/patrón del codebase):
- `screen` (hoy | items | rem | ajustes), `theme` (light | dark), `wide` (bool, del resize).
- `query`, `draft` (input del asistente).
- `assistantOpen`, `historyOpen`.
- `newOpen`, `newMode` (menu | form | photo), `newTipo` (nota | lista | tabla), `photoAnalyzed`.
- `tipoFilter`, `temaFilter`, `remFilter`, `collapsed` (mapa por tema).
- `messages`, `proposal`, `conversations`.
- **Datos reales a conectar:** ítems (con tema, tipo, prioridad, contenido/lines/rows, reminder), temas (id + nombre + **color propio nuevo**), recordatorios (estado, fecha, tipo). El color por tema es un campo nuevo a agregar al modelo `Tema`.

## Design Tokens

Definidos como CSS custom properties en `:root` y `[data-theme="dark"]`.

**Claro:**
- `--paper #eef0ec` (fondo) · `--card #f7f8f5` · `--card-2 #e9ece5`
- `--ink #1e2a22` · `--ink-soft #4b5750` · `--ink-mute #8a938a`
- `--line #d7dad2` · `--line-soft #e4e7e0`
- `--moss #3d5c41` (acento primario) · `--moss-ink #eaf0ea` · `--moss-tint #e3eae1`
- `--rust #9c3b22` (alta/vencido/destructivo) · `--gold #b98530` (media/próximo) · `--slate #7c8577` (baja/hecho/terciario)

**Oscuro:**
- `--paper #12160f` · `--card #1a1f17` · `--card-2 #232a20`
- `--ink #e8ece3` · `--ink-soft #a9b2a5` · `--ink-mute #71796f`
- `--line #2b322a` · `--line-soft #222820`
- `--moss #6f9873` · `--moss-ink #0e120c` · `--moss-tint #20291d`
- `--rust #cc7458` · `--gold #d3ab63` · `--slate #939c90`

**Colores de tema (dimensión NUEVA, tonos fríos para no chocar con la prioridad, que es cálida):**
- Programación `oklch(0.56 0.10 255)` (azul)
- Compras `oklch(0.60 0.10 195)` (teal)
- Comida `oklch(0.58 0.10 150)` (verde)
- Trabajo `oklch(0.54 0.11 305)` (violeta)
- Personal `oklch(0.56 0.09 225)` (acero)
- Regla de sistema: **prioridad = cálido (lomo de tarjeta); tema = frío (punto/chip)**. Nunca usar el color de tema en el lomo.

**Tipografía:**
- **Fraunces** (500/600/700): brand, títulos de vista, encabezados de tema/sección.
- **IBM Plex Sans** (400/500/600): cuerpo, notas, mensajes.
- **IBM Plex Mono** (400/500/600): metadatos, labels, botones, badges — uppercase con `letter-spacing` .05–.12em.

**Radius:** 2–4px (nada muy redondeado); píldoras de chip = 999px; FAB/avatar = 50%.
**Sombra:** `0 1px 2px rgba(30,42,34,.04), 0 8px 24px -16px rgba(30,42,34,.18)` (claro) / más profunda en oscuro.
**Espaciado:** múltiplos de ~6–8px; gaps de flex/grid en 6–12px; secciones separadas 22–28px.

## Assets
- **Íconos:** SVG de línea inline (home, lista, campana, sliders, lupa, "+", sparkle, cámara, check, cerrar, reloj, chevron, papelera), stroke ~1.6–1.8, 22px en nav. Reemplazables por el icon set del codebase.
- **Fuentes:** Google Fonts (Fraunces, IBM Plex Sans, IBM Plex Mono).
- **Sin imágenes bitmap.** El dropzone de foto es un placeholder rayado.
- No hay assets de marca de terceros.

## Files
- `Organizador.dc.html` — prototipo hifi completo (todas las vistas, overlays, light/dark, responsive). Template + clase `Component` con los datos de muestra y toda la lógica de estado.
