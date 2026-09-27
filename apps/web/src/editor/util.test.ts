// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isTyping } from './util.ts'

function keyFrom(element: HTMLElement) {
  document.body.append(element)
  let result = false
  element.addEventListener('keydown', (event) => {
    result = isTyping(event)
  })
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', bubbles: true }),
  )
  element.remove()
  return result
}

const input = (type: string) =>
  Object.assign(document.createElement('input'), { type })

describe('isTyping', () => {
  it('is true in text fields', () => {
    expect(keyFrom(input('text'))).toBe(true)
    expect(keyFrom(document.createElement('textarea'))).toBe(true)
  })

  it('is false on radio buttons, checkboxes and buttons', () => {
    expect(keyFrom(input('radio'))).toBe(false)
    expect(keyFrom(input('checkbox'))).toBe(false)
    expect(keyFrom(document.createElement('button'))).toBe(false)
  })
})
