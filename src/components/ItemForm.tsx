import { useEffect, useState, type FormEvent } from 'react'
import type { Item, ItemInsert, LineaLista, Prioridad, Tema, TipoItem } from '../types/database'
// Todas las escrituras del form pasan por el repositorio local: se guardan al
// instante en IndexedDB y se encolan para subir, así el form funciona igual con
// o sin conexión (PLAN_OFFLINE.md ítems 5-6).
import {
  createItem,
  createTema,
  deleteRecordatoriosForItem,
  getRecordatorioForItem,
  updateItem,
  updateTemaColor,
  upsertRecordatorio,
} from '../lib/repo'
import { datetimeLocalToIso, isoToDatetimeLocal } from '../lib/recordatorios'
import type { BorradorItem } from '../lib/accionesPropuestas'
import {
  COLORES_TEMA,
  TEMA_COLOR_LABEL,
  colorDeTema,
  siguienteColorTema,
  temaColorVar,
  type TemaColor,
} from '../lib/temaColores'
import {
  contenidoDeGrilla,
  grillaDesdeContenido,
  grillaDesdeTexto,
  grillaVacia,
  nombreColumna,
  type Grilla,
} from '../lib/tabla'

function nuevaLinea(): LineaLista {
  return { id: crypto.randomUUID(), texto: '', hecho: false }
}

// Una fila de la grilla mientras se edita. Lleva id por el mismo motivo que las
// líneas de una lista: quitar la fila del medio con la clave puesta en el índice
// haría que React reusara los inputs de la fila de abajo y el foco saltara.
// El id es de la edición, no del dato: no se guarda.
interface FilaEditable {
  id: string
  celdas: string[]
}

function aFilasEditables(filas: string[][]): FilaEditable[] {
  return filas.map((celdas) => ({ id: crypto.randomUUID(), celdas }))
}

interface ItemFormProps {
  userId: string
  temas: Tema[]
  editingItem: Item | null
  /** Item propuesto por la IA y todavía no guardado, para arrancar el form con
   *  sus campos ya cargados ("editar antes de guardar" de la captura por foto,
   *  ítem 14). Se ignora si hay `editingItem`: editar un item real manda.
   *  Sigue siendo una CREACIÓN — un borrador no tiene id ni existe en la base. */
  borrador?: BorradorItem | null
  onSaved: () => void
  onCancel: () => void
  onTemaCreated: (tema: Tema) => void
  /** Un tema cambió (hoy: su color). Se avisa aparte de onSaved porque el
   *  cambio es del tema, no del item, y ya está guardado cuando llega. */
  onTemaUpdated: (tema: Tema) => void
}

function IconMas() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

const TIPOS: TipoItem[] = ['nota', 'recordatorio', 'lista', 'tabla']
const PRIORIDADES: Prioridad[] = ['alta', 'media', 'baja']

export function ItemForm({
  userId,
  temas,
  editingItem,
  borrador = null,
  onSaved,
  onCancel,
  onTemaCreated,
  onTemaUpdated,
}: ItemFormProps) {
  const [tipo, setTipo] = useState<TipoItem>('nota')
  const [temaId, setTemaId] = useState<string>('')
  const [nuevoTemaNombre, setNuevoTemaNombre] = useState('')
  // Color que llevará el tema nuevo. Se propone solo al elegir "+ crear tema
  // nuevo" y queda fijo mientras se escribe el nombre: recalcularlo en cada
  // tecla haría parpadear la muestra elegida.
  const [nuevoTemaColor, setNuevoTemaColor] = useState<TemaColor>(COLORES_TEMA[0])
  const [prioridad, setPrioridad] = useState<Prioridad | ''>('')
  const [contenidoTexto, setContenidoTexto] = useState('')
  const [lineas, setLineas] = useState<LineaLista[]>([])
  // Grilla del editor de tablas (ítem 12). Se guarda como { columnas, filas };
  // lo que se lee puede venir en esa forma o en la vieja de texto con pipes —
  // de eso se ocupa `grillaDesdeContenido`.
  const [columnas, setColumnas] = useState<string[]>([])
  const [filas, setFilas] = useState<FilaEditable[]>([])
  const [conRecordatorio, setConRecordatorio] = useState(false)
  const [recordatorioFecha, setRecordatorioFecha] = useState('')
  // Marca si el item que estamos editando ya tenía un recordatorio, para saber
  // si al desmarcar el toggle hay que eliminarlo.
  const [teniaRecordatorio, setTeniaRecordatorio] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editingItem) {
      setTipo(editingItem.tipo)
      setTemaId(editingItem.tema_id ?? '')
      setPrioridad(editingItem.prioridad ?? '')
      const texto = editingItem.contenido.texto
      setContenidoTexto(typeof texto === 'string' ? texto : JSON.stringify(editingItem.contenido))
      // Al editar una lista con la forma nueva, preservamos hecho de cada línea.
      const itemsGuardados = editingItem.contenido.items
      setLineas(
        Array.isArray(itemsGuardados)
          ? (itemsGuardados as LineaLista[]).map((l) => ({
              id: typeof l.id === 'string' ? l.id : crypto.randomUUID(),
              texto: String(l.texto ?? ''),
              hecho: Boolean(l.hecho),
            }))
          : [],
      )
      // Al editar una tabla se precarga la grilla. Sirve tanto para las nuevas
      // ({columnas, filas}) como para las viejas ({texto} con pipes, incluidas
      // las que salieron de una foto): se parsean al abrir y, al guardar, el
      // item sale ya en la forma estructurada. No hay migración de datos — cada
      // tabla se convierte sola la primera vez que se la edita.
      const grilla =
        editingItem.tipo === 'tabla' ? grillaDesdeContenido(editingItem.contenido) : null
      setColumnas(grilla?.columnas ?? [])
      setFilas(grilla ? aFilasEditables(grilla.filas) : [])
    } else if (borrador) {
      // Creación arrancada desde una propuesta de la IA (hoy: la foto). Mismos
      // campos que una creación a mano — el form no sabe ni le importa de dónde
      // salieron —, sólo que ya vienen llenos y el usuario corrige lo que quiera
      // antes de guardar.
      setTipo(borrador.tipo)
      setPrioridad(borrador.prioridad ?? '')
      setContenidoTexto(borrador.contenidoTexto)
      setLineas(
        borrador.lineas.map((texto) => ({ id: crypto.randomUUID(), texto, hecho: false })),
      )
      // La propuesta trae la tabla aplanada a texto con pipes; acá se abre como
      // grilla y se guarda estructurada, igual que cualquier otra.
      const grilla = borrador.tipo === 'tabla' ? grillaDesdeTexto(borrador.contenidoTexto) : null
      setColumnas(grilla?.columnas ?? [])
      setFilas(grilla ? aFilasEditables(grilla.filas) : [])

      // El tema viene por nombre: si ya existe se selecciona (sin duplicarlo), y
      // si no, se precarga el flujo de "crear tema nuevo" con el nombre puesto.
      // Es la misma resolución que hace el asistente al confirmar una acción,
      // pero acá pasa por el form para que el usuario pueda cambiarlo.
      const existente = borrador.temaNombre
        ? temas.find((t) => t.nombre.toLowerCase() === borrador.temaNombre!.toLowerCase())
        : undefined
      if (existente) {
        setTemaId(existente.id)
        setNuevoTemaNombre('')
      } else if (borrador.temaNombre) {
        setTemaId('new')
        setNuevoTemaNombre(borrador.temaNombre)
        setNuevoTemaColor(siguienteColorTema(temas))
      } else {
        setTemaId('')
        setNuevoTemaNombre('')
      }
    } else {
      setTipo('nota')
      setTemaId('')
      setPrioridad('')
      setContenidoTexto('')
      setLineas([])
      setColumnas([])
      setFilas([])
    }
    // El nombre de tema nuevo lo fija la rama del borrador; en los otros dos
    // casos se limpia.
    if (!borrador || editingItem) setNuevoTemaNombre('')
    setError(null)

    // Recordatorio: reseteamos primero y, si estamos editando, cargamos el que
    // exista para prellenar el toggle y la fecha.
    setConRecordatorio(false)
    setRecordatorioFecha('')
    setTeniaRecordatorio(false)

    if (editingItem) {
      let cancelled = false
      getRecordatorioForItem(editingItem.id)
        .then((rec) => {
          if (cancelled || !rec) return
          setConRecordatorio(true)
          setTeniaRecordatorio(true)
          setRecordatorioFecha(isoToDatetimeLocal(rec.fecha_hora))
        })
        .catch(() => {
          /* si falla la carga del recordatorio, el form igual funciona sin él */
        })
      return () => {
        cancelled = true
      }
    }
    // `temas` queda fuera de las dependencias a propósito: se usa sólo para
    // resolver el nombre de tema del borrador en el momento de cargarlo, y
    // volver a correr este efecto cada vez que cambia la lista pisaría lo que el
    // usuario ya eligió en el select. El sheet remonta el form con `formKey`
    // cuando el borrador cambia, que es cuando esta resolución tiene que rehacerse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingItem, borrador])

  // Aseguramos al menos una línea en blanco cuando el tipo es "lista".
  useEffect(() => {
    if (tipo === 'lista' && lineas.length === 0) {
      setLineas([nuevaLinea()])
    }
  }, [tipo, lineas.length])

  // Lo mismo para "tabla": si todavía no hay grilla (item nuevo, o el usuario
  // acaba de cambiar el tipo), se arranca con una 2×2 vacía. Si ya hay, no se
  // toca: cambiar de tipo y volver no debería perder lo escrito.
  useEffect(() => {
    if (tipo === 'tabla' && columnas.length === 0) {
      const g = grillaVacia()
      setColumnas(g.columnas)
      setFilas(aFilasEditables(g.filas))
    }
  }, [tipo, columnas.length])

  // El tema seleccionado, si es uno real (no '' ni 'new'). Es el que puede
  // cambiar de color desde acá.
  const temaSeleccionado = temas.find((t) => t.id === temaId) ?? null
  const colorActivo = temaId === 'new' ? nuevoTemaColor : temaSeleccionado ? colorDeTema(temaSeleccionado) : null

  function handleTemaChange(value: string) {
    setTemaId(value)
    // Al entrar en "tema nuevo" se propone un color libre de la paleta (D4:
    // automático al crear, con opción de cambiarlo acá mismo).
    if (value === 'new') setNuevoTemaColor(siguienteColorTema(temas))
  }

  // Para un tema nuevo solo se recuerda la elección (se guarda al crear el
  // item); para uno existente, el cambio se persiste ya — es una propiedad del
  // tema, no del item, y no tiene sentido atarla al submit del form.
  async function handleColorClick(color: TemaColor) {
    if (temaId === 'new') {
      setNuevoTemaColor(color)
      return
    }
    if (!temaSeleccionado) return
    try {
      onTemaUpdated(await updateTemaColor(temaSeleccionado.id, color))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el color del tema')
    }
  }

  const updateLinea = (id: string, texto: string) =>
    setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, texto } : l)))
  const removeLinea = (id: string) => setLineas((prev) => prev.filter((l) => l.id !== id))
  const addLinea = () => setLineas((prev) => [...prev, nuevaLinea()])

  // --- Grilla de la tabla ---------------------------------------------------
  // Agregar y quitar columna tocan las dos mitades del estado (los encabezados y
  // todas las filas) para que la grilla nunca quede dentada: si una fila tuviera
  // más celdas que columnas, la de más no se vería y se guardaría igual.

  const updateColumna = (ci: number, valor: string) =>
    setColumnas((prev) => prev.map((c, i) => (i === ci ? valor : c)))

  const updateCelda = (id: string, ci: number, valor: string) =>
    setFilas((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, celdas: f.celdas.map((c, i) => (i === ci ? valor : c)) } : f,
      ),
    )

  const addColumna = () => {
    setColumnas((prev) => [...prev, nombreColumna(prev.length)])
    setFilas((prev) => prev.map((f) => ({ ...f, celdas: [...f.celdas, ''] })))
  }

  const removeColumna = (ci: number) => {
    if (columnas.length <= 1) return
    setColumnas((prev) => prev.filter((_, i) => i !== ci))
    setFilas((prev) => prev.map((f) => ({ ...f, celdas: f.celdas.filter((_, i) => i !== ci) })))
  }

  const addFila = () =>
    setFilas((prev) => [
      ...prev,
      { id: crypto.randomUUID(), celdas: columnas.map(() => '') },
    ])

  const removeFila = (id: string) => {
    if (filas.length <= 1) return
    setFilas((prev) => prev.filter((f) => f.id !== id))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    // Cada tipo arma su contenido: "lista" desde las líneas, "tabla" desde la
    // grilla y el resto desde el textarea.
    let contenido: Record<string, unknown>
    if (tipo === 'lista') {
      const items = lineas
        .map((l) => ({ ...l, texto: l.texto.trim() }))
        .filter((l) => l.texto.length > 0)
      if (items.length === 0) {
        setError('Agregá al menos una línea a la lista.')
        return
      }
      contenido = { items }
    } else if (tipo === 'tabla') {
      // Estructurado, no más texto con pipes: es lo que cierra la asimetría con
      // `ItemList`, que ya leía {columnas, filas} (PLAN_REDISEÑO.md §5.4).
      const grilla: Grilla = { columnas, filas: filas.map((f) => f.celdas) }
      const tabla = contenidoDeGrilla(grilla)
      if (!tabla) {
        setError('Completá al menos una fila de la tabla.')
        return
      }
      contenido = tabla
    } else {
      if (!contenidoTexto.trim()) {
        setError('El contenido no puede estar vacío.')
        return
      }
      contenido = { texto: contenidoTexto.trim() }
    }

    if (temaId === 'new' && !nuevoTemaNombre.trim()) {
      setError('Escribí un nombre para el tema nuevo.')
      return
    }

    if (conRecordatorio && !recordatorioFecha) {
      setError('Elegí una fecha y hora para el recordatorio.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      let temaIdFinal: string | null = temaId === '' ? null : temaId

      if (temaId === 'new') {
        const tema = await createTema(userId, nuevoTemaNombre.trim(), nuevoTemaColor)
        onTemaCreated(tema)
        temaIdFinal = tema.id
      }

      const payload: ItemInsert = {
        user_id: userId,
        tema_id: temaIdFinal,
        tipo,
        prioridad: prioridad === '' ? null : prioridad,
        contenido,
        // Un item que arrancó de una foto sigue siendo de origen 'foto' aunque
        // el usuario lo haya corregido antes de guardar: lo que la columna
        // registra es de dónde salió el contenido, no quién lo tocó último.
        origen: !editingItem && borrador ? borrador.origen : 'manual',
      }

      const saved = editingItem
        ? await updateItem(editingItem.id, payload)
        : await createItem(payload)

      // Sincronizamos el recordatorio según el toggle:
      //  - marcado con fecha → upsert (crea o actualiza, estado 'pendiente')
      //  - desmarcado pero antes existía → eliminarlo
      if (conRecordatorio && recordatorioFecha) {
        await upsertRecordatorio(saved.id, datetimeLocalToIso(recordatorioFecha))
      } else if (!conRecordatorio && teniaRecordatorio) {
        await deleteRecordatoriosForItem(saved.id)
      }

      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando el item')
    } finally {
      setLoading(false)
    }
  }

  return (
    // Sin card propia: desde el ítem 11 el único contenedor de este form es el
    // sheet, que ya aporta la superficie y el padding. El form sólo espacia sus
    // campos.
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="tipo">
            Tipo
          </label>
          <select
            id="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoItem)}
            className="ctl ctl--mono w-full"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="prioridad">
            Prioridad
          </label>
          <select
            id="prioridad"
            value={prioridad}
            onChange={(e) => setPrioridad(e.target.value as Prioridad | '')}
            className="ctl ctl--mono w-full"
          >
            <option value="">Sin prioridad</option>
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="tema">
          Tema
        </label>
        <select
          id="tema"
          value={temaId}
          onChange={(e) => handleTemaChange(e.target.value)}
          className="ctl ctl--mono w-full"
        >
          <option value="">Sin tema</option>
          {temas.map((tema) => (
            <option key={tema.id} value={tema.id}>
              {tema.nombre}
            </option>
          ))}
          <option value="new">+ Crear tema nuevo…</option>
        </select>

        {temaId === 'new' && (
          <input
            type="text"
            value={nuevoTemaNombre}
            onChange={(e) => setNuevoTemaNombre(e.target.value)}
            placeholder="Nombre del tema nuevo"
            className="ctl w-full mt-2"
          />
        )}

        {/* Color del tema. Vive acá y no en una pantalla de "gestionar temas"
            (que no existe) porque este es el único lugar donde el tema ya está
            en pantalla y seleccionado. */}
        {colorActivo && (
          <>
            <div className="tema-colores" role="group" aria-label="Color del tema">
              {COLORES_TEMA.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => handleColorClick(color)}
                  aria-pressed={color === colorActivo}
                  aria-label={TEMA_COLOR_LABEL[color]}
                  title={TEMA_COLOR_LABEL[color]}
                  style={{ background: temaColorVar(color) }}
                  className={`swatch${color === colorActivo ? ' swatch--activa' : ''}`}
                />
              ))}
            </div>
            <p className="tema-colores__nota">
              {temaId === 'new'
                ? 'Color del tema nuevo — se asigna solo, podés cambiarlo'
                : `Color de "${temaSeleccionado?.nombre}" en toda la app — se guarda al instante`}
            </p>
          </>
        )}
      </div>

      <div>
        {tipo === 'tabla' ? (
          // La tabla lleva sus dos acciones de "agregar" en la misma línea que
          // el rótulo: son de la grilla entera, no de una fila ni una columna.
          // Las de quitar, en cambio, van pegadas a lo que quitan.
          <div className="tabla-editor__head">
            <span className="label">Tabla</span>
            <div className="tabla-editor__agregar">
              <button type="button" onClick={addColumna} className="btn-dashed">
                <IconMas />
                Columna
              </button>
              <button type="button" onClick={addFila} className="btn-dashed">
                <IconMas />
                Fila
              </button>
            </div>
          </div>
        ) : (
          <label className="label" htmlFor="contenido">
            {tipo === 'lista' ? 'Líneas de la lista' : 'Contenido'}
          </label>
        )}

        {tipo === 'lista' ? (
          <div className="space-y-2">
            {lineas.map((l, idx) => (
              <div key={l.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={l.texto}
                  onChange={(e) => updateLinea(l.id, e.target.value)}
                  placeholder={`Línea ${idx + 1}`}
                  className="ctl flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeLinea(l.id)}
                  aria-label="Quitar línea"
                  className="btn-linea"
                  disabled={lineas.length === 1}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addLinea} className="btn-ghost">
              + Agregar línea
            </button>
          </div>
        ) : tipo === 'tabla' ? (
          <>
            {/* El scroll horizontal se lo queda el contenedor, no la página:
                mismo criterio que `.item-table-wrap` cuando la tabla se muestra
                en la ficha, para que una grilla ancha no ensanche el sheet. */}
            <div className="tabla-editor__wrap">
              <table className="tabla-editor">
                <thead>
                  <tr>
                    {columnas.map((c, ci) => (
                      <th key={ci}>
                        <div className="tabla-editor__col">
                          <input
                            type="text"
                            value={c}
                            onChange={(e) => updateColumna(ci, e.target.value)}
                            aria-label={`Encabezado de la columna ${ci + 1}`}
                            className="tabla-editor__celda tabla-editor__celda--head"
                          />
                          <button
                            type="button"
                            onClick={() => removeColumna(ci)}
                            disabled={columnas.length === 1}
                            aria-label={`Quitar la columna ${ci + 1}`}
                            title="Quitar columna"
                            className="tabla-editor__quitar"
                          >
                            ×
                          </button>
                        </div>
                      </th>
                    ))}
                    {/* La columna de las × lleva su nombre en aria-label y no
                        en un `.sr-only`: esa utilidad posiciona en absoluto, y
                        adentro de una tabla que scrollea a lo ancho el span
                        aterriza fuera de la página y la ensancha entera. */}
                    <th className="tabla-editor__acciones" aria-label="Quitar fila" />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, ri) => (
                    <tr key={f.id}>
                      {columnas.map((col, ci) => (
                        <td key={ci}>
                          <input
                            type="text"
                            value={f.celdas[ci] ?? ''}
                            onChange={(e) => updateCelda(f.id, ci, e.target.value)}
                            aria-label={`Fila ${ri + 1}, ${col || `columna ${ci + 1}`}`}
                            className="tabla-editor__celda"
                          />
                        </td>
                      ))}
                      <td className="tabla-editor__acciones">
                        <button
                          type="button"
                          onClick={() => removeFila(f.id)}
                          disabled={filas.length === 1}
                          aria-label={`Quitar la fila ${ri + 1}`}
                          title="Quitar fila"
                          className="tabla-editor__quitar"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tabla-editor__nota">
              Editá cada celda directamente. Las filas que queden vacías no se guardan.
            </p>
          </>
        ) : (
          <textarea
            id="contenido"
            value={contenidoTexto}
            onChange={(e) => setContenidoTexto(e.target.value)}
            rows={4}
            className="ctl w-full"
          />
        )}
      </div>

      <div className="rec-toggle">
        <label className="rec-toggle__check">
          <input
            type="checkbox"
            checked={conRecordatorio}
            onChange={(e) => setConRecordatorio(e.target.checked)}
          />
          <span>Agregar recordatorio</span>
        </label>

        {conRecordatorio && (
          <input
            type="datetime-local"
            value={recordatorioFecha}
            onChange={(e) => setRecordatorioFecha(e.target.value)}
            className="ctl ctl--mono mt-2"
            aria-label="Fecha y hora del recordatorio"
          />
        )}
      </div>

      {error && <p className="text-sm text-rust">{error}</p>}

      <div className="flex items-center gap-4">
        <button type="submit" disabled={loading} className="btn-moss">
          {loading ? 'Guardando…' : editingItem ? 'Guardar cambios' : 'Crear item'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </form>
  )
}
