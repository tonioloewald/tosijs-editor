import { Window } from 'happy-dom'

const window = new Window()

// Patch error constructors onto happy-dom Window for Bun compatibility.
const errorConstructors = ['SyntaxError', 'TypeError', 'RangeError'] as const
for (const name of errorConstructors) {
  if ((window as any)[name] === undefined) {
    ;(window as any)[name] = globalThis[name]
  }
}

// Expose all window properties to globalThis for DOM compatibility
const windowProps = [
  'window',
  'document',
  'localStorage',
  'addEventListener',
  'removeEventListener',
  'HTMLElement',
  'HTMLSpanElement',
  'HTMLDivElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLFormElement',
  'HTMLAnchorElement',
  'HTMLImageElement',
  'HTMLTableElement',
  'HTMLTemplateElement',
  'HTMLProgressElement',
  'HTMLDialogElement',
  'HTMLLabelElement',
  'HTMLSelectElement',
  'HTMLOptionElement',
  'HTMLTextAreaElement',
  'customElements',
  'Element',
  'Node',
  'Text',
  'DocumentFragment',
  'Range',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'InputEvent',
  'FocusEvent',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
  'CSSStyleDeclaration',
  'SVGElement',
  'SVGSVGElement',
  'DOMParser',
  'XMLSerializer',
  'NodeList',
  'HTMLCollection',
  'URL',
  'URLSearchParams',
]

const globals: Record<string, unknown> = { window }

for (const prop of windowProps) {
  if ((window as unknown as Record<string, unknown>)[prop] !== undefined) {
    globals[prop] = (window as unknown as Record<string, unknown>)[prop]
  }
}

// Bind functions that need window context
globals.getComputedStyle = window.getComputedStyle.bind(window)
globals.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globals.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
globals.fetch = window.fetch.bind(window)

Object.assign(globalThis, globals)
