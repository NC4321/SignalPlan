// @vitest-environment happy-dom
import type { Background, Plan } from '@signalplan/floorplan'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetImagesOutside,
  loadImage,
  rememberImage,
  useBackgroundImage,
} from './images.ts'
import type { PlanLibrary } from './library.ts'
import { samplePlan } from './persistence.ts'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/** A stand-in for a decoded image, noting when it's closed. */
function fakeBitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>
  }
}

const background = (imageId: string): Background => ({
  imageId,
  x: 0,
  y: 0,
  widthPx: 10,
  heightPx: 10,
  metresPerPixel: 0.01,
  opacity: 0.5,
  visible: true,
  locked: false,
})

/** The sample plan with these tracing images on its floors. */
function planWith(...imageIds: string[]): Plan {
  const plan = samplePlan()
  return {
    ...plan,
    floors: plan.floors.map((floor, i) => ({
      ...floor,
      background: imageIds[i] ? background(imageIds[i]) : undefined,
    })),
  }
}

let image: ReturnType<typeof vi.fn>
let library: PlanLibrary
beforeEach(() => {
  image = vi.fn(async () => new Blob(['x']))
  library = { image } as unknown as PlanLibrary
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => fakeBitmap()),
  )
})
afterEach(() => {
  forgetImagesOutside(planWith())
  vi.unstubAllGlobals()
})

describe('tracing image cache', () => {
  it('decodes an image once and shares it', async () => {
    const first = await loadImage(background('img-a'), library)
    const second = await loadImage(background('img-a'), library)
    expect(first).toBeDefined()
    expect(second).toBe(first)
    expect(image).toHaveBeenCalledTimes(1)
  })

  it('tries again after a load that found nothing', async () => {
    image.mockResolvedValueOnce(undefined)
    expect(await loadImage(background('img-a'), library)).toBeUndefined()
    expect(await loadImage(background('img-a'), library)).toBeDefined()
    expect(image).toHaveBeenCalledTimes(2)
  })

  it('tries again after a load that failed', async () => {
    image.mockRejectedValueOnce(new Error('IndexedDB hiccup'))
    expect(await loadImage(background('img-a'), library)).toBeUndefined()
    expect(await loadImage(background('img-a'), library)).toBeDefined()
    expect(image).toHaveBeenCalledTimes(2)
  })

  it('tries again after an image that would not decode', async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('bad'))
    expect(await loadImage(background('img-a'), library)).toBeUndefined()
    expect(await loadImage(background('img-a'), library)).toBeDefined()
  })

  it('forgets and closes images the open plan no longer uses', async () => {
    const kept = await loadImage(background('img-a'), library)
    const dropped = (await loadImage(background('img-b'), library)) as
      ReturnType<typeof fakeBitmap> | undefined
    const remembered = fakeBitmap()
    rememberImage('img-c', remembered)

    forgetImagesOutside(planWith('img-a'))
    await Promise.resolve()
    expect(dropped?.close).toHaveBeenCalledTimes(1)
    expect(remembered.close).toHaveBeenCalledTimes(1)
    expect((kept as ReturnType<typeof fakeBitmap>).close).not.toHaveBeenCalled()

    // The one still used comes from the cache; a forgotten one loads again.
    expect(await loadImage(background('img-a'), library)).toBe(kept)
    expect(image).toHaveBeenCalledTimes(2)
    expect(await loadImage(background('img-b'), library)).not.toBe(dropped)
    expect(image).toHaveBeenCalledTimes(3)
  })
})

describe('useBackgroundImage', () => {
  /** Renders the hook, returning what it gave on the latest render. */
  function show(at: () => Background | undefined) {
    let seen: ImageBitmap | undefined
    const report = (bitmap: ImageBitmap | undefined) => {
      seen = bitmap
    }
    function Probe(props: {
      background: Background | undefined
      report: typeof report
    }) {
      const bitmap = useBackgroundImage(props.background, library)
      useEffect(() => props.report(bitmap))
      return null
    }
    const root = createRoot(document.createElement('div'))
    const render = () =>
      act(() => root.render(createElement(Probe, { background: at(), report })))
    render()
    return {
      render,
      seen: () => seen,
      stop: () => act(() => root.unmount()),
    }
  }

  it('tries a failed load again shortly, without a reload', async () => {
    vi.useFakeTimers()
    try {
      image.mockRejectedValueOnce(new Error('IndexedDB hiccup'))
      const shown = show(() => background('img-a'))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(shown.seen()).toBeUndefined()
      await act(() => vi.advanceTimersByTimeAsync(1000))
      expect(shown.seen()).toBeDefined()
      expect(image).toHaveBeenCalledTimes(2)
      shown.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never hands out an image that was freed', async () => {
    let current = background('img-a')
    const shown = show(() => current)
    await act(() => Promise.resolve())
    const first = shown.seen()
    expect(first).toBeDefined()

    // The floor's image is replaced by one that can't load, so the plan
    // drops the first; then undo brings it back.
    image.mockResolvedValue(undefined)
    current = background('img-b')
    shown.render()
    forgetImagesOutside(planWith('img-b'))
    await act(() => Promise.resolve())
    expect(first?.close).toHaveBeenCalled()
    current = background('img-a')
    shown.render()
    expect(shown.seen()).not.toBe(first)
    shown.stop()
  })
})
