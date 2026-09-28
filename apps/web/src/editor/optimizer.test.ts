import {
  handlePlacementRequest,
  type PlacementMessage,
  type PlacementRequest,
} from '@signalplan/engine'
import { parsePlan, type Plan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import { describe, expect, it } from 'vitest'
import {
  chooseTarget,
  createOptimizer,
  placementProblem,
  searchOutcome,
  suggestionText,
  withSuggestion,
  type SearchWorker,
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

const suggestion = (overrides: Partial<Suggestion> = {}): Suggestion => ({
  apId: 'router',
  name: 'Wi-Fi 6E router',
  floorId: 'main',
  band: '5GHz',
  from: { x: 5.6, y: 1.2 },
  position: { x: 4, y: 3 },
  before: 0.729,
  after: 0.915,
  beforeWeakestDbm: -80.4,
  weakestDbm: -70.2,
  stoppedEarly: false,
  ...overrides,
})

describe('chooseTarget', () => {
  it('moves the selected access point', () => {
    const target = chooseTarget(sample(), 'main', '5GHz', [router])
    expect(target).toMatchObject({ kind: 'move', ap: { id: 'router' } })
  })

  it('refuses a locked one, saying how to unlock it', () => {
    const plan = sample()
    plan.accessPoints[0]!.locked = true
    expect(chooseTarget(plan, 'main', '5GHz', [router])).toEqual({
      kind: 'unavailable',
      reason: 'Wi-Fi 6E router is locked. Untick Locked to let it move.',
    })
  })

  it('refuses one without a radio on the band', () => {
    const plan = sample()
    plan.accessPoints[0]!.radios = [{ band: '2.4GHz' }]
    expect(chooseTarget(plan, 'main', '5GHz', [router])).toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining('doesn’t broadcast on 5 GHz') as string,
    })
  })

  it('needs an access point, not a wall, when something is selected', () => {
    const target = chooseTarget(sample(), 'main', '5GHz', [
      { kind: 'wall', id: 'w1' },
    ])
    expect(target.kind).toBe('unavailable')
  })

  it('with nothing selected, moves the only unlocked access point', () => {
    const target = chooseTarget(
      twoAccessPoints([true, false]),
      'main',
      '5GHz',
      [],
    )
    expect(target).toMatchObject({ kind: 'move', ap: { id: 'ap2' } })
  })

  it('with nothing selected, asks which of several to move', () => {
    expect(chooseTarget(twoAccessPoints(), 'main', '5GHz', [])).toEqual({
      kind: 'unavailable',
      reason:
        'Select the access point to move; the others stay where they are.',
    })
  })

  it('with every access point locked, says so', () => {
    const target = chooseTarget(
      twoAccessPoints([true, true]),
      'main',
      '5GHz',
      [],
    )
    expect(target).toMatchObject({ kind: 'unavailable' })
  })

  it('adds one when the floor has none', () => {
    const plan = sample()
    plan.accessPoints = []
    expect(chooseTarget(plan, 'main', '5GHz', [])).toEqual({ kind: 'add' })
  })
})

describe('placementProblem', () => {
  it('keeps every other access point on the floor fixed', () => {
    const plan = twoAccessPoints()
    plan.floors.push({ ...plan.floors[0]!, id: 'up' })
    plan.accessPoints.push({
      ...plan.accessPoints[0]!,
      id: 'ap3',
      floorId: 'up',
    })
    const problem = placementProblem(plan, 'main', '5GHz', {
      kind: 'move',
      ap: plan.accessPoints[0]!,
    })
    expect(problem.fixed.map((ap) => ap.id)).toEqual(['ap2'])
    expect(problem.current).toEqual({ x: 5.6, y: 1.2 })
    expect(problem.template.heightM).toBe(1)
    // Fair, the default target, starts at −67 dBm.
    expect(problem.minDbm).toBe(-67)
  })

  it('uses the plan’s target and a new access point’s settings', () => {
    const plan = sample()
    plan.accessPoints = []
    plan.coverageTarget = 'good'
    const problem = placementProblem(plan, 'main', '5GHz', { kind: 'add' })
    expect(problem.minDbm).toBe(-60)
    expect(problem.current).toBeUndefined()
    expect(problem.template).toEqual({
      heightM: 1,
      radios: [{ band: '2.4GHz' }, { band: '5GHz' }, { band: '6GHz' }],
    })
  })
})

describe('searchOutcome', () => {
  const problem = placementProblem(sample(), 'main', '5GHz', {
    kind: 'move',
    ap: sample().accessPoints[0]!,
  })
  const context = { name: 'Wi-Fi 6E router', apId: 'router', problem }
  const found = (x: number, y: number) =>
    ({
      id: 0,
      kind: 'result',
      result: {
        kind: 'found',
        position: { x, y },
        share: 0.9,
        weakestDbm: -70,
        before: 0.8,
        beforeWeakestDbm: -75,
        stoppedEarly: false,
      },
    }) as const

  it('turns a found spot into a suggestion', () => {
    const state = searchOutcome(found(4, 3), context)
    expect(state).toEqual({
      status: 'suggestion',
      suggestion: suggestion({
        position: { x: 4, y: 3 },
        before: 0.8,
        after: 0.9,
        beforeWeakestDbm: -75,
        weakestDbm: -70,
      }),
    })
  })

  it('says so when the access point is already there', () => {
    // 5 cm away is under the 10 cm refinement step.
    expect(searchOutcome(found(5.65, 1.2), context)).toEqual({
      status: 'message',
      text: 'Wi-Fi 6E router is already in the best spot found.',
    })
  })

  it('counts nothing as covered before when one is added', () => {
    const add = placementProblem(sample(), 'main', '5GHz', { kind: 'add' })
    const message = found(4, 3)
    const state = searchOutcome(
      { ...message, result: { ...message.result, before: undefined } },
      { name: 'Access point 1', apId: undefined, problem: add },
    )
    expect(state).toMatchObject({
      status: 'suggestion',
      suggestion: { apId: undefined, from: undefined, before: 0 },
    })
  })

  it('explains an open floor and errors', () => {
    expect(
      searchOutcome(
        { id: 0, kind: 'result', result: { kind: 'no-floor-area' } },
        context,
      ),
    ).toEqual({
      status: 'message',
      text: 'Close the outer walls first: suggested spots go inside them.',
    })
    expect(
      searchOutcome({ id: 0, kind: 'error', message: 'boom' }, context),
    ).toEqual({ status: 'message', text: 'Couldn’t search: boom' })
  })
})

describe('suggestionText', () => {
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
})

describe('withSuggestion', () => {
  it('moves or adds the access point without changing the plan', () => {
    const plan = sample()
    const moved = withSuggestion(plan, suggestion())
    expect(moved.accessPoints[0]).toMatchObject({ x: 4, y: 3 })
    expect(plan.accessPoints[0]).toMatchObject({ x: 5.6, y: 1.2 })

    const added = withSuggestion(plan, suggestion({ apId: undefined }))
    expect(added.accessPoints).toHaveLength(2)
    expect(added.accessPoints[1]).toMatchObject({ x: 4, y: 3, floorId: 'main' })
  })
})

/** A worker that keeps what it's sent, and whether it was terminated. */
class FakeWorker implements SearchWorker {
  onmessage: ((event: MessageEvent<PlacementMessage>) => void) | null = null
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

  it('reports progress, then the suggestion, and ends the worker', () => {
    const { store, workers, optimizer } = setup()
    store.getState().select([router])
    optimizer.start()
    const worker = workers[0]!
    expect(worker.requests[0]).toMatchObject({ kind: 'place-one' })
    expect(store.getState().optimizer).toEqual({
      status: 'searching',
      fraction: 0,
      name: 'Wi-Fi 6E router',
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
      text: 'Couldn’t search: boom',
    })
    expect(worker.terminated).toBe(true)
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
    optimizer.start()
    store.getState().renamePlan('Renamed')
    expect(workers[0]!.terminated).toBe(true)
    expect(store.getState().optimizer).toBeUndefined()
    expect(store.getState().notice).toBe('Search stopped: the plan changed.')
  })

  it('explains why it can’t start, without a worker', () => {
    const { store, workers, optimizer } = setup(twoAccessPoints())
    optimizer.start()
    expect(workers).toHaveLength(0)
    expect(store.getState().optimizer).toMatchObject({ status: 'message' })
  })

  it('finds a better spot for the sample home’s router', () => {
    const store = createEditorStore(sample())
    const optimizer = createOptimizer(store, () => {
      const worker = new FakeWorker()
      worker.postMessage = (request) =>
        handlePlacementRequest(request, (message) => worker.reply(message))
      return worker
    })
    optimizer.start()
    const state = store.getState().optimizer
    if (state?.status !== 'suggestion') throw new Error(state?.status)
    // D42: 86.9% → 92.0% at Fair on 5 GHz.
    expect(suggestionText(state.suggestion, undefined)).toBe(
      '86% → 92% of the floor at Fair or better on 5 GHz.',
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
    expect(state.plan.accessPoints[0]).toMatchObject({ x: 4, y: 3 })
    expect(state.past.map((e) => e.label)).toEqual([
      'Move Wi-Fi 6E router to the suggested spot',
    ])
    expect(state.selection).toEqual([router])
    expect(state.optimizer).toBeUndefined()
    expect(state.notice).toBeUndefined()

    state.undo()
    expect(store.getState().plan.accessPoints[0]).toMatchObject({ x: 5.6 })
  })

  it('selects an added access point', () => {
    const store = withWaiting(
      suggestion({ apId: undefined, name: 'Access point 1', from: undefined }),
    )
    store.getState().applySuggestion()
    const added = store.getState().plan.accessPoints[1]!
    expect(added).toMatchObject({ name: 'Access point 1', x: 4, y: 3 })
    expect(store.getState().selection).toEqual([
      { kind: 'accessPoint', id: added.id },
    ])
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
