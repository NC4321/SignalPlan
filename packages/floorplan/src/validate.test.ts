import { describe, expect, it } from 'vitest'
import sampleHome from '../fixtures/sample-home.json' with { type: 'json' }
import { SCHEMA_VERSION, type Plan } from './schema.ts'
import { loadPlan, parsePlan, type ParseResult } from './validate.ts'

/** A one-room plan: a 4 m × 3 m box with a door on the top wall. */
function box(): Plan {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Box',
    floors: [
      {
        id: 'f',
        name: 'Floor',
        elevationM: 0,
        heightM: 2.5,
        nodes: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 4, y: 0 },
          { id: 'c', x: 4, y: 3 },
          { id: 'd', x: 0, y: 3 },
        ],
        walls: [
          { id: 'top', from: 'a', to: 'b', material: 'brick' },
          { id: 'right', from: 'b', to: 'c', material: 'brick' },
          { id: 'bottom', from: 'c', to: 'd', material: 'brick' },
          { id: 'left', from: 'd', to: 'a', material: 'brick' },
        ],
        openings: [
          {
            id: 'door',
            wallId: 'top',
            kind: 'door',
            offsetM: 1,
            widthM: 0.9,
            material: 'wood',
          },
        ],
      },
    ],
    accessPoints: [
      {
        id: 'ap',
        name: 'AP',
        floorId: 'f',
        x: 2,
        y: 1.5,
        heightM: 1,
        radios: [{ band: '5GHz' }],
      },
    ],
  }
}

function issuesOf(result: ParseResult) {
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.issues
}

describe('parsePlan', () => {
  it('accepts the sample home fixture', () => {
    const result = parsePlan(sampleHome)
    expect(result.ok ? [] : result.issues).toEqual([])
  })

  it('accepts a minimal valid plan', () => {
    expect(parsePlan(box())).toEqual({ ok: true, plan: box() })
  })

  it('rejects a plan without a schema version', () => {
    const { schemaVersion: _, ...plan } = box()
    expect(issuesOf(parsePlan(plan))[0]?.message).toMatch(/schemaVersion/)
  })

  it('rejects a plan from a newer version with a helpful message', () => {
    const plan = { ...box(), schemaVersion: SCHEMA_VERSION + 1 }
    expect(issuesOf(parsePlan(plan))[0]?.message).toMatch(/Update SignalPlan/)
  })

  it('rejects non-objects', () => {
    expect(issuesOf(parsePlan([]))[0]?.message).toMatch(/JSON object/)
    expect(issuesOf(parsePlan(null))[0]?.message).toMatch(/JSON object/)
  })

  it('reports shape errors with a readable path', () => {
    const plan = box() as unknown as {
      floors: { walls: { material: string }[] }[]
    }
    plan.floors[0]!.walls[2]!.material = 'cardboard'
    expect(issuesOf(parsePlan(plan))).toEqual([
      expect.objectContaining({ path: 'floors[0].walls[2].material' }),
    ])
  })

  it('rejects non-finite coordinates', () => {
    const plan = box()
    plan.floors[0]!.nodes[0]!.x = Number.POSITIVE_INFINITY
    expect(issuesOf(parsePlan(plan))[0]?.path).toBe('floors[0].nodes[0].x')
  })

  it('accepts an optional coverage target and rejects unknown ones', () => {
    const plan: Plan = { ...box(), coverageTarget: 'good' }
    expect(parsePlan(plan)).toEqual({ ok: true, plan })
    expect(
      issuesOf(parsePlan({ ...box(), coverageTarget: 'poor' }))[0]?.path,
    ).toBe('coverageTarget')
  })

  it('rejects a plan with no floors', () => {
    expect(issuesOf(parsePlan({ ...box(), floors: [] }))[0]?.path).toBe(
      'floors',
    )
  })
})

describe('background images', () => {
  const background = {
    imageId: 'img1',
    x: 0,
    y: 0,
    metresPerPixel: 0.01,
    widthPx: 1000,
    heightPx: 800,
    opacity: 0.5,
    visible: true,
    locked: false,
  }

  it('accepts a background referenced by id or embedded as a data URL', () => {
    const plan = box()
    plan.floors[0]!.background = background
    expect(parsePlan(plan).ok).toBe(true)
    const { imageId: _, ...embedded } = background
    plan.floors[0]!.background = {
      ...embedded,
      dataUrl: 'data:image/png;base64,AAAA',
    }
    expect(parsePlan(plan).ok).toBe(true)
  })

  it('rejects a background with no image', () => {
    const plan = box()
    const { imageId: _, ...noImage } = background
    plan.floors[0]!.background = noImage
    expect(issuesOf(parsePlan(plan))[0]?.message).toMatch(
      /imageId or a dataUrl/,
    )
  })
})

describe('structural checks', () => {
  it('reports walls that reference missing nodes', () => {
    const plan = box()
    plan.floors[0]!.walls[1]!.to = 'nowhere'
    expect(issuesOf(parsePlan(plan))).toEqual([
      { path: 'floors[0].walls[1].to', message: 'No node with id "nowhere".' },
    ])
  })

  it('reports walls that are too short', () => {
    const plan = box()
    plan.floors[0]!.nodes.push({ id: 'e', x: 0.001, y: 0 })
    plan.floors[0]!.walls.push({
      id: 'tiny',
      from: 'a',
      to: 'e',
      material: 'wood',
    })
    expect(issuesOf(parsePlan(plan))[0]?.path).toBe('floors[0].walls[4]')
  })

  it('reports duplicate ids', () => {
    const plan = box()
    plan.floors[0]!.nodes[3]!.id = 'a'
    const issues = issuesOf(parsePlan(plan))
    expect(issues).toContainEqual({
      path: 'floors[0].nodes[3].id',
      message: 'Duplicate id "a".',
    })
  })

  it('reports openings on a missing wall', () => {
    const plan = box()
    plan.floors[0]!.openings[0]!.wallId = 'gone'
    expect(issuesOf(parsePlan(plan))[0]?.path).toBe(
      'floors[0].openings[0].wallId',
    )
  })

  it('reports openings that run past the end of their wall', () => {
    const plan = box()
    plan.floors[0]!.openings[0]!.offsetM = 3.5
    expect(issuesOf(parsePlan(plan))[0]?.message).toMatch(
      /ends 4.40 m along a wall that is only 4.00 m long/,
    )
  })

  it('allows an opening that ends exactly at the end of its wall', () => {
    const plan = box()
    plan.floors[0]!.openings[0]!.offsetM = 3.1
    expect(parsePlan(plan).ok).toBe(true)
  })

  it('reports overlapping openings on the same wall', () => {
    const plan = box()
    plan.floors[0]!.openings.push({
      id: 'window',
      wallId: 'top',
      kind: 'window',
      offsetM: 1.5,
      widthM: 1,
      material: 'glass',
    })
    expect(issuesOf(parsePlan(plan))).toEqual([
      {
        path: 'floors[0].openings[1]',
        message: 'Opening overlaps floors[0].openings[0] on the same wall.',
      },
    ])
  })

  it('reports access points on a missing floor', () => {
    const plan = box()
    plan.accessPoints[0]!.floorId = 'attic'
    expect(issuesOf(parsePlan(plan))[0]?.path).toBe('accessPoints[0].floorId')
  })

  it('reports duplicate radio bands on one access point', () => {
    const plan = box()
    plan.accessPoints[0]!.radios.push({ band: '5GHz', txPowerDbm: 17 })
    expect(issuesOf(parsePlan(plan))[0]?.path).toBe(
      'accessPoints[0].radios[1].band',
    )
  })
})

describe('loadPlan', () => {
  it('parses JSON text', () => {
    expect(loadPlan(JSON.stringify(box())).ok).toBe(true)
  })

  it('reports invalid JSON', () => {
    expect(issuesOf(loadPlan('{ not json'))[0]?.message).toMatch(
      /not valid JSON/,
    )
  })
})
