import {
  applyScan,
  applyScanAtSpot,
  parseScan,
  planScan,
  scanDeviceKey,
  setNeighbourLocation,
  type AccessPoint,
  type Plan,
  type ScanChoice,
  type ScanTuning,
  type SurveySpot,
} from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  CCA_DBM,
  neighbourLinks,
  overlapMHz,
  planBandChannels,
} from './channelPlan.ts'
import { gridForFloor } from './coverage.ts'
import { floorAreaMask } from './floorArea.ts'
import { radioTuning } from './interference.ts'
import { bssidSightings, locateSource } from './locate.ts'
import { mulberry32 } from './multiSearch.ts'
import { channelAtWidth } from './regions.ts'
import { predictReadings } from './survey.ts'
import { threeApHome } from './testPlans.ts'

/**
 * Phase 8 exit gate, automated part (D77, D86, #144): the three-AP home
 * with two neighbours at known positions, next door to the downstairs
 * bedroom and to the upstairs access point, scanned at survey spots
 * through the whole Scan your network path: SignalPlan's scan format
 * read by `parseScan`, BSSIDs answered as the dialog would, applied at
 * each spot (D80, D82). The scans' neighbour readings then locate each
 * neighbour (D83) within its stated uncertainty, and with the neighbours
 * located (D84) the channel planner sees them as the true neighbours
 * would be seen: strong only for the access points that hear them at
 * CCA. With spectrum scarce (DFS off, 40 MHz), its plan is the one it
 * gives with the neighbours at their true positions, with no clash left,
 * where counting their strongest strength everywhere leaves a clash at
 * every access point. The channels it picks then are a tie-break between
 * plans that all clash, so they can match the located plan's or not, by
 * the noise; the test doesn't compare them.
 *
 * Readings are the model's own plus 3 dB of seeded Gaussian noise, the
 * scatter calibration leaves (D78), rounded to 0.1 dB, and a BSSID weaker
 * than −95 dBm isn't heard. The neighbours are quiet (2 dBm EIRP), so each
 * is heard at the CCA level by the access point by its wall (by 10 dB) and
 * below it by the others (by 5 dB or more): close calls would make the
 * plan follow the noise, not the method.
 */

/** Plans are plain data. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const BAND = '5GHz' as const
const NOISE_DB = 3
const HEARD_DBM = -95

/** Each access point's 5 GHz BSSID, as its radio knows it. */
const OWN: Record<string, string> = {
  router: 'a4:2b:b0:00:00:51',
  bedroom: 'a4:2b:b0:00:01:51',
  upstairs: 'a4:2b:b0:00:02:51',
}

interface Neighbour {
  name: string
  floorId: string
  x: number
  y: number
  eirpDbm: number
  /** Primary channel and width, as a scan reports them. */
  channel: number
  widthMHz: 80
  /** The device's main and guest BSSIDs, which group as one device. */
  bssids: [string, string]
}

const NEIGHBOURS: Neighbour[] = [
  {
    // Next door, by the downstairs bedroom's west wall.
    name: 'Smith',
    floorId: 'main',
    x: -1,
    y: 9,
    eirpDbm: 2,
    channel: 36,
    widthMHz: 80,
    bssids: ['10:20:30:40:50:60', '12:20:30:40:50:61'],
  },
  {
    // Next door the other side, by the upstairs access point's east wall.
    name: 'Jones',
    floorId: 'up',
    x: 16.5,
    y: 1,
    eirpDbm: 2,
    channel: 149,
    widthMHz: 80,
    bssids: ['20:30:40:50:60:70', '22:30:40:50:60:71'],
  },
]

/** The home with DFS allowed, its typed-in neighbour gone, BSSIDs known. */
function home(): Plan {
  const plan = threeApHome()
  return {
    ...plan,
    allowDfs: true,
    neighbourNetworks: undefined,
    accessPoints: plan.accessPoints.map((ap) => ({
      ...ap,
      radios: ap.radios.map((r) =>
        r.band === BAND ? { ...r, bssids: [OWN[ap.id]!] } : r,
      ),
    })),
  }
}

/** A spot every 2.5 m across each floor, inside its walls. */
function surveySpots(plan: Plan): Map<string, SurveySpot[]> {
  const spots = new Map<string, SurveySpot[]>()
  for (const floor of plan.floors) {
    const grid = gridForFloor(floor, 0.1)
    const inside = floorAreaMask(floor, grid)
    const list: SurveySpot[] = []
    for (let y = 1.3; y < 10; y += 2.5) {
      for (let x = 1.2; x < 15; x += 2.5) {
        const col = Math.floor((x - grid.originX) / grid.cellM)
        const row = Math.floor((y - grid.originY) / grid.cellM)
        if (!inside[row * grid.cols + col]) continue
        list.push({ id: `${floor.id}-${list.length}`, x, y, readings: [] })
      }
    }
    spots.set(floor.id, list)
  }
  return spots
}

/** What each spot's scan hears, from the model with noise. */
function heardAtSpots(plan: Plan, seed: number) {
  const spots = surveySpots(plan)
  const standIns: AccessPoint[] = NEIGHBOURS.map((n) => ({
    id: n.name,
    name: n.name,
    floorId: n.floorId,
    x: n.x,
    y: n.y,
    heightM: 1,
    radios: [{ band: BAND, txPowerDbm: n.eirpDbm }],
  }))
  const sources = [...plan.accessPoints, ...standIns]
  const probe: Plan = {
    ...plan,
    accessPoints: sources,
    floors: plan.floors.map((f) => ({
      ...f,
      surveySpots: spots.get(f.id)!.map((s) => ({
        ...s,
        readings: sources.map((a) => ({ apId: a.id, band: BAND, dbm: -60 })),
      })),
    })),
  }
  const random = mulberry32(seed)
  const noise = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  const heard = new Map<string, Map<string, number>>()
  for (const r of predictReadings(probe)) {
    const dbm = Math.round((r.predictedDbm + NOISE_DB * noise()) * 10) / 10
    if (dbm < HEARD_DBM) continue
    const at = heard.get(r.spotId) ?? new Map<string, number>()
    at.set(r.apId, dbm)
    heard.set(r.spotId, at)
  }
  return { spots, heard }
}

/** SignalPlan's scan format (D79, D81) for what a spot hears. */
function scanOutput(heard: Map<string, number>): string {
  const networks = []
  for (const [apId, dbm] of heard) {
    const own = OWN[apId]
    // Your own networks without a width, so your radios stay on Auto (D80).
    if (own)
      networks.push({
        bssid: own,
        ssid: 'HomeNet',
        band: '5',
        channel: 36,
        dbm,
      })
    const n = NEIGHBOURS.find((x) => x.name === apId)
    if (n) {
      n.bssids.forEach((bssid, i) =>
        networks.push({
          bssid,
          ssid: i === 0 ? n.name : `${n.name}-guest`,
          band: '5',
          channel: n.channel,
          widthMHz: n.widthMHz,
          // The guest network a little weaker, as scans show.
          dbm: i === 0 ? dbm : dbm - 1,
        }),
      )
    }
  }
  return JSON.stringify({ signalplanScan: 1, networks })
}

/** The home after scanning at every spot, as Scan your network does it. */
function scanned(seed: number): Plan {
  const plan = clone(home())
  const tuning: ScanTuning = {
    usualWidth: (band) => radioTuning({ band }, plan.region).widthMHz,
    channelAt: (band, primary, width) =>
      channelAtWidth(plan.region, band, primary, width),
  }
  const answers = new Map<string, ScanChoice>([
    ...Object.entries(OWN).map(
      ([apId, bssid]) => [bssid, { apId }] as [string, ScanChoice],
    ),
    ...NEIGHBOURS.flatMap((n) =>
      n.bssids.map((b) => [b, 'neighbour'] as [string, ScanChoice]),
    ),
  ])
  const { spots, heard } = heardAtSpots(plan, seed)
  for (const [floorId, list] of spots) {
    for (const spot of list) {
      const result = parseScan(scanOutput(heard.get(spot.id) ?? new Map()))
      if (!result.ok) throw new Error('scan unreadable')
      const changes = planScan(plan, result.entries, answers, tuning)
      applyScan(plan, changes)
      applyScanAtSpot(plan, result.entries, changes, {
        floorId,
        x: spot.x,
        y: spot.y,
      })
    }
  }
  return plan
}

/** Each scanned neighbour network located from its device's readings. */
function located(plan: Plan) {
  const result = clone(plan)
  const found = new Map<string, ReturnType<typeof locateSource>>()
  for (const network of plan.neighbourNetworks ?? []) {
    const key = scanDeviceKey(network.bssid!)
    const bssids = NEIGHBOURS.flatMap((n) => n.bssids).filter(
      (b) => scanDeviceKey(b) === key,
    )
    const location = locateSource(
      plan,
      network.band,
      bssidSightings(plan, bssids, network.band),
      { outside: true },
    )
    found.set(network.name!, location)
    if (location) {
      setNeighbourLocation(result, network.id, {
        floorId: location.floorId,
        x: location.x,
        y: location.y,
        heightM: location.heightM,
        eirpDbm: location.eirpDbm,
        uncertaintyM: location.uncertaintyM,
      })
    }
  }
  return { plan: result, found }
}

/** The same scanned plan with each neighbour at its true position. */
function truth(plan: Plan): Plan {
  const result = clone(plan)
  for (const network of result.neighbourNetworks ?? []) {
    const n = NEIGHBOURS.find((x) => x.name === network.name)!
    network.location = {
      floorId: n.floorId,
      x: n.x,
      y: n.y,
      heightM: 1,
      eirpDbm: n.eirpDbm,
      uncertaintyM: 0,
    }
  }
  return result
}

/**
 * Spectrum made scarce, so where the neighbours are decides the plan: DFS
 * off and every 5 GHz radio at 40 MHz by hand, which leaves four channels
 * (38, 46, 151 and 159), each overlapping one neighbour's 80 MHz.
 */
function scarce(plan: Plan): Plan {
  return {
    ...plan,
    allowDfs: false,
    accessPoints: plan.accessPoints.map((ap) => ({
      ...ap,
      radios: ap.radios.map((r) =>
        r.band === BAND ? { ...r, channelWidthMHz: 40 as const } : r,
      ),
    })),
  }
}

const strongFlags = (plan: Plan) =>
  planBandChannels(plan, BAND)!.radios.map((r) => ({
    ap: r.accessPointId,
    strong: r.networks.map((n) => n.strong),
  }))

const choices = (plan: Plan) =>
  planBandChannels(plan, BAND)!.radios.map(
    (r) => `${r.accessPointId} ${r.channel}/${r.widthMHz}`,
  )

describe('Phase 8 exit gate: scan, locate, plan (D86)', () => {
  const seeds = [1, 2, 3]

  it('reads every scan into readings and two neighbour networks', () => {
    const plan = scanned(1)
    const networks = plan.neighbourNetworks!
    expect(networks.map((n) => [n.name, n.channel, n.channelWidthMHz])).toEqual(
      [
        ['Smith', 42, 80],
        ['Jones', 155, 80],
      ],
    )
    // Your radios stay on Auto, since the scans gave them no width.
    for (const ap of plan.accessPoints) {
      expect(ap.radios.find((r) => r.band === BAND)!.channel).toBeUndefined()
    }
    const spots = plan.floors.flatMap((f) => f.surveySpots ?? [])
    // Every 2.5 m: 24 spots on each floor.
    expect(spots.length).toBe(48)
    expect(spots.every((s) => s.readings.length > 0)).toBe(true)
  })

  for (const seed of seeds) {
    it(`locates each neighbour within its uncertainty (seed ${seed})`, () => {
      const { found } = located(scanned(seed))
      for (const n of NEIGHBOURS) {
        const location = found.get(n.name)!
        expect(location, n.name).toBeDefined()
        expect(location.floorId, n.name).toBe(n.floorId)
        expect(
          Math.hypot(location.x - n.x, location.y - n.y),
          n.name,
        ).toBeLessThanOrEqual(location.uncertaintyM)
        // Close enough to tell rooms apart from next door.
        expect(location.uncertaintyM, n.name).toBeLessThan(8)
      }
    })

    it(`plans channels as the true neighbours would have it (seed ${seed})`, () => {
      const plan = scarce(scanned(seed))
      const { plan: withLocations } = located(plan)
      const real = truth(plan)
      // Located, each neighbour is strong for the same access points as at
      // its true position, and the plan is the same, with no clash left.
      expect(strongFlags(withLocations)).toEqual(strongFlags(real))
      expect(choices(withLocations)).toEqual(choices(real))
      const after = planBandChannels(withLocations, BAND)!
      expect(after.clashes).toBe(0)
      // The bedroom stays off Smith's channel and upstairs off Jones's.
      const [smith, jones] = withLocations.neighbourNetworks!
      const on = (apId: string) =>
        after.radios.find((r) => r.accessPointId === apId)!
      expect(
        overlapMHz(BAND, on('bedroom'), {
          channel: smith!.channel!,
          widthMHz: 80,
        }),
      ).toBe(0)
      expect(
        overlapMHz(BAND, on('upstairs'), {
          channel: jones!.channel!,
          widthMHz: 80,
        }),
      ).toBe(0)
      // Counting their strongest strength everywhere instead, each is strong
      // for every access point, and every 40 MHz channel without DFS
      // overlaps one of them: the planner reports a clash per access point.
      expect(
        strongFlags(plan).every(({ strong }) => strong.every(Boolean)),
      ).toBe(true)
      expect(planBandChannels(plan, BAND)!.clashes).toBe(3)
    })
  }

  it('has each neighbour strong where it truly is, and only there', () => {
    const real = truth(scanned(1))
    const at = neighbourLinks(real, BAND, real.accessPoints)
    const cca = CCA_DBM[80]
    const strongAt = (name: string) => {
      const id = real.neighbourNetworks!.find((n) => n.name === name)!.id
      return real.accessPoints
        .filter((_, i) => at.get(id)![i]! >= cca)
        .map((ap) => ap.id)
    }
    // Smith is heard at CCA only by the bedroom by its wall, Jones only by
    // the upstairs access point.
    expect(strongAt('Smith')).toEqual(['bedroom'])
    expect(strongAt('Jones')).toEqual(['upstairs'])
  })
})
