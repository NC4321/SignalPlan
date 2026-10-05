import type { Background, Plan } from '@signalplan/floorplan'
import { useEffect, useState } from 'react'
import type { PlanLibrary } from './library.ts'
import { dataUrlToBlob } from './tracing.ts'

/**
 * Decoded tracing images, by image id or data URL, shared across renders.
 * Only images that loaded are kept, and only while the open plan uses them.
 */
const cache = new Map<string, Promise<ImageBitmap | undefined>>()

/** Images freed by `forgetImagesOutside`, which can no longer be drawn. */
const closed = new WeakSet<ImageBitmap>()

/** After a failed load, try again this many times, waiting longer each time. */
const RETRIES = 3
const RETRY_MS = 1000

function keyOf(background: Background): string | undefined {
  return background.imageId ?? background.dataUrl
}

/** Puts an already-decoded image in the cache, e.g. straight after upload. */
export function rememberImage(key: string, bitmap: ImageBitmap) {
  cache.set(key, Promise.resolve(bitmap))
}

/**
 * Forgets, and frees, the decoded images the plan doesn't use, e.g. after
 * another plan is opened or a floor's image is replaced. One brought back
 * by undo is loaded again from the library.
 */
export function forgetImagesOutside(plan: Plan) {
  const used = new Set<string>()
  for (const floor of plan.floors) {
    const key = floor.background && keyOf(floor.background)
    if (key) used.add(key)
  }
  for (const [key, pending] of cache) {
    if (used.has(key)) continue
    cache.delete(key)
    void pending.then((bitmap) => {
      if (!bitmap) return
      closed.add(bitmap)
      bitmap.close()
    })
  }
}

/** The background's image, decoded; undefined if it couldn't be loaded. */
export function loadImage(
  background: Background,
  library: PlanLibrary | undefined,
): Promise<ImageBitmap | undefined> {
  const key = keyOf(background)
  if (!key) return Promise.resolve(undefined)
  const cached = cache.get(key)
  if (cached) return cached
  const pending = (async () => {
    try {
      const blob = background.imageId
        ? await library?.image(background.imageId)
        : background.dataUrl
          ? dataUrlToBlob(background.dataUrl)
          : undefined
      return blob ? await createImageBitmap(blob) : undefined
    } catch {
      return undefined
    }
  })()
  cache.set(key, pending)
  // A failed load (say a passing storage error) isn't kept, so the next
  // render tries again.
  void pending.then((bitmap) => {
    if (!bitmap && cache.get(key) === pending) cache.delete(key)
  })
  return pending
}

/** The floor's tracing image, decoded and ready to draw. */
export function useBackgroundImage(
  background: Background | undefined,
  library: PlanLibrary | undefined,
): ImageBitmap | undefined {
  const key = background && keyOf(background)
  const [loaded, setLoaded] = useState<{ key: string; bitmap: ImageBitmap }>()
  useEffect(() => {
    if (!background || !key) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = (tries: number) =>
      void loadImage(background, library).then((bitmap) => {
        if (cancelled) return
        if (bitmap) setLoaded({ key, bitmap })
        else if (tries < RETRIES) {
          timer = setTimeout(() => attempt(tries + 1), RETRY_MS * 2 ** tries)
        }
      })
    attempt(0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [background, key, library])
  return loaded && loaded.key === key && !closed.has(loaded.bitmap)
    ? loaded.bitmap
    : undefined
}
