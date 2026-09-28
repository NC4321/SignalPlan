import { BANDS, type Band, type WallMaterial } from '@signalplan/floorplan'
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
