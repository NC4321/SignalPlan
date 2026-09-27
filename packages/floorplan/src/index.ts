export * from './schema.ts'
export { migrate, MigrationError } from './migrate.ts'
export {
  checkStructure,
  loadPlan,
  MIN_WALL_LENGTH_M,
  parsePlan,
  type ParseResult,
  type PlanIssue,
} from './validate.ts'
export {
  materialSegments,
  type MaterialSegment,
  type Point,
} from './geometry.ts'
export {
  addWall,
  collapseShortWalls,
  deleteNode,
  deleteWall,
  fitOpenings,
  fitOpeningsAround,
  JOIN_TOLERANCE_M,
  joinNode,
  mergeCollinearAt,
  mergeNodes,
  moveNodes,
  nextId,
  nodeAt,
  removeOrphanNodes,
  setWallLength,
  splitWall,
} from './edit.ts'
