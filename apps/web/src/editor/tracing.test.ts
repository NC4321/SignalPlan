import 'fake-indexeddb/auto'
import type { Background } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { PlanLibrary } from './library.ts'
import { blankPlan } from './persistence.ts'
import {
  createEditorStore,
  heatmapShown,
  tracingHidesHeatmap,
} from './store.ts'
import {
  backgroundRecipe,
  blobToDataUrl,
  calibrate,
  calibrateRecipe,
  checkImageFile,
  dataUrlToBlob,
  embedImages,
  initialPlacement,
  onImage,
  removeBackgroundRecipe,
  replaceBackground,
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

/** A store on a blank plan whose floor has a 200 × 100 px image at 1 cm/px. */
function tracedStore() {
  const plan = blankPlan()
  plan.floors[0]!.background = {
    imageId: 'first',
    x: 1,
    y: 2,
    metresPerPixel: 0.01,
    widthPx: 200,
    heightPx: 100,
    opacity: 0.5,
    visible: true,
    locked: false,
  }
  const store = createEditorStore(plan)
  const floorId = plan.floors[0]!.id
  const background = () => store.getState().plan.floors[0]!.background
  return { store, floorId, background }
}

describe('tracing image edits', () => {
  it('changes opacity, visibility and lock as undoable edits', () => {
    const { store, floorId, background } = tracedStore()
    const state = store.getState()
    state.edit('Hide', backgroundRecipe(floorId, { visible: false }))
    state.edit('Lock', backgroundRecipe(floorId, { locked: true }))
    expect(background()).toMatchObject({ visible: false, locked: true })
    store.getState().undo()
    expect(background()).toMatchObject({ visible: false, locked: false })
    store.getState().undo()
    expect(background()).toMatchObject({ visible: true, locked: false })
  })

  it('makes one opacity drag a single undo step', () => {
    const { store, floorId, background } = tracedStore()
    const state = store.getState()
    state.beginGesture()
    for (const opacity of [0.6, 0.7, 0.8]) {
      state.updateGesture(backgroundRecipe(floorId, { opacity }))
    }
    state.endGesture('Change tracing image opacity')
    expect(background()?.opacity).toBe(0.8)
    expect(store.getState().past).toHaveLength(1)
    store.getState().undo()
    expect(background()?.opacity).toBe(0.5)
  })

  it('calibrates in one step and locks the image', () => {
    const { store, floorId, background } = tracedStore()
    // Points 1 m apart on the image, really 3 m: the scale triples about a.
    store
      .getState()
      .edit(
        'Calibrate',
        calibrateRecipe(floorId, { x: 2, y: 2 }, { x: 3, y: 2 }, 3),
      )
    expect(background()?.metresPerPixel).toBeCloseTo(0.03, 9)
    expect(background()?.x).toBeCloseTo(-1, 9) // 1 m left of a becomes 3 m
    expect(background()?.y).toBeCloseTo(2, 9)
    expect(background()?.locked).toBe(true)
    store.getState().undo()
    expect(background()).toMatchObject({
      x: 1,
      metresPerPixel: 0.01,
      locked: false,
    })
  })

  it('removes the image, and undo brings it back', () => {
    const { store, floorId, background } = tracedStore()
    store.getState().edit('Remove', removeBackgroundRecipe(floorId))
    expect(background()).toBeUndefined()
    store.getState().undo()
    expect(background()?.imageId).toBe('first')
  })
})

describe('replaceBackground', () => {
  const current: Background = {
    imageId: 'first',
    x: 1,
    y: 2,
    metresPerPixel: 0.01,
    widthPx: 200,
    heightPx: 100,
    opacity: 0.3,
    visible: false,
    locked: true,
  }
  const fresh = { x: 5, y: 5, metresPerPixel: 0.02 }

  it('keeps the place and real size of a picture with the same proportions', () => {
    // Twice the resolution: 400 px must still cover 2 m, so 0.5 cm/px.
    const result = replaceBackground(
      current,
      { imageId: 'second' },
      { widthPx: 400, heightPx: 200 },
      fresh,
    )
    expect(result.needsCalibration).toBe(false)
    expect(result.background).toEqual({
      imageId: 'second',
      x: 1,
      y: 2,
      metresPerPixel: 0.005,
      widthPx: 400,
      heightPx: 200,
      opacity: 0.3,
      visible: true,
      locked: true,
    })
  })

  it('places a differently shaped picture afresh, unlocked, to calibrate', () => {
    const result = replaceBackground(
      current,
      { imageId: 'second' },
      { widthPx: 300, heightPx: 300 },
      fresh,
    )
    expect(result.needsCalibration).toBe(true)
    expect(result.background).toMatchObject({
      imageId: 'second',
      ...fresh,
      opacity: 0.3,
      visible: true,
      locked: false,
    })
    expect(result.background.dataUrl).toBeUndefined()
  })
})

describe('heatmap while tracing', () => {
  it('hides it while calibrating, even with something selected', () => {
    const { store } = tracedStore()
    store.getState().select([{ kind: 'accessPoint', id: 'x' }])
    store.getState().setTool('calibrate')
    expect(tracingHidesHeatmap(store.getState())).toBe(true)
  })

  it('hides it on Select with nothing selected while the image shows', () => {
    const { store, floorId } = tracedStore()
    expect(tracingHidesHeatmap(store.getState())).toBe(true)
    expect(heatmapShown(store.getState())).toBe(false)
    // The setting itself is untouched, so the heatmap returns afterwards.
    expect(store.getState().showHeatmap).toBe(true)

    store.getState().edit('Hide', backgroundRecipe(floorId, { visible: false }))
    expect(heatmapShown(store.getState())).toBe(true)
  })

  it('shows it again once something is selected or another tool is picked', () => {
    const { store } = tracedStore()
    const apId = store.getState().plan.accessPoints[0]!.id
    store.getState().select([{ kind: 'accessPoint', id: apId }])
    expect(heatmapShown(store.getState())).toBe(true)
    store.getState().select([])
    store.getState().setTool('wall')
    expect(heatmapShown(store.getState())).toBe(true)
  })

  it('leaves floors without an image, and a switched-off heatmap, alone', () => {
    const plain = createEditorStore(blankPlan())
    expect(tracingHidesHeatmap(plain.getState())).toBe(false)
    expect(heatmapShown(plain.getState())).toBe(true)
    plain.getState().setShowHeatmap(false)
    expect(heatmapShown(plain.getState())).toBe(false)
  })
})
