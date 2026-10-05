import {
  calibrateBand,
  handleCalibrationRequest,
  type BandCalibrationResult,
  type CalibrationMessage,
  type CalibrationRequest,
} from '@signalplan/engine'
import { parsePlan, type Plan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import surveyedHome from '@signalplan/floorplan/fixtures/surveyed-home.json'
import { describe, expect, it } from 'vitest'
import {
  appliedFits,
  bandsWithReadings,
  calibratedNote,
  createModelCalibrator,
  errorChange,
  fitRows,
  pendingCalibration,
  readinessLines,
  withModelCalibration,
  type CalibrationWorker,
} from './modelCalibration.ts'
import { createEditorStore } from './store.ts'

function load(json: unknown): Plan {
  const result = parsePlan(json)
  if (!result.ok) throw new Error('fixture is invalid')
  return result.plan
}

const surveyed = () => load(surveyedHome)

/** The surveyed home with only its first `n` spots. */
function firstSpots(n: number): Plan {
  const plan = surveyed()
  return {
    ...plan,
    floors: plan.floors.map((f) => ({
      ...f,
      surveySpots: f.surveySpots!.slice(0, n),
    })),
  }
}

/** A worker that answers each request at once, or holds them until `flush`. */
function fakeWorker(hold = false) {
  const held: CalibrationRequest[] = []
  const worker: CalibrationWorker & { flush(): void; terminated: boolean } = {
    onmessage: null,
    terminated: false,
    postMessage(request) {
      held.push(request)
      if (!hold) worker.flush()
    },
    flush() {
      for (const request of held.splice(0)) {
        worker.onmessage?.({
          data: handleCalibrationRequest(request),
        } as MessageEvent<CalibrationMessage>)
      }
    },
    terminate() {
      worker.terminated = true
    },
  }
  return worker
}

describe('bandsWithReadings', () => {
  it('lists the bands with readings the model can compare', () => {
    expect(bandsWithReadings(surveyed())).toEqual(['2.4GHz', '5GHz', '6GHz'])
    expect(bandsWithReadings(load(sampleHome))).toEqual([])
  })
})

describe('what Apply saves (D76)', () => {
  const results = (plan: Plan) =>
    (['2.4GHz', '5GHz'] as const).map((band) => calibrateBand(plan, band))

  it('replaces each band that improves and keeps the others', () => {
    const plan: Plan = {
      ...surveyed(),
      calibration: { '6GHz': { pathLossExponent: 2.1 } },
    }
    const fitted = results(plan)
    const calibration = pendingCalibration(plan, fitted)!
    expect(Object.keys(calibration).sort()).toEqual(['2.4GHz', '5GHz', '6GHz'])
    expect(calibration['5GHz']).toEqual(fitted[1]!.fit!.calibration)
    expect(calibration['6GHz']).toEqual({ pathLossExponent: 2.1 })
    expect(calibration['5GHz']!.deviceOffsetDb).toBeLessThan(-2)
  })

  it('leaves out a fit that doesn’t beat the defaults', () => {
    const plan = surveyed()
    const [first, second] = results(plan)
    const worse: BandCalibrationResult = {
      ...second!,
      fit: {
        ...second!.fit!,
        after: { ...second!.fit!.before, rmsDb: second!.fit!.before.rmsDb },
      },
    }
    expect(appliedFits([first!, worse]).map((f) => f.band)).toEqual(['2.4GHz'])
    expect(pendingCalibration(plan, [worse])).toBeUndefined()
  })

  it('previews the plan as Apply would leave it', () => {
    const plan = surveyed()
    expect(withModelCalibration(plan, undefined)).toBe(plan)
    expect(withModelCalibration(plan, { status: 'fitting' })).toBe(plan)
    const fitted = results(plan)
    expect(
      withModelCalibration(plan, { status: 'result', results: fitted })
        .calibration,
    ).toEqual(pendingCalibration(plan, fitted))
  })
})

describe('the words Calibrate shows', () => {
  it('says which bands a plan is calibrated on', () => {
    expect(calibratedNote(surveyed())).toBeUndefined()
    expect(
      calibratedNote({
        ...surveyed(),
        calibration: {
          '6GHz': { pathLossExponent: 2.1 },
          '2.4GHz': {},
          '5GHz': { deviceOffsetDb: -3 },
        },
      }),
    ).toBe('Calibrated to this home’s survey on 5 GHz and 6 GHz.')
  })

  it('says what a band still needs', () => {
    const plan = firstSpots(4)
    const { readiness, fit } = calibrateBand(plan, '5GHz')
    expect(fit).toBeUndefined()
    // The first four spots are in two of the seven rooms.
    expect(readinessLines(plan, readiness)).toEqual([
      'Needs readings at 10 spots or more; has 4.',
      'Spots in 2 of 7 rooms; needs 4.',
    ])
  })

  it('says when spots are at the same place, or all at one distance (D101)', () => {
    // Ten spots all where the first one is: enough spots, one place.
    const plan = surveyed()
    const first = plan.floors[0]!.surveySpots![0]!
    const crowded: Plan = {
      ...plan,
      floors: plan.floors.map((f) => ({
        ...f,
        surveySpots: Array.from({ length: 10 }, (_, i) => ({
          ...first,
          id: `same${i}`,
        })),
      })),
    }
    const { readiness, fit } = calibrateBand(crowded, '5GHz')
    expect(fit).toBeUndefined()
    expect(readinessLines(crowded, readiness)).toEqual([
      'Needs readings at 10 spots at least 1 m apart; has 10, at 1 separate place.',
      'Needs readings both near and far from the access points, to tell how fast signal fades from how your phone reads.',
      'Spots in 1 of 7 rooms; needs 4.',
    ])
  })

  it('lists each fitted value next to its default', () => {
    const { fit } = calibrateBand(surveyed(), '5GHz')
    const rows = fitRows(fit!)
    expect(rows[0]).toMatchObject({
      label: 'Path loss exponent',
      defaultText: '2.00',
    })
    expect(rows[1]).toMatchObject({
      label: 'Phone offset',
      defaultText: '0.0 dB',
      note: 'Only when comparing with readings, not on the heatmap.',
    })
    expect(rows[1]!.valueText).toMatch(/^−\d+\.\d dB$/)
    const labels = rows.slice(2).map((r) => r.label)
    expect(labels).toContain('Drywall')
    for (const row of rows.slice(2)) {
      expect(row.note).toMatch(/^(Kept: |Crossed by \d+ readings? from)/)
    }
    expect(errorChange(fit!)).toMatch(
      /^RMS error \d+\.\d → \d+\.\d dB, mean [+−]\d+\.\d dB → [+−]?\d+\.\d dB, each spot predicted by a fit to the others\.$/,
    )
  })
})

describe('createModelCalibrator', () => {
  it('fits every band with readings in a worker, then waits', () => {
    const store = createEditorStore(surveyed())
    const worker = fakeWorker(true)
    const calibrator = createModelCalibrator(store, () => worker)
    calibrator.start()
    expect(store.getState().modelCalibration).toEqual({ status: 'fitting' })
    worker.flush()
    const state = store.getState().modelCalibration
    expect(state?.status).toBe('result')
    if (state?.status !== 'result') return
    expect(state.results.map((r) => r.band)).toEqual(['2.4GHz', '5GHz', '6GHz'])
    expect(state.results.every((r) => r.fit !== undefined)).toBe(true)
    expect(worker.terminated).toBe(true)
  })

  it('stops when the plan changes, and ignores what comes back', () => {
    const store = createEditorStore(surveyed())
    const worker = fakeWorker(true)
    createModelCalibrator(store, () => worker).start()
    store.getState().renamePlan('Changed')
    expect(worker.terminated).toBe(true)
    expect(store.getState().modelCalibration).toBeUndefined()
    expect(store.getState().notice).toBe(
      'Calibration stopped: the plan changed.',
    )
    worker.flush()
    expect(store.getState().modelCalibration).toBeUndefined()
  })

  it('shows a failure where the result would be when the worker fails (D91)', () => {
    for (const hook of ['onerror', 'onmessageerror'] as const) {
      const store = createEditorStore(surveyed())
      const worker = fakeWorker(true)
      createModelCalibrator(store, () => worker).start()
      worker[hook]?.(new Error('worker crashed'))
      expect(store.getState().modelCalibration).toEqual({
        status: 'failed',
        message:
          'Couldn’t calibrate. Try again; if it keeps failing, reload the page.',
        details: 'worker crashed',
      })
      expect(worker.terminated).toBe(true)
    }
  })

  it('shows a failure when the worker answers with an error or won’t start', () => {
    const store = createEditorStore(surveyed())
    const worker = fakeWorker(true)
    createModelCalibrator(store, () => worker).start()
    worker.onmessage?.({
      data: { id: 0, kind: 'error', message: 'boom.' },
    } as MessageEvent<CalibrationMessage>)
    expect(store.getState().modelCalibration).toEqual({
      status: 'failed',
      message: 'Couldn’t calibrate. Undo your last change, or reload the page.',
      details: 'boom.',
    })

    const blocked = createEditorStore(surveyed())
    createModelCalibrator(blocked, () => {
      throw new Error('no workers here')
    }).start()
    expect(blocked.getState().modelCalibration).toMatchObject({
      status: 'failed',
    })
  })

  it('drops a failure with the next change to the plan, quietly', () => {
    const store = createEditorStore(surveyed())
    const worker = fakeWorker(true)
    createModelCalibrator(store, () => worker).start()
    worker.onerror?.(new Error('x'))
    store.getState().renamePlan('Changed')
    expect(store.getState().modelCalibration).toBeUndefined()
    expect(store.getState().notice).toBeUndefined()
  })

  it('has nothing to fit without readings', () => {
    const store = createEditorStore(load(sampleHome))
    let made = 0
    createModelCalibrator(store, () => {
      made++
      return fakeWorker()
    }).start()
    expect(made).toBe(0)
    expect(store.getState().modelCalibration).toEqual({
      status: 'result',
      results: [],
    })
  })
})

describe('Apply, Dismiss and Reset (D76)', () => {
  const fitted = () => {
    const store = createEditorStore(surveyed())
    createModelCalibrator(store, () => fakeWorker()).start()
    return store
  }

  it('applies every band that improves as one undo step', () => {
    const store = fitted()
    const state = store.getState().modelCalibration
    if (state?.status !== 'result') throw new Error('no result')
    const expected = pendingCalibration(store.getState().plan, state.results)
    store.getState().applyModelCalibration()
    expect(store.getState().plan.calibration).toEqual(expected)
    expect(store.getState().modelCalibration).toBeUndefined()
    expect(store.getState().notice).toBeUndefined()
    expect(store.getState().past.at(-1)?.label).toBe('Apply the calibration')
    store.getState().undo()
    expect(store.getState().plan.calibration).toBeUndefined()
    store.getState().redo()
    expect(store.getState().plan.calibration).toEqual(expected)
  })

  it('is dropped by any change to the plan, with a note', () => {
    const store = fitted()
    store.getState().addSurveySpot({ x: 3, y: 3 })
    expect(store.getState().modelCalibration).toBeUndefined()
    expect(store.getState().notice).toBe(
      'Calibration dismissed: the plan changed.',
    )
  })

  it('is dropped quietly by Dismiss, and on opening another plan', () => {
    const store = fitted()
    store.getState().dismissModelCalibration()
    expect(store.getState().modelCalibration).toBeUndefined()
    expect(store.getState().plan.calibration).toBeUndefined()
    createModelCalibrator(store, () => fakeWorker()).start()
    store.getState().loadPlan(load(sampleHome))
    expect(store.getState().modelCalibration).toBeUndefined()
  })

  it('resets every band to the defaults as one undo step', () => {
    const store = fitted()
    store.getState().applyModelCalibration()
    store.getState().resetModelCalibration()
    expect(store.getState().plan.calibration).toBeUndefined()
    expect(store.getState().past.at(-1)?.label).toBe(
      'Reset the model to its defaults',
    )
    store.getState().undo()
    expect(store.getState().plan.calibration).toBeDefined()
    // Nothing to reset is no edit.
    const steps = store.getState().past.length
    store.getState().loadPlan(load(sampleHome))
    store.getState().resetModelCalibration()
    expect(store.getState().past.length).toBeLessThanOrEqual(steps)
    expect(store.getState().past).toHaveLength(0)
  })
})
