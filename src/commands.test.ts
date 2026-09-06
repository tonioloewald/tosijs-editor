import { test, expect, describe, beforeEach } from 'bun:test'
import { makeCSS, commands, executeCommand } from './commands'
import { Selectable } from './selection'
import type { EditableContext } from './commands'

describe('makeCSS', () => {
  test('parses pairs into CSS object', () => {
    const css = makeCSS(['font-weight', 'bold', 'font-style', 'italic'])
    expect(css).toEqual({ 'font-weight': 'bold', 'font-style': 'italic' })
  })

  test('replaces + with space in values', () => {
    const css = makeCSS(['font-family', 'Times+New+Roman'])
    expect(css).toEqual({ 'font-family': 'Times New Roman' })
  })

  test('returns null for odd number of arguments', () => {
    const css = makeCSS(['font-weight'])
    expect(css).toBeNull()
  })

  test('returns empty object for empty args', () => {
    const css = makeCSS([])
    expect(css).toEqual({})
  })
})

function createContext(root: HTMLElement): EditableContext {
  const selectable = new Selectable(root)
  return {
    root,
    selectable,
    find: (sel: string) => root.querySelector(sel),
    findAll: (sel: string) => Array.from(root.querySelectorAll(sel)),
    selectedLeafNodes() {
      const selected = root.querySelectorAll('.selected')
      const nodes: Node[] = []
      for (const el of selected) {
        for (let i = 0; i < el.childNodes.length; i++) {
          const child = el.childNodes[i]
          if (!child.firstChild) nodes.push(child)
        }
      }
      return nodes
    },
    selectedBlocks: () =>
      Array.from(root.querySelectorAll('.selected-block')),
    insertionPoint() {
      return root.querySelector('input.caret') as HTMLInputElement | null
    },
    block(node: Node) {
      let current: Node | null = node
      while (current && current.parentNode !== root) {
        current = current.parentNode
      }
      return current instanceof Element ? current : null
    },
    normalize() {
      root.normalize()
    },
    focus() {},
    updateUndo() {},
  }
}

describe('commands.setBlockType', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  test('changes paragraph to heading', () => {
    root.innerHTML = '<p class="selected-block">Hello</p>'
    const ctx = createContext(root)
    commands.setBlockType(ctx, 'h1')
    expect(root.querySelector('h1')).not.toBeNull()
    expect(root.querySelector('h1')!.textContent).toBe('Hello')
    expect(root.querySelector('p')).toBeNull()
  })

  test('preserves content when changing block type', () => {
    root.innerHTML =
      '<p class="selected-block"><b>Bold</b> and <i>italic</i></p>'
    const ctx = createContext(root)
    commands.setBlockType(ctx, 'blockquote')
    const bq = root.querySelector('blockquote')!
    expect(bq).not.toBeNull()
    expect(bq.querySelector('b')!.textContent).toBe('Bold')
    expect(bq.querySelector('i')!.textContent).toBe('italic')
  })

  test('changes multiple selected blocks', () => {
    root.innerHTML =
      '<p class="selected-block">A</p><p class="selected-block">B</p>'
    const ctx = createContext(root)
    commands.setBlockType(ctx, 'h2')
    const headings = root.querySelectorAll('h2')
    expect(headings.length).toBe(2)
  })
})

describe('commands.setBlocks', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  test('applies CSS to selected blocks', () => {
    root.innerHTML = '<p class="selected-block">Hello</p>'
    const ctx = createContext(root)
    commands.setBlocks(ctx, 'text-align', 'center')
    expect(
      (root.querySelector('p') as HTMLElement).style.getPropertyValue(
        'text-align'
      )
    ).toBe('center')
  })

  test('applies multiple CSS properties', () => {
    root.innerHTML = '<p class="selected-block">Hello</p>'
    const ctx = createContext(root)
    commands.setBlocks(ctx, 'text-align', 'right', 'line-height', '2')
    const p = root.querySelector('p') as HTMLElement
    expect(p.style.getPropertyValue('text-align')).toBe('right')
    expect(p.style.getPropertyValue('line-height')).toBe('2')
  })
})

describe('commands.setDebug', () => {
  test('toggles debug class on root', () => {
    const root = document.createElement('div')
    const ctx = createContext(root)
    commands.setDebug(ctx)
    expect(root.classList.contains('debug')).toBe(true)
    commands.setDebug(ctx)
    expect(root.classList.contains('debug')).toBe(false)
  })
})

describe('executeCommand', () => {
  test('parses and executes a single command', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p class="selected-block">Hello</p>'
    document.body.appendChild(root)
    const ctx = createContext(root)
    executeCommand(ctx, 'setBlockType h2')
    expect(root.querySelector('h2')).not.toBeNull()
    root.remove()
  })

  test('executes chained commands', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p class="selected-block">Hello</p>'
    document.body.appendChild(root)
    const ctx = createContext(root)
    executeCommand(ctx, 'setBlockType h2; setBlocks text-align center')
    expect(root.querySelector('h2')).not.toBeNull()
    expect(
      (root.querySelector('h2') as HTMLElement).style.getPropertyValue(
        'text-align'
      )
    ).toBe('center')
    root.remove()
  })

  test('ignores empty commands', () => {
    const root = document.createElement('div')
    const ctx = createContext(root)
    // Should not throw
    executeCommand(ctx, '  ;  ; ')
  })

  test('resolves against ctx.commands when provided', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const ctx = createContext(root)
    const calls: string[][] = []
    ctx.commands = {
      ...commands,
      custom: (_ctx, ...args) => {
        calls.push(args)
      },
    }
    executeCommand(ctx, 'custom alpha beta')
    expect(calls).toEqual([['alpha', 'beta']])
    root.remove()
  })

  test('custom commands can override built-ins', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p class="selected-block">Hello</p>'
    document.body.appendChild(root)
    const ctx = createContext(root)
    let called = false
    ctx.commands = {
      ...commands,
      setBlockType: () => {
        called = true
      },
    }
    executeCommand(ctx, 'setBlockType h2')
    expect(called).toBe(true)
    expect(root.querySelector('h2')).toBeNull()
    root.remove()
  })

  test('logs error for unknown command', () => {
    const root = document.createElement('div')
    const ctx = createContext(root)
    const errors: string[] = []
    const origError = console.error
    console.error = (...args: any[]) => errors.push(args.join(' '))
    executeCommand(ctx, 'nonExistentCommand')
    console.error = origError
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('unrecognized command')
  })
})
