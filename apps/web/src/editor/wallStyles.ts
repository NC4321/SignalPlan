import type { Point, WallMaterial } from '@signalplan/floorplan'

/**
 * How each wall material is drawn (D17): a colour from the Okabe–Ito palette,
 * which stays distinct with common colour-vision deficiencies, plus a width
 * and pattern so materials can be told apart without colour at all.
 */
export interface WallStyle {
  label: string
  colour: string
  /** Multiple of the base wall width. */
  width: number
  pattern: 'solid' | 'dashed' | 'double' | 'double-dotted' | 'ticks' | 'hatch'
}

export const WALL_STYLES: Record<WallMaterial, WallStyle> = {
  drywall: { label: 'Drywall', colour: '#f5f5f5', width: 1, pattern: 'solid' },
  brick: { label: 'Brick', colour: '#D55E00', width: 1.4, pattern: 'ticks' },
  concrete: {
    label: 'Concrete',
    colour: '#8a8a8a',
    width: 1.8,
    pattern: 'solid',
  },
  wood: { label: 'Wood', colour: '#E69F00', width: 1, pattern: 'dashed' },
  glass: { label: 'Glass', colour: '#56B4E9', width: 1, pattern: 'double' },
  'low-e-glass': {
    label: 'Low-E glass',
    colour: '#0072B2',
    width: 1,
    pattern: 'double-dotted',
  },
  metal: { label: 'Metal', colour: '#CC79A7', width: 1.2, pattern: 'hatch' },
}

/**
 * Draws one wall segment: a dark casing so it reads over any heatmap colour,
 * then the material's colour and pattern inside it.
 */
export function drawWall(
  context: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  style: WallStyle,
  baseWidth: number,
  casing: string,
) {
  const width = baseWidth * style.width
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length === 0) return
  // Unit vectors along and across the wall.
  const ux = (b.x - a.x) / length
  const uy = (b.y - a.y) / length
  const nx = -uy
  const ny = ux

  const line = (
    p: Point,
    q: Point,
    lineWidth: number,
    colour: string,
    dash: number[] = [],
    cap: CanvasLineCap = 'butt',
  ) => {
    context.beginPath()
    context.moveTo(p.x, p.y)
    context.lineTo(q.x, q.y)
    context.lineWidth = lineWidth
    context.strokeStyle = colour
    context.setLineDash(dash)
    context.lineCap = cap
    context.stroke()
  }

  line(a, b, width + 2, casing, [], 'round')

  const inner = Math.max(width - 1.5, 1)
  switch (style.pattern) {
    case 'solid':
    case 'ticks':
    case 'hatch':
      line(a, b, inner, style.colour)
      break
    case 'dashed':
      line(a, b, inner, style.colour, [inner * 1.6, inner * 1.2])
      break
    case 'double':
    case 'double-dotted': {
      const offset = inner / 3
      const thin = Math.max(inner / 4, 0.75)
      for (const side of [-1, 1]) {
        const shift = { x: nx * offset * side, y: ny * offset * side }
        line(
          { x: a.x + shift.x, y: a.y + shift.y },
          { x: b.x + shift.x, y: b.y + shift.y },
          thin,
          style.colour,
        )
      }
      if (style.pattern === 'double-dotted') {
        line(a, b, thin, style.colour, [thin, thin * 3])
      }
      break
    }
  }

  if (style.pattern === 'ticks' || style.pattern === 'hatch') {
    // Short strokes across the wall: sparse for brick, dense diagonal for metal.
    const spacing = style.pattern === 'ticks' ? width * 2.2 : width * 0.9
    const half = inner / 2
    const slant = style.pattern === 'hatch' ? half : 0
    context.setLineDash([])
    context.lineWidth = Math.max(inner / 5, 0.75)
    context.strokeStyle = casing
    context.beginPath()
    for (let d = spacing / 2; d < length; d += spacing) {
      const c = { x: a.x + ux * d, y: a.y + uy * d }
      context.moveTo(c.x - nx * half - ux * slant, c.y - ny * half - uy * slant)
      context.lineTo(c.x + nx * half + ux * slant, c.y + ny * half + uy * slant)
    }
    context.stroke()
  }
  context.setLineDash([])
}
