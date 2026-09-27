import type { Point } from '@signalplan/floorplan'

/** Maps plan metres to canvas pixels: screen = offset + metres · scale. */
export interface Camera {
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

/** Zoom limits in pixels per metre. */
export const MIN_SCALE = 5
export const MAX_SCALE = 2000

const clampScale = (scale: number) =>
  Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE)

/** The largest camera that fits the bounds inside the viewport, centred. */
export function fitCamera(
  bounds: Bounds,
  width: number,
  height: number,
  paddingPx = 32,
): Camera {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const scale = clampScale(
    Math.min((width - 2 * paddingPx) / spanX, (height - 2 * paddingPx) / spanY),
  )
  return {
    scale,
    offsetX: (width - spanX * scale) / 2 - bounds.minX * scale,
    offsetY: (height - spanY * scale) / 2 - bounds.minY * scale,
  }
}

export const toScreen = (camera: Camera, p: Point): Point => ({
  x: camera.offsetX + p.x * camera.scale,
  y: camera.offsetY + p.y * camera.scale,
})

export const toPlan = (camera: Camera, p: Point): Point => ({
  x: (p.x - camera.offsetX) / camera.scale,
  y: (p.y - camera.offsetY) / camera.scale,
})

export const panBy = (camera: Camera, dx: number, dy: number): Camera => ({
  ...camera,
  offsetX: camera.offsetX + dx,
  offsetY: camera.offsetY + dy,
})

/** Zooms by `factor`, keeping the plan point under `screen` where it is. */
export function zoomAt(camera: Camera, screen: Point, factor: number): Camera {
  const scale = clampScale(camera.scale * factor)
  const anchor = toPlan(camera, screen)
  return {
    scale,
    offsetX: screen.x - anchor.x * scale,
    offsetY: screen.y - anchor.y * scale,
  }
}
