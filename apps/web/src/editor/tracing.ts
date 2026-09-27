import type { Background, Plan, Point } from '@signalplan/floorplan'
import type { Camera } from './camera.ts'
import type { PlanLibrary } from './library.ts'

/** Tracing images (D22). */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
/** Images over this size are accepted with a note that files will be large. */
export const LARGE_IMAGE_BYTES = 10 * 1024 * 1024
/** Images over this size are refused. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export type ImageCheck =
  { ok: true; large: boolean } | { ok: false; reason: string }

export function checkImageFile(file: {
  type: string
  size: number
}): ImageCheck {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return {
      ok: false,
      reason:
        'Use a PNG, JPEG or WebP image. For a PDF, export or screenshot the page first.',
    }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason:
        'This image is over 25 MB. Export a smaller version, or take a screenshot of the plan.',
    }
  }
  return { ok: true, large: file.size > LARGE_IMAGE_BYTES }
}

/**
 * Where a new image first appears: filling most of the current view, until
 * calibration sets its real scale.
 */
export function initialPlacement(
  camera: Camera,
  view: { width: number; height: number },
  image: { widthPx: number; heightPx: number },
): Pick<Background, 'x' | 'y' | 'metresPerPixel'> {
  const viewWidthM = view.width / camera.scale
  const viewHeightM = view.height / camera.scale
  const metresPerPixel = Math.min(
    (viewWidthM * 0.8) / image.widthPx,
    (viewHeightM * 0.8) / image.heightPx,
  )
  const left = -camera.offsetX / camera.scale
  const top = -camera.offsetY / camera.scale
  return {
    x: left + (viewWidthM - image.widthPx * metresPerPixel) / 2,
    y: top + (viewHeightM - image.heightPx * metresPerPixel) / 2,
    metresPerPixel,
  }
}

/**
 * Rescales an image so the two plan points `a` and `b` (clicked on it) end up
 * `realMetres` apart, keeping `a` where it is.
 */
export function calibrate(
  background: Pick<Background, 'x' | 'y' | 'metresPerPixel'>,
  a: Point,
  b: Point,
  realMetres: number,
): Pick<Background, 'x' | 'y' | 'metresPerPixel'> {
  const measured = Math.hypot(b.x - a.x, b.y - a.y)
  const factor = realMetres / measured
  return {
    x: a.x + (background.x - a.x) * factor,
    y: a.y + (background.y - a.y) * factor,
    metresPerPixel: background.metresPerPixel * factor,
  }
}

/** True if a plan point lies on the image. */
export function onImage(background: Background, p: Point): boolean {
  return (
    p.x >= background.x &&
    p.y >= background.y &&
    p.x <= background.x + background.widthPx * background.metresPerPixel &&
    p.y <= background.y + background.heightPx * background.metresPerPixel
  )
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header = '', data = ''] = dataUrl.split(',', 2)
  const type = /^data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream'
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/**
 * A copy of the plan for a file: images referenced from the library are
 * embedded as data URLs, so one file restores everything (D22).
 */
export async function embedImages(
  plan: Plan,
  library: PlanLibrary | undefined,
): Promise<Plan> {
  const floors = await Promise.all(
    plan.floors.map(async (floor) => {
      const { background } = floor
      if (!background?.imageId) return floor
      const blob = await library?.image(background.imageId)
      if (!blob) return floor
      const { imageId: _, ...rest } = background
      return {
        ...floor,
        background: { ...rest, dataUrl: await blobToDataUrl(blob) },
      }
    }),
  )
  return { ...plan, floors }
}

/**
 * The opposite of `embedImages`, for a plan opened from a file: embedded
 * images move into the library and are referenced by id. Without a library
 * they stay embedded.
 */
export async function storeEmbeddedImages(
  plan: Plan,
  library: PlanLibrary | undefined,
): Promise<Plan> {
  if (!library) return plan
  const floors = await Promise.all(
    plan.floors.map(async (floor) => {
      const { background } = floor
      if (!background?.dataUrl) return floor
      const imageId = await library.addImage(dataUrlToBlob(background.dataUrl))
      const { dataUrl: _, ...rest } = background
      return { ...floor, background: { ...rest, imageId } }
    }),
  )
  return { ...plan, floors }
}
