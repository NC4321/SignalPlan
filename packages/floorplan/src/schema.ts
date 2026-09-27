import * as z from 'zod'

/**
 * Floor plan schema, version 1.
 *
 * Conventions:
 * - All lengths are metres (D4). Display units are a user setting, not part of the plan.
 * - Plan coordinates are x to the right and y downward, matching the canvas.
 * - Walls are segments between shared nodes, plus a material (D5), so moving a
 *   node moves every wall attached to it.
 *
 * Structural rules that Zod alone can't express (references, lengths, overlaps)
 * are checked in `validate.ts`.
 */
export const SCHEMA_VERSION = 1

/** Wall materials. Loss values per band live in the engine, not the plan. */
export const WALL_MATERIALS = [
  'drywall',
  'brick',
  'concrete',
  'glass',
  'low-e-glass',
  'wood',
  'metal',
] as const

/** Opening materials: any wall material, or `open` for a doorway with no door. */
export const OPENING_MATERIALS = [...WALL_MATERIALS, 'open'] as const

export const BANDS = ['2.4GHz', '5GHz', '6GHz'] as const

const id = z.string().min(1).max(64)
const metres = z.number()
const positiveMetres = z.number().positive()

export const wallMaterialSchema = z.enum(WALL_MATERIALS)
export const openingMaterialSchema = z.enum(OPENING_MATERIALS)
export const bandSchema = z.enum(BANDS)

export const nodeSchema = z.object({
  id,
  x: metres,
  y: metres,
})

export const wallSchema = z.object({
  id,
  from: id,
  to: id,
  material: wallMaterialSchema,
})

export const openingSchema = z.object({
  id,
  wallId: id,
  kind: z.enum(['door', 'window']),
  /** Distance from the wall's `from` node to the near edge of the opening. */
  offsetM: z.number().nonnegative(),
  widthM: positiveMetres,
  material: openingMaterialSchema,
})

/**
 * A floor plan image to trace over (D22). In the browser the image is kept
 * in its own store and referenced by `imageId`; saved files embed it as a
 * `dataUrl` so one file restores everything.
 */
export const backgroundSchema = z
  .object({
    imageId: id.optional(),
    dataUrl: z.string().startsWith('data:image/').optional(),
    /** Plan position of the image's top-left corner. */
    x: metres,
    y: metres,
    /** Scale: plan metres per image pixel, set by calibration. */
    metresPerPixel: z.number().positive(),
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
    opacity: z.number().min(0).max(1),
    visible: z.boolean(),
    /** Locked images can't be dragged by accident. */
    locked: z.boolean(),
  })
  .refine((b) => b.imageId !== undefined || b.dataUrl !== undefined, {
    message: 'A background needs an imageId or a dataUrl.',
  })

export const floorSchema = z.object({
  id,
  name: z.string().max(100),
  /** Height of this floor's surface above the lowest floor. */
  elevationM: metres,
  /** Floor-to-ceiling height. */
  heightM: positiveMetres,
  nodes: z.array(nodeSchema),
  walls: z.array(wallSchema),
  openings: z.array(openingSchema),
  background: backgroundSchema.optional(),
})

export const radioSchema = z.object({
  band: bandSchema,
  /**
   * Effective radiated power (EIRP) in dBm, antenna gain included. Omitted
   * means the engine's default for the band.
   */
  txPowerDbm: z.number().min(-10).max(40).optional(),
})

export const accessPointSchema = z.object({
  id,
  name: z.string().max(100),
  floorId: id,
  x: metres,
  y: metres,
  /** Mounting height above this floor's surface. */
  heightM: z.number().nonnegative(),
  radios: z.array(radioSchema).min(1),
})

export const planSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string().max(200),
  floors: z.array(floorSchema).min(1),
  accessPoints: z.array(accessPointSchema),
})

export type WallMaterial = z.infer<typeof wallMaterialSchema>
export type OpeningMaterial = z.infer<typeof openingMaterialSchema>
export type Band = z.infer<typeof bandSchema>
export type PlanNode = z.infer<typeof nodeSchema>
export type Wall = z.infer<typeof wallSchema>
export type Opening = z.infer<typeof openingSchema>
export type Background = z.infer<typeof backgroundSchema>
export type Floor = z.infer<typeof floorSchema>
export type Radio = z.infer<typeof radioSchema>
export type AccessPoint = z.infer<typeof accessPointSchema>
export type Plan = z.infer<typeof planSchema>
