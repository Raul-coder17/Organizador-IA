import { formatFechaHora } from '../lib/recordatorios'
import type { AccionPropuesta } from '../types/assistant'
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
}

function contenidoTexto(item: Item): string {
  return typeof item.contenido?.texto === 'string' ? item.contenido.texto : JSON.stringify(item.contenido)
}

function EstadoBadge({ estado, errorMsg }: { estado: EstadoAccion; errorMsg?: string }) {
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

export function ProposedActionCard({
  accion,
  estado,
  errorMsg,
  items,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirmar',
}: {
  accion: AccionPropuesta
  estado: EstadoAccion
  errorMsg?: string
  items: Item[]
  onConfirm: () => void
  onCancel: () => void
  /** El chat dice "Confirmar"; la foto dice "Guardar item". Es la misma acción,
   *  pero en el sheet de foto no hay un mensaje del asistente arriba que le dé
   *  contexto al verbo. */
  confirmLabel?: string
}) {
  const target = 'item_id' in accion ? items.find((it) => it.id === accion.item_id) : undefined
  const resuelto = estado === 'done' || estado === 'cancelled'

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
            {accion.recordatorio_fecha_hora && (
              <li>
                <span className="text-ink-soft">Recordatorio:</span>{' '}
                {formatFechaHora(accion.recordatorio_fecha_hora)}
              </li>
            )}
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
            {accion.cambios.recordatorio_fecha_hora && (
              <li>
                <span className="text-ink-soft">Recordatorio:</span>{' '}
                {formatFechaHora(accion.cambios.recordatorio_fecha_hora)}
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
        <EstadoBadge estado={estado} errorMsg={errorMsg} />
      ) : (
        <div className="flex items-center gap-4 mt-4">
          <button onClick={onConfirm} disabled={estado === 'applying'} className="btn-moss">
            {estado === 'applying' ? 'Aplicando…' : confirmLabel}
          </button>
          <button onClick={onCancel} disabled={estado === 'applying'} className="btn-ghost">
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
