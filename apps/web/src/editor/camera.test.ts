import { describe, expect, it } from 'vitest'
import {
  fitCamera,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  toPlan,
  toScreen,
  zoomAt,
} from './camera.ts'

const bounds = { minX: -1, minY: -1, maxX: 11, maxY: 9 }

describe('fitCamera', () => {
  it('fits the limiting dimension and centres the other', () => {
    const camera = fitCamera(bounds, 632, 400, 16)
    // Height limits: (400 − 32) / 10 m = 36.8 px/m.
    expect(camera.scale).toBeCloseTo(36.8)
    expect(toScreen(camera, { x: -1, y: -1 }).y).toBeCloseTo(16)
    const left = toScreen(camera, { x: -1, y: 0 }).x
    const right = toScreen(camera, { x: 11, y: 0 }).x
    expect(left).toBeCloseTo(632 - right)
  })
})

describe('camera moves', () => {
  const camera = fitCamera(bounds, 800, 600)

  it('round-trips between plan and screen', () => {
    const p = { x: 3.25, y: 7.5 }
    const back = toPlan(camera, toScreen(camera, p))
    expect(back.x).toBeCloseTo(p.x, 9)
    expect(back.y).toBeCloseTo(p.y, 9)
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const cursor = { x: 250, y: 410 }
    const before = toPlan(camera, cursor)
    const after = toPlan(zoomAt(camera, cursor, 1.7), cursor)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('clamps zoom to its limits', () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 1e9).scale).toBe(MAX_SCALE)
    expect(zoomAt(camera, { x: 0, y: 0 }, 1e-9).scale).toBe(MIN_SCALE)
  })

  it('pans in screen pixels', () => {
    const moved = panBy(camera, 10, -5)
    expect(toScreen(moved, { x: 0, y: 0 })).toEqual({
      x: toScreen(camera, { x: 0, y: 0 }).x + 10,
      y: toScreen(camera, { x: 0, y: 0 }).y - 5,
    })
  })
})
