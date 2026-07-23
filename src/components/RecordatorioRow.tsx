import {
  ESTADO_LABEL,
  TIPO_LABEL,
  formatFechaHora,
  resumenContenido,
  type EstadoRecordatorio,
} from '../lib/recordatorios'
import type { RecordatorioConItem } from '../types/database'

// La fila de un recordatorio, compartida por /reminders y por la vista Hoy
// (ítem 8). Nació dentro de RemindersPage; se extrajo cuando Hoy necesitó
// mostrar los mismos vencidos con el mismo lomo, el mismo meta y la misma
// acción. El estado clasificado se recibe ya calculado: quién agrupa decide.
export function RecordatorioRow({
  rec,
  estado,
  marcando,
  onMarcarHecho,
}: {
  rec: RecordatorioConItem
  estado: EstadoRecordatorio
  marcando: boolean
  onMarcarHecho: (id: string) => void
}) {
  return (
    <li className={`rem rem--${estado}`}>
      <div className="rem__body">
        <div className="rem__meta">
          <span className={`rem__estado rem__estado--${estado}`}>{ESTADO_LABEL[estado]}</span>
          <span className="rem__when">{formatFechaHora(rec.fecha_hora)}</span>
          {rec.estado === 'enviado' && (
            <span className="rem__notificado" title="Ya te enviamos la notificación">
              ● Notificado
            </span>
          )}
          {rec.item && (
            <span className="rem__tipo">{TIPO_LABEL[rec.item.tipo] ?? rec.item.tipo}</span>
          )}
        </div>
        <p className="rem__contenido">{resumenContenido(rec.item)}</p>
      </div>

      {estado !== 'hecho' && (
        <div className="rem__actions">
          <button onClick={() => onMarcarHecho(rec.id)} disabled={marcando} className="btn-ghost">
            {marcando ? 'Guardando…' : 'Marcar hecho'}
          </button>
        </div>
      )}
    </li>
  )
}
