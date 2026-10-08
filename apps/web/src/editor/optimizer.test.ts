import {
  handlePlacementRequest,
  type FloorShare,
  type PlacementMessage,
  type PlacementRequest,
} from '@signalplan/engine'
import { BANDS, parsePlan, type Plan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import { describe, expect, it } from 'vitest'
import {
  createOptimizer,
  newNames,
  planSearch,
  searchOutcome,
  suggestionFloorLines,
  suggestionSummary,
  suggestionText,
  withSuggestion,
  type SearchJob,
  type SearchWorker,
  type SuggestedMove,
  type Suggestion,
} from './optimizer.ts'
import { createEditorStore } from './store.ts'

function sample(): Plan {
  const result = parsePlan(sampleHome)
  if (!result.ok) throw new Error('fixture is invalid')
  return result.plan
}

/** The sample home with a second access point, optionally locked. */
function twoAccessPoints(locked: boolean[] = [false, false]): Plan {
  const plan = sample()
  plan.accessPoints.push({ ...plan.accessPoints[0]!, id: 'ap2', name: 'Den' })
  plan.accessPoints.forEach((ap, i) => {
    if (locked[i]) ap.locked = true
  })
  return plan
}

const router = { kind: 'accessPoint', id: 'router' } as const
const ALL_BANDS = BANDS.map((band) => ({ band }))

const move = (overrides: Partial<SuggestedMove> = {}): SuggestedMove => ({
  apId: 'router',
  name: 'Router',
  from: { x: 5.6, y: 1.2, floorId: 'main' },
  to: { x: 4, y: 3, floorId: 'main' },
  template: { heightM: 1, radios: [{ band: '5GHz' }] },
  ...overrides,
})

const suggestion = (overrides: Partial<Suggestion> = {}): Suggestion => ({
  moves: [move()],
  band: '5GHz',
  before: 0.729,
  after: 0.915,
  floors: [{ floorId: 'main', before: 0.729, share: 0.915 }],
  beforeWeakestDbm: -80.4,
  weakestDbm: -70.2,
  stoppedEarly: false,
  ...overrides,
})

function ready(job: SearchJob | undefined) {
  if (job?.kind !== 'ready') throw new Error(JSON.stringify(job))
  return job
}

describe('planSearch: find the best spots', () => {
  it('moves unlocked access points on every floor together (D55)', () => {
    const plan = sample()
    plan.floors.push({
      ...plan.floors[0]!,
      id: 'up',
      name: 'Upstairs',
      elevationM: 2.7,
      nodes: [],
      walls: [],
      openings: [],
    })
    plan.accessPoints.push({
      ...plan.accessPoints[0]!,
      id: 'up-ap',
      name: 'Landing',
      floorId: 'up',
    })
    // Shown from the upper floor, which makes no difference.
    const job = ready(planSearch(plan, 'up', '5GHz', []))
    expect(job.label).toBe('Find better spots for 2 access points')
    expect(job.movers.map((m) => [m.apId, m.from?.floorId])).toEqual([
      ['router', 'main'],
      ['up-ap', 'up'],
    ])
    expect(job.request.problem.fixed).toEqual([])
    const howMany = ready(planSearch(plan, 'up', '5GHz', [], 'how-many'))
    expect(howMany.what).toBe('how many access points cover 90% of the home')
    // New ones copy the access point on the floor on show.
    expect(howMany.request.problem.template).toMatchObject({
      heightM: plan.accessPoints[1]!.heightM,
    })
    // Locked upstairs, it stays put and counts.
    plan.accessPoints[1]!.locked = true
    const one = ready(planSearch(plan, 'up', '5GHz', []))
    expect(one.request.kind).toBe('place-one')
    expect(one.request.problem.fixed.map((ap) => ap.id)).toEqual(['up-ap'])
  })

  it('moves the selected access point', () => {
    const job = ready(planSearch(twoAccessPoints(), 'main', '5GHz', [router]))
    expect(job.label).toBe('Find a better spot for Router')
    expect(job.request).toMatchObject({
      kind: 'place-one',
      problem: { current: { x: 5.6, y: 1.2, floorId: 'main' }, minDbm: -67 },
    })
    // The other one stays put.
    expect(job.request.problem.fixed.map((ap) => ap.id)).toEqual(['ap2'])
    expect(job.movers.map((m) => m.apId)).toEqual(['router'])
  })

  it('refuses a locked one, saying how to unlock it', () => {
    const plan = sample()
    plan.accessPoints[0]!.locked = true
    expect(planSearch(plan, 'main', '5GHz', [router])).toEqual({
      kind: 'unavailable',
      reason: 'Router is locked. Untick Locked to let it move.',
    })
  })

  it('refuses one without a radio on the band', () => {
    const plan = sample()
    plan.accessPoints[0]!.radios = [{ band: '2.4GHz' }]
    expect(planSearch(plan, 'main', '5GHz', [router])).toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining('doesn’t broadcast on 5 GHz') as string,
    })
  })

  it('needs an access point, not a wall, when something is selected', () => {
    const job = planSearch(sample(), 'main', '5GHz', [
      { kind: 'wall', id: 'w1' },
    ])
    expect(job?.kind).toBe('unavailable')
  })

  it('with nothing selected, moves every unlocked one together (D45)', () => {
    const job = ready(planSearch(twoAccessPoints(), 'main', '5GHz', []))
    expect(job.label).toBe('Find better spots for 2 access points')
    expect(job.what).toBe('spots for 2 access points')
    expect(job.request).toMatchObject({ kind: 'place-many' })
    if (job.request.kind !== 'place-many') throw new Error()
    expect(job.request.problem.add).toBe(0)
    expect(job.request.problem.moving.map((ap) => ap.id)).toEqual([
      'router',
      'ap2',
    ])
    expect(job.request.problem.fixed).toEqual([])
  })

  it('with one unlocked, moves just that one, the locked one fixed', () => {
    const job = ready(
      planSearch(twoAccessPoints([true, false]), 'main', '5GHz', []),
    )
    expect(job.request.kind).toBe('place-one')
    expect(job.movers.map((m) => m.apId)).toEqual(['ap2'])
    expect(job.request.problem.fixed.map((ap) => ap.id)).toEqual(['router'])
  })

  it('leaves unlocked ones off the band where they are', () => {
    const plan = twoAccessPoints()
    plan.accessPoints[1]!.radios = [{ band: '2.4GHz' }]
    const job = ready(planSearch(plan, 'main', '5GHz', []))
    expect(job.movers.map((m) => m.apId)).toEqual(['router'])
  })

  it('with every access point locked, says so', () => {
    expect(
      planSearch(twoAccessPoints([true, true]), 'main', '5GHz', []),
    ).toMatchObject({ kind: 'unavailable' })
  })

  it('adds one, with the tool’s settings, when the floor has none', () => {
    const plan = sample()
    plan.accessPoints = []
    plan.coverageTarget = 'good'
    const job = ready(planSearch(plan, 'main', '5GHz', []))
    expect(job.label).toBe('Find the best spot for an access point')
    expect(job.request.problem.minDbm).toBe(-60)
    expect(job.request.problem.template).toEqual({
      heightM: 1,
      radios: ALL_BANDS,
    })
    expect(job.movers).toMatchObject([
      { apId: undefined, name: 'Access point 1', from: undefined },
    ])
  })
})

describe('planSearch: one more access point (D45)', () => {
  it('adds a copy of the first one and lets the unlocked ones move', () => {
    const plan = sample()
    plan.accessPoints[0]!.heightM = 2.1
    plan.accessPoints[0]!.radios = [{ band: '5GHz', txPowerDbm: 20 }]
    const job = ready(planSearch(plan, 'main', '5GHz', [], 'one-more'))
    expect(job.label).toBe('Suggest one more access point')
    if (job.request.kind !== 'place-many') throw new Error()
    expect(job.request.problem).toMatchObject({
      add: 1,
      template: { heightM: 2.1, radios: [{ band: '5GHz', txPowerDbm: 20 }] },
    })
    expect(job.request.problem.moving.map((ap) => ap.id)).toEqual(['router'])
    expect(job.movers.map((m) => m.name)).toEqual(['Router', 'Access point 1'])
  })

  it('keeps locked ones fixed and copies the first on the band', () => {
    const plan = twoAccessPoints([true, true])
    plan.accessPoints[0]!.radios = [{ band: '2.4GHz' }]
    plan.accessPoints[1]!.heightM = 1.8
    const job = ready(planSearch(plan, 'main', '5GHz', [], 'one-more'))
    if (job.request.kind !== 'place-many') throw new Error()
    expect(job.request.problem.moving).toEqual([])
    expect(job.request.problem.fixed).toHaveLength(2)
    expect(job.request.problem.template.heightM).toBe(1.8)
  })

  it('isn’t offered with a selection or on an empty floor', () => {
    expect(planSearch(sample(), 'main', '5GHz', [router], 'one-more')).toBe(
      undefined,
    )
    const empty = sample()
    empty.accessPoints = []
    expect(planSearch(empty, 'main', '5GHz', [], 'one-more')).toBe(undefined)
  })
})

describe('planSearch: how many access points (D46)', () => {
  it('asks for the goal with the unlocked ones moving', () => {
    const job = ready(
      planSearch(
        twoAccessPoints([false, true]),
        'main',
        '5GHz',
        [],
        'how-many',
        0.95,
      ),
    )
    expect(job.label).toBe('How many access points do I need?')
    expect(job.what).toBe('how many access points cover 95% of the floor')
    if (job.request.kind !== 'how-many') throw new Error()
    expect(job.request.problem.goal).toBe(0.95)
    expect(job.request.problem.moving.map((ap) => ap.id)).toEqual(['router'])
    expect(job.request.problem.fixed.map((ap) => ap.id)).toEqual(['ap2'])
    // New ones are only named once the search says how many.
    expect(job.movers.map((m) => m.apId)).toEqual(['router'])
  })

  it('works on an empty floor and with every access point locked', () => {
    const empty = sample()
    empty.accessPoints = []
    const fresh = ready(planSearch(empty, 'main', '5GHz', [], 'how-many'))
    if (fresh.request.kind !== 'how-many') throw new Error()
    expect(fresh.request.problem).toMatchObject({ moving: [], goal: 0.9 })
    expect(fresh.request.problem.template.radios).toEqual(ALL_BANDS)

    const locked = ready(
      planSearch(twoAccessPoints([true, true]), 'main', '5GHz', [], 'how-many'),
    )
    if (locked.request.kind !== 'how-many') throw new Error()
    expect(locked.request.problem.moving).toEqual([])
    expect(locked.request.problem.fixed).toHaveLength(2)
  })

  it('isn’t offered with a selection', () => {
    expect(planSearch(sample(), 'main', '5GHz', [router], 'how-many')).toBe(
      undefined,
    )
  })
})

describe('newNames', () => {
  it('numbers new access points in turn, without changing the plan', () => {
    const plan = sample()
    plan.accessPoints[0]!.name = 'Access point 4'
    expect(newNames(plan, 2)).toEqual(['Access point 5', 'Access point 6'])
    expect(plan.accessPoints).toHaveLength(1)
  })
})

describe('searchOutcome', () => {
  const single = ready(planSearch(sample(), 'main', '5GHz', [router]))
  const found = (x: number, y: number) =>
    ({
      id: 0,
      kind: 'result',
      result: {
        kind: 'found',
        position: { x, y, floorId: 'main' },
        floors: [{ floorId: 'main', before: 0.8, share: 0.9 }] as FloorShare[],
        share: 0.9,
        weakestDbm: -70,
        before: 0.8,
        beforeWeakestDbm: -75,
        stoppedEarly: false,
      },
    }) as const

  it('turns a found spot into a suggestion', () => {
    expect(searchOutcome(found(4, 3), single)).toEqual({
      status: 'suggestion',
      suggestion: suggestion({
        moves: [move({ template: { heightM: 1, radios: ALL_BANDS } })],
        before: 0.8,
        after: 0.9,
        floors: [{ floorId: 'main', before: 0.8, share: 0.9 }],
        beforeWeakestDbm: -75,
        weakestDbm: -70,
      }),
    })
  })

  it('says so when the access point is already there', () => {
    // 5 cm away is under the 10 cm refinement step.
    expect(searchOutcome(found(5.65, 1.2), single)).toEqual({
      status: 'message',
      text: 'Router is already in the best spot found.',
    })
  })

  it('pairs several positions with their access points', () => {
    const job = ready(planSearch(sample(), 'main', '5GHz', [], 'one-more'))
    const state = searchOutcome(
      {
        id: 0,
        kind: 'result-many',
        result: {
          kind: 'found',
          positions: [
            { x: 1, y: 2, floorId: 'main' },
            { x: 6, y: 2, floorId: 'main' },
          ],
          share: 1,
          weakestDbm: -60,
          before: 0.86,
          beforeWeakestDbm: -110,
          floors: [],
          stoppedEarly: false,
        },
      },
      job,
    )
    if (state.status !== 'suggestion') throw new Error(state.status)
    expect(state.suggestion.moves).toMatchObject([
      { apId: 'router', to: { x: 1, y: 2, floorId: 'main' } },
      {
        apId: undefined,
        name: 'Access point 1',
        to: { x: 6, y: 2, floorId: 'main' },
      },
    ])
    // Adding one isn't compared by the weakest spot.
    expect(state.suggestion.beforeWeakestDbm).toBeUndefined()
  })

  it('says so when several are already in place', () => {
    const job = ready(planSearch(twoAccessPoints(), 'main', '5GHz', []))
    const state = searchOutcome(
      {
        id: 0,
        kind: 'result-many',
        result: {
          kind: 'found',
          positions: [
            { x: 5.6, y: 1.2, floorId: 'main' },
            { x: 5.62, y: 1.2, floorId: 'main' },
          ],
          share: 0.9,
          weakestDbm: -70,
          before: 0.9,
          beforeWeakestDbm: -70,
          floors: [],
          stoppedEarly: false,
        },
      },
      job,
    )
    expect(state).toEqual({
      status: 'message',
      text: 'The access points are already in the best spots found.',
    })
  })

  describe('for how many access points', () => {
    const job = ready(planSearch(sample(), 'main', '5GHz', [], 'how-many'))
    const answer = (
      overrides: Partial<{ added: number; reached: boolean }> & {
        positions: { x: number; y: number; floorId: string }[]
      },
    ) =>
      ({
        id: 0,
        kind: 'result-how-many',
        result: {
          kind: 'found',
          added: 0,
          reached: true,
          share: 1,
          weakestDbm: -60,
          before: 0.8,
          beforeWeakestDbm: -75,
          floors: [] as FloorShare[],
          stoppedEarly: false,
          ...overrides,
        },
      }) as const

    it('names and places the access points it adds', () => {
      const outcome = searchOutcome(
        answer({
          added: 2,
          positions: [
            { x: 1, y: 1, floorId: 'main' },
            { x: 6, y: 2, floorId: 'main' },
            { x: 9, y: 2, floorId: 'main' },
          ],
        }),
        job,
      )
      if (outcome.status !== 'suggestion') throw new Error(outcome.status)
      const { moves, howMany } = outcome.suggestion
      expect(moves.map((m) => [m.apId, m.name, m.to.x])).toEqual([
        ['router', 'Router', 1],
        [undefined, 'Access point 1', 6],
        [undefined, 'Access point 2', 9],
      ])
      // New ones copy the first access point on the band.
      expect(moves[1]!.template).toEqual(moves[0]!.template)
      expect(howMany).toEqual({ goal: 0.9, added: 2, reached: true })
    })

    it('says when none are needed and nothing has to move', () => {
      expect(
        searchOutcome(
          answer({ positions: [{ x: 5.6, y: 1.2, floorId: 'main' }] }),
          job,
        ),
      ).toEqual({
        status: 'message',
        text: 'No more access points needed: 80% of the floor is already at Fair or better on 5 GHz, which meets the 90% goal.',
      })
    })
  })

  it('explains an open floor, nothing to place and errors', () => {
    expect(
      searchOutcome(
        { id: 0, kind: 'result', result: { kind: 'no-floor-area' } },
        single,
      ),
    ).toEqual({
      status: 'message',
      text: 'Close the outer walls first: suggested spots go inside them.',
    })
    expect(
      searchOutcome(
        { id: 0, kind: 'result-many', result: { kind: 'nothing-to-place' } },
        single,
      ),
    ).toEqual({ status: 'message', text: 'There’s nothing to move or add.' })
    expect(
      searchOutcome({ id: 0, kind: 'error', message: 'boom' }, single),
    ).toEqual({
      status: 'message',
      text: 'Couldn’t search for a spot. Undo your last change, or reload the page.',
      details: 'boom',
    })
  })
})

describe('suggestionText and suggestionSummary', () => {
  it('rounds down like the coverage summary', () => {
    expect(suggestionText(suggestion(), undefined)).toBe(
      '72% → 91% of the floor at Fair or better on 5 GHz.',
    )
  })

  it('mentions the weakest spot when the share doesn’t change', () => {
    expect(suggestionText(suggestion({ before: 1, after: 1 }), 'good')).toBe(
      '100% → 100% of the floor at Good or better on 5 GHz. The weakest spot improves from -80 to -70 dBm.',
    )
  })

  it('says where each access point goes', () => {
    expect(suggestionSummary(suggestion(), undefined, 'metric')).toBe(
      'Move Router to 4.00 m, 3.00 m: 72% → 91% of the floor at Fair or better on 5 GHz.',
    )
    const two = suggestion({
      moves: [
        move({ to: { x: 1, y: 2, floorId: 'main' } }),
        move({
          apId: undefined,
          name: 'Access point 1',
          from: undefined,
          to: { x: 6, y: 2, floorId: 'main' },
        }),
      ],
      stoppedEarly: true,
    })
    expect(suggestionSummary(two, undefined, 'metric')).toBe(
      'Move Router to 1.00 m, 2.00 m and add Access point 1 at 6.00 m, 2.00 m: 72% → 91% of the floor at Fair or better on 5 GHz. The search hit its 10 second limit, so this is the best found so far.',
    )
  })
})

describe('withSuggestion', () => {
  it('moves or adds access points without changing the plan', () => {
    const plan = sample()
    const moved = withSuggestion(plan, suggestion())
    expect(moved.accessPoints[0]).toMatchObject({ x: 4, y: 3, floorId: 'main' })
    expect(plan.accessPoints[0]).toMatchObject({
      x: 5.6,
      y: 1.2,
      floorId: 'main',
    })

    const template = { heightM: 2.1, radios: [{ band: '5GHz' as const }] }
    const added = withSuggestion(
      plan,
      suggestion({
        moves: [move({ apId: undefined, name: 'Access point 1', template })],
      }),
    )
    expect(added.accessPoints).toHaveLength(2)
    // A new one is a copy of the template (D40, D45).
    expect(added.accessPoints[1]).toMatchObject({
      name: 'Access point 1',
      x: 4,
      y: 3,
      floorId: 'main',
      ...template,
    })
  })

  it('gives a new access point the width but not a hand-set channel or BSSIDs', () => {
    const template = {
      heightM: 1,
      radios: [
        {
          band: '5GHz' as const,
          channel: 42,
          channelWidthMHz: 80 as const,
          bssids: ['a4:2b:b0:12:34:56'],
        },
      ],
    }
    const added = withSuggestion(
      sample(),
      suggestion({ moves: [move({ apId: undefined, template })] }),
    )
    // Copying the channel would put both on it on purpose (D63), and a
    // BSSID belongs to one radio (D71).
    expect(added.accessPoints[1]!.radios).toEqual([
      { band: '5GHz', channelWidthMHz: 80 },
    ])
  })
})

/** A worker that keeps what it's sent, and whether it was terminated. */
class FakeWorker implements SearchWorker {
  onmessage: ((event: MessageEvent<PlacementMessage>) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessageerror: ((event: unknown) => void) | null = null
  requests: PlacementRequest[] = []
  terminated = false
  postMessage(request: PlacementRequest) {
    this.requests.push(request)
  }
  terminate() {
    this.terminated = true
  }
  reply(message: PlacementMessage) {
    this.onmessage?.({ data: message } as MessageEvent<PlacementMessage>)
  }
}

/** An optimizer whose worker runs the real search straight away. */
function realOptimizer(plan: Plan) {
  const store = createEditorStore(plan)
  const optimizer = createOptimizer(store, () => {
    const worker = new FakeWorker()
    worker.postMessage = (request) =>
      handlePlacementRequest(request, (message) => worker.reply(message))
    return worker
  })
  return { store, optimizer }
}

describe('suggestionSummary for how many (D46)', () => {
  const added = move({
    apId: undefined,
    name: 'Access point 1',
    from: undefined,
    to: { x: 6, y: 2, floorId: 'main' },
  })
  const summary = (
    howMany: Suggestion['howMany'],
    overrides: Partial<Suggestion> = {},
  ) =>
    suggestionSummary(
      suggestion({ moves: [added], ...(howMany && { howMany }), ...overrides }),
      undefined,
      'metric',
    )

  it('says how many more are needed', () => {
    expect(summary({ goal: 0.9, added: 1, reached: true })).toBe(
      'You need 1 more access point for 90% of the floor. Add Access point 1 at 6.00 m, 2.00 m: 72% → 91% of the floor at Fair or better on 5 GHz.',
    )
    expect(summary({ goal: 1, added: 3, reached: true })).toMatch(
      /^You need 3 more access points for 100% of the floor\. /,
    )
  })

  it('says when moving is enough', () => {
    expect(
      summary({ goal: 0.9, added: 0, reached: true }, { moves: [move()] }),
    ).toMatch(/^No more access points needed for 90% of the floor\. Move /)
  })

  it('says when the goal is out of reach, or wasn’t reached in time', () => {
    expect(summary({ goal: 1, added: 4, reached: false })).toMatch(
      /^Even 4 more access points don’t cover 100% of the floor\. The best found: Add /,
    )
    expect(
      summary({ goal: 1, added: 2, reached: false }, { stoppedEarly: true }),
    ).toMatch(
      /^No layout found in time covers 100% of the floor\. The best found: .* The search hit its 10 second limit/,
    )
  })
})

describe('createOptimizer', () => {
  function setup(plan = sample()) {
    const store = createEditorStore(plan)
    const workers: FakeWorker[] = []
    const optimizer = createOptimizer(store, () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    return { store, workers, optimizer }
  }

  it('reports progress, then the outcome, and ends the worker', () => {
    const { store, workers, optimizer } = setup()
    store.getState().select([router])
    optimizer.start()
    const worker = workers[0]!
    expect(worker.requests[0]).toMatchObject({ kind: 'place-one' })
    expect(store.getState().optimizer).toEqual({
      status: 'searching',
      fraction: 0,
      what: 'a spot for Router',
    })

    const id = worker.requests[0]!.id
    worker.reply({ id, kind: 'progress', fraction: 0.4 })
    expect(store.getState().optimizer).toMatchObject({ fraction: 0.4 })

    // Replies to an older request are ignored.
    worker.reply({ id: id + 1, kind: 'progress', fraction: 0.9 })
    expect(store.getState().optimizer).toMatchObject({ fraction: 0.4 })

    worker.reply({ id, kind: 'error', message: 'boom' })
    expect(store.getState().optimizer).toEqual({
      status: 'message',
      text: 'Couldn’t search for a spot. Undo your last change, or reload the page.',
      details: 'boom',
    })
    expect(worker.terminated).toBe(true)
  })

  it('says so when the worker throws or its message can’t be read (D91)', () => {
    for (const hook of ['onerror', 'onmessageerror'] as const) {
      const { store, workers, optimizer } = setup()
      store.getState().select([router])
      optimizer.start()
      workers[0]![hook]?.(new Error('worker crashed'))
      expect(store.getState().optimizer).toEqual({
        status: 'message',
        text: 'Couldn’t search for a spot. Try again; if it keeps failing, reload the page.',
        details: 'worker crashed',
      })
      expect(workers[0]!.terminated).toBe(true)
    }
  })

  it('says so when the worker can’t be started (D91)', () => {
    const store = createEditorStore(sample())
    const optimizer = createOptimizer(store, () => {
      throw new Error('no workers here')
    })
    store.getState().select([router])
    optimizer.start()
    expect(store.getState().optimizer).toEqual({
      status: 'message',
      text: 'Couldn’t search for a spot. Try again; if it keeps failing, reload the page.',
      details: 'no workers here',
    })
  })

  it('terminates the worker on Cancel', () => {
    const { store, workers, optimizer } = setup()
    optimizer.start()
    optimizer.cancel()
    expect(workers[0]!.terminated).toBe(true)
    expect(store.getState().optimizer).toBeUndefined()
  })

  it('stops the search when the plan changes, with a note', () => {
    const { store, workers, optimizer } = setup()
    optimizer.start('one-more')
    expect(workers[0]!.requests[0]).toMatchObject({ kind: 'place-many' })
    store.getState().renamePlan('Renamed')
    expect(workers[0]!.terminated).toBe(true)
    expect(store.getState().optimizer).toBeUndefined()
    expect(store.getState().notice).toBe('Search stopped: the plan changed.')
  })

  it('explains why it can’t start, without a worker', () => {
    const { store, workers, optimizer } = setup(twoAccessPoints([true, true]))
    optimizer.start()
    expect(workers).toHaveLength(0)
    expect(store.getState().optimizer).toMatchObject({ status: 'message' })
  })

  it('finds a better spot for the sample home’s router', () => {
    const { store, optimizer } = realOptimizer(sample())
    optimizer.start()
    const state = store.getState().optimizer
    if (state?.status !== 'suggestion') throw new Error(state?.status)
    // D42: 86.9% → 92.0% at Fair on 5 GHz.
    expect(suggestionText(state.suggestion, undefined)).toBe(
      '86% → 92% of the floor at Fair or better on 5 GHz.',
    )
  })

  it('counts access points for the goal set in the store', () => {
    const { store, optimizer } = realOptimizer(sample())
    // Moving the router alone reaches 92% (D42): enough for 90%.
    optimizer.start('how-many')
    let state = store.getState().optimizer
    if (state?.status !== 'suggestion') throw new Error(state?.status)
    expect(state.suggestion.howMany).toEqual({
      goal: 0.9,
      added: 0,
      reached: true,
    })
    expect(state.suggestion.moves).toHaveLength(1)

    store.getState().setCoverageGoal(1)
    optimizer.start('how-many')
    state = store.getState().optimizer
    if (state?.status !== 'suggestion') throw new Error(state?.status)
    expect(state.suggestion.howMany).toEqual({
      goal: 1,
      added: 1,
      reached: true,
    })
    expect(suggestionText(state.suggestion, undefined)).toBe(
      '86% → 100% of the floor at Fair or better on 5 GHz.',
    )
  })

  it('covers the whole sample home with one more access point', () => {
    const { store, optimizer } = realOptimizer(sample())
    optimizer.start('one-more')
    const state = store.getState().optimizer
    if (state?.status !== 'suggestion') throw new Error(state?.status)
    expect(state.suggestion.moves).toHaveLength(2)
    expect(suggestionText(state.suggestion, undefined)).toBe(
      '86% → 100% of the floor at Fair or better on 5 GHz.',
    )
  })
})

describe('store with a suggestion', () => {
  function withWaiting(s: Suggestion = suggestion()) {
    const store = createEditorStore(sample())
    store.getState().setOptimizer({ status: 'suggestion', suggestion: s })
    return store
  }

  it('applies it as one undo step and selects the access point', () => {
    const store = withWaiting()
    store.getState().applySuggestion()
    const state = store.getState()
    expect(state.plan.accessPoints[0]).toMatchObject({
      x: 4,
      y: 3,
      floorId: 'main',
    })
    expect(state.past.map((e) => e.label)).toEqual([
      'Move Router to the suggested spot',
    ])
    expect(state.selection).toEqual([router])
    expect(state.optimizer).toBeUndefined()
    expect(state.notice).toBeUndefined()

    state.undo()
    expect(store.getState().plan.accessPoints[0]).toMatchObject({ x: 5.6 })
  })

  it('applies several as one undo step and selects them all', () => {
    const store = withWaiting(
      suggestion({
        moves: [
          move(),
          move({ apId: undefined, name: 'Access point 1', from: undefined }),
        ],
      }),
    )
    store.getState().applySuggestion()
    const state = store.getState()
    const added = state.plan.accessPoints[1]!
    expect(added).toMatchObject({ name: 'Access point 1', x: 4, y: 3 })
    expect(state.past.map((e) => e.label)).toEqual([
      'Apply the suggested spots',
    ])
    expect(state.selection).toEqual([
      router,
      { kind: 'accessPoint', id: added.id },
    ])
    state.undo()
    expect(store.getState().plan.accessPoints).toHaveLength(1)
  })

  it('is dismissed by an edit, undo or band change, with a note', () => {
    const store = withWaiting()
    store.getState().renamePlan('Renamed')
    expect(store.getState().optimizer).toBeUndefined()
    expect(store.getState().notice).toBe(
      'Suggestion dismissed: the plan changed.',
    )

    store
      .getState()
      .setOptimizer({ status: 'suggestion', suggestion: suggestion() })
    store.getState().undo()
    expect(store.getState().optimizer).toBeUndefined()

    store
      .getState()
      .setOptimizer({ status: 'suggestion', suggestion: suggestion() })
    store.getState().setBand('5GHz')
    expect(store.getState().optimizer).toBeDefined()
    store.getState().setBand('6GHz')
    expect(store.getState().optimizer).toBeUndefined()
    expect(store.getState().notice).toBe(
      'Suggestion dismissed: the band changed.',
    )
  })

  it('is dismissed by a drag', () => {
    const store = withWaiting()
    store.getState().beginGesture()
    expect(store.getState().optimizer).toBeDefined()
    store.getState().updateGesture((plan) => {
      plan.accessPoints[0]!.x = 2
    })
    expect(store.getState().optimizer).toBeUndefined()
  })
})

describe('suggestions across floors (D55)', () => {
  /** The sample home with an empty upper floor. */
  function twoStoreys(): Plan {
    const plan = sample()
    plan.floors.push({
      ...plan.floors[0]!,
      id: 'up',
      name: 'Upstairs',
      elevationM: 2.7,
      nodes: [],
      walls: [],
      openings: [],
    })
    return plan
  }
  const acrossFloors = suggestion({
    moves: [
      move(),
      move({
        apId: undefined,
        name: 'Access point 1',
        from: undefined,
        to: { x: 6, y: 2, floorId: 'up' },
      }),
    ],
    before: 0.43,
    after: 0.955,
    floors: [
      { floorId: 'main', before: 0.86, share: 0.97 },
      { floorId: 'up', before: 0, share: 0.94 },
    ],
  })

  it('gives the whole home and one line per floor, top first', () => {
    const plan = twoStoreys()
    expect(suggestionText(acrossFloors, undefined)).toBe(
      '43% → 95% of the home at Fair or better on 5 GHz.',
    )
    expect(suggestionFloorLines(acrossFloors, plan)).toEqual([
      'Upstairs: 0% → 94%',
      'Main floor: 86% → 97%',
    ])
    expect(suggestionFloorLines(suggestion(), plan)).toEqual([])
    expect(suggestionSummary(acrossFloors, undefined, 'metric', plan)).toBe(
      'Move Router to 4.00 m, 3.00 m on Main floor and add Access point 1 at 6.00 m, 2.00 m on Upstairs: 43% → 95% of the home at Fair or better on 5 GHz.',
    )
  })

  it('adds a new access point on the floor it was suggested for', () => {
    const after = withSuggestion(twoStoreys(), acrossFloors)
    const added = after.accessPoints.find((ap) => ap.name === 'Access point 1')
    expect(added).toMatchObject({ floorId: 'up', x: 6, y: 2 })
    expect(after.accessPoints[0]).toMatchObject({ floorId: 'main', x: 4, y: 3 })
  })

  it('selects only what moved or was added on the floor on show', () => {
    const store = createEditorStore(twoStoreys())
    store
      .getState()
      .setOptimizer({ status: 'suggestion', suggestion: acrossFloors })
    store.getState().applySuggestion()
    expect(store.getState().selection).toEqual([router])
    expect(store.getState().past.at(-1)!.label).toBe(
      'Apply the suggested spots',
    )
  })
})
