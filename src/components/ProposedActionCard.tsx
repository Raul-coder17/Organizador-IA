import { formatFechaHora, proximaFechaConHora } from '../lib/fechaLocal'
import { fechaLocalDeAccion, primeraVuelta } from '../lib/accionesPropuestas'
import {
  RECURRENCIA_LABEL,
  etiquetaDias,
  parseDiasSemana,
  prepararRecurrencia,
} from '../lib/recurrencia'

// Cuándo va a avisar la primera vez una creación propuesta, o null si no trae
// recordatorio. Se calcula con las MISMAS funciones que van a correr al
// confirmar (`fechaLocalDeAccion` + `prepararRecurrencia` + `primeraVuelta`),
// no con la fecha cruda que mandó el modelo: con "diario" y "días específicos"
// el asistente sólo manda la hora, con días la primera vuelta se corre al
// próximo día marcado, y si la recurrencia arranca vencida `primeraVuelta` la
// corre a su próxima ocurrencia real — exactamente lo que hace
// `aplicarAccionCrear` al guardar. Si la tarjeta mostrara otra cosa, el
// usuario estaría confirmando una fecha distinta de la que se guarda.
export function primeraVezDeAccionCrear(accion: AccionCrear): string | null {
  const local = fechaLocalDeAccion(accion)
  // Una fecha ilegible del modelo no puede tumbar el render de la tarjeta: sin
  // fecha mostrable simplemente no se muestra la línea del recordatorio.
  if (!local || !Number.isFinite(new Date(local).getTime())) return null
  const listo = prepararRecurrencia(
    new Date(local).toISOString(),
    accion.recordatorio_recurrencia ?? null,
    accion.recordatorio_dias,
  )
  return primeraVuelta(listo.fechaIso, listo.recurrencia, listo.diasUtc)
}

// Cómo se lee una repetición propuesta, antes de confirmarla. Para
// 'dias_semana' lo que importa son los días concretos ("los Lun, Mié, Vie"), no
// la palabra "días específicos": es justo lo que el usuario tiene que poder
// revisar. Los días de una propuesta vienen en escala LOCAL, así que se nombran
// directo, sin conversión.
function textoRepeticion(recurrencia: string, dias: number[] | undefined): string {
  if (recurrencia !== 'dias_semana') {
    return RECURRENCIA_LABEL[recurrencia as keyof typeof RECURRENCIA_LABEL]?.toLowerCase() ?? recurrencia
  }
  const limpios = parseDiasSemana(dias)
  return limpios ? `los ${etiquetaDias(limpios)}` : 'días específicos'
}
import type { AccionCrear, AccionEditar, AccionPropuesta } from '../types/assistant'
import type { Item } from '../types/database'

// La tarjeta de preview de una acción propuesta por la IA: qué va a pasar si
// confirmás, con Confirmar / Cancelar.
//
// Vivía dentro de `AssistantDrawer`. Se mudó acá cuando la captura por foto
// (ítem 14) pasó a necesitar el MISMO preview: el principio de la app es que la
// IA nunca escribe directo, y ese principio se sostiene con una sola tarjeta que
// los dos caminos comparten, no con dos tarjetas parecidas que se van separando.
// El drawer la importa igual que antes; no cambió nada de lo que dibuja para el
// chat.

export type EstadoAccion = 'idle' | 'applying' | 'done' | 'cancelled' | 'error'

export interface PendingAction {
  accion: AccionPropuesta
  estado: EstadoAccion
  error?: string
  /** Se aplicó desde "Editar antes de confirmar", así que lo guardado NO es
   *  necesariamente lo que la tarjeta muestra. */
  ajustada?: boolean
}

function contenidoTexto(item: Item): string {
  return typeof item.contenido?.texto === 'string' ? item.contenido.texto : JSON.stringify(item.contenido)
}

function EstadoBadge({
  estado,
  errorMsg,
  ajustada,
}: {
  estado: EstadoAccion
  errorMsg?: string
  ajustada?: boolean
}) {
  // Cuando se guardó desde el formulario, la tarjeta de arriba sigue mostrando
  // lo que la IA PROPUSO, que puede no ser lo que se guardó. Un "✓ Aplicado"
  // pelado encima de esos datos diría que se guardaron ésos. El badge tiene que
  // decir que la versión buena es otra.
  if (estado === 'done' && ajustada)
    return (
      <p className="text-sm text-moss mt-3 font-mono">
        ✓ Guardado con tus ajustes
        <span className="block text-xs text-ink-soft font-sans mt-0.5">
          Lo de arriba es lo que había propuesto la IA; se guardó lo que dejaste en el formulario.
        </span>
      </p>
    )
  if (estado === 'done') return <p className="text-sm text-moss mt-3 font-mono">✓ Aplicado</p>
  if (estado === 'cancelled') return <p className="text-sm text-slate mt-3 font-mono">Cancelado</p>
  if (estado === 'error')
    return <p className="text-sm text-rust mt-3">{errorMsg ?? 'No se pudo aplicar.'}</p>
  return null
}

// Preview de una tabla extraída de una foto. Se dibuja como `<table>` real y no
// como el texto con pipes que después se guarda, por la misma razón por la que
// `ItemList` dibuja tablas de verdad: con pipes sueltos no se ve si las columnas
// quedaron alineadas, y eso es justamente lo que hay que revisar antes de
// confirmar una lectura automática. Reusa `.item-table-wrap` / `.item-table` de
// index.css —las mismas clases con que `ItemList` dibuja una tabla guardada—,
// así el preview se ve exactamente como se va a ver el item una vez creado, con
// su scroll horizontal propio para no romper el ancho en mobile.
function TablaPreview({ columnas, filas }: { columnas?: string[]; filas: string[][] }) {
  return (
    <div className="item-table-wrap mt-1">
      <table className="item-table">
        {columnas && columnas.length > 0 && (
          <thead>
            <tr>
              {columnas.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {filas.map((fila, fi) => (
            <tr key={fi}>
              {fila.map((celda, ci) => (
                <td key={ci}>{celda}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Lo mismo para una edición: la fecha legible que va a quedar, o null si lo que
// vino no se puede leer como fecha.
function fechaCambioRecordatorio(cambios: AccionEditar['cambios']): string | null {
  const local =
    cambios.recordatorio_hora && !cambios.recordatorio_fecha_hora
      ? proximaFechaConHora(cambios.recordatorio_hora)
      : (cambios.recordatorio_fecha_hora ?? null)
  if (!local || !Number.isFinite(new Date(local).getTime())) return null
  return formatFechaHora(local)
}

// La línea "Recordatorio: …" de una creación propuesta, con la fecha REAL que se
// va a guardar y la repetición pegada al lado — no como línea aparte, porque es
// la diferencia entre "una vez" y "para siempre" y el usuario tiene que verla
// ANTES de confirmar.
function RecordatorioLinea({ accion }: { accion: AccionCrear }) {
  const primeraVez = primeraVezDeAccionCrear(accion)
  if (!primeraVez) return null
  return (
    <li>
      <span className="text-ink-soft">Recordatorio:</span> {formatFechaHora(primeraVez)}
      {accion.recordatorio_recurrencia && (
        <>
          {' — se repite '}
          {textoRepeticion(accion.recordatorio_recurrencia, accion.recordatorio_dias)}
        </>
      )}
    </li>
  )
}

export function ProposedActionCard({
  accion,
  estado,
  errorMsg,
  items,
  onConfirm,
  onCancel,
  onEdit,
  ajustada,
  confirmLabel = 'Confirmar',
}: {
  accion: AccionPropuesta
  estado: EstadoAccion
  errorMsg?: string
  /** Ver `PendingAction.ajustada`: cambia el badge final. */
  ajustada?: boolean
  items: Item[]
  onConfirm: () => void
  onCancel: () => void
  /** Abre la propuesta en el formulario real, ya cargada, para ajustarla antes
   *  de que se aplique. Opcional: quien no lo pase se queda con
   *  Confirmar/Cancelar. Sólo se dibuja para create y update — en un borrado no
   *  hay nada que editar, la decisión es sí o no. */
  onEdit?: () => void
  /** El chat dice "Confirmar"; la foto dice "Guardar item". Es la misma acción,
   *  pero en el sheet de foto no hay un mensaje del asistente arriba que le dé
   *  contexto al verbo. */
  confirmLabel?: string
}) {
  const target = 'item_id' in accion ? items.find((it) => it.id === accion.item_id) : undefined
  const resuelto = estado === 'done' || estado === 'cancelled'
  const puedeEditar = Boolean(onEdit) && accion.tipo_accion !== 'delete'

  return (
    <div className="bg-card border border-line border-l-4 border-l-moss rounded-[2px] p-4 text-left">
      {accion.tipo_accion === 'create' && (
        <>
          <p className="text-sm font-medium text-ink mb-2">Vas a crear este item:</p>
          <ul className="text-sm text-ink space-y-0.5">
            <li>
              <span className="text-ink-soft">Tipo:</span> {accion.tipo}
            </li>
            <li>
              <span className="text-ink-soft">Tema:</span> {accion.tema ?? 'sin tema'}
            </li>
            <li>
              <span className="text-ink-soft">Prioridad:</span> {accion.prioridad ?? 'sin prioridad'}
            </li>
            {accion.tipo === 'tabla' && accion.filas && accion.filas.length > 0 ? (
              <li>
                <span className="text-ink-soft">Tabla:</span>
                <TablaPreview columnas={accion.columnas} filas={accion.filas} />
              </li>
            ) : accion.tipo === 'lista' && accion.lineas ? (
              <li>
                <span className="text-ink-soft">Líneas:</span>
                <ul className="list-disc ml-5 mt-1">
                  {accion.lineas.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </li>
            ) : (
              <li className="whitespace-pre-wrap">
                <span className="text-ink-soft">Contenido:</span> {accion.contenido}
              </li>
            )}
            <RecordatorioLinea accion={accion} />
          </ul>
        </>
      )}

      {accion.tipo_accion === 'update' && (
        <>
          <p className="text-sm font-medium text-ink mb-2">Vas a editar este item:</p>
          {target && (
            <p className="text-sm text-ink-soft mb-2 whitespace-pre-wrap">Actual: {contenidoTexto(target)}</p>
          )}
          <ul className="text-sm text-ink space-y-0.5">
            {accion.cambios.tipo && (
              <li>
                <span className="text-ink-soft">Nuevo tipo:</span> {accion.cambios.tipo}
              </li>
            )}
            {'tema' in accion.cambios && (
              <li>
                <span className="text-ink-soft">Nuevo tema:</span> {accion.cambios.tema ?? 'sin tema'}
              </li>
            )}
            {accion.cambios.prioridad && (
              <li>
                <span className="text-ink-soft">Nueva prioridad:</span> {accion.cambios.prioridad}
              </li>
            )}
            {accion.cambios.contenido && (
              <li className="whitespace-pre-wrap">
                <span className="text-ink-soft">Nuevo contenido:</span> {accion.cambios.contenido}
              </li>
            )}
            {accion.cambios.lineas_agregar && (
              <li>
                <span className="text-ink-soft">Agregar líneas:</span>{' '}
                {accion.cambios.lineas_agregar.join(', ')}
              </li>
            )}
            {accion.cambios.lineas_quitar && (
              <li>
                <span className="text-ink-soft">Quitar líneas:</span>{' '}
                {accion.cambios.lineas_quitar.join(', ')}
              </li>
            )}
            {accion.cambios.lineas_marcar_hechas && (
              <li>
                <span className="text-ink-soft">Marcar hechas:</span>{' '}
                {accion.cambios.lineas_marcar_hechas.join(', ')}
              </li>
            )}
            {accion.cambios.lineas_desmarcar && (
              <li>
                <span className="text-ink-soft">Desmarcar:</span>{' '}
                {accion.cambios.lineas_desmarcar.join(', ')}
              </li>
            )}
            {/* Igual que en la creación: con "diario"/"días específicos" el
                asistente manda hora sola, y lo que se muestra es la fecha que
                se va a guardar, no la hora suelta. */}
            {(accion.cambios.recordatorio_fecha_hora ?? accion.cambios.recordatorio_hora) && (
              <li>
                <span className="text-ink-soft">Recordatorio:</span>{' '}
                {fechaCambioRecordatorio(accion.cambios) ?? `a las ${accion.cambios.recordatorio_hora}`}
              </li>
            )}
            {accion.cambios.recordatorio_recurrencia !== undefined && (
              <li>
                <span className="text-ink-soft">Repetición:</span>{' '}
                {accion.cambios.recordatorio_recurrencia
                  ? textoRepeticion(
                      accion.cambios.recordatorio_recurrencia,
                      accion.cambios.recordatorio_dias,
                    )
                  : 'deja de repetirse'}
              </li>
            )}
            {accion.cambios.quitar_recordatorio && (
              <li>
                <span className="text-ink-soft">Recordatorio:</span> quitar
              </li>
            )}
          </ul>
        </>
      )}

      {accion.tipo_accion === 'delete' && (
        <>
          <p className="text-sm font-medium text-ink mb-2">Vas a borrar este item:</p>
          <p className="text-sm text-ink whitespace-pre-wrap">
            {target ? contenidoTexto(target) : `Item ${accion.item_id}`}
          </p>
        </>
      )}

      {resuelto || estado === 'error' ? (
        <EstadoBadge estado={estado} errorMsg={errorMsg} ajustada={ajustada} />
      ) : (
        <>
          <div className="flex items-center gap-4 mt-4">
            <button onClick={onConfirm} disabled={estado === 'applying'} className="btn-moss">
              {estado === 'applying' ? 'Aplicando…' : confirmLabel}
            </button>
            <button onClick={onCancel} disabled={estado === 'applying'} className="btn-ghost">
              Cancelar
            </button>
          </div>
          {/* "Editar" no es una tercera decisión al mismo nivel que
              confirmar/cancelar: es el desvío para cuando la propuesta está bien
              pero no del todo. Va como link y en su propio renglón —el mismo
              tratamiento y el mismo lugar que "Editar antes de guardar" en la
              foto—, así los dos botones de verdad quedan juntos y el renglón no
              se parte en el ancho del drawer. */}
          {puedeEditar && (
            <button
              type="button"
              onClick={onEdit}
              disabled={estado === 'applying'}
              className="link-underline text-sm mt-3 disabled:opacity-60 disabled:cursor-not-allowed disabled:no-underline"
            >
              Editar antes de confirmar
            </button>
          )}
        </>
      )}
    </div>
  )
}
