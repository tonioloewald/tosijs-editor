/**
 * Toolbar factory for tosijs-styled-editor.
 *
 * Provides ready-made toolbar configurations using tosijs-ui icons and menus.
 * Toolbar buttons fire commands via their `value` attribute.
 * Menus use tosi-menu with actions that call doCommand on a provided editor.
 */

import { elements } from 'tosijs'
import { icons } from 'tosijs-ui/icons'
import { tosiMenu, type MenuItem, type SubMenu } from 'tosijs-ui/menu'
import { tosiLocalePicker, tosiLocalized } from 'tosijs-ui/localize'
import type { TosijsStyledEditor } from './tosijs-styled-editor'

const { button, span } = elements

/**
 * Create a toolbar command button with an icon.
 * The button's `value` attribute holds the command string.
 */
export function commandButton(
  title: string,
  command: string,
  icon: SVGElement,
  shortcut?: string,
): HTMLButtonElement {
  const attrs: Record<string, any> = {
    title,
    value: command,
    // tosijs-ui's convention: a JSON map of attribute -> translation key, applied
    // automatically (and re-applied on locale change). `localize` returns its
    // input when no row exists, so this is inert until a table is loaded.
    dataTosiLocalized: JSON.stringify({ title }),
  }
  if (shortcut) {
    attrs.dataShortcut = shortcut
  }
  return button(attrs, icon) as unknown as HTMLButtonElement
}

/** Create a spacer for visual grouping */
export function toolbarSpacer(width = '8px'): HTMLElement {
  return span({
    style: { display: 'inline-block', width },
  }) as unknown as HTMLElement
}

/** A menu label that re-renders itself when the locale changes */
function menuLabel(caption: string): HTMLElement {
  return tosiLocalized({ refString: caption }) as unknown as HTMLElement
}

/** A language picker for the menubar — flag only, no caption */
export function localePickerWidget(): HTMLElement {
  return tosiLocalePicker({
    slot: 'menubar',
    hideCaption: true,
  }) as unknown as HTMLElement
}

/** Create a menu item that dispatches an editor command */
function editorMenuItem(
  editor: TosijsStyledEditor,
  caption: string,
  command: string,
): MenuItem {
  return {
    caption,
    action() {
      editor.doCommand(command)
    },
  } as MenuItem
}

/** Paragraph style menu */
export function paragraphStyleMenu(editor: TosijsStyledEditor): HTMLElement {
  return tosiMenu(
    {
      slot: 'menubar',
      localized: true,
      menuItems: [
        editorMenuItem(editor, 'Title', 'setBlockType h1'),
        editorMenuItem(editor, 'Heading', 'setBlockType h2'),
        editorMenuItem(editor, 'Subheading', 'setBlockType h3'),
        editorMenuItem(editor, 'Minor Heading', 'setBlockType h4'),
        null,
        editorMenuItem(editor, 'Body', 'setBlockType p'),
        editorMenuItem(editor, 'Code Block', 'setBlockType pre'),
        editorMenuItem(editor, 'Blockquote', 'setBlockType blockquote'),
        null,
        editorMenuItem(editor, 'Bulleted List', 'setList ul'),
        editorMenuItem(editor, 'Numbered List', 'setList ol'),
        editorMenuItem(editor, 'No List', 'setList none'),
      ],
    },
    icons.type(),
    ' ',
    menuLabel('Style'),
  ) as unknown as HTMLElement
}

/** Justification menu */
export function justificationMenu(editor: TosijsStyledEditor): HTMLElement {
  return tosiMenu(
    {
      slot: 'menubar',
      localized: true,
      menuItems: [
        editorMenuItem(editor, 'Left', 'setBlocks text-align left'),
        editorMenuItem(editor, 'Center', 'setBlocks text-align center'),
        editorMenuItem(editor, 'Right', 'setBlocks text-align right'),
        editorMenuItem(editor, 'Justify', 'setBlocks text-align justify'),
      ],
    },
    icons.alignLeft(),
    ' ',
    menuLabel('Align'),
  ) as unknown as HTMLElement
}

/** Font family menu */
export function fontFamilyMenu(editor: TosijsStyledEditor): HTMLElement {
  return tosiMenu(
    {
      slot: 'menubar',
      localized: true,
      menuItems: [
        editorMenuItem(
          editor,
          'Times New Roman',
          'setText font-family Times+New+Roman',
        ),
        editorMenuItem(editor, 'Georgia', 'setText font-family Georgia'),
        editorMenuItem(editor, 'Helvetica', 'setText font-family Helvetica'),
        editorMenuItem(editor, 'Arial', 'setText font-family Arial'),
        null,
        editorMenuItem(editor, 'Serif', 'setText font-family serif'),
        editorMenuItem(editor, 'Sans-serif', 'setText font-family sans-serif'),
        editorMenuItem(editor, 'Monospace', 'setText font-family monospace'),
      ],
    },
    icons.type(),
    ' ',
    menuLabel('Font'),
  ) as unknown as HTMLElement
}

/** Font size menu */
export function fontSizeMenu(editor: TosijsStyledEditor): HTMLElement {
  return tosiMenu(
    {
      slot: 'menubar',
      localized: true,
      menuItems: [
        editorMenuItem(editor, '10', 'setText font-size 10px'),
        editorMenuItem(editor, '12', 'setText font-size 12px'),
        editorMenuItem(editor, '14', 'setText font-size 14px'),
        editorMenuItem(editor, '18', 'setText font-size 18px'),
        editorMenuItem(editor, '24', 'setText font-size 24px'),
        editorMenuItem(editor, '36', 'setText font-size 36px'),
      ],
    },
    ' ',
    menuLabel('Size'),
  ) as unknown as HTMLElement
}

/** Line spacing menu */
export function lineSpacingMenu(editor: TosijsStyledEditor): HTMLElement {
  return tosiMenu(
    {
      slot: 'menubar',
      localized: true,
      menuItems: [
        editorMenuItem(editor, 'Single', 'setBlocks line-height unset'),
        editorMenuItem(editor, '1.5', 'setBlocks line-height 1.875'),
        editorMenuItem(editor, 'Double', 'setBlocks line-height 2.5'),
      ],
    },
    ' ',
    menuLabel('Spacing'),
  ) as unknown as HTMLElement
}

/** Character formatting buttons (toolbar) */
export function characterStyleWidgets(): HTMLElement[] {
  return [
    commandButton(
      'Bold',
      'setText font-weight bold',
      icons.fontBold(),
      'ctrl+b',
    ),
    commandButton(
      'Italic',
      'setText font-style italic',
      icons.fontItalic(),
      'ctrl+i',
    ),
    commandButton(
      'Underline',
      'setText text-decoration underline',
      icons.underline(),
      'ctrl+u',
    ),
    commandButton(
      'Highlight',
      'setText background-color rgba(255,255,64,0.5)',
      icons.penTool(),
    ),
  ]
}

/** Paragraph formatting buttons (toolbar) */
export function paragraphStyleWidgets(): HTMLElement[] {
  return [
    commandButton('Align Left', 'setBlocks text-align left', icons.alignLeft()),
    commandButton('Center', 'setBlocks text-align center', icons.alignCenter()),
    commandButton(
      'Align Right',
      'setBlocks text-align right',
      icons.alignRight(),
    ),
    commandButton(
      'Justify',
      'setBlocks text-align justify',
      icons.alignJustify(),
    ),
    toolbarSpacer(),
    commandButton('Bulleted List', 'setList ul', icons.listBullet()),
    commandButton('Numbered List', 'setList ol', icons.listNumber()),
    toolbarSpacer(),
    commandButton('Indent', 'setBlocks margin-left 40px', icons.indent()),
    commandButton('Outdent', 'setBlocks margin-left 0px', icons.outdent()),
  ]
}

/** Undo/redo buttons (toolbar) */
export function undoRedoWidgets(): HTMLElement[] {
  return [
    commandButton('Undo', 'updateUndo undo', icons.rotateCcw(), 'ctrl+z'),
    commandButton('Redo', 'updateUndo redo', icons.rotateCw(), 'ctrl+y'),
  ]
}

/** Debug toggle (toolbar) */
export function debugWidget(): HTMLElement {
  return commandButton('Toggle Debug', 'setDebug', icons.bug())
}

/** Minimal toolbar: bold/italic/underline + undo/redo */
export function minimalToolbar(): HTMLElement[] {
  return [...characterStyleWidgets(), toolbarSpacer(), ...undoRedoWidgets()]
}

/** Default (full) toolbar */
export function defaultToolbar(): HTMLElement[] {
  return [
    ...characterStyleWidgets(),
    toolbarSpacer(),
    ...paragraphStyleWidgets(),
    toolbarSpacer(),
    ...undoRedoWidgets(),
    toolbarSpacer(),
    debugWidget(),
  ]
}

/** Table menu */
export function tableMenu(editor: TosijsStyledEditor): HTMLElement {
  return tosiMenu(
    {
      slot: 'menubar',
      localized: true,
      menuItems: [
        {
          caption: 'Insert Table',
          menuItems: [
            editorMenuItem(editor, '2 Columns', 'insertTable 2'),
            editorMenuItem(editor, '3 Columns', 'insertTable 3'),
            editorMenuItem(editor, '4 Columns', 'insertTable 4'),
            editorMenuItem(editor, '5 Columns', 'insertTable 5'),
          ],
        } as SubMenu,
        null,
        editorMenuItem(editor, 'Insert Row After', 'insertTableRow after'),
        editorMenuItem(editor, 'Insert Row Before', 'insertTableRow before'),
        editorMenuItem(editor, 'Insert Column After', 'insertTableCol after'),
        editorMenuItem(editor, 'Insert Column Before', 'insertTableCol before'),
        null,
        editorMenuItem(editor, 'Delete Row', 'deleteTableRow'),
        editorMenuItem(editor, 'Delete Column', 'deleteTableCol'),
        null,
        editorMenuItem(editor, 'Toggle Header Row', 'toggleHeaderRow'),
      ],
    },
    icons.grid(),
    ' ',
    menuLabel('Table'),
  ) as unknown as HTMLElement
}

/** Default menubar */
export function defaultMenubar(editor: TosijsStyledEditor): HTMLElement[] {
  return [
    paragraphStyleMenu(editor),
    justificationMenu(editor),
    fontFamilyMenu(editor),
    fontSizeMenu(editor),
    lineSpacingMenu(editor),
    tableMenu(editor),
  ]
}
