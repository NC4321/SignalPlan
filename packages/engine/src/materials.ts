import {
  BANDS,
  type Band,
  type FloorMaterial,
  type WallMaterial,
} from '@signalplan/floorplan'
import { BAND_PROFILES, bandSamples } from './bands.ts'
import { slabLossDb, type Layer } from './slab.ts'

export interface Construction {
  /** What the material stands for in a North American home. */
  description: string
  /** Layers from one face of the wall to the other. */
  layers: Layer[]
  /** Upper limit on the loss, for leakage the slab model can't see. */
  maxLossDb?: number
}

const mm = (thickness: number) => thickness / 1000

/**
 * Sheet resistance of the low-E coating, fitted so the model reproduces the
 * 29.7 dB measured through a double-pane low-E window at 6.75 GHz by Shakya et
 * al., "Wideband Penetration Loss through Building Materials and Partitions at
 * 6.75 GHz in FR1(C) and 16.95 GHz in the FR3 Upper Mid-band spectrum",
 * IEEE GLOBECOM 2024, Table II. Real low-E coatings are commonly quoted at
 * roughly 2–20 Ω/sq.
 */
export const LOW_E_SHEET_RESISTANCE_OHMS = 9.1

/**
 * Typical North American constructions for each wall material. Layer
 * properties come from ITU-R P.2040-4 Table 3, except brick, whose conductivity
 * is fitted to a measured wall (`brick-fitted`, see slab.ts). Stud cavities are
 * modelled as air; fibreglass insulation has a permittivity close to 1.
 */
export const CONSTRUCTIONS: Readonly<Record<WallMaterial, Construction>> = {
  drywall: {
    description:
      'Interior partition: 12.7 mm gypsum on both sides of an 89 mm stud cavity',
    layers: [
      { material: 'plasterboard', thicknessM: mm(12.7) },
      { material: 'air', thicknessM: mm(89) },
      { material: 'plasterboard', thicknessM: mm(12.7) },
    ],
  },
  brick: {
    description:
      'Exterior brick veneer: 90 mm brick, 25 mm air gap, 11 mm OSB sheathing, 89 mm insulated cavity, 12.7 mm gypsum',
    layers: [
      { material: 'brick-fitted', thicknessM: mm(90) },
      { material: 'air', thicknessM: mm(25) },
      { material: 'chipboard', thicknessM: mm(11) },
      { material: 'air', thicknessM: mm(89) },
      { material: 'plasterboard', thicknessM: mm(12.7) },
    ],
  },
  concrete: {
    description: 'Poured concrete wall, 200 mm, such as a basement wall',
    layers: [{ material: 'concrete', thicknessM: mm(200) }],
  },
  glass: {
    description: 'Double-glazed window: two 3 mm panes with a 13 mm gap',
    layers: [
      { material: 'glass', thicknessM: mm(3) },
      { material: 'air', thicknessM: mm(13) },
      { material: 'glass', thicknessM: mm(3) },
    ],
  },
  'low-e-glass': {
    description:
      'Double-glazed low-E window: as glass, with a metallic coating on the inner face of the outer pane',
    layers: [
      { material: 'glass', thicknessM: mm(3) },
      {
        sheetResistanceOhms: LOW_E_SHEET_RESISTANCE_OHMS,
        thicknessM: 100e-9,
      },
      { material: 'air', thicknessM: mm(13) },
      { material: 'glass', thicknessM: mm(3) },
    ],
  },
  wood: {
    description: 'Solid-core wood door, 44 mm',
    layers: [{ material: 'wood', thicknessM: mm(44) }],
  },
  metal: {
    description:
      'Steel sheet, 1 mm, such as a steel door or appliance; capped for leakage around its edges',
    layers: [{ material: 'metal', thicknessM: mm(1) }],
    maxLossDb: 40,
  },
}

/**
 * Loss in dB through a construction at normal incidence, averaged over the
 * band's channels so thickness resonances at single frequencies don't dominate.
 */
export function constructionLossDb(
  construction: Construction,
  band: Band,
): number {
  const loss = slabLossDb(construction.layers, bandSamples(BAND_PROFILES[band]))
  return Math.min(loss, construction.maxLossDb ?? Number.POSITIVE_INFINITY)
}

/** Loss in dB per wall crossing, by band and material. Computed once. */
export const MATERIAL_LOSS_DB: Readonly<
  Record<Band, Readonly<Record<WallMaterial, number>>>
> = Object.fromEntries(
  BANDS.map((band) => [
    band,
    Object.fromEntries(
      Object.entries(CONSTRUCTIONS).map(([material, construction]) => [
        material,
        constructionLossDb(construction, band),
      ]),
    ),
  ]),
) as Record<Band, Record<WallMaterial, number>>

export interface FloorConstruction {
  /** What the floor stands for in a home. */
  description: string
  /**
   * Layers from the top of the floor to the ceiling below. Several variants
   * stand for a range of real floors, and their loss is averaged (D50).
   */
  variants: Layer[][]
}

/** OSB subfloor, 23/32 in: IRC Table R503.2.1.1(1) at 16 or 24 in joists. */
const SUBFLOOR_M = mm(18.3)
/** Dry depths of 2×8, 2×10 and 2×12 joists (PS 20-20, Table 3). */
const JOIST_DEPTHS_M = [mm(184), mm(235), mm(286)]
/** 1/2 in gypsum ceiling: IRC Table R702.3.5. */
const CEILING_M = mm(12.7)

/**
 * Floor constructions (D49, D50). Layer properties come from ITU-R P.2040-4
 * Table 3, OSB as chipboard, as in the brick wall. Joist cavities are air: a
 * path crossing a floor mostly passes between joists.
 */
export const FLOOR_CONSTRUCTIONS: Readonly<
  Record<FloorMaterial, FloorConstruction>
> = {
  'timber-joist': {
    description:
      'Timber joist floor: 18.3 mm OSB subfloor, a 2×8, 2×10 or 2×12 joist cavity, and a 12.7 mm gypsum ceiling below',
    variants: JOIST_DEPTHS_M.map((depth) => [
      { material: 'chipboard', thicknessM: SUBFLOOR_M },
      { material: 'air', thicknessM: depth },
      { material: 'plasterboard', thicknessM: CEILING_M },
    ]),
  },
  'concrete-slab': {
    description:
      'Concrete slab, 150 mm, as between apartments or over a basement',
    variants: [[{ material: 'concrete', thicknessM: mm(150) }]],
  },
}

/**
 * Loss in dB through a floor (D49, D60): the power transmission averaged
 * over the band's channels and the floor's variants, as `slabLossDb`
 * averages over channels. Head-on unless given an angle from the normal.
 */
export function floorConstructionLossDb(
  construction: FloorConstruction,
  band: Band,
  angleRad = 0,
): number {
  const samples = bandSamples(BAND_PROFILES[band])
  let sum = 0
  for (const layers of construction.variants) {
    sum += 10 ** (-slabLossDb(layers, samples, angleRad) / 10)
  }
  const mean = sum / construction.variants.length
  return mean > 0 ? -10 * Math.log10(mean) : Number.POSITIVE_INFINITY
}

/** Loss in dB per floor crossing head-on, by band and floor material. */
export const FLOOR_LOSS_DB: Readonly<
  Record<Band, Readonly<Record<FloorMaterial, number>>>
> = Object.fromEntries(
  BANDS.map((band) => [
    band,
    Object.fromEntries(
      Object.entries(FLOOR_CONSTRUCTIONS).map(([material, construction]) => [
        material,
        floorConstructionLossDb(construction, band),
      ]),
    ),
  ]),
) as Record<Band, Record<FloorMaterial, number>>

/**
 * A slab's loss stops growing past this angle from its normal (D60), the
 * top of the 60–75° that D30 suggested for walls. Past it the P.2040 loss
 * climbs steeply towards grazing, where real signal finds other ways round.
 */
export const FLOOR_ANGLE_CAP_DEG = 75

/** Step between angles in a floor's loss table, in degrees. */
export const FLOOR_ANGLE_STEP_DEG = 0.5

/**
 * A floor's loss in dB every `FLOOR_ANGLE_STEP_DEG` from its normal, 0 up
 * to `FLOOR_ANGLE_CAP_DEG`. Read it with `floorLossAtDb`.
 */
export type FloorLossTable = readonly number[]

const floorLossTables = new Map<string, FloorLossTable>()

/**
 * A floor's loss table in one band. Each takes tens of milliseconds, so it's
 * worked out the first time it's needed and kept.
 */
export function floorLossTable(
  band: Band,
  material: FloorMaterial,
): FloorLossTable {
  const key = `${band} ${material}`
  let table = floorLossTables.get(key)
  if (!table) {
    const construction = FLOOR_CONSTRUCTIONS[material]
    table = Array.from(
      { length: FLOOR_ANGLE_CAP_DEG / FLOOR_ANGLE_STEP_DEG + 1 },
      (_, i) =>
        floorConstructionLossDb(
          construction,
          band,
          (i * FLOOR_ANGLE_STEP_DEG * Math.PI) / 180,
        ),
    )
    floorLossTables.set(key, table)
  }
  return table
}

/**
 * A floor's loss for a path `across` metres sideways for every `up` metres
 * it rises: interpolated between the table's angles, and held at the cap
 * beyond.
 */
export function floorLossAtDb(
  table: FloorLossTable,
  across: number,
  up: number,
): number {
  const steps = (Math.atan2(across, up) * 180) / Math.PI / FLOOR_ANGLE_STEP_DEG
  const last = table.length - 1
  if (!(steps < last)) return table[last]!
  const i = Math.floor(steps)
  const below = table[i]!
  return below + (steps - i) * (table[i + 1]! - below)
}
