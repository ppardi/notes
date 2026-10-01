<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Colored ink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reader pick one of six colors before drawing, so each stroke
carries its own color through the canvas, the saved PNG, and back.

**Architecture:** A new `src/inkPalette.js` owns which colors exist, which one
is in force, and validation of any color arriving from outside. Color becomes a
field on a stroke (`{points, color}`), so the three renderers set `fillStyle`
per stroke instead of inheriting one set on the context. The theme keeps being
applied where ink is *shown* — the dark-mode CSS filter gains `hue-rotate(180deg)`
so it flips lightness without destroying hue.

**Tech Stack:** Vue 3 (Options API), `@nextcloud/vue` (`NcButton`, `NcActions`,
`NcActionButton`), Canvas 2D, vitest + jsdom for unit tests, Playwright for e2e.

**Spec:** `docs/INK-COLOR-DESIGN.md` — read it first. It records what was
measured (the contrast table, the browser agreement, the theme scoping) and why
each decision follows.

## Global Constraints

- Every new file needs an SPDX header; CI enforces REUSE compliance. Copy the
  header from `src/inkRender.js` verbatim, changing nothing.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`) — CI enforces them.
- Every commit ends with the trailer `Assisted-by: Claude Code:claude-opus-5`
  and `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **Never** add
  `Signed-off-by`.
- **American spelling** in all comments, test names, and prose: color, behavior,
  center, recognize, gray.
- Comments describe what the code does and constraints it cannot express. Never
  "changed X to Y" or "this fixes…". Match the surrounding comment density,
  which in the ink files is high and explanatory.
- The six colors are exactly: `#000000`, `#cc0000`, `#b35900`, `#008800`,
  `#0044cc`, `#7733cc`. These values are measured; do not adjust them by eye.
- `npm run lint` and `npm run stylelint` must pass. `npm run test` must stay at
  21 files passing with no failures.
- Do not run `npm run test:e2e` casually: it calls `deleteAllNotesVia()` and
  **wipes the dev container's notes**.
- Never `git push` and never publish a release. Commit only.

## Review Focus

Five things the spec implies that no task's happy path exercises. Each has a
test assigned to the task that owns the code.

1. **A stroke loaded from a file with a color that is not in the palette** —
   e.g. `#ff00ff` from a hand-edited file. Expected: drawn in the default, never
   passed to `fillStyle`, **and saved back as the default rather than as the
   value it came in with**. Validating only on the way to the canvas would leave
   the picture black while the metadata beside it still claimed magenta, and
   this codebase's rule is that the picture and the strokes that drew it cannot
   come to disagree (`rubOut()` says so in as many words). Pinned in Task 2 for
   the validator and Task 3 for both halves of the round trip.
2. **`localStorage.getItem` throwing** — Safari private browsing throws rather
   than returning null. Expected: the default color, canvas opens normally.
   Pinned in Task 2.
3. **`localStorage.setItem` throwing** — quota exceeded, or the same private
   mode. Expected: the color still applies to this session's strokes; only the
   remembering is lost. Pinned in Task 2.
4. **A stroke object with no `color` key at all** — every file written before
   this change. Expected: the default color. Pinned in Task 3.
5. **Undo after a color change** — the strokes in `history` must keep the color
   they were drawn with, not the color currently selected. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/inkPalette.js` **(new)** | Which colors exist, the default, validation, and the remembered choice. No canvas, no Vue. |
| `src/tests/inkPalette.spec.js` **(new)** | Unit tests for the above. |
| `src/inkRender.js` | Geometry only. Loses `INK_COLOR`; `traceStroke` is unchanged and still expects the caller to have set `fillStyle`. |
| `src/inkErase.js` | Gains its own `ERASER_COLOR` instead of borrowing the ink's. |
| `src/components/InkCanvas.vue` | Holds the selected color, stamps it onto each stroke, sets `fillStyle` per stroke in all three render paths, and shows the picker. |
| `src/components/NoteRich.vue` | The dark-mode filter on the picture in the note. |
| `src/tests/inkRender.spec.js`, `src/tests/inkErase.spec.js`, `src/tests/inkCanvas.spec.js` | Updated for the moved constant and the new behavior. |
| `playwright/e2e/ink.spec.ts` | Color survives a save and a reopen; the filter is applied on a dark theme. |

**Why `traceStroke` does not take a color:** it draws geometry and fills with
whatever the context carries. Threading a color through it would put the palette
inside the geometry module. The renderers set `fillStyle` immediately before
each call instead.

---

### Task 1: Move the ink color out of the geometry module

Groundwork with no user-visible change. `INK_COLOR` lives in `src/inkRender.js`
and is imported by `src/inkErase.js` for the eraser's outline ring — which is
interface, not ink, and must stop tracking it once ink has six colors.

**Files:**
- Create: `src/inkPalette.js`
- Create: `src/tests/inkPalette.spec.js`
- Modify: `src/inkRender.js` (remove `INK_COLOR`, lines 8–16)
- Modify: `src/inkErase.js` (its import on line 6, and `traceEraser`'s `strokeStyle`)
- Modify: `src/tests/inkRender.spec.js` (drops the `INK_COLOR` import and its test)
- Modify: `src/components/InkCanvas.vue` (import, and the two `fillStyle` sites)

**Interfaces:**
- Produces: `INK_COLORS: Array<{key: string, value: string}>` (ordered),
  `DEFAULT_INK_COLOR: string` (`'#000000'`), both from `src/inkPalette.js`.
  `ERASER_COLOR: string` from `src/inkErase.js`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/inkPalette.spec.js`:

```js
/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_INK_COLOR, INK_COLORS } from '../inkPalette.js'

describe('the palette', () => {
	it('offers the six measured colors, in order', () => {
		expect(INK_COLORS.map((color) => color.value)).toEqual([
			'#000000', '#cc0000', '#b35900', '#008800', '#0044cc', '#7733cc',
		])
	})

	it('starts at black, which is what every drawing made before color is', () => {
		expect(DEFAULT_INK_COLOR).toBe('#000000')
		expect(INK_COLORS[0].value).toBe(DEFAULT_INK_COLOR)
	})

	it('gives every color a key, so the picker can name it without reading hex', () => {
		expect(INK_COLORS.map((color) => color.key)).toEqual([
			'ink', 'red', 'orange', 'green', 'blue', 'purple',
		])
	})
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -- inkPalette`
Expected: FAIL — `Failed to resolve import "../inkPalette.js"`.

- [ ] **Step 3: Create the palette module**

Create `src/inkPalette.js`:

```js
/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * What ink can be written in.
 *
 * Ordered, because the picker shows them in this order and a stored value has
 * to mean the same color tomorrow. The keys are stable identifiers; the names
 * a reader sees are translated in the component, so this module stays free of
 * the translation globals and can be tested on its own.
 *
 * Every value was chosen against a measurement rather than by eye: each clears
 * 4.5:1 against the light theme's background and 7:1 against both dark ones,
 * after the dark-mode filter has flipped its lightness. `docs/INK-COLOR-DESIGN.md`
 * carries the table. A seventh color needs the same two numbers before it
 * belongs here.
 */
export const INK_COLORS = [
	{ key: 'ink', value: '#000000' },
	{ key: 'red', value: '#cc0000' },
	{ key: 'orange', value: '#b35900' },
	{ key: 'green', value: '#008800' },
	{ key: 'blue', value: '#0044cc' },
	{ key: 'purple', value: '#7733cc' },
]

/**
 * What a stroke is drawn in when it says nothing else.
 *
 * Black, so a file written before strokes carried a color reads exactly as it
 * did - and so the canvas a reader has never touched the picker on behaves the
 * way it always has.
 */
export const DEFAULT_INK_COLOR = INK_COLORS[0].value
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm run test -- inkPalette`
Expected: PASS, 3 tests.

- [ ] **Step 5: Give the eraser its own color**

In `src/inkErase.js`, change the import on line 6 from

```js
import { INK_COLOR, STROKE_SIZE } from './inkRender.js'
```

to

```js
import { STROKE_SIZE } from './inkRender.js'
```

and add this constant beside the other constants near the top of the file:

```js
/**
 * The eraser's outline.
 *
 * Interface rather than ink: it marks where the eraser is, so it follows the
 * same themed filter the canvas does and has no business tracking whatever
 * color the pen happens to be set to.
 */
export const ERASER_COLOR = '#000000'
```

Then in `traceEraser`, change `context.strokeStyle = INK_COLOR` to
`context.strokeStyle = ERASER_COLOR`.

- [ ] **Step 6: Remove `INK_COLOR` from the geometry module**

Delete lines 8–16 of `src/inkRender.js` — the whole doc comment beginning
"What every stroke is drawn and saved in." together with the
`export const INK_COLOR = '#000000'` line beneath it.

- [ ] **Step 7: Point the remaining importers at the new home**

In `src/components/InkCanvas.vue`, change the `inkRender.js` import line from

```js
import { INK_COLOR, INK_DENSITY, inkBounds, placeInk, shiftStrokes, STROKE_SIZE, traceStroke } from '../inkRender.js'
```

to

```js
import { DEFAULT_INK_COLOR } from '../inkPalette.js'
import { INK_DENSITY, inkBounds, placeInk, shiftStrokes, STROKE_SIZE, traceStroke } from '../inkRender.js'
```

(keep the import list alphabetically ordered as the file already has it — the
`inkPalette.js` line goes immediately before the `inkRender.js` line), and
replace both `context.fillStyle = INK_COLOR` occurrences with
`context.fillStyle = DEFAULT_INK_COLOR`. These two sites are rewritten properly
in Task 3; this step only keeps the build working.

- [ ] **Step 8: Update the tests that named the old constant**

In `src/tests/inkRender.spec.js`, remove `INK_COLOR` from the import on line 7,
and delete the test containing `expect(INK_COLOR).toBe('#000000')` — the
palette module's own test now covers it.

In `src/tests/inkCanvas.spec.js`, change line 28 from

```js
const { CROP_MARGIN, INK_COLOR, INK_DENSITY } = await import('../inkRender.js')
```

to

```js
const { CROP_MARGIN, INK_DENSITY } = await import('../inkRender.js')
const { DEFAULT_INK_COLOR } = await import('../inkPalette.js')
```

and replace the two assertions near line 1172 that read `toBe(INK_COLOR)` with
`toBe(DEFAULT_INK_COLOR)`.

- [ ] **Step 9: Run the whole suite and the linters**

Run: `npm run test && npm run lint && npm run stylelint`
Expected: 22 test files passing (21 plus the new `inkPalette.spec.js`), 479 tests
— the 477 that passed before, plus 3 added here, minus the 1 deleted in Step 8.
A different total means something else moved; find out what before continuing.
Lint: 0 errors (3 pre-existing warnings in `EditorEasyMDE.vue` are expected).

- [ ] **Step 10: Commit**

```bash
git add src/inkPalette.js src/tests/inkPalette.spec.js src/inkRender.js src/inkErase.js src/tests/inkRender.spec.js src/tests/inkCanvas.spec.js src/components/InkCanvas.vue
git commit -F - <<'MSG'
refactor(ink): a palette module, and an eraser that owns its own color

The ink color lived in the geometry module and the eraser's outline
borrowed it. The outline is interface: it marks where the eraser is and
has no business tracking what the pen is set to. Ink is about to have six
colors, which makes one shared constant wrong for both.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: Validation, and remembering the choice

Everything that decides *which* color is in force, with no canvas involved.
Covers Review Focus items 1, 2 and 3.

**Files:**
- Modify: `src/inkPalette.js`
- Modify: `src/tests/inkPalette.spec.js`

**Interfaces:**
- Consumes: `INK_COLORS`, `DEFAULT_INK_COLOR` from Task 1.
- Produces: `knownColor(value: string | null | undefined): string`,
  `rememberedColor(): string`, `rememberColor(value: string): void`, all from
  `src/inkPalette.js`.

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/inkPalette.spec.js`, and add `beforeEach` and `vi` to the
existing `vitest` import so the first line reads
`import { beforeEach, describe, expect, it, vi } from 'vitest'`, and add
`knownColor, rememberColor, rememberedColor` to the `../inkPalette.js` import:

```js
describe('knownColor', () => {
	it('passes a color from the palette through', () => {
		expect(knownColor('#cc0000')).toBe('#cc0000')
	})

	it('refuses one that is not in the palette', () => {
		/* An ink file can be copied in from anywhere, or edited. What it says
		   reaches fillStyle, so an arbitrary string must not. */
		expect(knownColor('#ff00ff')).toBe(DEFAULT_INK_COLOR)
	})

	it('refuses something that is not a color at all', () => {
		expect(knownColor('url(http://example.com/x.png)')).toBe(DEFAULT_INK_COLOR)
		expect(knownColor('')).toBe(DEFAULT_INK_COLOR)
		expect(knownColor(null)).toBe(DEFAULT_INK_COLOR)
		expect(knownColor(undefined)).toBe(DEFAULT_INK_COLOR)
	})

	it('is case insensitive, since hex is', () => {
		expect(knownColor('#CC0000')).toBe('#cc0000')
	})
})

describe('the remembered color', () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it('is the default until one is chosen', () => {
		expect(rememberedColor()).toBe(DEFAULT_INK_COLOR)
	})

	it('comes back after it is set', () => {
		rememberColor('#0044cc')
		expect(rememberedColor()).toBe('#0044cc')
	})

	it('refuses a stored value that is not in the palette', () => {
		window.localStorage.setItem('notes-ink-color', '#ff00ff')
		expect(rememberedColor()).toBe(DEFAULT_INK_COLOR)
	})

	it('is the default when storage cannot be read', () => {
		/* Private browsing throws rather than returning null. The canvas has to
		   open regardless; a forgotten color is not a reason to fail. */
		vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
			throw new Error('denied')
		})
		expect(rememberedColor()).toBe(DEFAULT_INK_COLOR)
		vi.restoreAllMocks()
	})

	it('does not throw when storage cannot be written', () => {
		/* The color still applies to this session's strokes. Only the
		   remembering is lost, and that is not worth an error. */
		vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
			throw new Error('quota')
		})
		expect(() => rememberColor('#0044cc')).not.toThrow()
		vi.restoreAllMocks()
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- inkPalette`
Expected: FAIL — `knownColor is not a function` (and the same for the other two).

- [ ] **Step 3: Implement**

Append to `src/inkPalette.js`:

```js
/* Where the last choice is kept. Per browser, not per note: the pen is a tool,
   and a tool stays where it was left. */
const REMEMBERED = 'notes-ink-color'

/**
 * The palette's own version of a color, or the default.
 *
 * Everything arriving from outside this module goes through here: a stroke read
 * out of a file, and the value read back from storage. An ink file can be
 * copied in from anywhere and edited by anything, and what it says would
 * otherwise reach fillStyle directly - where an unrecognized string silently
 * draws nothing at all.
 *
 * @param {string | null | undefined} value what was found
 * @return {string} a color this palette offers
 */
export function knownColor(value) {
	const wanted = typeof value === 'string' ? value.toLowerCase() : ''
	return INK_COLORS.some((color) => color.value === wanted) ? wanted : DEFAULT_INK_COLOR
}

/**
 * The color to open the canvas in.
 *
 * @return {string} the last color chosen here, or the default
 */
export function rememberedColor() {
	try {
		return knownColor(window.localStorage.getItem(REMEMBERED))
	} catch {
		/* Storage can be unreadable - a private window, or site data blocked.
		   The canvas still opens; it just opens in black. */
		return DEFAULT_INK_COLOR
	}
}

/**
 * Keep this color for next time.
 *
 * @param {string} value the chosen color
 */
export function rememberColor(value) {
	try {
		window.localStorage.setItem(REMEMBERED, knownColor(value))
	} catch {
		/* Full, or unwritable. The choice still holds for as long as this
		   canvas is open, which is the part that matters now. */
	}
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test -- inkPalette`
Expected: PASS, 13 tests in the file.

- [ ] **Step 5: Run the whole suite and the linters**

Run: `npm run test && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/inkPalette.js src/tests/inkPalette.spec.js
git commit -F - <<'MSG'
feat(ink): validate a color, and remember the one in use

A color arriving from a file or from storage is checked against the
palette before anything draws with it. An ink file can be copied in from
anywhere, and an unrecognized fillStyle draws nothing at all rather than
failing loudly.

Storage that cannot be read or written is a default, not an error: a
canvas that will not open because a private window refused localStorage
would be a far worse fault than a forgotten color.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: A stroke carries its own color

The canvas change, with no picker yet — the color is fixed at the default, so
nothing a reader can see changes, but the three render paths now take it from
the stroke. Covers Review Focus item 4.

Today `fit()` sets `fillStyle` once per context (`src/components/InkCanvas.vue`,
in the `for (const which of ['page', 'canvas'])` loop) and `renderPage()` and
`paintLive()` set none at all, relying on it. That is why a resize has to redo
it. After this task the color belongs to the stroke and `fit()` sets none.

**Files:**
- Modify: `src/components/InkCanvas.vue`
- Modify: `src/tests/inkCanvas.spec.js`

**Interfaces:**
- Consumes: `knownColor`, `DEFAULT_INK_COLOR` from `src/inkPalette.js`.
- Produces: strokes shaped `{points: Array<Array<number>>, color: string}`;
  a `color` field in the component's `data()`; a method `colorOf(stroke)`.

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/inkCanvas.spec.js`, inside the `describe('InkCanvas', …)`
block. The helpers `open`, `pointer`, `live` and `page` already exist in this
file; `live` and `page` are defined near line 928, so place these tests after
that point.

```js
	it('draws each stroke in its own color', async () => {
		const wrapper = await open()
		wrapper.vm.strokes = [
			{ points: [[10, 10, 0.5]], color: '#cc0000' },
			{ points: [[20, 20, 0.5]], color: '#0044cc' },
		]

		wrapper.vm.renderPage()

		/* The context carries one color at a time, so what is asserted is the
		   sequence it was set to - the last stroke's color is all that would
		   survive on the context itself. */
		expect(page(wrapper).fillStyles).toEqual(['#cc0000', '#0044cc'])
	})

	it('draws a stroke with no color of its own in the default', async () => {
		/* Every file written before strokes carried a color. */
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[10, 10, 0.5]] }]

		wrapper.vm.renderPage()

		expect(page(wrapper).fillStyles).toEqual([DEFAULT_INK_COLOR])
	})

	it('refuses a color from a file that is not in the palette', async () => {
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[10, 10, 0.5]], color: '#ff00ff' }]

		wrapper.vm.renderPage()

		expect(page(wrapper).fillStyles).toEqual([DEFAULT_INK_COLOR])
	})

	it('saves a refused color as the one it was drawn in, not the one it came in with', async () => {
		/* Validating only on the way to the canvas would leave the picture
		   black and the metadata beside it still claiming magenta - a file
		   that disagrees with itself for good. The strokes a canvas holds are
		   the ones it draws. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({
			png: new Blob(),
			strokes: [{ points: [[10, 10, 0.5]], color: '#ff00ff' }],
			origin: null,
		})

		await wrapper.vm.done()

		expect(saveInk.mock.calls[0][3][0].color).toBe(DEFAULT_INK_COLOR)
	})

	it('gives a stroke loaded without a color one of its own', async () => {
		/* Every file written before this change. Opening and saving it makes
		   it say what it has always drawn. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({
			png: new Blob(),
			strokes: [{ points: [[10, 10, 0.5]] }],
			origin: null,
		})

		await wrapper.vm.done()

		expect(saveInk.mock.calls[0][3][0].color).toBe(DEFAULT_INK_COLOR)
	})

	it('stamps the color in force onto the stroke being drawn', async () => {
		const wrapper = await open()
		wrapper.vm.color = '#008800'

		await pointer(wrapper, 'pointerdown', { offsetX: 30, offsetY: 30 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].color).toBe('#008800')
	})

	it('saves the strokes with their colors', async () => {
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[10, 10, 0.5]], color: '#7733cc' }]

		await wrapper.vm.done()

		const saved = saveInk.mock.calls[0][3]
		expect(saved[0].color).toBe('#7733cc')
	})
```

The mock context in this file records nothing about `fillStyle` beyond the last
value assigned, so add the recording to it. In the `beforeAll` block, inside the
object passed to `contexts.set(this, { … })`, replace the line `fillStyle: null,`
with:

```js
				/* Every value it was set to, in order. A stroke's color is on
				   the context only while that stroke is being traced, so the
				   last value alone says nothing about the ones before it. */
				fillStyles: [],
				_fillStyle: null,
				get fillStyle() { return this._fillStyle },
				set fillStyle(value) {
					this._fillStyle = value
					this.fillStyles.push(value)
				},
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- inkCanvas`
Expected: FAIL. "draws each stroke in its own color" fails with
`expected [] to deeply equal [ '#cc0000', '#0044cc' ]` — `renderPage` sets no
`fillStyle` at all today. "stamps the color in force" fails with
`expected undefined to be '#008800'`.

Two pre-existing tests near line 1172 assert `fillStyle` after `fit()`; they will
also fail once Step 4 removes that assignment. That is expected and Step 6
replaces them.

- [ ] **Step 3: Add the color to the component's state**

In `src/components/InkCanvas.vue`, change the import added in Task 1 from

```js
import { DEFAULT_INK_COLOR } from '../inkPalette.js'
```

to

```js
import { DEFAULT_INK_COLOR, knownColor } from '../inkPalette.js'
```

and add to `data()`, immediately after `erasing: false,`:

```js
			/* What the next stroke will be drawn in. A stroke keeps the color
			   it was drawn with, so changing this never alters the page. */
			color: DEFAULT_INK_COLOR,
```

- [ ] **Step 4: Take the color off the context**

In `fit()`, delete the line `context.fillStyle = DEFAULT_INK_COLOR` from inside
the `for (const which of ['page', 'canvas'])` loop, leaving `context.scale(ratio, ratio)`.
Update that method's leading comment, which currently reads:

```js
		/* Size both sheets to the box, and set what a context loses whenever
		   its size is written to: the device-pixel scale, so every coordinate
		   from here on is a CSS pixel, and the color strokes are filled in. */
```

to:

```js
		/* Size both sheets to the box, and set what a context loses whenever
		   its size is written to: the device-pixel scale, so every coordinate
		   from here on is a CSS pixel. The color is not set here - it belongs
		   to the stroke, and each one is filled in its own. */
```

- [ ] **Step 5: Add `colorOf` and use it in all three render paths**

Add this method to `methods`, immediately before `renderPage()`:

```js
		/* The color to fill a stroke with.
		 *
		 * Validated on the way out rather than on the way in: strokes arrive
		 * from a file that anything could have written, and this is the last
		 * place before the value reaches the canvas.
		 *
		 * @param {object} stroke the stroke about to be traced
		 * @return {string} a color the palette offers
		 */
		colorOf(stroke) {
			return knownColor(stroke.color)
		},
```

In `renderPage()`, change the stroke loop from

```js
			for (const stroke of this.strokes) {
				traceStroke(context, stroke.points)
			}
```

to

```js
			for (const stroke of this.strokes) {
				context.fillStyle = this.colorOf(stroke)
				traceStroke(context, stroke.points)
			}
```

In `paintLive()`, inside the `if (this.current) {` branch, add the fill before
the `traceStroke` call so it reads:

```js
			if (this.current) {
				const points = this.predicted?.length
					? [...this.current.points, ...this.predicted]
					: this.current.points
				context.fillStyle = this.colorOf(this.current)
				traceStroke(context, points)
				this.painted = this.onScreen(this.boundsOf(points))
			} else {
```

In `finishStroke()`, add the fill before its `traceStroke` call:

```js
				const context = this.contextFor('page')
				if (context) {
					context.save()
					context.translate(0, -this.panY)
					context.fillStyle = this.colorOf(this.current)
					traceStroke(context, this.current.points)
					context.restore()
				}
```

In `pictureOf(strokes, bounds)`, change

```js
				context.fillStyle = DEFAULT_INK_COLOR
				for (const stroke of strokes) {
					traceStroke(context, stroke.points)
				}
```

to

```js
				for (const stroke of strokes) {
					context.fillStyle = this.colorOf(stroke)
					traceStroke(context, stroke.points)
				}
```

- [ ] **Step 6: Give every loaded stroke a color of its own**

`colorOf()` guards the canvas, but `done()` saves `this.strokes` as they are —
`shiftStrokes()` spreads `...stroke`, so an unrecognized color would be drawn as
black and written back unchanged, and the file would disagree with its own
picture for good.

In `mounted()`, change

```js
			const placed = placeInk(
				existing?.strokes ?? [],
				existing?.origin,
				canvas?.clientWidth ?? 0,
				canvas?.clientHeight ?? 0,
			)
```

to

```js
			/* Every stroke gets a color this palette offers, here at the one
			   place strokes enter the canvas. A file can be copied in from
			   anywhere and edited by anything; what it says would otherwise be
			   drawn as the default and saved back as whatever it claimed, and
			   a picture that disagrees with the strokes beside it is the one
			   thing this format must never produce. A stroke from before color
			   existed gets the default, which is what it has always drawn in. */
			const placed = placeInk(
				(existing?.strokes ?? []).map((stroke) => ({ ...stroke, color: knownColor(stroke.color) })),
				existing?.origin,
				canvas?.clientWidth ?? 0,
				canvas?.clientHeight ?? 0,
			)
```

- [ ] **Step 7: Stamp the color onto a new stroke**

In `onDown(event)`, change

```js
			this.current = { points: withoutRepeats(this.onPage(samplesFrom(event)), null) }
```

to

```js
			this.current = {
				points: withoutRepeats(this.onPage(samplesFrom(event)), null),
				color: this.color,
			}
```

Then replace the two pre-existing assertions near line 1172 —
`expect(live(wrapper).fillStyle).toBe(DEFAULT_INK_COLOR)` and the `page`
equivalent — with a test that asserts what now matters. Find the test that
contains them and replace its body with:

```js
		/* fit() no longer sets a color: it belongs to the stroke now, and a
		   resize has none to lose. */
		expect(live(wrapper).fillStyles).toEqual([])
		expect(page(wrapper).fillStyles).toEqual([])
```

Rename that test to `'leaves the color off the context, since a stroke carries its own'`.

- [ ] **Step 8: Run them and watch them pass**

Run: `npm run test -- inkCanvas`
Expected: PASS, all tests in the file.

- [ ] **Step 9: Run the whole suite and the linters**

Run: `npm run test && npm run lint && npm run stylelint`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add src/components/InkCanvas.vue src/tests/inkCanvas.spec.js
git commit -F - <<'MSG'
feat(ink): a stroke carries the color it was drawn in

The color was a property of the context: fit() set it on both sheets and
the renderers inherited it, which is why a resize had to set it again.
It belongs to the stroke, so each render path fills per stroke and fit()
sets none.

Every stroke is given a color the palette offers as it enters the canvas,
rather than only on the way to fillStyle. Guarding the canvas alone would
have drawn an unrecognized color as black and saved it back unchanged,
leaving a picture that disagrees with the strokes beside it - which is the
one thing this format must never produce. A stroke from before color
existed gets the default, which is what it has always drawn in.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: The picker

One button in the bar showing the color in use, opening a popover of six.
Covers Review Focus item 5.

**Files:**
- Modify: `src/components/InkCanvas.vue`
- Modify: `src/tests/inkCanvas.spec.js`

**Interfaces:**
- Consumes: `INK_COLORS`, `rememberedColor`, `rememberColor` from
  `src/inkPalette.js`; the `color` data field from Task 3.
- Produces: a computed `colorChoices` returning
  `Array<{key, value, label, chosen}>` and a computed `colorLabel`; a method
  `chooseColor(value)`; a `picking` boolean in `data()` that `claimFocus()`
  reads.

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/inkCanvas.spec.js`, inside `describe('InkCanvas', …)`:

```js
	it('names every color, so the picker is not six unlabeled squares', async () => {
		const wrapper = await open()

		expect(wrapper.vm.colorChoices.map((choice) => choice.label))
			.toEqual(['Black', 'Red', 'Orange', 'Green', 'Blue', 'Purple'])
	})

	it('marks which color is in use', async () => {
		const wrapper = await open()

		wrapper.vm.chooseColor('#0044cc')

		const chosen = wrapper.vm.colorChoices.filter((choice) => choice.chosen)
		expect(chosen).toHaveLength(1)
		expect(chosen[0].value).toBe('#0044cc')
	})

	it('opens in the color last used', async () => {
		window.localStorage.setItem('notes-ink-color', '#008800')

		const wrapper = await open()

		expect(wrapper.vm.color).toBe('#008800')
		window.localStorage.clear()
	})

	it('remembers a color when it is chosen', async () => {
		const wrapper = await open()

		wrapper.vm.chooseColor('#7733cc')

		expect(window.localStorage.getItem('notes-ink-color')).toBe('#7733cc')
		window.localStorage.clear()
	})

	it('leaves the strokes already drawn alone when the color changes', async () => {
		/* The picker sets what the next stroke will be. Changing it is not an
		   edit to the page. */
		const wrapper = await open()
		await pointer(wrapper, 'pointerdown', { offsetX: 30, offsetY: 30 })
		await pointer(wrapper, 'pointerup')

		wrapper.vm.chooseColor('#cc0000')

		expect(wrapper.vm.strokes[0].color).toBe(DEFAULT_INK_COLOR)
	})

	it('leaves the focus alone while the picker is open', async () => {
		/* The dialog holds the focus on purpose: iPadOS Scribble writes into
		   whatever text field has it, and the note's editor is right behind
		   this. The picker's popover teleports to <body>, so it is NOT inside
		   the dialog - and claimFocus() returns early only when the dialog
		   contains the active element. Called while the menu is open it would
		   take the focus back and shut the menu.
		 *
		 * fit() is the only caller and ensureFitted() only calls it when the
		 * backing size changed - a rotation, or the error message appearing.
		 * Both of those happen on the device, which is the one place this
		 * would be found. */
		const wrapper = await open()
		wrapper.vm.picking = true
		const elsewhere = document.createElement('button')
		document.body.appendChild(elsewhere)
		elsewhere.focus()

		wrapper.vm.claimFocus()

		expect(document.activeElement).toBe(elsewhere)
		elsewhere.remove()
	})

	it('takes the focus back once the picker closes', async () => {
		/* The guard above must not become a way to leave the focus outside the
		   dialog for good - that is the state Scribble writes into the note
		   from. */
		const wrapper = await open()
		wrapper.vm.picking = false
		const elsewhere = document.createElement('button')
		document.body.appendChild(elsewhere)
		elsewhere.focus()

		wrapper.vm.claimFocus()

		expect(document.activeElement).not.toBe(elsewhere)
		elsewhere.remove()
	})

	it('undoes a stroke with the color it was drawn in, not the one now chosen', async () => {
		const wrapper = await open()
		wrapper.vm.chooseColor('#cc0000')
		await pointer(wrapper, 'pointerdown', { offsetX: 30, offsetY: 30 })
		await pointer(wrapper, 'pointerup')
		wrapper.vm.chooseColor('#0044cc')
		await pointer(wrapper, 'pointerdown', { offsetX: 60, offsetY: 60 })
		await pointer(wrapper, 'pointerup')

		wrapper.vm.undo()

		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.strokes[0].color).toBe('#cc0000')
	})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- inkCanvas`
Expected: FAIL — `Cannot read properties of undefined (reading 'map')`, because
`colorChoices` does not exist.

- [ ] **Step 3: Make the test translation stub interpolate**

This task adds the first string with a placeholder in it. The stub in
`src/tests/inkCanvas.spec.js` is `globalThis.t = (app, text) => text`, which
drops the variables — so `t('notes', 'Color: {color}', { color: 'Red' })` would
return the literal `Color: {color}` and any test asserting that label would be
asserting a lie. In the `beforeAll` block, change

```js
	globalThis.t = (app, text) => text
```

to

```js
	/* Interpolating, because a label with a placeholder left in it is not the
	   label a reader sees, and a test asserting one would pass on a string
	   nobody will ever read. */
	globalThis.t = (app, text, vars) => text.replace(/\{(\w+)\}/g, (whole, name) => vars?.[name] ?? whole)
```

- [ ] **Step 4: Mock NcActions so the component can mount**

`NcActions` and `NcActionButton` import `.css`, which Node cannot load — the
same problem this file already solves for `NcButton` at the top. Add beside that
existing `vi.mock` call, **before** the `const InkCanvas = (await import(…))`
line:

```js
vi.mock('@nextcloud/vue/components/NcActions', () => ({
	default: { name: 'NcActions', template: '<div><slot name="icon" /><slot /></div>' },
}))
vi.mock('@nextcloud/vue/components/NcActionButton', () => ({
	default: { name: 'NcActionButton', template: '<button><slot /></button>' },
}))
```

- [ ] **Step 5: Add the choices and the chooser**

In `src/components/InkCanvas.vue`, change the palette import to

```js
import { DEFAULT_INK_COLOR, INK_COLORS, knownColor, rememberColor, rememberedColor } from '../inkPalette.js'
```

Add to `computed`, after `morePageBelow()`:

```js
		/* The palette, named and with the one in use marked.
		 *
		 * The names are here rather than in the palette module because they
		 * are translated, and a module of six hex values should not need the
		 * translation globals to be testable. A color is a poor label on its
		 * own in any case: it is no label at all to a reader who cannot tell
		 * two of them apart, or who is listening rather than looking.
		 */
		colorChoices() {
			const named = {
				ink: t('notes', 'Black'),
				red: t('notes', 'Red'),
				orange: t('notes', 'Orange'),
				green: t('notes', 'Green'),
				blue: t('notes', 'Blue'),
				purple: t('notes', 'Purple'),
			}
			return INK_COLORS.map((color) => ({
				...color,
				label: named[color.key],
				chosen: color.value === this.color,
			}))
		},

		/* What the picker's own button says it will draw in. */
		colorLabel() {
			return this.colorChoices.find((choice) => choice.chosen)?.label ?? ''
		},
```

Add to `methods`, immediately before `colorOf(stroke)`:

```js
		/* Set what the next stroke will be drawn in.
		 *
		 * Nothing already on the page moves: a stroke keeps the color it was
		 * drawn with, which is what makes Undo put back what was taken rather
		 * than a recolored copy of it.
		 *
		 * @param {string} value the chosen color
		 */
		chooseColor(value) {
			this.color = knownColor(value)
			rememberColor(this.color)
		},
```

In `data()`, change the `color` field added in Task 3 from
`color: DEFAULT_INK_COLOR,` to:

```js
			/* What the next stroke will be drawn in, starting where the last
			   canvas left it. A stroke keeps the color it was drawn with, so
			   changing this never alters the page. */
			color: rememberedColor(),
```

`DEFAULT_INK_COLOR` is no longer referenced in the component after this change —
remove it from the import, leaving
`import { INK_COLORS, knownColor, rememberColor, rememberedColor } from '../inkPalette.js'`.

Add to `data()`, immediately after the `color` field:

```js
			/* Whether the picker's menu is open. NcActions manages this
			   itself; the component has to know because the menu lives
			   outside the dialog and the dialog takes the focus back from
			   anything outside it. */
			picking: false,
```

and make `claimFocus()` stand down while it is. Change its guard from

```js
			const dialog = this.$refs.dialog
			if (!dialog || dialog.contains(document.activeElement)) {
				return
			}
```

to

```js
			const dialog = this.$refs.dialog
			if (!dialog || this.picking || dialog.contains(document.activeElement)) {
				return
			}
```

and add to the end of that method's doc comment, before the closing `*/`:

```
	 * The color picker's menu is the one thing outside this dialog that
	 * belongs to it: it is a popover, so it is teleported to the body and
	 * `contains` says no. Taking the focus back from it would shut it
	 * mid-choice, which a resize - a rotation, or the error message
	 * appearing - is enough to cause.
```

- [ ] **Step 6: Add the picker to the bar**

Add the imports beside the existing component imports:

```js
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
```

and register `NcActionButton` and `NcActions` in `components`, keeping it
alphabetical: `CloseIcon, EraserIcon, NcActionButton, NcActions, NcButton, UndoIcon`.

In the template, insert this as the **first** child of `<div class="ink__bar">`,
before the Erase button:

```html
				<!-- The color in use is the button: a reader can see what the
				     pen will draw without opening anything. Six swatches in
				     the bar itself would be faster by one tap and leave no
				     room for the tools. -->
				<NcActions v-model:open="picking"
					class="ink__color"
					:aria-label="t('notes', 'Color: {color}', { color: colorLabel })"
					:title="t('notes', 'Color: {color}', { color: colorLabel })"
					:disabled="!accepting()"
				>
					<template #icon>
						<span class="ink__swatch" :style="{ background: color }" />
					</template>
					<!-- Radio rather than six toggles. These are one choice
					     among six, and NcActionButton's default behavior with
					     a boolean model-value is a toggle button - which a
					     reader listening would hear as six separate pressed
					     and unpressed buttons rather than as a single pen. -->
					<NcActionButton v-for="choice in colorChoices"
						:key="choice.key"
						type="radio"
						:model-value="color"
						:value="choice.value"
						@update:model-value="chooseColor(choice.value)"
					>
						<template #icon>
							<span class="ink__swatch" :style="{ background: choice.value }" />
						</template>
						{{ choice.label }}
					</NcActionButton>
				</NcActions>
```

`NcActionButton` takes `type` from `['button', 'checkbox', 'radio', 'reset', 'submit']`
and, with `type="radio"`, compares its own `value` against `modelValue` to decide
which one is selected — so `model-value` is bound to the chosen color itself,
not to a per-choice boolean. The `chosen` field on `colorChoices` is still what
the tests assert and what `colorLabel` reads; it is no longer what the markup
binds.

The swatch's own CSS lands in Task 5, which owns every surface the theme filter
touches. Until then the swatches show their raw color, which is right on a light
theme and a little off on a dark one for the span of one commit.

- [ ] **Step 7: Run them and watch them pass**

Run: `npm run test -- inkCanvas`
Expected: PASS, all tests in the file.

- [ ] **Step 8: Run the whole suite and the linters**

Run: `npm run test && npm run lint && npm run stylelint`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/components/InkCanvas.vue src/tests/inkCanvas.spec.js
git commit -F - <<'MSG'
feat(ink): pick a color before writing

One button in the bar, filled with the color in use, opening the six. The
bar already holds four controls and will want room for more, so this
costs one slot rather than six - two taps to change color, which is a
thing done occasionally rather than constantly.

Each swatch carries its own name and the six are radio buttons, because
they are one choice rather than six switches. A color is no label at all
to a reader who cannot tell two of them apart, or who is listening.

The dialog stands down from claiming the focus while the menu is open.
It holds the focus so that iPadOS Scribble has no text field to write the
pen into, but the menu is a popover and so lives outside the dialog -
and a resize while it was open would have taken the focus back and shut
it mid-choice.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: Keep the hue when the theme inverts

The last piece, and the one the whole design rests on. Today both the canvas and
the picture in the note carry `filter: var(--background-invert-if-dark)`, which
on a dark theme is `invert(100%)` — and plain invert turns red into cyan.

This task owns **every** surface the theme filter touches — the canvas, the
picture in the note, and the picker's swatches — so that they cannot drift apart
and a reviewer sees them agree in one diff.

**Files:**
- Modify: `src/components/InkCanvas.vue` (the `.ink__canvas` rule, and the new `.ink__swatch` rule)
- Modify: `src/components/NoteRich.vue` (the `figure[data-component="image-view"]` rule)
- Modify: `playwright/e2e/ink.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. This task is independent of 1–4 and
  could be done first; it is last because it is the one that needs a browser to
  verify.

- [ ] **Step 1: Write the failing e2e test**

Add to `playwright/e2e/ink.spec.ts`, inside the `test.describe('Ink', …)` block.
`openInkedNote` and `drawAndFinish` already exist in this file.

```ts
	test('keeps the hue of colored ink when the theme inverts it', async ({ page, request }) => {
		// The whole color design rests on this one declaration. Plain invert
		// flips lightness and hue together, which turns a red annotation cyan;
		// the hue-rotate puts the hue back. A mistake here is invisible in the
		// light theme, which is how the tests run by default.
		await openInkedNote(page, request)
		await drawAndFinish(page)

		const picture = page.locator('figure[data-component="image-view"] img').first()
		await expect(picture).toBeVisible()

		const filter = await picture.evaluate((img) => getComputedStyle(img).filter)
		// The light theme applies none: `no hue-rotate(180deg)` is not a valid
		// filter, so the declaration is dropped entirely.
		expect(filter).toBe('none')

		// And on the dark theme the pair is applied. Swap the attribute the
		// theming app sets, rather than changing the account's theme, so the
		// test says what the CSS does and nothing about the server.
		//
		// The light attribute has to come OFF, not merely be joined by the dark
		// one. Every theme's stylesheet is linked on every page so the theme can
		// be switched without a reload, and `[data-theme-light]` and
		// `[data-theme-dark]` have equal specificity — so with both attributes
		// present, source order decides and light.css is linked last. Measured:
		// adding `data-theme-dark` alone leaves the variable at `no`.
		await page.evaluate(() => {
			document.body.removeAttribute('data-theme-light')
			document.body.setAttribute('data-theme-dark', '')
		})
		const dark = await picture.evaluate((img) => getComputedStyle(img).filter)
		expect(dark).toBe('invert(1) hue-rotate(180deg)')
	})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test ink.spec.ts -g "keeps the hue"`
Expected: FAIL on the dark assertion with
`expected "invert(1) hue-rotate(180deg)" but received "invert(1)"`.

**Before running this, know that the e2e suite calls `deleteAllNotesVia()` and
wipes the dev container's notes.** That is the trade for this test existing.

- [ ] **Step 3: Change both filters**

In `src/components/NoteRich.vue`, change the ink-image rule's filter from

```css
	filter: var(--background-invert-if-dark);
```

to

```css
	/* Lightness flipped, hue kept. The variable is `invert(100%)` on a dark
	   theme and `no` on a light one, so this is `invert(100%) hue-rotate(180deg)`
	   there and an invalid - therefore ignored - declaration here. Extending
	   the variable rather than writing the theme's own selector is what makes
	   this track whatever the server decides is dark, including themes that do
	   not exist yet.

	   Without the rotation, invert flips hue along with lightness and a red
	   annotation reads cyan. With it, a dark red becomes a light red. */
	filter: var(--background-invert-if-dark) hue-rotate(180deg);
```

In `src/components/InkCanvas.vue`, make the same change to the `.ink__canvas`
rule (around line 926), with the shorter comment:

```css
	/* Lightness flipped, hue kept - see NoteRich.vue, which does the same to
	   the picture once it is in the note. */
	filter: var(--background-invert-if-dark) hue-rotate(180deg);
```

And add the picker's swatch rule to the same `<style scoped>` block, beside the
other `.ink__` rules — it is a third surface showing ink, and it has to be
filtered identically or the picker would promise a color the page does not give:

```css
/* A swatch shows the ink itself, so it sits under the same themed filter the
   canvas and the picture do: what the picker offers is what lands on the page. */
.ink__swatch {
	display: block;
	inline-size: 16px;
	block-size: 16px;
	border-radius: 50%;
	border: 1px solid var(--color-border-dark);
	filter: var(--background-invert-if-dark) hue-rotate(180deg);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx playwright test ink.spec.ts -g "keeps the hue"`
Expected: PASS.

- [ ] **Step 5: Run the full ink e2e suite**

Run: `npx playwright test ink.spec.ts`
Expected: 28 passing (27 existing plus this one).

- [ ] **Step 6: Run the whole unit suite and the linters**

Run: `npm run test && npm run lint && npm run stylelint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/components/NoteRich.vue src/components/InkCanvas.vue playwright/e2e/ink.spec.ts
git commit -F - <<'MSG'
fix(ink): keep the hue when the dark theme inverts the ink

Ink is one color on transparency and the theme is applied where it is
shown, which is what lets a page written on a light screen read on a dark
one. The filter was plain invert, and invert flips hue with lightness: a
red annotation came out cyan.

invert(100%) hue-rotate(180deg) flips the lightness and puts the hue
back, which is what PencilKit does. Measured in Blink: all six palette
colors come out byte-identical to the values computed from the filter
specification's own matrix. Black still becomes white, so every drawing
saved before this is unaffected.

All three surfaces that show ink move together - the canvas, the picture
in the note, and the picker's swatches. A swatch filtered differently
from the page would offer a color the page does not give.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: Prove a color survives the round trip

The unit tests assert that a color reaches `fillStyle`. This asserts the thing a
reader cares about: a red stroke is still red after it has been through the PNG,
the note, and a reopen.

**Files:**
- Modify: `playwright/e2e/ink.spec.ts`

**Interfaces:**
- Consumes: the picker from Task 4, the per-stroke color from Task 3.

- [ ] **Step 1: Write the failing test**

Add to `playwright/e2e/ink.spec.ts`, inside `test.describe('Ink', …)`. It needs
a helper that reads the colors actually painted on the page sheet; add it beside
`inkOnThePage` and `inkBoxOnScreen` near the top of the file:

```ts
// Which colors are actually painted on the page sheet, most-used first. Read
// off the pixels rather than off the strokes: what is being checked is what the
// reader sees when they open their drawing again.
async function inkColorsOnThePage(page: Page): Promise<string[]> {
	return await page.locator('.ink__canvas--page').evaluate((canvas: HTMLCanvasElement) => {
		const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
		const counts = new Map<string, number>()
		for (let i = 0; i < data.length; i += 4) {
			// Only pixels the nib covered fully. An antialiased edge is a blend
			// with the transparent ground and is not the color anything was
			// drawn in.
			//
			// This threshold is coupled to the nib: a 2.5 CSS pixel stroke at
			// INK_DENSITY has a solid core, and a much finer one might have
			// none at all. The caller asserts that something opaque was found,
			// so a nib thinned past this fails loudly rather than reporting an
			// empty page.
			if (data[i + 3] < 250) {
				continue
			}
			const hex = '#' + [data[i], data[i + 1], data[i + 2]]
				.map((v) => v.toString(16).padStart(2, '0')).join('')
			counts.set(hex, (counts.get(hex) ?? 0) + 1)
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex)
	})
}
```

and the test:

```ts
	test('a stroke keeps its color through the file and back', async ({ page, request }) => {
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// Pick red, then draw. The picker names the color it will draw in, so
		// the button is found by what it says rather than by its place.
		await page.getByRole('button', { name: /^Color:/ }).click()
		await page.getByRole('button', { name: 'Red' }).click()

		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 2
		const y = box.y + box.height / 2
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 100, y + 70, { steps: 10 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()

		// Reopen the drawing and read what is on the page sheet.
		await expect(page.locator('figure[data-component="image-view"] img').first()).toBeVisible()
		await page.locator('figure[data-component="image-view"] img').first().click()
		await expect(page.locator('.ink__canvas--page')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		const colors = await inkColorsOnThePage(page)
		// Said separately, so a reader of a failure can tell "the ink is the
		// wrong color" from "the helper found no fully-opaque pixels at all",
		// which is what a thinner nib would cause.
		expect(colors.length).toBeGreaterThan(0)
		expect(colors).toContain('#cc0000')

		// And the picker opens on the color last used, not back at black.
		await expect(page.getByRole('button', { name: 'Color: Red' })).toBeVisible()
	})
```

- [ ] **Step 2: Run it, and prove it bites**

This test runs after Tasks 3 and 4, which built the behavior it checks, so it is
expected to **pass** on the first run. A passing test you never saw fail proves
nothing, so prove it bites before trusting it:

Run: `npx playwright test ink.spec.ts -g "keeps its color through"`
Expected: PASS.

Then change `toContain('#cc0000')` to `toContain('#0044cc')` — a color nothing
in the test drew — and run it again.
Expected: FAIL, with the received array listing `#cc0000`.

Change it back to `'#cc0000'` and confirm it passes again.

- [ ] **Step 3: If it failed on the first run, the fault is real**

Do not loosen this test to make it pass. A red stroke that is not red after the
round trip is a bug in Task 3 (the color is not reaching the picture) or Task 4
(the picker is not setting it); fix it there, with a unit test in that task that
fails first.

- [ ] **Step 4: Run the full ink e2e suite**

Run: `npx playwright test ink.spec.ts`
Expected: 29 passing.

- [ ] **Step 5: Commit**

```bash
git add playwright/e2e/ink.spec.ts
git commit -F - <<'MSG'
test(ink): a color survives the picture and the reopen

The unit tests say a color reaches fillStyle. This says the reader gets
it back: red is still red after the PNG, the note, and a reopen - read
off the pixels on the page sheet rather than off the strokes.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 7: Update the running documents

**Files:**
- Modify: `docs/INK-COLOR-DESIGN.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Mark the spec built**

In `docs/INK-COLOR-DESIGN.md`, change the status line from
`Status: design, awaiting approval.` to `Status: built.` and add beneath it the
one thing the spec left open, now answerable: whether `#b35900` is a pleasant
orange on the device, which is Paul's call once he has drawn with it.

- [ ] **Step 2: Move the colored-ink entries in STATUS.md**

Move "colored ink" out of whatever section names it as next up and into
`## Closed`, with one line naming what shipped: six colors, a picker that
remembers, and a dark-mode filter that keeps hue. Add to `## For Paul` that the
orange is the one color chosen against a measurement rather than for how it
looks, and is the easiest thing to drop.

- [ ] **Step 3: Commit**

```bash
git add docs/INK-COLOR-DESIGN.md
git commit -F - <<'MSG'
docs(ink): the color spec is built

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

`STATUS.md` is untracked by design and has nothing to commit.

- [ ] **Step 4: Put the build on the harness**

Run: `bash dev/ipad.sh`
Expected: it builds, reports "cache busted", and prints the LAN URL. Give Paul
that URL. **Do not cut a release and do not push.**

---

## Notes for whoever implements this

- **Order matters for 1 → 4.** Task 1 moves a constant that Tasks 3 and 4 import.
  Task 5 is independent and could run at any point; it is last because it is the
  one needing a browser.
- **The e2e suite wipes the dev container's notes.** Tasks 5 and 6 run it. If
  Paul has a drawing in there he cares about, ask first.
- **If a test passes before you write the code**, that is a finding about the
  test. Make it fail on purpose before trusting it.
- **Do not adjust the six hex values.** They were measured against contrast on
  four themes. `docs/INK-COLOR-DESIGN.md` has the table and the method; a
  seventh color needs the same two numbers.
