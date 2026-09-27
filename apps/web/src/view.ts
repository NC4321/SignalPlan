import type { Point } from '@signalplan/floorplan'

/** Maps plan metres to canvas pixels: screen = offset + metres · scale. */
export interface View {
  scale: number
  offsetX: number
  offsetY: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** The largest view that fits the bounds inside the canvas, centred. */
export function fitView(
  bounds: Bounds,
  width: number,
  height: number,
  paddingPx = 16,
): View {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const scale = Math.max(
    Math.min((width - 2 * paddingPx) / spanX, (height - 2 * paddingPx) / spanY),
    1e-6,
  )
  return {
    scale,
    offsetX: (width - spanX * scale) / 2 - bounds.minX * scale,
    offsetY: (height - spanY * scale) / 2 - bounds.minY * scale,
  }
}

export const toScreen = (view: View, p: Point): Point => ({
  x: view.offsetX + p.x * view.scale,
  y: view.offsetY + p.y * view.scale,
})

export const toPlan = (view: View, p: Point): Point => ({
  x: (p.x - view.offsetX) / view.scale,
  y: (p.y - view.offsetY) / view.scale,
})
