/**
 * Bundle entry for the doc site.
 *
 * Importing the library registers <tosi-styled-editor>, so `html` examples in
 * doc comments work with no import. The factories are also exposed globally so
 * `js` examples can build toolbars and menubars.
 */
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
