import { COLORES_TEMA, TEMA_COLOR_LABEL, temaColorVar, type TemaColor } from '../lib/temaColores'

// Las 7 muestras de color de un tema. Puramente presentacional, compartida
// entre el selector de ItemForm y el menú de opciones de Biblioteca (ítem
// "Gestión de temas desde Biblioteca", PLAN_ORGANIZADOR.md) para no
// duplicar el markup ni la paleta en dos lugares.
export function TemaColorSwatches({
  activo,
  onSelect,
}: {
  activo: TemaColor | null
  onSelect: (color: TemaColor) => void
}) {
  return (
    <div className="tema-colores" role="group" aria-label="Color del tema">
      {COLORES_TEMA.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onSelect(color)}
          aria-pressed={color === activo}
          aria-label={TEMA_COLOR_LABEL[color]}
          title={TEMA_COLOR_LABEL[color]}
          style={{ background: temaColorVar(color) }}
          className={`swatch${color === activo ? ' swatch--activa' : ''}`}
        />
      ))}
    </div>
  )
}
