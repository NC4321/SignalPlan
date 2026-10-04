// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { parsePlan } from '@signalplan/floorplan'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanLibrary } from './editor/library.ts'
import { blankPlan, planToFile, samplePlan } from './editor/persistence.ts'
import { rescueFile } from './rescue.ts'
import { workerFailureText } from './workerFailure.ts'

let library: PlanLibrary
let counter = 0
beforeEach(async () => {
  library = (await PlanLibrary.open(`rescue-${counter++}`))!
})
afterEach(() => library.close())

describe('rescueFile (D91)', () => {
  it('is the plan in the same format as File › Save to file', async () => {
    const plan = { ...samplePlan(), name: 'My house' }
    const file = await rescueFile(() => plan, library)
    expect(file?.name).toBe('My house.signalplan.json')
    expect(file?.text).toBe(planToFile(plan))
    const parsed = parsePlan(JSON.parse(file!.text))
    expect(parsed.ok).toBe(true)
  })

  it('works without a library', async () => {
    const file = await rescueFile(() => blankPlan(), undefined)
    expect(file?.name).toBe('Untitled plan.signalplan.json')
  })

  it('falls back to the last saved plan when the store’s can’t be read', async () => {
    const saved = { ...samplePlan(), name: 'Saved copy' }
    await library.save('one', saved)
    const file = await rescueFile(() => {
      throw new Error('store is broken')
    }, library)
    expect(file?.name).toBe('Saved copy.signalplan.json')
    expect(JSON.parse(file!.text).name).toBe('Saved copy')
  })

  it('falls back when the plan can’t be written out', async () => {
    await library.save('one', { ...samplePlan(), name: 'Saved copy' })
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    const file = await rescueFile(() => circular as never, library)
    expect(file?.name).toBe('Saved copy.signalplan.json')
  })

  it('says there’s nothing when neither can be read', async () => {
    const file = await rescueFile(() => {
      throw new Error('store is broken')
    }, library)
    expect(file).toBeUndefined()
  })
})

describe('workerFailureText', () => {
  it('uses the message of an error or an error event', () => {
    expect(workerFailureText(new Error('boom'))).toBe('boom')
    expect(workerFailureText({ message: 'Uncaught Error: boom' })).toBe('boom')
    expect(workerFailureText({ message: 'Uncaught RangeError: x' })).toBe('x')
  })

  it('says something plain when there is no message', () => {
    for (const failure of [undefined, {}, new Event('messageerror'), '', ' ']) {
      expect(workerFailureText(failure)).toBe(
        'the background calculation stopped unexpectedly',
      )
    }
  })
})
