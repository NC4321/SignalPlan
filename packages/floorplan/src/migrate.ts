import { SCHEMA_VERSION } from './schema.ts'

/**
 * Upgrades a plan from version N to N + 1. Each migration receives a plan
 * already at its source version and must return one at the next version.
 */
type Migration = (plan: Record<string, unknown>) => Record<string, unknown>

/** Keyed by the version each migration upgrades from. None yet. */
const MIGRATIONS: Partial<Record<number, Migration>> = {}

export class MigrationError extends Error {
  override name = 'MigrationError'
}

/** Brings a raw plan object up to the current schema version. */
export function migrate(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new MigrationError('A plan must be a JSON object.')
  }
  let plan = input as Record<string, unknown>
  const version = plan['schemaVersion']
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new MigrationError('The plan has no valid schemaVersion.')
  }
  if (version > SCHEMA_VERSION) {
    throw new MigrationError(
      `This plan uses schema version ${version}, but this app only understands up to version ${SCHEMA_VERSION}. Update SignalPlan to open it.`,
    )
  }
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) {
      throw new MigrationError(`No migration from schema version ${v}.`)
    }
    plan = { ...step(plan), schemaVersion: v + 1 }
  }
  return plan
}
