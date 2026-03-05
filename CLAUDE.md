# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tosi-editable** is a rich text editor web component that completely replaces browser `contentEditable`, `execCommand`, `getSelection`, and Range APIs with pure DOM manipulation. It is built on the tosijs/tosijs-ui ecosystem.

## Commands

```bash
bun install          # Install dependencies
bun start            # Dev server with hot reload (http://localhost:8789)
bun test             # Run all unit tests
bun run build        # Production build only
```

## Architecture

Three-layer TypeScript design, each building on the previous:

### src/dom-utils.ts — DOM Traversal Utilities
Pure functions for leaf-node navigation: `firstLeafNode`, `lastLeafNode`, `nextLeafNode`, `previousLeafNode`, `siblingOrder`, `isBefore`, `leafNodes`, `topSingleParentAncestor`, `closestSingleParentAncestor`, `allowSelection`. The concept of **leaf nodes** (nodes with no children) is fundamental — nearly all editor operations work in terms of leaf nodes.

### src/selection.ts — Custom Selection System
`Selectable` class that replaces browser selection by **spanifying** text — wrapping each character in a `<span>` to determine exact positions. Selection bounds are tracked with `.sel-start` and `.sel-end` marker elements; selected text gets the `.selected` CSS class. The caret is an `<input>` element (to trigger mobile keyboards).

### src/tosi-editable.ts — Web Component
`TosiEditable extends Component` (tosijs web component). Implements a **command-based architecture** where all editing operations go through `doCommand()`. Commands are on the extensible `editable.commands` object.

### src/commands.ts — Command Definitions
Extracted for testability. Commands: `setText` (character styling), `setBlockType` (paragraph type), `setBlocks` (block-level CSS), `updateUndo` (undo/redo), `setDebug`, `annotate`. Multiple commands chain with semicolons.

### src/toolbar.ts — Toolbar Factory
`defaultToolbar()` and `minimalToolbar()` create toolbar widgets using tosijs-ui `icons` and `tosiSelect`. Helper functions: `commandButton`, `blockStyleSelect`, `toolbarSpacer`.

## Key Concepts

- **Leaf nodes**: All cursor/selection operations navigate between text-level leaf nodes
- **Single parent chains**: Chains of elements with only one child — deletion removes the entire chain
- **Spanification**: Temporarily wrapping characters in spans to determine positions without browser APIs
- **Bounds**: `.caret`, `.sel-start`, `.sel-end` elements mark insertion point and selection range

## Dependencies

- **Peer**: `tosijs` (web component base, elements, CSS), `tosijs-ui` (icons, select, menus)
- **Dev**: `happy-dom` (DOM simulation for tests), `chokidar` (file watching), `bun-types`, `typescript`

## Testing

Tests use `bun:test` with `happy-dom` for DOM simulation. Each source module has a corresponding `.test.ts` file. Test setup is in `test-setup.ts` (configured via `bunfig.toml`).

## Legacy Files

The original jQuery-based implementation is preserved in the root: `edx-shared.js`, `edx-selectable.js`, `edx-editable.js`, `index.html`, `tools.html`, `styles.css`, `constitution.html`, `tests.html`, `selectable.html`, `lib/`.
