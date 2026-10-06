import { describe, expect, it } from 'vitest'
import apartment from '../fixtures/apartment.json' with { type: 'json' }
import lShapedHouse from '../fixtures/l-shaped-house.json' with { type: 'json' }
import sampleHome from '../fixtures/sample-home.json' with { type: 'json' }
import surveyedHome from '../fixtures/surveyed-home.json' with { type: 'json' }
import threeApHome from '../fixtures/three-ap-home.json' with { type: 'json' }
import twoStoreyHome from '../fixtures/two-storey-home.json' with { type: 'json' }
import {
  MAX_COORDINATE_M,
  MAX_FLOOR_HEIGHT_M,
  MAX_MOUNTING_HEIGHT_M,
  PLAN_ELEVATION_RANGE_M,
  SCHEMA_VERSION,
  type Floor,
  type Plan,
} from './schema.ts'
import {
  loadPlan,
  MAX_NODES_PER_FLOOR,
  MAX_OPENINGS_PER_FLOOR,
  MAX_PLAN_SIZE_M,
  MAX_WALLS_PER_FLOOR,
  parsePlan,
  planSizeM,
  type ParseResult,
} from './validate.ts'

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

  it('accepts an optional calibration per band and rejects nonsense (D76)', () => {
    const plan: Plan = {
      ...box(),
      calibration: {
        '5GHz': {
          pathLossExponent: 2.2,
          wallLossDb: { drywall: 4, brick: 12 },
          floorLossDb: { 'timber-joist': 5.5 },
          deviceOffsetDb: -6,
        },
        '2.4GHz': {},
      },
    }
    expect(parsePlan(plan)).toEqual({ ok: true, plan })
    const paths = (calibration: unknown) =>
      issuesOf(parsePlan({ ...box(), calibration })).map((i) => i.path)
    expect(paths({ '5GHz': { pathLossExponent: 0.5 } })).toEqual([
      'calibration.5GHz.pathLossExponent',
    ])
    expect(paths({ '5GHz': { wallLossDb: { drywall: -1 } } })).toEqual([
      'calibration.5GHz.wallLossDb.drywall',
    ])
    expect(paths({ '5GHz': { deviceOffsetDb: 90 } })).toEqual([
      'calibration.5GHz.deviceOffsetDb',
    ])
    expect(paths({ '5GHz': { wallLossDb: { paper: 1 } } })).toHaveLength(1)
    expect(paths({ '7GHz': {} })).toHaveLength(1)
  })

  it('accepts an optional locked flag on access points', () => {
    const plan: Plan = {
      ...box(),
      accessPoints: [
        {
          id: 'ap',
          name: 'Router',
          floorId: box().floors[0]!.id,
          x: 1,
          y: 1,
          heightM: 1,
          radios: [{ band: '5GHz' }],
          locked: true,
        },
      ],
    }
    expect(parsePlan(plan)).toEqual({ ok: true, plan })
    const bad = {
      ...plan,
      accessPoints: [{ ...plan.accessPoints[0]!, locked: 'yes' }],
    }
    expect(issuesOf(parsePlan(bad))[0]?.path).toBe('accessPoints[0].locked')
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

  it('keeps the overlap margin and roaming threshold in range (D64)', () => {
    expect(
      parsePlan({ ...box(), overlapMarginDb: 8, roamThresholdDbm: -70 }).ok,
    ).toBe(true)
    expect(issuesOf(parsePlan({ ...box(), overlapMarginDb: 0 }))[0]?.path).toBe(
      'overlapMarginDb',
    )
    expect(
      issuesOf(parsePlan({ ...box(), roamThresholdDbm: -95 }))[0]?.path,
    ).toBe('roamThresholdDbm')
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

  it('refuses a plan saved in millimetres, saying so', () => {
    const plan = JSON.parse(JSON.stringify(sampleHome)) as Plan
    for (const floor of plan.floors) {
      for (const node of floor.nodes) {
        node.x *= 1000
        node.y *= 1000
      }
      for (const opening of floor.openings) {
        opening.offsetM *= 1000
        opening.widthM *= 1000
      }
    }
    for (const ap of plan.accessPoints) {
      ap.x *= 1000
      ap.y *= 1000
    }
    // It is a valid plan, only far too large.
    expect(parsePlan(plan).ok).toBe(true)
    expect(issuesOf(loadPlan(JSON.stringify(plan)))).toEqual([
      {
        path: '',
        message:
          'This plan is 15 km across. Was it saved in millimetres? SignalPlan opens plans up to 2 km across.',
      },
    ])
  })

  it('opens a plan up to the size limit, and refuses one just past it', () => {
    const plan = box()
    plan.floors[0]!.nodes[1]!.x = MAX_PLAN_SIZE_M
    plan.floors[0]!.nodes[2]!.x = MAX_PLAN_SIZE_M
    expect(planSizeM(plan)).toBe(MAX_PLAN_SIZE_M)
    expect(loadPlan(JSON.stringify(plan)).ok).toBe(true)
    plan.accessPoints[0]!.x = -1
    expect(issuesOf(loadPlan(JSON.stringify(plan)))[0]?.message).toMatch(
      /^This plan is 2.1 km across\. Was it saved in millimetres\?/,
    )
  })
})

describe('bounds on positions and heights (D104)', () => {
  it('opens every fixture, from a file as from a link', () => {
    const fixtures = {
      apartment,
      lShapedHouse,
      sampleHome,
      surveyedHome,
      threeApHome,
      twoStoreyHome,
    }
    for (const [name, fixture] of Object.entries(fixtures)) {
      const result = loadPlan(JSON.stringify(fixture))
      expect(result.ok ? [] : result.issues, name).toEqual([])
    }
  })

  it('refuses a lone corner far from the rest, which the size check alone missed', () => {
    const plan = box()
    plan.floors[0]!.nodes.push({ id: 'far', x: 1e300, y: 0 })
    expect(issuesOf(parsePlan(plan))).toEqual([
      {
        path: 'floors[0].nodes[4].x',
        message:
          'More than 1,000 km from the plan’s origin. SignalPlan opens positions up to 1,000 km from it.',
      },
    ])
  })

  it('opens positions up to 1,000 km from the origin either way', () => {
    const plan = box()
    for (const node of plan.floors[0]!.nodes) node.x -= MAX_COORDINATE_M
    plan.accessPoints[0]!.x -= MAX_COORDINATE_M
    expect(parsePlan(plan).ok).toBe(true)
    plan.accessPoints[0]!.y = MAX_COORDINATE_M + 1
    expect(issuesOf(parsePlan(plan))[0]?.path).toBe('accessPoints[0].y')
  })

  it('bounds every kind of position', () => {
    const far = 1e9
    const cases: [string, (plan: Plan) => void][] = [
      ['floors[0].nodes[0].y', (p) => (p.floors[0]!.nodes[0]!.y = -far)],
      ['accessPoints[0].x', (p) => (p.accessPoints[0]!.x = far)],
      [
        'floors[0].surveySpots[0].x',
        (p) =>
          (p.floors[0]!.surveySpots = [
            { id: 's', x: far, y: 0, readings: [] },
          ]),
      ],
      [
        'floors[0].floorOpenings[0].points[2].y',
        (p) =>
          (p.floors[0]!.floorOpenings = [
            {
              id: 'stairs',
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: far },
              ],
            },
          ]),
      ],
      [
        'floors[0].background.x',
        (p) =>
          (p.floors[0]!.background = {
            dataUrl: 'data:image/png;base64,',
            x: far,
            y: 0,
            metresPerPixel: 0.01,
            widthPx: 10,
            heightPx: 10,
            opacity: 0.5,
            visible: true,
            locked: false,
          }),
      ],
      [
        'neighbourNetworks[0].location.x',
        (p) =>
          (p.neighbourNetworks = [
            {
              id: 'n',
              band: '5GHz',
              channelWidthMHz: 20,
              strengthDbm: -70,
              location: {
                floorId: 'f',
                x: far,
                y: 0,
                heightM: 1,
                eirpDbm: 20,
                uncertaintyM: 2,
              },
            },
          ]),
      ],
    ]
    for (const [path, change] of cases) {
      const plan = box()
      change(plan)
      expect(issuesOf(parsePlan(plan)).map((i) => i.path)).toEqual([path])
    }
  })

  it('bounds elevations, floor heights and mounting heights', () => {
    const cases: [string, (plan: Plan) => void, RegExp][] = [
      [
        'floors[0].elevationM',
        (p) => (p.floors[0]!.elevationM = 1e308),
        /^Elevation is above 1,000 m\. SignalPlan opens elevations from −1,000 m to 1,000 m\.$/,
      ],
      [
        'floors[0].elevationM',
        (p) => (p.floors[0]!.elevationM = PLAN_ELEVATION_RANGE_M.min - 1),
        /^Elevation is below −1,000 m\./,
      ],
      [
        'floors[0].heightM',
        (p) => (p.floors[0]!.heightM = 1e308),
        /^Floor is more than 100 m tall\./,
      ],
      [
        'accessPoints[0].heightM',
        (p) => (p.accessPoints[0]!.heightM = 1e6),
        /^Mounted more than 100 m above its floor\./,
      ],
    ]
    for (const [path, change, message] of cases) {
      const plan = box()
      change(plan)
      const issues = issuesOf(parsePlan(plan))
      expect(issues.map((i) => i.path)).toEqual([path])
      expect(issues[0]!.message).toMatch(message)
    }
  })

  it('opens heights up to the limits', () => {
    const plan = box()
    plan.floors[0]!.elevationM = PLAN_ELEVATION_RANGE_M.max
    plan.floors[0]!.heightM = MAX_FLOOR_HEIGHT_M
    plan.accessPoints[0]!.heightM = MAX_MOUNTING_HEIGHT_M
    expect(parsePlan(plan).ok).toBe(true)
    plan.floors[0]!.elevationM = PLAN_ELEVATION_RANGE_M.min
    expect(parsePlan(plan).ok).toBe(true)
  })

  it('counts where a neighbour was located in the plan’s size', () => {
    const plan = box()
    plan.neighbourNetworks = [
      {
        id: 'n',
        band: '5GHz',
        channelWidthMHz: 20,
        strengthDbm: -70,
        location: {
          floorId: 'f',
          x: 5000,
          y: 0,
          heightM: 1,
          eirpDbm: 20,
          uncertaintyM: 2,
        },
      },
    ]
    expect(parsePlan(plan).ok).toBe(true)
    expect(planSizeM(plan)).toBe(5000)
    expect(issuesOf(loadPlan(JSON.stringify(plan)))[0]?.message).toMatch(
      /^This plan is 5 km across\./,
    )
  })
})

describe('caps on walls, corners and openings per floor (D104)', () => {
  /** A floor of `count` separate 1 m walls, each with its own two corners. */
  function walls(count: number): Plan {
    const plan = box()
    const floor = plan.floors[0]!
    floor.nodes = []
    floor.walls = []
    floor.openings = []
    for (let i = 0; i < count; i++) {
      floor.nodes.push({ id: `a${i}`, x: i * 0.01, y: 0 })
      floor.nodes.push({ id: `b${i}`, x: i * 0.01, y: 1 })
      floor.walls.push({
        id: `w${i}`,
        from: `a${i}`,
        to: `b${i}`,
        material: 'drywall',
      })
    }
    return plan
  }

  it('opens a floor with as many walls as allowed', () => {
    const plan = walls(MAX_WALLS_PER_FLOOR)
    expect(plan.floors[0]!.nodes).toHaveLength(MAX_NODES_PER_FLOOR)
    expect(loadPlan(JSON.stringify(plan)).ok).toBe(true)
  })

  it('refuses one more wall, saying how many there are and may be', () => {
    const plan = walls(MAX_WALLS_PER_FLOOR + 1)
    plan.floors[0]!.nodes = plan.floors[0]!.nodes.slice(0, MAX_NODES_PER_FLOOR)
    expect(issuesOf(loadPlan(JSON.stringify(plan)))).toEqual([
      {
        path: 'floors[0].walls',
        message:
          'Floor has 2,001 walls. SignalPlan opens floors with up to 2,000 walls.',
      },
    ])
  })

  it('refuses too many corners', () => {
    const plan = box()
    for (let i = 0; i < MAX_NODES_PER_FLOOR; i++) {
      plan.floors[0]!.nodes.push({ id: `n${i}`, x: 0, y: 0 })
    }
    expect(issuesOf(parsePlan(plan))).toEqual([
      {
        path: 'floors[0].nodes',
        message:
          'Floor has 4,004 corners. SignalPlan opens floors with up to 4,000 corners.',
      },
    ])
  })

  it('refuses too many doors and windows', () => {
    const plan = box()
    const door = plan.floors[0]!.openings[0]!
    for (let i = 0; i < MAX_OPENINGS_PER_FLOOR; i++) {
      plan.floors[0]!.openings.push({ ...door, id: `o${i}` })
    }
    expect(issuesOf(parsePlan(plan))).toEqual([
      {
        path: 'floors[0].openings',
        message:
          'Floor has 4,001 doors and windows. SignalPlan opens floors with up to 4,000 doors and windows.',
      },
    ])
  })

  it('counts each floor on its own', () => {
    const plan = walls(MAX_WALLS_PER_FLOOR)
    const upper = JSON.parse(JSON.stringify(plan.floors[0]!)) as Floor
    upper.id = 'upper'
    upper.elevationM = 3
    plan.floors.push(upper)
    expect(parsePlan(plan).ok).toBe(true)
  })
})
