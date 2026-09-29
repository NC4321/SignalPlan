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

/**
 * What a floor's slab is made of (D49, D50). Loss values live in the engine.
 */
export const FLOOR_MATERIALS = ['timber-joist', 'concrete-slab'] as const

/** The slab assumed when a floor doesn't say (D50). */
export const DEFAULT_FLOOR_MATERIAL: FloorMaterial = 'timber-joist'

/** Opening materials: any wall material, or `open` for a doorway with no door. */
export const OPENING_MATERIALS = [...WALL_MATERIALS, 'open'] as const

export const BANDS = ['2.4GHz', '5GHz', '6GHz'] as const

/**
 * Regulatory regions a plan can follow (D61, D62). Their channels and power
 * limits live in the engine's data file, not the plan.
 */
export const REGIONS = ['US', 'EU'] as const

/** The region assumed when a plan doesn't say: plans made before D62. */
export const DEFAULT_REGION: Region = 'US'

/**
 * Channel widths, in MHz. 320 MHz waits for a primary source for its channel
 * numbers (D62).
 */
export const CHANNEL_WIDTHS = [20, 40, 80, 160] as const

/**
 * Limits for the Overlap view's margin and the Roaming view's threshold
 * (D64); their defaults live in the engine with their source.
 */
export const OVERLAP_MARGIN_RANGE_DB = { min: 1, max: 20 } as const
export const ROAM_THRESHOLD_RANGE_DBM = { min: -90, max: -50 } as const

/** Limits for a neighbour network's typed-in strength (D67). */
export const NEIGHBOUR_STRENGTH_RANGE_DBM = { min: -100, max: -20 } as const

/**
 * Limits for a typed-in survey reading (D71): wide enough for any phone's
 * RSSI, from a spot next to the access point to the edge of reception.
 */
export const SURVEY_READING_RANGE_DBM = { min: -120, max: 0 } as const

/** Signal levels a plan can aim for, named after the heatmap bands (D12). */
export const COVERAGE_TARGETS = ['excellent', 'good', 'fair', 'weak'] as const

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
 * A hole in a floor's slab, such as a stairwell or an atrium (D54): a polygon
 * of at least three corners, in order. Signal crossing the slab inside it
 * pays no floor loss, and its area isn't counted as floor.
 */
export const floorOpeningSchema = z.object({
  id,
  points: z.array(z.object({ x: metres, y: metres })).min(3),
})

/**
 * A signal reading taken at a survey spot (D70, D71): one access point's
 * radio on one band, in dBm, as a phone or analyser shows it.
 */
export const surveyReadingSchema = z.object({
  apId: id,
  band: bandSchema,
  dbm: z
    .number()
    .min(SURVEY_READING_RANGE_DBM.min)
    .max(SURVEY_READING_RANGE_DBM.max),
})

/**
 * A spot where signal was measured (D70, D71), with at most one reading per
 * access point and band. Ids are unique across the whole plan.
 */
export const surveySpotSchema = z.object({
  id,
  x: metres,
  y: metres,
  readings: z.array(surveyReadingSchema),
  note: z.string().max(500).optional(),
})

/** A BSSID, stored lower case with colons, such as `a4:2b:b0:12:34:56`. */
export const bssidSchema = z
  .string()
  .regex(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/, 'Not a BSSID like a4:2b:b0:12:34:56')

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
  /**
   * What this floor's slab is made of: the floor under its rooms, crossed by
   * signal to and from the storey below (D51). Omitted means
   * `DEFAULT_FLOOR_MATERIAL`.
   */
  material: z.enum(FLOOR_MATERIALS).optional(),
  nodes: z.array(nodeSchema),
  walls: z.array(wallSchema),
  openings: z.array(openingSchema),
  /** Holes in this floor's slab (D54). Omitted means none. */
  floorOpenings: z.array(floorOpeningSchema).optional(),
  background: backgroundSchema.optional(),
  /** Where signal was measured on this floor (D71). Omitted means none. */
  surveySpots: z.array(surveySpotSchema).optional(),
})

export const radioSchema = z
  .object({
    band: bandSchema,
    /**
     * Effective radiated power (EIRP) in dBm, antenna gain included. Omitted
     * means the engine's default for the band.
     */
    txPowerDbm: z.number().min(-10).max(40).optional(),
    /**
     * IEEE 802.11 channel number at `channelWidthMHz`, set by hand and fixed
     * for the channel planner (D61, D63). Omitted means the planner chooses.
     * Whether the plan's region allows it is checked by the engine, not here,
     * so a plan keeps its channels when its region changes.
     */
    channel: z.number().int().min(1).max(233).optional(),
    /** Channel width in MHz. Omitted means the planner chooses. */
    channelWidthMHz: z
      .union(CHANNEL_WIDTHS.map((w) => z.literal(w)))
      .optional(),
    /**
     * The BSSIDs this radio broadcasts, one per network name (D71), so
     * imported readings can be matched to it. Omitted means none known.
     */
    bssids: z.array(bssidSchema).min(1).optional(),
  })
  .refine((r) => r.channel === undefined || r.channelWidthMHz !== undefined, {
    message: 'A radio with a channel needs a channel width',
    path: ['channelWidthMHz'],
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
  /**
   * Locked access points can't be moved, by hand or by the optimizer (D40,
   * D43). Omitted means unlocked.
   */
  locked: z.boolean().optional(),
})

/**
 * A network next door, typed in by hand (D61, D67). It has no position: its
 * strength counts everywhere in the home as background interference.
 */
export const neighbourNetworkSchema = z.object({
  id,
  /** A label such as the network's name, to tell rows apart. */
  name: z.string().max(100).optional(),
  band: bandSchema,
  /**
   * IEEE 802.11 channel number at `channelWidthMHz`. Omitted until it's
   * picked, and a network without one isn't counted.
   */
  channel: z.number().int().min(1).max(233).optional(),
  channelWidthMHz: z.union(CHANNEL_WIDTHS.map((w) => z.literal(w))),
  /** Its rough signal in the home, in dBm, as a phone or analyser shows it. */
  strengthDbm: z
    .number()
    .min(NEIGHBOUR_STRENGTH_RANGE_DBM.min)
    .max(NEIGHBOUR_STRENGTH_RANGE_DBM.max),
})

export const planSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string().max(200),
  floors: z.array(floorSchema).min(1),
  accessPoints: z.array(accessPointSchema),
  /** The level the coverage summary counts towards. Omitted means `fair`. */
  coverageTarget: z.enum(COVERAGE_TARGETS).optional(),
  /** Whose channel and power rules apply (D61). Omitted means `DEFAULT_REGION`. */
  region: z.enum(REGIONS).optional(),
  /** Whether 5 GHz DFS channels may be used (D61). Omitted means no. */
  allowDfs: z.boolean().optional(),
  /**
   * The Overlap view counts access points within this many dB of the
   * strongest (D64). Omitted means the engine's default.
   */
  overlapMarginDb: z
    .number()
    .min(OVERLAP_MARGIN_RANGE_DB.min)
    .max(OVERLAP_MARGIN_RANGE_DB.max)
    .optional(),
  /**
   * Below this signal a device looks for another access point, and where none
   * reaches it the Roaming view shows a gap (D64). Omitted means the engine's
   * default.
   */
  roamThresholdDbm: z
    .number()
    .min(ROAM_THRESHOLD_RANGE_DBM.min)
    .max(ROAM_THRESHOLD_RANGE_DBM.max)
    .optional(),
  /** Neighbours' networks, as background interference (D67). Omitted means none. */
  neighbourNetworks: z.array(neighbourNetworkSchema).optional(),
  /**
   * BSSIDs marked "not mine" when importing readings (D72), so later imports
   * skip them without asking. Omitted means none.
   */
  ignoredBssids: z.array(bssidSchema).min(1).optional(),
})

export type WallMaterial = z.infer<typeof wallMaterialSchema>
export type FloorMaterial = (typeof FLOOR_MATERIALS)[number]
export type Region = (typeof REGIONS)[number]
export type ChannelWidth = (typeof CHANNEL_WIDTHS)[number]
export type OpeningMaterial = z.infer<typeof openingMaterialSchema>
export type Band = z.infer<typeof bandSchema>
export type PlanNode = z.infer<typeof nodeSchema>
export type Wall = z.infer<typeof wallSchema>
export type Opening = z.infer<typeof openingSchema>
export type FloorOpening = z.infer<typeof floorOpeningSchema>
export type SurveyReading = z.infer<typeof surveyReadingSchema>
export type SurveySpot = z.infer<typeof surveySpotSchema>
export type Background = z.infer<typeof backgroundSchema>
export type Floor = z.infer<typeof floorSchema>
export type Radio = z.infer<typeof radioSchema>
export type AccessPoint = z.infer<typeof accessPointSchema>
export type NeighbourNetwork = z.infer<typeof neighbourNetworkSchema>
export type CoverageTarget = (typeof COVERAGE_TARGETS)[number]
export type Plan = z.infer<typeof planSchema>
