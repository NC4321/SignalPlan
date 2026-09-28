import { blankPlan } from './persistence.ts'
import { describe, expect, it } from 'vitest'
import {
  EXPORT_SIZES,
  exportFileName,
  PLAN_AREA,
  scaleBar,
} from './exportImage.ts'

describe('scaleBar', () => {
  it('picks the longest round length in metres that fits', () => {
    // 56 px per metre, 238 px available: 5 m would be 280 px, 2 m is 112 px.
    expect(scaleBar(56, 238, 'metric')).toEqual({ metres: 2, label: '2 m' })
    expect(scaleBar(1000, 238, 'metric')).toEqual({
      metres: 0.2,
      label: '20 cm',
    })
  })

  it('uses feet in imperial', () => {
    // 10 ft is 3.048 m = 171 px at 56 px/m; 20 ft would be 341 px.
    const bar = scaleBar(56, 238, 'imperial')
    expect(bar.label).toBe('10 ft')
    expect(bar.metres).toBeCloseTo(3.048, 9)
  })

  it('falls back to the shortest length when nothing fits', () => {
    expect(scaleBar(10000, 238, 'metric').metres).toBe(0.1)
  })
})

describe('exportFileName', () => {
  it('names the image after the plan and band', () => {
    expect(exportFileName({ ...blankPlan(), name: 'My house' }, '5GHz')).toBe(
      'My house - 5 GHz.png',
    )
    expect(exportFileName({ ...blankPlan(), name: 'a/b: c?' }, '6GHz')).toBe(
      'a-b- c- - 6 GHz.png',
    )
  })
})

describe('export layout', () => {
  it('keeps every size at the 16:10 page proportions', () => {
    for (const size of EXPORT_SIZES) {
      expect(size.width / size.height).toBe(1.6)
    }
  })

  it('leaves room for the sidebar beside the plan', () => {
    expect(PLAN_AREA.x + PLAN_AREA.width).toBeLessThanOrEqual(1280 - 256 - 24)
  })
})
