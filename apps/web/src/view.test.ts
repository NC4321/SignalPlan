import { describe, expect, it } from 'vitest'
import { fitView, toPlan, toScreen } from './view.ts'

describe('fitView', () => {
  const bounds = { minX: -1, minY: -1, maxX: 11, maxY: 9 }

  it('fits the limiting dimension and centres the other', () => {
    const view = fitView(bounds, 632, 400, 16)
    // Height limits: (400 − 32) / 10 m = 36.8 px/m.
    expect(view.scale).toBeCloseTo(36.8)
    expect(toScreen(view, { x: -1, y: -1 }).y).toBeCloseTo(16)
    const left = toScreen(view, { x: -1, y: 0 }).x
    const right = toScreen(view, { x: 11, y: 0 }).x
    expect(left).toBeCloseTo(632 - right)
  })

  it('round-trips between plan and screen', () => {
    const view = fitView(bounds, 800, 600)
    const p = { x: 3.25, y: 7.5 }
    const back = toPlan(view, toScreen(view, p))
    expect(back.x).toBeCloseTo(p.x, 9)
    expect(back.y).toBeCloseTo(p.y, 9)
  })
})
