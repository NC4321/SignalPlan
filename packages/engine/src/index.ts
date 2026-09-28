export { BAND_PROFILES, bandSamples, type BandProfile } from './bands.ts'
export {
  cellCentre,
  DEFAULT_CELL_M,
  evaluateCoverage,
  gridForFloor,
  predictDbm,
  RECEIVER_HEIGHT_M,
  type Coverage,
  type Grid,
} from './coverage.ts'
export {
  floorAreaMask,
  segmentsTouch,
  summariseCoverage,
  type CoverageSummary,
} from './floorArea.ts'
export { crossings, wallLoss, type Crossing } from './crossings.ts'
export {
  CONSTRUCTIONS,
  constructionLossDb,
  LOW_E_SHEET_RESISTANCE_OHMS,
  MATERIAL_LOSS_DB,
  type Construction,
} from './materials.ts'
export { freeSpacePathLoss, SPEED_OF_LIGHT } from './pathLoss.ts'
export {
  betterScore,
  CANDIDATE_SPACING_M,
  candidatePositions,
  createScorer,
  SEARCH_CELL_M,
  WALL_CLEARANCE_M,
  type AccessPointTemplate,
  type PlacementProblem,
  type PlacementScore,
  type Scorer,
} from './placement.ts'
export {
  FITTED_MATERIALS,
  P2040_MATERIALS,
  slabLossDb,
  slabTransmission,
  type FittedMaterial,
  type Layer,
  type P2040Material,
  type Polarisation,
} from './slab.ts'
export {
  ANNEAL_SEED,
  ANNEAL_START_STEP_M,
  ANNEAL_STEPS_PER_AP,
  JUMP_CHANCE,
  MAX_ADDED,
  mulberry32,
  searchHowMany,
  searchMultiPlacement,
  type HowManyProblem,
  type HowManyResult,
  type MultiPlacementProblem,
  type MultiSearchResult,
} from './multiSearch.ts'
export {
  REFINE_COUNT,
  REFINE_STEPS_M,
  SEARCH_BUDGET_MS,
  searchSinglePlacement,
  type SearchOptions,
  type SearchResult,
  type SinglePlacementProblem,
} from './search.ts'
export {
  handlePlacementRequest,
  handleRequest,
  transferables,
  type EngineRequest,
  type EngineResponse,
  type PlacementMessage,
  type PlacementRequest,
} from './worker.ts'
