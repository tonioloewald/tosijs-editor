import { test, expect, describe } from 'bun:test'
import {
  commandButton,
  toolbarSpacer,
  characterStyleWidgets,
  paragraphStyleWidgets,
  undoRedoWidgets,
  minimalToolbar,
  defaultToolbar,
  debugWidget,
} from './toolbar'

describe('toolbar', () => {
  describe('commandButton', () => {
    test('creates a button element', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const btn = commandButton('Bold', 'setText font-weight bold', svg)
      expect(btn.tagName.toLowerCase()).toBe('button')
      expect(btn.getAttribute('value')).toBe('setText font-weight bold')
      expect(btn.getAttribute('title')).toBe('Bold')
    })

    test('sets data-shortcut when provided', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const btn = commandButton(
        'Bold',
        'setText font-weight bold',
        svg,
        'ctrl+b',
      )
      expect(btn.dataset.shortcut).toBe('ctrl+b')
    })
  })

  describe('toolbarSpacer', () => {
    test('creates a span element', () => {
      const spacer = toolbarSpacer()
      expect(spacer.tagName.toLowerCase()).toBe('span')
    })
  })

  describe('widget groups', () => {
    test('characterStyleWidgets returns 4 buttons', () => {
      const widgets = characterStyleWidgets()
      expect(widgets.length).toBe(4)
      expect(widgets[0].getAttribute('title')).toBe('Bold')
      expect(widgets[1].getAttribute('title')).toBe('Italic')
      expect(widgets[2].getAttribute('title')).toBe('Underline')
      expect(widgets[3].getAttribute('title')).toBe('Highlight')
    })

    test('paragraphStyleWidgets returns buttons and spacers', () => {
      const widgets = paragraphStyleWidgets()
      expect(widgets.length).toBeGreaterThan(5)
    })

    test('undoRedoWidgets returns 2 buttons', () => {
      const widgets = undoRedoWidgets()
      expect(widgets.length).toBe(2)
      expect(widgets[0].getAttribute('title')).toBe('Undo')
      expect(widgets[1].getAttribute('title')).toBe('Redo')
    })

    test('debugWidget creates a button', () => {
      const btn = debugWidget()
      expect(btn.getAttribute('value')).toBe('setDebug')
    })
  })

  describe('toolbar presets', () => {
    test('minimalToolbar creates widgets', () => {
      const toolbar = minimalToolbar()
      expect(toolbar.length).toBeGreaterThan(3)
    })

    test('defaultToolbar creates widgets', () => {
      const toolbar = defaultToolbar()
      expect(toolbar.length).toBeGreaterThan(10)
    })
  })
})
