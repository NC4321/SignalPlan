import 'fake-indexeddb/auto'
import type { Background } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { PlanLibrary } from './library.ts'
import { blankPlan } from './persistence.ts'
import {
  blobToDataUrl,
  calibrate,
  checkImageFile,
  dataUrlToBlob,
  embedImages,
  initialPlacement,
  onImage,
  storeEmbeddedImages,
} from './tracing.ts'

const MB = 1024 * 1024

describe('checkImageFile', () => {
  it('accepts PNG, JPEG and WebP, noting large ones', () => {
    expect(checkImageFile({ type: 'image/png', size: MB })).toEqual({
      ok: true,
      large: false,
    })
    expect(checkImageFile({ type: 'image/webp', size: 12 * MB })).toEqual({
      ok: true,
      large: true,
    })
  })

  it('refuses other types and images over 25 MB', () => {
    expect(checkImageFile({ type: 'application/pdf', size: MB }).ok).toBe(false)
    expect(checkImageFile({ type: 'image/jpeg', size: 26 * MB }).ok).toBe(false)
  })
})

describe('initialPlacement', () => {
  it('fits the image into 80% of the view, centred', () => {
    const camera = { scale: 50, offsetX: 0, offsetY: 0 } // 20 m × 10 m view
    const placed = initialPlacement(
      camera,
      { width: 1000, height: 500 },
      { widthPx: 2000, heightPx: 500 },
    )
    expect(placed.metresPerPixel).toBeCloseTo(0.008, 9) // 16 m across
    expect(placed.x).toBeCloseTo(2, 9)
    expect(placed.y).toBeCloseTo(3, 9)
  })
})

describe('calibrate', () => {
  it('scales so the clicked points are the real distance apart, keeping the first', () => {
    const background = { x: 1, y: 1, metresPerPixel: 0.01 }
    const a = { x: 2, y: 1 }
    const b = { x: 4, y: 1 } // 2 m apart as drawn
    const result = calibrate(background, a, b, 5)
    expect(result.metresPerPixel).toBeCloseTo(0.025, 9)
    expect(result.x).toBeCloseTo(-0.5, 9) // a stays at x = 2
    expect(result.y).toBeCloseTo(1, 9)
  })
})

describe('onImage', () => {
  const background: Background = {
    imageId: 'i',
    x: 0,
    y: 0,
    metresPerPixel: 0.01,
    widthPx: 100,
    heightPx: 50,
    opacity: 1,
    visible: true,
    locked: false,
  }
  it('tells whether a point is on the image', () => {
    expect(onImage(background, { x: 0.5, y: 0.25 })).toBe(true)
    expect(onImage(background, { x: 1.5, y: 0.25 })).toBe(false)
  })
})

describe('embedding', () => {
  it('round-trips a blob through a data URL', async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 250, 255])], {
      type: 'image/png',
    })
    const url = await blobToDataUrl(blob)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const back = dataUrlToBlob(url)
    expect(back.type).toBe('image/png')
    expect([...new Uint8Array(await back.arrayBuffer())]).toEqual([
      0, 1, 2, 250, 255,
    ])
  })

  it('embeds library images in files and stores them again on open', async () => {
    const library = (await PlanLibrary.open('embedding'))!
    const imageId = await library.addImage(
      new Blob([new Uint8Array([7, 8, 9])], { type: 'image/webp' }),
    )
    const plan = blankPlan()
    plan.floors[0]!.background = {
      imageId,
      x: 0,
      y: 0,
      metresPerPixel: 0.01,
      widthPx: 3,
      heightPx: 1,
      opacity: 0.5,
      visible: true,
      locked: true,
    }
    const file = await embedImages(plan, library)
    expect(file.floors[0]!.background?.imageId).toBeUndefined()
    expect(file.floors[0]!.background?.dataUrl).toMatch(
      /^data:image\/webp;base64,/,
    )

    const opened = await storeEmbeddedImages(file, library)
    const stored = opened.floors[0]!.background!
    expect(stored.dataUrl).toBeUndefined()
    const blob = await library.image(stored.imageId!)
    expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([7, 8, 9])
    library.close()
  })
})
