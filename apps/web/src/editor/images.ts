import type { Background } from '@signalplan/floorplan'
import { useEffect, useState } from 'react'
import type { PlanLibrary } from './library.ts'
import { dataUrlToBlob } from './tracing.ts'

/** Decoded tracing images, by image id or data URL, shared across renders. */
const cache = new Map<string, Promise<ImageBitmap | undefined>>()

function keyOf(background: Background): string | undefined {
  return background.imageId ?? background.dataUrl
}

/** Puts an already-decoded image in the cache, e.g. straight after upload. */
export function rememberImage(key: string, bitmap: ImageBitmap) {
  cache.set(key, Promise.resolve(bitmap))
}

function load(
  background: Background,
  library: PlanLibrary | undefined,
): Promise<ImageBitmap | undefined> {
  const key = keyOf(background)
  if (!key) return Promise.resolve(undefined)
  let pending = cache.get(key)
  if (!pending) {
    pending = (async () => {
      const blob = background.imageId
        ? await library?.image(background.imageId)
        : background.dataUrl
          ? dataUrlToBlob(background.dataUrl)
          : undefined
      return blob ? createImageBitmap(blob).catch(() => undefined) : undefined
    })()
    cache.set(key, pending)
  }
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
    void load(background, library).then((bitmap) => {
      if (!cancelled && bitmap) setLoaded({ key, bitmap })
    })
    return () => {
      cancelled = true
    }
  }, [background, key, library])
  return loaded && loaded.key === key ? loaded.bitmap : undefined
}
