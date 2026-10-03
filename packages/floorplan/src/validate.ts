import { polygonArea } from './geometry.ts'
import { migrate, MigrationError } from './migrate.ts'
import { planSchema, type Floor, type Plan } from './schema.ts'

/** Walls shorter than this are almost certainly a slip of the mouse. */
export const MIN_WALL_LENGTH_M = 0.01

/** Slack for floating-point comparisons of lengths, in metres. */
const EPSILON_M = 1e-6

export interface PlanIssue {
  /** Where the problem is, such as `floors[0].walls[3].to`. Empty for the whole plan. */
  path: string
  message: string
}

export type ParseResult =
  { ok: true; plan: Plan } | { ok: false; issues: PlanIssue[] }

/** Parses a plan from JSON text: syntax, migration, shape and structure. */
export function loadPlan(json: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    return fail('', `The file is not valid JSON${detail}`)
  }
  return parsePlan(data)
}

/** Parses an already-decoded plan object: migration, shape and structure. */
export function parsePlan(input: unknown): ParseResult {
  let migrated: unknown
  try {
    migrated = migrate(input)
  } catch (error) {
    if (error instanceof MigrationError) return fail('', error.message)
    throw error
  }

  const shape = planSchema.safeParse(migrated)
  if (!shape.success) {
    return {
      ok: false,
      issues: shape.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        message: issue.message,
      })),
    }
  }

  const issues = checkStructure(shape.data)
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, plan: shape.data }
}

/** Rules that span objects: unique ids, references, lengths and overlaps. */
export function checkStructure(plan: Plan): PlanIssue[] {
  const issues: PlanIssue[] = []
  const report = (path: string, message: string) =>
    issues.push({ path, message })

  checkUniqueIds(plan.floors, 'floors', report)
  plan.floors.forEach((floor, f) => checkFloor(floor, `floors[${f}]`, report))

  checkUniqueIds(plan.accessPoints, 'accessPoints', report)
  const floorIds = new Set(plan.floors.map((floor) => floor.id))
  plan.accessPoints.forEach((ap, a) => {
    const path = `accessPoints[${a}]`
    if (!floorIds.has(ap.floorId)) {
      report(`${path}.floorId`, `No floor with id "${ap.floorId}".`)
    }
    const bands = new Set<string>()
    ap.radios.forEach((radio, r) => {
      if (bands.has(radio.band)) {
        report(`${path}.radios[${r}].band`, `Duplicate ${radio.band} radio.`)
      }
      bands.add(radio.band)
    })
  })

  checkUniqueIds(plan.neighbourNetworks ?? [], 'neighbourNetworks', report)
  checkSurvey(plan, report)

  return issues
}

function checkFloor(
  floor: Floor,
  path: string,
  report: (path: string, message: string) => void,
) {
  checkUniqueIds(floor.nodes, `${path}.nodes`, report)
  checkUniqueIds(floor.walls, `${path}.walls`, report)
  checkUniqueIds(floor.openings, `${path}.openings`, report)
  checkUniqueIds(floor.floorOpenings ?? [], `${path}.floorOpenings`, report)
  floor.floorOpenings?.forEach((opening, o) => {
    if (polygonArea(opening.points) < 1e-6) {
      report(`${path}.floorOpenings[${o}]`, 'Floor opening has no area.')
    }
  })

  const nodes = new Map(floor.nodes.map((node) => [node.id, node]))
  const wallLengths = new Map<string, number>()

  floor.walls.forEach((wall, w) => {
    const wallPath = `${path}.walls[${w}]`
    const from = nodes.get(wall.from)
    const to = nodes.get(wall.to)
    if (!from) report(`${wallPath}.from`, `No node with id "${wall.from}".`)
    if (!to) report(`${wallPath}.to`, `No node with id "${wall.to}".`)
    if (!from || !to) return

    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length < MIN_WALL_LENGTH_M) {
      report(wallPath, `Wall is shorter than ${MIN_WALL_LENGTH_M * 100} cm.`)
    }
    wallLengths.set(wall.id, length)
  })

  const openingsByWall = new Map<
    string,
    { index: number; start: number; end: number }[]
  >()
  floor.openings.forEach((opening, o) => {
    const openingPath = `${path}.openings[${o}]`
    const length = wallLengths.get(opening.wallId)
    if (length === undefined) {
      if (!floor.walls.some((wall) => wall.id === opening.wallId)) {
        report(`${openingPath}.wallId`, `No wall with id "${opening.wallId}".`)
      }
      return
    }
    const end = opening.offsetM + opening.widthM
    if (end > length + EPSILON_M) {
      report(
        openingPath,
        `Opening ends ${end.toFixed(2)} m along a wall that is only ${length.toFixed(2)} m long.`,
      )
    }
    const list = openingsByWall.get(opening.wallId) ?? []
    list.push({ index: o, start: opening.offsetM, end })
    openingsByWall.set(opening.wallId, list)
  })

  for (const list of openingsByWall.values()) {
    list.sort((a, b) => a.start - b.start)
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1]!
      const current = list[i]!
      if (current.start < previous.end - EPSILON_M) {
        report(
          `${path}.openings[${current.index}]`,
          `Opening overlaps ${path}.openings[${previous.index}] on the same wall.`,
        )
      }
    }
  }
}

/**
 * Survey spots (D71): ids unique across floors, readings from access points
 * in the plan, one per access point and band; and each BSSID on one radio
 * or one neighbour network (D77).
 */
function checkSurvey(
  plan: Plan,
  report: (path: string, message: string) => void,
) {
  const apIds = new Set(plan.accessPoints.map((ap) => ap.id))
  const spotIds = new Set<string>()
  plan.floors.forEach((floor, f) => {
    floor.surveySpots?.forEach((spot, s) => {
      const path = `floors[${f}].surveySpots[${s}]`
      if (spotIds.has(spot.id)) {
        report(`${path}.id`, `Duplicate id "${spot.id}".`)
      }
      spotIds.add(spot.id)
      const sources = new Set<string>()
      spot.readings.forEach((reading, r) => {
        if (!apIds.has(reading.apId)) {
          report(
            `${path}.readings[${r}].apId`,
            `No access point with id "${reading.apId}".`,
          )
        }
        const source = `${reading.apId} ${reading.band}`
        if (sources.has(source)) {
          report(
            `${path}.readings[${r}]`,
            `Second ${reading.band} reading from "${reading.apId}".`,
          )
        }
        sources.add(source)
      })
    })
  })

  const bssids = new Set<string>()
  const ignored = new Set<string>()
  plan.ignoredBssids?.forEach((bssid, i) => {
    if (ignored.has(bssid)) {
      report(`ignoredBssids[${i}]`, `BSSID ${bssid} is listed twice.`)
    }
    ignored.add(bssid)
  })
  plan.accessPoints.forEach((ap, a) => {
    ap.radios.forEach((radio, r) => {
      radio.bssids?.forEach((bssid, b) => {
        if (bssids.has(bssid)) {
          report(
            `accessPoints[${a}].radios[${r}].bssids[${b}]`,
            `BSSID ${bssid} is on more than one radio.`,
          )
        }
        if (ignored.has(bssid)) {
          report(
            `accessPoints[${a}].radios[${r}].bssids[${b}]`,
            `BSSID ${bssid} is on a radio and also marked not mine.`,
          )
        }
        bssids.add(bssid)
      })
    })
  })
  const neighbours = new Set<string>()
  plan.neighbourNetworks?.forEach((network, n) => {
    const { bssid } = network
    if (bssid === undefined) return
    const path = `neighbourNetworks[${n}].bssid`
    if (neighbours.has(bssid)) {
      report(path, `BSSID ${bssid} is on more than one neighbour network.`)
    }
    if (bssids.has(bssid)) {
      report(path, `BSSID ${bssid} is on a radio and also a neighbour’s.`)
    }
    if (ignored.has(bssid)) {
      report(path, `BSSID ${bssid} is a neighbour’s and also marked not mine.`)
    }
    neighbours.add(bssid)
  })
}

function checkUniqueIds(
  items: readonly { id: string }[],
  path: string,
  report: (path: string, message: string) => void,
) {
  const seen = new Set<string>()
  items.forEach((item, i) => {
    if (seen.has(item.id))
      report(`${path}[${i}].id`, `Duplicate id "${item.id}".`)
    seen.add(item.id)
  })
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((key, i) =>
      typeof key === 'number'
        ? `[${key}]`
        : `${i === 0 ? '' : '.'}${String(key)}`,
    )
    .join('')
}

function fail(path: string, message: string): ParseResult {
  return { ok: false, issues: [{ path, message }] }
}
