import { describe, expect, it } from 'vitest'
import { VIEW3D_FAILURES, type View3DFailure } from './failures.ts'

describe('the 3D view’s failure messages', () => {
  const kinds = Object.keys(VIEW3D_FAILURES) as View3DFailure[]

  it('each says what happened and offers the 2D map', () => {
    for (const kind of kinds) {
      expect(VIEW3D_FAILURES[kind].message).toContain('the 2D map')
      expect(VIEW3D_FAILURES[kind].message).toMatch(/\.$/)
    }
  })

  it('offers hardware acceleration where WebGL is missing, and no retry', () => {
    expect(VIEW3D_FAILURES['no-webgl'].message).toContain(
      'hardware acceleration',
    )
    expect(VIEW3D_FAILURES['no-webgl'].canRetry).toBe(false)
  })

  it('offers a retry for the ones that may pass', () => {
    expect(VIEW3D_FAILURES.lost.canRetry).toBe(true)
    expect(VIEW3D_FAILURES.broken.canRetry).toBe(true)
  })
})
