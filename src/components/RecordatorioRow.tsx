import {
  ESTADO_LABEL,
  TIPO_LABEL,
  formatFechaHora,
  resumenContenido,
  type EstadoRecordatorio,
} from '../lib/recordatorios'
import { marcaRecurrencia } from '../lib/recurrencia'
import type { RecordatorioConItem } from '../types/database'

// Flecha circular: el símbolo de "esto vuelve". Chico y en el mismo tono que el
// resto del meta — es una marca, no una alerta.
export function IconRepetir() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

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
  // Para 'dias_semana' esto ya viene como "Lun, Mié, Vie" (días traducidos a la
  // zona del usuario); para el resto, "Cada día" / "Cada semana" / "Cada mes".
  const repite = marcaRecurrencia(rec)

  return (
    <li className={`rem rem--${estado}`}>
      <div className="rem__body">
        <div className="rem__meta">
          <span className={`rem__estado rem__estado--${estado}`}>{ESTADO_LABEL[estado]}</span>
          <span className="rem__when">{formatFechaHora(rec.fecha_hora)}</span>
          {/* Lo que distingue un recurrente de uno de una sola vez. Va pegado a
              la fecha porque la califica: no es "el 26 a las 9", es "el 26 a
              las 9 y después cada día". */}
          {repite && (
            <span className="rem__repite" title={repite.titulo}>
              <IconRepetir />
              {repite.corta}
            </span>
          )}
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
          {/* En un recurrente "hecho" cierra ESTA vuelta, no el recordatorio:
              el botón hace lo mismo, pero el título aclara que vuelve. */}
          <button
            onClick={() => onMarcarHecho(rec.id)}
            disabled={marcando}
            className="btn-ghost"
            title={
              repite ? 'Marca hecha esta vez y lo reprograma para la próxima' : undefined
            }
          >
            {marcando ? 'Guardando…' : 'Marcar hecho'}
          </button>
        </div>
      )}
    </li>
  )
}
