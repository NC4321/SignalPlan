// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { inOpenDialog, isTyping } from './util.ts'

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

describe('inOpenDialog', () => {
  function keyIn(dialogOpen: boolean, from: 'inside' | 'body') {
    const dialog = document.createElement('dialog')
    const button = document.createElement('button')
    dialog.append(button)
    if (dialogOpen) dialog.setAttribute('open', '')
    document.body.append(dialog)
    const target = from === 'inside' ? button : document.body
    let result = false
    const listener = (event: KeyboardEvent) => {
      result = inOpenDialog(event)
    }
    window.addEventListener('keydown', listener)
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    )
    window.removeEventListener('keydown', listener)
    dialog.remove()
    return result
  }

  it('is true for keys in an open dialog, or on the body behind one', () => {
    expect(keyIn(true, 'inside')).toBe(true)
    expect(keyIn(true, 'body')).toBe(true)
  })

  it('is false with no dialog open', () => {
    expect(keyIn(false, 'inside')).toBe(false)
    expect(keyIn(false, 'body')).toBe(false)
  })
})
