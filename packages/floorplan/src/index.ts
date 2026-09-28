export * from './schema.ts'
export {
  addFloor,
  adjacentFloorId,
  deleteFloor,
  moveFloor,
  SLAB_THICKNESS_M,
  stackedFloors,
} from './floors.ts'
export {
  addFloorOpening,
  deleteFloorOpening,
  MIN_FLOOR_OPENING_AREA_M2,
  moveFloorOpening,
  moveFloorOpeningCorner,
} from './floorOpenings.ts'
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
  openingSpans,
  pointInPolygon,
  polygonArea,
  type MaterialSegment,
  type OpeningSpan,
  type Point,
} from './geometry.ts'
export {
  addAccessPoint,
  deleteAccessPoint,
  EIRP_RANGE_DBM,
  NEW_ACCESS_POINT_HEIGHT_M,
  nextAccessPointName,
  setRadioChannel,
  setRadioOn,
  setRadioPower,
  setRadioWidth,
} from './accessPoints.ts'
export {
  addOpening,
  addWall,
  alongWall,
  collapseShortWalls,
  deleteOpening,
  fitOpeningAt,
  moveOpening,
  setOpeningWidth,
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
