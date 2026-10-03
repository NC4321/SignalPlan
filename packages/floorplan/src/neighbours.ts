import type { Band, ChannelWidth, NeighbourNetwork, Plan } from './schema.ts'

/**
 * Editing operations on neighbours' networks (D67). Like the access point
 * operations, each mutates the plan it's given, so it works on an Immer draft,
 * and returns false when nothing changed. Widths come from the caller, since
 * the band's usual width depends on the region's rules in the engine.
 */

/** The strength a new network starts at, until the real one is typed in. */
export const NEW_NEIGHBOUR_STRENGTH_DBM = -70

function nextNeighbourId(plan: Plan): string {
  const used = new Set((plan.neighbourNetworks ?? []).map((n) => n.id))
  let n = 1
  while (used.has(`nn${n}`)) n++
  return `nn${n}`
}

function find(plan: Plan, id: string): NeighbourNetwork {
  const network = plan.neighbourNetworks?.find((n) => n.id === id)
  if (!network) throw new Error(`No neighbour network with id "${id}".`)
  return network
}

/**
 * Adds a network on a band at a width, with no channel yet (so it isn't
 * counted until one is picked), and returns its id.
 */
export function addNeighbourNetwork(
  plan: Plan,
  band: Band,
  width: ChannelWidth,
): string {
  const id = nextNeighbourId(plan)
  plan.neighbourNetworks ??= []
  plan.neighbourNetworks.push({
    id,
    band,
    channelWidthMHz: width,
    strengthDbm: NEW_NEIGHBOUR_STRENGTH_DBM,
  })
  return id
}

export function deleteNeighbourNetwork(plan: Plan, id: string): boolean {
  const networks = plan.neighbourNetworks ?? []
  const kept = networks.filter((n) => n.id !== id)
  if (kept.length === networks.length) return false
  if (kept.length === 0) delete plan.neighbourNetworks
  else plan.neighbourNetworks = kept
  return true
}

/** Sets the label, or clears it when blank. */
export function renameNeighbourNetwork(
  plan: Plan,
  id: string,
  name: string,
): boolean {
  const network = find(plan, id)
  const trimmed = name.trim().slice(0, 100)
  if ((network.name ?? '') === trimmed) return false
  if (trimmed === '') delete network.name
  else network.name = trimmed
  return true
}

/** Moves a network to another band at `width`; its channel is cleared. */
export function setNeighbourBand(
  plan: Plan,
  id: string,
  band: Band,
  width: ChannelWidth,
): boolean {
  const network = find(plan, id)
  if (network.band === band) return false
  network.band = band
  network.channelWidthMHz = width
  delete network.channel
  return true
}

/** A new width clears the channel, as it does for a radio (D63). */
export function setNeighbourWidth(
  plan: Plan,
  id: string,
  width: ChannelWidth,
): boolean {
  const network = find(plan, id)
  if (network.channelWidthMHz === width) return false
  network.channelWidthMHz = width
  delete network.channel
  return true
}

export function setNeighbourChannel(
  plan: Plan,
  id: string,
  channel: number | undefined,
): boolean {
  const network = find(plan, id)
  if (network.channel === channel) return false
  if (channel === undefined) delete network.channel
  else network.channel = channel
  return true
}

export function setNeighbourStrength(
  plan: Plan,
  id: string,
  dbm: number,
): boolean {
  const network = find(plan, id)
  if (network.strengthDbm === dbm) return false
  network.strengthDbm = dbm
  return true
}

/**
 * Adds or updates a network from a scan (D77), keyed by its BSSID: an
 * existing network keeps its id and, if it has one, its name. Returns the id.
 */
export function upsertScannedNeighbour(
  plan: Plan,
  id: string | undefined,
  fields: Omit<NeighbourNetwork, 'id'>,
): string {
  const existing = id === undefined ? undefined : find(plan, id)
  if (existing) {
    const name = existing.name ?? fields.name
    Object.assign(existing, fields)
    if (name === undefined) delete existing.name
    else existing.name = name
    if (fields.channel === undefined) delete existing.channel
    return existing.id
  }
  const next = nextNeighbourId(plan)
  plan.neighbourNetworks ??= []
  plan.neighbourNetworks.push({ id: next, ...fields })
  return next
}
