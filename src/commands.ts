/**
 * Command system for tosi-editable.
 *
 * Commands are the interface between the toolbar/keyboard and
 * the editing engine. Each command is a method that receives
 * the editable context and arguments parsed from the command string.
 */

import {
  leafNodes,
  topSingleParentAncestor,
  closestSingleParentAncestor,
} from './dom-utils'
import type { Selectable } from './selection'
import { spanify } from './selection'

/** Context passed to every command */
export interface EditableContext {
  root: HTMLElement
  selectable: Selectable
  find(selector: string): Element | null
  findAll(selector: string): Element[]
  selectedLeafNodes(): Node[]
  selectedBlocks(): Element[]
  insertionPoint(): HTMLInputElement | null
  block(node: Node): Element | null
  normalize(): void
  focus(): void
  updateUndo(command?: string, reason?: string): void
}

/** Parse a "key value key value" argument list into a CSS object */
export function makeCSS(args: string[]): Record<string, string> | null {
  if (args.length % 2 !== 0) {
    console.error('Error: expected even number of arguments', args)
    return null
  }
  const css: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    css[args[i]] = args[i + 1].replace(/\+/g, ' ')
  }
  return css
}

/** Apply a CSS object to an element */
function applyCSS(element: HTMLElement, css: Record<string, string>): void {
  for (const [key, value] of Object.entries(css)) {
    element.style.setProperty(key, value)
  }
}

/** Command definitions — extensible by adding new methods */
export const commands: Record<
  string,
  (ctx: EditableContext, ...args: string[]) => void
> = {
  /**
   * Style selected characters with CSS properties.
   * Usage: setText font-weight bold font-style italic
   */
  setText(ctx: EditableContext, ...args: string[]) {
    const css = makeCSS(args)
    if (!css) return

    // Despanify so we work with real text nodes
    ctx.selectable.resetBounds()
    spanify(ctx.root, false)
    ctx.selectable.markBounds()
    ctx.normalize()

    // Grab selected leaf nodes and remove bounds (they break single-parent chains)
    const nodes = ctx.selectedLeafNodes()
    ctx.selectable.removeBounds()

    for (const node of nodes) {
      if (node.nodeType === 3) {
        // Try to find an existing setText span in the single-parent chain
        const existing = closestSingleParentAncestor(node, '.setText')
        if (existing && existing instanceof HTMLElement) {
          applyCSS(existing, css)
        } else {
          // Wrap in a new styled span
          const span = document.createElement('span')
          span.className = 'setText'
          applyCSS(span, css)
          node.parentNode?.insertBefore(span, node)
          span.appendChild(node)
        }
      }
    }

    // Restore selection and update undo
    ctx.selectable.resetBounds()
    ctx.focus()
    ctx.updateUndo('new')
  },

  /**
   * Change the block type of selected blocks.
   * Usage: setBlockType h1
   */
  setBlockType(ctx: EditableContext, newNodeType: string) {
    const blocks = ctx.selectedBlocks()
    for (const block of blocks) {
      const newBlock = document.createElement(newNodeType)
      // Move children
      while (block.firstChild) {
        newBlock.appendChild(block.firstChild)
      }
      newBlock.classList.add('selected-block')
      block.parentNode?.replaceChild(newBlock, block)
    }
    ctx.updateUndo('new')
  },

  /**
   * Apply CSS to selected blocks.
   * Usage: setBlocks text-align center
   */
  setBlocks(ctx: EditableContext, ...args: string[]) {
    const css = makeCSS(args)
    if (!css) return
    for (const block of ctx.selectedBlocks()) {
      applyCSS(block as HTMLElement, css)
    }
    ctx.updateUndo('new')
  },

  /**
   * Undo/redo.
   * Usage: updateUndo undo | updateUndo redo
   */
  updateUndo(ctx: EditableContext, command: string) {
    ctx.updateUndo(command)
  },

  /**
   * Toggle debug mode on the editor root.
   * Usage: setDebug
   */
  setDebug(ctx: EditableContext) {
    ctx.root.classList.toggle('debug')
  },

  /**
   * Insert an annotation at the insertion point.
   * Usage: annotate note
   */
  annotate(ctx: EditableContext, type: string) {
    const insertionPoint = ctx.insertionPoint()
    if (!insertionPoint) return

    const template = document.querySelector(
      `.annotation-template .${type}`
    )
    if (!template) return

    const span = document.createElement('span')
    span.className = 'annotation do-not-spanify not-selectable not-editable'
    const body = template.cloneNode(true) as Element
    body.classList.add('annotation-body')
    span.appendChild(body)
    insertionPoint.after(span)
    ctx.updateUndo('new')
  },
}

/**
 * Parse and execute a command string.
 * Supports chained commands separated by semicolons.
 * Example: "setText font-weight bold; setBlockType h2"
 */
export function executeCommand(
  ctx: EditableContext,
  commandString: string
): void {
  const commandList = commandString.split(/;\s*/)
  for (const cmd of commandList) {
    const pieces = cmd.trim().split(/\s+/)
    const name = pieces.shift()
    if (!name) continue

    const fn = commands[name]
    if (fn) {
      fn(ctx, ...pieces)
    } else {
      console.error('unrecognized command', name)
    }
  }
}
