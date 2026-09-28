import type { Floor, Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  accessPointAt,
  hitTest,
  nudgeRecipe,
  pressGrabsAccessPoint,
  selectionHasLocked,
  snapDraggedNode,
  wallDragDelta,
} from './selectTool.ts'

const floor: Floor = {
  id: 'f',
  name: 'Floor',
  elevationM: 0,
  heightM: 2.5,
  nodes: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 4, y: 0 },
    { id: 'c', x: 4, y: 3 },
  ],
  walls: [
    { id: 'ab', from: 'a', to: 'b', material: 'brick' },
    { id: 'bc', from: 'b', to: 'c', material: 'drywall' },
  ],
  openings: [],
}
// 100 px per metre, origin at the top-left of the canvas.
const camera = { scale: 100, offsetX: 0, offsetY: 0 }
const ap = {
  id: 'ap',
  name: 'AP',
  floorId: 'f',
  x: 2,
  y: 2,
  heightM: 1,
  radios: [],
}

describe('hitTest', () => {
  it('prefers access points, then corners, then walls', () => {
    expect(hitTest(camera, floor, [ap], [], { x: 203, y: 198 })).toEqual({
      kind: 'accessPoint',
      id: 'ap',
    })
    expect(hitTest(camera, floor, [ap], [], { x: 396, y: 4 })).toEqual({
      kind: 'node',
      id: 'b',
    })
    expect(hitTest(camera, floor, [ap], [], { x: 150, y: 5 })).toEqual({
      kind: 'wall',
      id: 'ab',
    })
    expect(hitTest(camera, floor, [ap], [], { x: 150, y: 60 })).toBeUndefined()
  })
})

describe('accessPointAt', () => {
  // The access point is drawn at (200, 200) px; it can be grabbed up to
  // 9 + 8 = 17 px from its centre.
  it('finds an access point within grabbing distance', () => {
    expect(accessPointAt(camera, [ap], { x: 212, y: 212 })).toBe(ap) // 17.0 px
    expect(accessPointAt(camera, [ap], { x: 217, y: 200 })).toBe(ap)
  })

  it('ignores points just out of reach', () => {
    expect(accessPointAt(camera, [ap], { x: 218, y: 200 })).toBeUndefined()
    expect(accessPointAt(camera, [], { x: 200, y: 200 })).toBeUndefined()
  })
})

describe('pressGrabsAccessPoint', () => {
  it('grabs with the wall tool only between chains, and not with Alt', () => {
    expect(pressGrabsAccessPoint('wall', false, false)).toBe(true)
    expect(pressGrabsAccessPoint('wall', true, false)).toBe(false)
    expect(pressGrabsAccessPoint('wall', false, true)).toBe(false)
  })

  it('grabs with the access point, door and window tools', () => {
    for (const tool of ['accessPoint', 'door', 'window'] as const) {
      expect(pressGrabsAccessPoint(tool, false, false)).toBe(true)
      expect(pressGrabsAccessPoint(tool, false, true)).toBe(true)
    }
  })

  it('never grabs while calibrating a tracing image', () => {
    expect(pressGrabsAccessPoint('calibrate', false, false)).toBe(false)
  })
})

describe('wallDragDelta', () => {
  it('moves at right angles to the wall in whole grid steps', () => {
    const delta = wallDragDelta(
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0.7, y: 0.26 },
      'metric',
      false,
    )
    expect(delta.x).toBeCloseTo(0, 9)
    expect(delta.y).toBeCloseTo(0.3, 9)
  })

  it('moves freely with Alt', () => {
    const pointer = { x: 0.7, y: 0.26 }
    expect(
      wallDragDelta({ x: 0, y: 0 }, { x: 4, y: 0 }, pointer, 'metric', true),
    ).toEqual(pointer)
  })
})

describe('snapDraggedNode', () => {
  it('never snaps a corner to itself or its own walls', () => {
    // Dragging c slightly: it must not snap back onto bc or itself.
    const to = snapDraggedNode(
      floor,
      'c',
      { x: 4.02, y: 2.51 },
      {
        scale: 100,
        units: 'metric',
        disabled: false,
      },
    )
    expect(to).toEqual({ x: 4, y: 2.5 })
  })

  it('snaps to another corner', () => {
    const to = snapDraggedNode(
      floor,
      'c',
      { x: 3.96, y: 0.04 },
      {
        scale: 100,
        units: 'metric',
        disabled: false,
      },
    )
    expect(to).toEqual({ x: 4, y: 0 })
  })
})

describe('locked access points (D43)', () => {
  const plan = (): Plan =>
    ({
      schemaVersion: 1,
      name: 'Plan',
      floors: [structuredClone(floor)],
      accessPoints: [
        { ...ap, id: 'free', x: 1, y: 1 },
        { ...ap, id: 'fixed', x: 2, y: 2, locked: true },
      ],
    }) as Plan

  it('nudges the rest of the selection but not a locked one', () => {
    const p = plan()
    nudgeRecipe(
      'f',
      [
        { kind: 'accessPoint', id: 'free' },
        { kind: 'accessPoint', id: 'fixed' },
        { kind: 'node', id: 'a' },
      ],
      { x: 0.5, y: 0 },
    )(p)
    expect(p.accessPoints.map((a) => a.x)).toEqual([1.5, 2])
    expect(p.floors[0]!.nodes[0]).toMatchObject({ x: 0.5, y: 0 })
  })

  it('finds a locked access point in the selection', () => {
    const p = plan()
    expect(selectionHasLocked(p, [{ kind: 'accessPoint', id: 'fixed' }])).toBe(
      true,
    )
    expect(
      selectionHasLocked(p, [
        { kind: 'accessPoint', id: 'free' },
        { kind: 'wall', id: 'fixed' },
      ]),
    ).toBe(false)
  })
})
