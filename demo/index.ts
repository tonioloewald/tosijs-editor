/**
 * Bundle entry for the doc site.
 *
 * `bundleEntry` REPLACES tosijs-ui's published iife.js — it does not add to it —
 * so this entry has to register everything the pages need, not just our own
 * elements. `doc-browser` registers `<tosi-doc-system>` (the header, menu and
 * nav) and `live-example` registers `<tosi-example>`; without them the pages
 * render their prerendered markup with no chrome and no examples, and nothing
 * errors, because the custom elements simply never upgrade.
 *
 * Import those SUBPATHS, not the `tosijs-ui` root: the root drags in every
 * component, including `mapbox`, whose source carries a Mapbox token that
 * GitHub push protection blocks when it lands in a committed sourcemap.
 *
 * Importing our library registers <tosi-styled-editor>, so `html` examples in
 * doc comments work with no import. The factories are also exposed globally so
 * `js` examples can build toolbars and menubars.
 */
import 'tosijs-ui/doc-browser'
import 'tosijs-ui/live-example'
import {
  tosiEditable,
  defaultToolbar,
  minimalToolbar,
  defaultMenubar,
} from '../src/index'

Object.assign(globalThis, {
  tosiEditable,
  defaultToolbar,
  minimalToolbar,
  defaultMenubar,
})
