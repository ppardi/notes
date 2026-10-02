<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Shapes in ink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw straight lines, rectangles and ellipses on the ink canvas, stored
as ordinary strokes so that erasing, undo, color, cropping and the file format
all keep working unchanged.

**Architecture:** A shape is a densely sampled polyline — vertices no further
apart than `SHAPE_STEP` (5 px, under `SMOOTH_GAP`) — committed as a normal
`{points, color}` stroke. The geometry lives in a new `src/inkShape.js`; the
component gains a tool mode, a branch in the pointer handlers, and a picker built
exactly like the color picker.

**Tech Stack:** Vue 3 (Options API), `@nextcloud/vue` (`NcActions`,
`NcActionButton`, `NcButton`), `vue-material-design-icons`, Canvas 2D, vitest +
jsdom, Playwright.

**Spec:** `docs/INK-SHAPE-DESIGN.md` — read it first. It records what was
measured (the 0.99 px corner, the `SMOOTH_GAP` property the design rests on) and
why each decision follows.

## Global Constraints

- Every new file needs an SPDX header; CI enforces REUSE compliance. Copy it
  verbatim from `src/inkRender.js`.
- Conventional commits. Every commit ends with the trailers
  `Assisted-by: Claude Code:claude-opus-5` and
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **Never**
  `Signed-off-by`.
- **American spelling** in all comments, test names and prose: color, behavior,
  center, recognize, gray.
- Comments describe what the code does and constraints the code cannot express.
  Never comments narrating the change itself ("changed X to Y", "this fixes…").
  The ink modules' comment density is high and explanatory — read the
  surrounding comments for the house voice before writing any.
- `npm run lint` and `npm run stylelint` must pass. Lint reports 3 pre-existing
  warnings in `src/components/EditorEasyMDE.vue` — expected, not yours.
- The unit suite stands at **22 files / 516 tests** and the ink e2e at **30**.
  Both must stay green; counts move only for the reasons a task states. Deleting
  or weakening a test to hit a number is a defect.
- **No vertex of a shape may be further than `SMOOTH_GAP` (6) from the next.**
  That is the property the whole design rests on: `smoothed()` interpolates any
  gap wider than that, which would bow a straight edge and round a corner.
- `src/inkPalette.js`, `src/inkRender.js` and `src/inkErase.js` are finished for
  this work. Do not modify them.
- **Do not "fix" the corner rounding.** A rectangle's corner comes out 0.99 px
  inside where the nib alone would put it, because perfect-freehand's
  `streamline` smooths the path it is given. That is under half the 2.5 px nib
  and the spec ships it unfixed on purpose, so that an additive field in the
  file format is not spent on a number nobody has seen. If you find yourself
  passing `streamline: 0` or adding a flag to a stroke, stop and report it.
- **Build nothing that is out of scope**: no arrows, no text, no moving or
  resizing a shape after it is drawn, no recognizing a freehand sketch and
  snapping it. Each was considered and declined with a reason in the spec.
- Never `git push`. Never create a release. Commit locally only.
- **Running the Playwright e2e wipes the dev container's notes.** Only Task 4
  needs it. Ask before running it if there is a drawing in there.

## Review Focus

Five things the spec implies that a happy-path test would miss. Each has a test
assigned to the task that owns the code.

1. **A shape drawn while the page is panned** must land under the pen, not
   `panY` pixels away. Shapes are built from page coordinates, as strokes are.
   Pinned in Task 2.
2. **A shape dragged off the side of the canvas** must be clamped into the page —
   ink off the sides can be neither seen nor rubbed out. Pinned in Task 2.
3. **`pointercancel` during a shape drag** must abandon it, where the same event
   commits a freehand stroke. Pinned in Task 2.
4. **An unknown tool value** must draw freehand rather than nothing at all — a
   canvas that silently refuses to draw is the worst outcome available here.
   Pinned in Task 1 and Task 2.
5. **A second pointer during a shape drag** — a palm landing beside the pen —
   must not move the far corner. Pinned in Task 2.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/inkShape.js` **(new)** | Which tools exist, validating one, and turning two corners into a polyline. No Vue, no canvas, no translation globals. |
| `src/tests/inkShape.spec.js` **(new)** | Unit tests for the above. |
| `src/components/InkCanvas.vue` | Holds the tool, branches the pointer handlers, previews the shape in progress, commits it as a stroke, and shows the picker. |
| `src/tests/inkCanvas.spec.js` | Tests for the mode and the drawing. |
| `playwright/e2e/ink.spec.ts` | One round trip: pick Rectangle, drag, Done, reopen, read the pixels. |

**Why the geometry is its own module:** `InkCanvas.vue` is 1273 lines before this
task. The shape maths is pure, has no dependency on the component, and is far
easier to test on its own.

---

### Task 1: The shape geometry

**Files:**
- Create: `src/inkShape.js`
- Create: `src/tests/inkShape.spec.js`

**Interfaces:**
- Consumes: `SMOOTH_GAP` from `src/inkRender.js`.
- Produces, all from `src/inkShape.js`:
  - `INK_TOOLS: Array<string>` — `['pen', 'line', 'rectangle', 'ellipse']`
  - `DEFAULT_TOOL: string` — `'pen'`
  - `SHAPE_STEP: number` — `5`
  - `SHAPE_MINIMUM: number` — `8`
  - `LINE_SNAP: number` — `5` (degrees)
  - `knownTool(value: string | null | undefined): string`
  - `straighten(from: Array<number>, to: Array<number>): Array<number>`
  - `shapePoints(tool: string, from: Array<number>, to: Array<number>): Array<Array<number>>`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/inkShape.spec.js`:

```js
/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_TOOL, INK_TOOLS, knownTool, LINE_SNAP, SHAPE_MINIMUM, SHAPE_STEP, shapePoints, straighten } from '../inkShape.js'
import { SMOOTH_GAP } from '../inkRender.js'

/* The longest step between two vertices of a shape. This is the property the
   whole design rests on: smoothed() interpolates anything wider than
   SMOOTH_GAP, which would bow a straight edge and round a corner. */
function longestStep(points) {
	let longest = 0
	for (let i = 1; i < points.length; i++) {
		longest = Math.max(longest, Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
	}
	return longest
}

describe('the tools', () => {
	it('offers the pen and the three shapes, in order', () => {
		expect(INK_TOOLS).toEqual(['pen', 'line', 'rectangle', 'ellipse'])
	})

	it('starts on the pen', () => {
		expect(DEFAULT_TOOL).toBe('pen')
	})

	it('samples closer together than the smoothing will touch', () => {
		/* At exactly SMOOTH_GAP a rounding error either way decides whether a
		   span is interpolated. The headroom is the point. */
		expect(SHAPE_STEP).toBeLessThan(SMOOTH_GAP)
	})
})

describe('knownTool', () => {
	it('passes a tool through', () => {
		expect(knownTool('rectangle')).toBe('rectangle')
	})

	it('falls back to the pen for anything else', () => {
		/* Freehand rather than nothing: a canvas that silently refuses to draw
		   is the worst thing this feature could do. */
		expect(knownTool('triangle')).toBe(DEFAULT_TOOL)
		expect(knownTool('')).toBe(DEFAULT_TOOL)
		expect(knownTool(null)).toBe(DEFAULT_TOOL)
		expect(knownTool(undefined)).toBe(DEFAULT_TOOL)
		expect(knownTool(42)).toBe(DEFAULT_TOOL)
	})
})

describe('straighten', () => {
	it('snaps a nearly horizontal line flat', () => {
		/* 100 across and 4 down is 2.3 degrees. */
		expect(straighten([0, 0], [100, 4])).toEqual([100, 0])
	})

	it('snaps a nearly vertical line upright', () => {
		expect(straighten([0, 0], [4, 100])).toEqual([0, 100])
	})

	it('leaves a line that means its angle alone', () => {
		/* 100 across and 30 down is 16.7 degrees, well outside the latitude. */
		expect(straighten([0, 0], [100, 30])).toEqual([100, 30])
	})

	it('snaps from the far side too, so direction does not matter', () => {
		expect(straighten([100, 100], [0, 96])).toEqual([0, 100])
	})

	it('leaves a line of no length alone rather than dividing by it', () => {
		expect(straighten([10, 10], [10, 10])).toEqual([10, 10])
	})

	it('snaps inside the latitude and not outside it', () => {
		const inside = Math.tan(((LINE_SNAP - 1) * Math.PI) / 180) * 100
		const outside = Math.tan(((LINE_SNAP + 1) * Math.PI) / 180) * 100
		expect(straighten([0, 0], [100, inside])[1]).toBe(0)
		expect(straighten([0, 0], [100, outside])[1]).toBeCloseTo(outside, 6)
	})
})

describe('shapePoints', () => {
	it('draws nothing for the pen', () => {
		expect(shapePoints('pen', [0, 0], [100, 100])).toEqual([])
	})

	it('draws nothing for a tool it does not know', () => {
		expect(shapePoints('triangle', [0, 0], [100, 100])).toEqual([])
	})

	it('draws nothing for a drag that never grew', () => {
		/* A zero-size shape is not a shape, and this is also what keeps a stray
		   tap from leaving a dot. */
		expect(shapePoints('rectangle', [50, 50], [50 + SHAPE_MINIMUM - 1, 50])).toEqual([])
	})

	it('draws one for a drag that did grow', () => {
		expect(shapePoints('rectangle', [50, 50], [50 + SHAPE_MINIMUM + 1, 50 + SHAPE_MINIMUM + 1]).length).toBeGreaterThan(0)
	})

	it('gives every point a pressure, since a stroke carries one', () => {
		const points = shapePoints('line', [0, 0], [100, 0])
		expect(points.every((point) => point.length === 3)).toBe(true)
		expect(points.every((point) => point[2] === 0.5)).toBe(true)
	})

	describe('a line', () => {
		it('runs from one end to the other', () => {
			const points = shapePoints('line', [10, 20], [110, 20])
			expect(points[0]).toEqual([10, 20, 0.5])
			expect(points.at(-1)).toEqual([110, 20, 0.5])
		})

		it('steps closely enough that the smoothing leaves it alone', () => {
			expect(longestStep(shapePoints('line', [0, 0], [500, 300]))).toBeLessThanOrEqual(SHAPE_STEP)
		})

		it('is straightened, so a delimiter is level', () => {
			const points = shapePoints('line', [0, 50], [200, 54])
			expect(points.every((point) => point[1] === 50)).toBe(true)
		})
	})

	describe('a rectangle', () => {
		it('closes, so the outline has no gap in it', () => {
			const points = shapePoints('rectangle', [0, 0], [100, 60])
			expect(points.at(-1)).toEqual(points[0])
		})

		it('puts every point on an edge of the box', () => {
			const points = shapePoints('rectangle', [10, 20], [110, 80])
			for (const [x, y] of points) {
				const onSide = Math.abs(x - 10) < 1e-9 || Math.abs(x - 110) < 1e-9
				const onTopOrBottom = Math.abs(y - 20) < 1e-9 || Math.abs(y - 80) < 1e-9
				expect(onSide || onTopOrBottom).toBe(true)
			}
		})

		it('reaches all four corners', () => {
			const points = shapePoints('rectangle', [10, 20], [110, 80])
			for (const corner of [[10, 20], [110, 20], [110, 80], [10, 80]]) {
				expect(points.some(([x, y]) => x === corner[0] && y === corner[1])).toBe(true)
			}
		})

		it('is drawn the same whichever corner it was dragged from', () => {
			const forwards = shapePoints('rectangle', [10, 20], [110, 80]).map(([x, y]) => `${x},${y}`).sort()
			const backwards = shapePoints('rectangle', [110, 80], [10, 20]).map(([x, y]) => `${x},${y}`).sort()
			expect(forwards).toEqual(backwards)
		})

		it('steps closely enough that the smoothing leaves it alone', () => {
			expect(longestStep(shapePoints('rectangle', [0, 0], [400, 250]))).toBeLessThanOrEqual(SHAPE_STEP)
		})
	})

	describe('an ellipse', () => {
		it('puts every point on the ellipse', () => {
			const points = shapePoints('ellipse', [0, 0], [200, 100])
			for (const [x, y] of points) {
				const u = (x - 100) / 100
				const v = (y - 50) / 50
				expect(u * u + v * v).toBeCloseTo(1, 3)
			}
		})

		it('closes, so the outline has no gap in it', () => {
			const points = shapePoints('ellipse', [0, 0], [200, 100])
			expect(points.at(-1)[0]).toBeCloseTo(points[0][0], 9)
			expect(points.at(-1)[1]).toBeCloseTo(points[0][1], 9)
		})

		it('steps closely enough that the smoothing leaves it alone', () => {
			expect(longestStep(shapePoints('ellipse', [0, 0], [400, 250]))).toBeLessThanOrEqual(SHAPE_STEP)
		})

		it('is drawn the same whichever corner it was dragged from', () => {
			const forwards = shapePoints('ellipse', [0, 0], [200, 100])
			const backwards = shapePoints('ellipse', [200, 100], [0, 0])
			expect(backwards).toHaveLength(forwards.length)
		})
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- inkShape`
Expected: FAIL — `Failed to resolve import "../inkShape.js"`.

- [ ] **Step 3: Create the module**

Create `src/inkShape.js`:

```js
/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { SMOOTH_GAP } from './inkRender.js'

/**
 * What the pen can be set to draw.
 *
 * The pen is a member of the set rather than the absence of one, so the mode
 * has a single home and the toolbar button can show what the next stroke will
 * be. Ordered, because the picker shows them in this order.
 */
export const INK_TOOLS = ['pen', 'line', 'rectangle', 'ellipse']

/**
 * What the canvas opens on, every time.
 *
 * Unlike the ink's color, a tool is not remembered between drawings: a color is
 * a preference, a tool is a momentary intent.
 */
export const DEFAULT_TOOL = INK_TOOLS[0]

/**
 * How far apart a shape's vertices are, in CSS pixels.
 *
 * Under `SMOOTH_GAP` on purpose. The smoothing fills any gap wider than that
 * with a curve through the readings, which is right for a hand that was moving
 * and wrong for an edge that is meant to be straight - so a shape is sampled
 * closely enough that there is nothing left to fill. The headroom is for
 * floating point: at exactly `SMOOTH_GAP` a rounding error decides.
 */
export const SHAPE_STEP = 5

/**
 * The shortest drag that makes a shape, in CSS pixels.
 *
 * Below it nothing is committed. A zero-size shape is not a shape, and this is
 * also what keeps a stray tap from leaving a dot on the page. The same distance
 * a finger has to travel before it is panning rather than resting.
 */
export const SHAPE_MINIMUM = 8

/**
 * How far from square a line may be and still be straightened, in degrees.
 *
 * A ruled line under a heading is the thing shapes were asked for, and one that
 * comes out a degree off is worse than none. Chosen rather than measured.
 */
export const LINE_SNAP = 5

/* Every point of a shape carries one, because a stroke's samples are
   [x, y, pressure] and the renderer reads three. The nib does not thin with
   pressure, so the value only has to be the one a device reporting none uses. */
const FLAT_PRESSURE = 0.5

/**
 * The tool's own name for a value, or the pen.
 *
 * Everything arriving from outside goes through here. Falling back to the pen
 * rather than to nothing is deliberate: a canvas that silently refuses to draw
 * is the worst thing this feature could do.
 *
 * @param {string | null | undefined} value what was asked for
 * @return {string} a tool this canvas has
 */
export function knownTool(value) {
	return INK_TOOLS.includes(value) ? value : DEFAULT_TOOL
}

/**
 * The far end of a line, squared up when it is nearly square already.
 *
 * Within a few degrees of flat or upright, the reader meant flat or upright -
 * a hand drawing a divider is not trying to be one degree off. Outside that,
 * the angle is the point and is left alone.
 *
 * @param {Array<number>} from where the drag started, [x, y]
 * @param {Array<number>} to where it is now, [x, y]
 * @return {Array<number>} the far end, snapped or not
 */
export function straighten(from, to) {
	const dx = to[0] - from[0]
	const dy = to[1] - from[1]
	if (dx === 0 && dy === 0) {
		return [to[0], to[1]]
	}
	const slack = Math.tan((LINE_SNAP * Math.PI) / 180)
	if (Math.abs(dy) <= Math.abs(dx) * slack) {
		return [to[0], from[1]]
	}
	if (Math.abs(dx) <= Math.abs(dy) * slack) {
		return [from[0], to[1]]
	}
	return [to[0], to[1]]
}

/**
 * The points between two, no further apart than `SHAPE_STEP`.
 *
 * The first is included and the last is not, so edges can be strung together
 * without doubling a corner.
 *
 * @param {Array<number>} from one end, [x, y]
 * @param {Array<number>} to the other, [x, y]
 * @return {Array<Array<number>>} [x, y, pressure] along the way
 */
function along(from, to) {
	const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / SHAPE_STEP))
	const out = []
	for (let step = 0; step < steps; step++) {
		out.push([
			from[0] + ((to[0] - from[0]) * step) / steps,
			from[1] + ((to[1] - from[1]) * step) / steps,
			FLAT_PRESSURE,
		])
	}
	return out
}

/**
 * Ramanujan's approximation of an ellipse's perimeter.
 *
 * Used only to decide how many points to walk it with, where being a fraction
 * of a percent out costs nothing.
 *
 * @param {number} a half the width
 * @param {number} b half the height
 * @return {number} the perimeter
 */
function ellipsePerimeter(a, b) {
	const h = ((a - b) * (a - b)) / ((a + b) * (a + b))
	return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

/**
 * A shape, as the points a stroke is made of.
 *
 * This is the whole design: a shape is a polyline sampled closely enough that
 * nothing downstream can tell it from handwriting, so the eraser, undo, color,
 * cropping, the picture and the file format all keep working untouched.
 *
 * @param {string} tool which shape, or the pen
 * @param {Array<number>} from where the drag started, [x, y]
 * @param {Array<number>} to where it ended, [x, y]
 * @return {Array<Array<number>>} the stroke's points, or none at all
 */
export function shapePoints(tool, from, to) {
	const wanted = knownTool(tool)
	if (wanted === 'pen') {
		return []
	}
	if (Math.hypot(to[0] - from[0], to[1] - from[1]) < SHAPE_MINIMUM) {
		return []
	}
	if (wanted === 'line') {
		const end = straighten(from, to)
		return [...along([from[0], from[1]], end), [end[0], end[1], FLAT_PRESSURE]]
	}
	const left = Math.min(from[0], to[0])
	const right = Math.max(from[0], to[0])
	const top = Math.min(from[1], to[1])
	const bottom = Math.max(from[1], to[1])
	if (wanted === 'rectangle') {
		const corners = [[left, top], [right, top], [right, bottom], [left, bottom]]
		const out = []
		for (let i = 0; i < corners.length; i++) {
			out.push(...along(corners[i], corners[(i + 1) % corners.length]))
		}
		/* Closed, so the outline has no gap where it started. */
		out.push([left, top, FLAT_PRESSURE])
		return out
	}
	const a = (right - left) / 2
	const b = (bottom - top) / 2
	const steps = Math.max(8, Math.ceil(ellipsePerimeter(a, b) / SHAPE_STEP))
	const out = []
	for (let step = 0; step <= steps; step++) {
		const angle = (step / steps) * 2 * Math.PI
		out.push([left + a + a * Math.cos(angle), top + b + b * Math.sin(angle), FLAT_PRESSURE])
	}
	return out
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test -- inkShape`
Expected: PASS, 28 tests.

- [ ] **Step 5: Run the whole suite and the linters**

Run: `npm run test && npm run lint`
Expected: 23 test files (22 plus the new one), 544 tests (516 plus 28). Lint 0
errors. A different total means something else moved — find out what before
continuing.

- [ ] **Step 6: Commit**

```bash
git add src/inkShape.js src/tests/inkShape.spec.js
git commit -F - <<'MSG'
feat(ink): the geometry of a line, a rectangle and an ellipse

A shape is a polyline sampled closer together than the smoothing will
touch, so nothing downstream can tell it from handwriting. SHAPE_STEP
sits under SMOOTH_GAP on purpose: the smoothing fills any wider gap with
a curve through the readings, which is right for a hand that was moving
and wrong for an edge meant to be straight.

A line within five degrees of flat or upright is squared up, because a
ruled divider one degree off is worse than none. Nothing else snaps.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: Drawing a shape on the canvas

The pointer handlers gain a branch, and a shape in progress is previewed on the
live sheet and committed as an ordinary stroke. **No picker yet** — tests set
`tool` directly, so this task is finished and reviewable on its own.

Covers Review Focus items 1, 2, 3, 4 and 5.

**Files:**
- Modify: `src/components/InkCanvas.vue`
- Modify: `src/tests/inkCanvas.spec.js`

**Interfaces:**
- Consumes: `shapePoints`, `knownTool`, `DEFAULT_TOOL` from `src/inkShape.js`.
- Produces: `tool` and `shaping` in the component's `data()`; methods
  `startShape(event)`, `stretchShape(event)`, `onCanvas(at)`, `finishShape()`,
  `dropShape()`, `onCancel(event)`.

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/inkCanvas.spec.js`, inside the second describe block —
`describe('InkCanvas drawing', …)` — where `live()` and `page()` are defined. The
helpers `open()`, `pointer()`, `live()` and `page()` already exist in this file.

```js
	it('commits a rectangle as an ordinary stroke', async () => {
		/* The whole design in one assertion: what a shape leaves behind is a
		   stroke like any other, so everything downstream keeps working. */
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.strokes[0].color).toBe(DEFAULT_INK_COLOR)
		expect(wrapper.vm.strokes[0].points.length).toBeGreaterThan(50)
		/* One shape is one thing to undo. */
		expect(wrapper.vm.history).toHaveLength(1)
	})

	it('draws the shape in the color in force', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'line'
		wrapper.vm.chooseColor('#0044cc')

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 200, offsetY: 20 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].color).toBe('#0044cc')
	})

	it('builds a shape from page coordinates, so a panned page draws under the pen', async () => {
		/* Strokes are kept in the page's coordinates and the sheets are the
		   screen's. A shape built from screen coordinates would land panY
		   pixels from the pen. */
		const wrapper = await open()
		wrapper.vm.tool = 'line'
		wrapper.vm.panY = 100

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 200, offsetY: 20 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].points[0][1]).toBe(120)
	})

	it('clamps a shape dragged off the side of the canvas', async () => {
		/* Ink off the sides can be neither seen nor rubbed out. There is no
		   bottom to clamp to: the page grows with what is drawn on it. */
		const wrapper = await open()
		wrapper.vm.tool = 'line'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 40 })
		await pointer(wrapper, 'pointermove', { offsetX: 5000, offsetY: -200 })
		await pointer(wrapper, 'pointerup')

		const xs = wrapper.vm.strokes[0].points.map(([x]) => x)
		const ys = wrapper.vm.strokes[0].points.map(([, y]) => y)
		expect(Math.max(...xs)).toBeLessThanOrEqual(800)
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
	})

	it('commits nothing for a drag that never grew', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 50, offsetY: 50 })
		await pointer(wrapper, 'pointermove', { offsetX: 53, offsetY: 51 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(0)
		expect(wrapper.vm.history).toHaveLength(0)
	})

	it('abandons a shape when the pointer is cancelled', async () => {
		/* A half-drawn freehand stroke is real ink that was really laid down,
		   so it commits. A shape is only itself once the reader has said where
		   it ends. */
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await pointer(wrapper, 'pointercancel')

		expect(wrapper.vm.strokes).toHaveLength(0)
		expect(wrapper.vm.shaping).toBeNull()
	})

	it('ignores a second pointer during a shape, as a palm beside the pen', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await pointer(wrapper, 'pointermove', { offsetX: 400, offsetY: 400, pointerId: 2 })
		await pointer(wrapper, 'pointerup')

		const xs = wrapper.vm.strokes[0].points.map(([x]) => x)
		expect(Math.max(...xs)).toBe(160)
	})

	it('draws freehand when the tool is one it does not know', async () => {
		/* Refusing to draw at all would be the worst outcome available. */
		const wrapper = await open()
		wrapper.vm.tool = 'triangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 60, offsetY: 60 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(1)
		/* Two samples, not a rectangle's hundred. */
		expect(wrapper.vm.strokes[0].points.length).toBeLessThan(10)
	})

	it('previews the shape on the live sheet while it is being dragged', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'
		traceStroke.mockClear()

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		runFrame()

		expect(traceStroke).toHaveBeenCalled()
		/* And nothing is on the page yet. */
		expect(wrapper.vm.strokes).toHaveLength(0)
	})

	it('erases rather than drawing a shape while the eraser is on', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'
		wrapper.vm.erasing = true

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(0)
		expect(wrapper.vm.shaping).toBeNull()
	})
```

Add `DEFAULT_TOOL` to the imports at the top of the file, beside the palette
import added for color:

```js
const { DEFAULT_TOOL } = await import('../inkShape.js')
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- inkCanvas`
Expected: FAIL. "commits a rectangle as an ordinary stroke" fails with
`expected 1 to be 50` or similar — today a pointerdown/move/up with any tool
draws a two-sample freehand stroke, because nothing reads `tool`.

- [ ] **Step 3: Add the tool and the shape in progress to the component's state**

In `src/components/InkCanvas.vue`, add the import beside the other ink modules,
keeping them alphabetical:

```js
import { DEFAULT_TOOL, knownTool, shapePoints } from '../inkShape.js'
```

Add to `data()`, immediately after the `color` field:

```js
			/* What the pen draws: the pen itself, or one of the shapes. Not
			   remembered between drawings - a color is a preference, a tool is
			   a momentary intent. */
			tool: DEFAULT_TOOL,
			/* The shape being dragged out, before it is a stroke:
			   { from: [x, y], points: [...] }. Null the rest of the time. */
			shaping: null,
```

- [ ] **Step 4: Add the shape methods**

Add to `methods`, immediately before `finishStroke()`:

```js
		/* Start a shape where the pen landed.
		 *
		 * Nothing is drawn yet: a shape with no size is not a shape, and
		 * shapePoints says so by returning no points at all.
		 *
		 * @param {PointerEvent} event the pointer that landed
		 */
		startShape(event) {
			const [at] = this.onPage(samplesFrom(event))
			this.shaping = { from: [at[0], at[1]], points: [] }
		},

		/* Follow the far corner.
		 *
		 * The whole shape is recomputed from its two corners rather than being
		 * extended, which is what lets a rectangle become an ellipse become a
		 * line without any of them keeping a trace of the others.
		 *
		 * @param {PointerEvent} event the pointer that moved
		 */
		stretchShape(event) {
			const [at] = this.onPage(samplesFrom(event))
			this.shaping.points = shapePoints(knownTool(this.tool), this.shaping.from, this.onCanvas(at))
			this.requestPaint()
		},

		/* The far corner, brought onto the page.
		 *
		 * Ink off the sides can be neither seen nor rubbed out. There is no
		 * bottom to bring it back from: the page is as long as what is drawn on
		 * it, which is what panLimit computes.
		 *
		 * @param {Array<number>} at where the pointer is, in page coordinates
		 * @return {Array<number>} where the shape may reach
		 */
		onCanvas(at) {
			const width = this.$refs.canvas?.clientWidth ?? 0
			return [Math.max(0, Math.min(at[0], width)), Math.max(0, at[1])]
		},

		/* Commit the shape, if the drag made one.
		 *
		 * One stroke and one thing to undo, however many points it took. */
		finishShape() {
			const drawn = this.shaping?.points ?? []
			if (drawn.length) {
				const stroke = { points: drawn, color: this.color }
				this.strokes.push(stroke)
				this.history.push({ drew: stroke })
				const context = this.contextFor('page')
				if (context) {
					context.save()
					context.translate(0, -this.panY)
					context.fillStyle = this.colorOf(stroke)
					traceStroke(context, stroke.points)
					context.restore()
				}
			}
			this.dropShape()
		},

		/* Let go of the shape without committing it. */
		dropShape() {
			this.shaping = null
			this.pointerId = null
			this.pointerType = null
			this.paintNow()
		},
```

- [ ] **Step 5: Branch the pointer handlers**

In `onDown(event)`, after the `if (this.erasing) { … }` block and before
`this.predicted = []`, insert:

```js
			if (knownTool(this.tool) !== 'pen') {
				this.startShape(event)
				return
			}
```

Change the guard at the top of `onDown` that refuses a second gesture from

```js
			if (this.current || this.rubbing) {
```

to

```js
			if (this.current || this.rubbing || this.shaping) {
```

In `onMove(event)`, after the `if (this.rubbing) { … }` block and before
`if (!this.current) {`, insert:

```js
			if (this.shaping) {
				this.stretchShape(event)
				return
			}
```

In `onUp(event)`, after the `if (this.rubbing) { … }` block and before
`if (this.current) {`, insert:

```js
			if (this.shaping) {
				this.finishShape()
				return
			}
```

- [ ] **Step 6: Give `pointercancel` its own handler**

A cancelled pointer commits a freehand stroke — the ink was really laid down —
but abandons a shape. Add this method immediately after `onUp`:

```js
		/* The system took the pointer away.
		 *
		 * A half-drawn stroke is ink that was really laid down, so it is kept,
		 * exactly as lifting the pen would keep it. A shape is not: it is only
		 * itself once the reader has said where it ends, and committing one the
		 * reader never finished would put a box on the page they did not draw.
		 *
		 * @param {PointerEvent} event the pointer that was cancelled
		 */
		onCancel(event) {
			if (this.shaping && event.pointerId === this.pointerId) {
				this.dropShape()
				return
			}
			this.onUp(event)
		},
```

In the template, change the live canvas's binding from

```html
					@pointercancel="onUp"
```

to

```html
					@pointercancel="onCancel"
```

- [ ] **Step 7: Preview the shape on the live sheet**

In `paintLive()`, the guard that decides whether anything is drawn reads

```js
			if (!this.current && !(this.rubbing && this.rubbedFrom)) {
```

Change it to

```js
			if (!this.current && !this.shaping?.points.length && !(this.rubbing && this.rubbedFrom)) {
```

and inside the `context.save()` block, change the `if (this.current) { … }` chain
so the shape has its own branch. The branch order matters: `current` and
`shaping` are never both set, so either may be tested first, but the eraser's
branch must stay last because it is the one with no points of its own.

```js
			if (this.current) {
				const points = this.predicted?.length
					? [...this.current.points, ...this.predicted]
					: this.current.points
				context.fillStyle = this.colorOf(this.current)
				traceStroke(context, points)
				this.painted = this.onScreen(this.boundsOf(points))
			} else if (this.shaping?.points.length) {
				context.fillStyle = this.colorOf({ color: this.color })
				traceStroke(context, this.shaping.points)
				this.painted = this.onScreen(this.boundsOf(this.shaping.points))
			} else {
```

- [ ] **Step 8: Run them and watch them pass**

Run: `npm run test -- inkCanvas`
Expected: PASS, every test in the file.

- [ ] **Step 9: Run the whole suite and the linters**

Run: `npm run test && npm run lint && npm run stylelint`
Expected: 23 files, 554 tests (544 plus the 10 added here). All green.

- [ ] **Step 10: Prove the preview is not the commit**

Delete the `this.strokes.push(stroke)` line from `finishShape()`, run
`npm run test -- inkCanvas`, and confirm "commits a rectangle as an ordinary
stroke" fails. Restore it and confirm it passes. Put both outputs in your report:
a shape that only ever previewed would look identical on screen until Done.

- [ ] **Step 11: Commit**

```bash
git add src/components/InkCanvas.vue src/tests/inkCanvas.spec.js
git commit -F - <<'MSG'
feat(ink): drag out a line, a rectangle or an ellipse

The pointer handlers gain a branch and the live sheet previews the shape
being dragged; what lands on the page is an ordinary stroke, so the
eraser, undo, color, cropping and the file format carry on untouched.

The shape is rebuilt from its two corners on every move rather than
extended, so changing the tool mid-drawing leaves no trace of the last
one. A cancelled pointer abandons a shape where it would keep a freehand
stroke: ink half drawn was really laid down, a shape half dragged was
never decided.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: The tool picker

**Files:**
- Modify: `src/components/InkCanvas.vue`
- Modify: `src/tests/inkCanvas.spec.js`

**Interfaces:**
- Consumes: `INK_TOOLS`, `knownTool`, `DEFAULT_TOOL` from `src/inkShape.js`; the
  `tool` field from Task 2.
- Produces: a computed `toolChoices` returning
  `Array<{key, label, chosen}>` and a computed `toolLabel`; a method
  `chooseTool(key)`; a `choosingTool` boolean in `data()`.

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/inkCanvas.spec.js`, inside the first `describe('InkCanvas', …)`
block, beside the color picker's tests:

```js
	it('names every tool, so the picker is not four unlabeled icons', async () => {
		const wrapper = await open()

		expect(wrapper.vm.toolChoices.map((choice) => choice.label))
			.toEqual(['Pen', 'Line', 'Rectangle', 'Ellipse'])
	})

	it('marks which tool is in use', async () => {
		const wrapper = await open()

		wrapper.vm.chooseTool('rectangle')

		const chosen = wrapper.vm.toolChoices.filter((choice) => choice.chosen)
		expect(chosen).toHaveLength(1)
		expect(chosen[0].key).toBe('rectangle')
	})

	it('opens on the pen, however the last drawing ended', async () => {
		/* Deliberately unlike the color, which is remembered: a tool is a
		   momentary intent, and a reader coming back means to write. */
		const wrapper = await open()

		expect(wrapper.vm.tool).toBe('pen')
	})

	it('closes the tool menu when a tool is chosen', async () => {
		const wrapper = await open()
		wrapper.vm.choosingTool = true

		wrapper.vm.chooseTool('line')

		expect(wrapper.vm.choosingTool).toBe(false)
	})

	it('turns the eraser off when a tool is chosen', async () => {
		/* Choosing a tool says the next thing is a stroke, which is the rule
		   choosing a color already follows. The eraser is the one thing on this
		   canvas that destroys work. */
		const wrapper = await open()
		wrapper.vm.erasing = true

		wrapper.vm.chooseTool('ellipse')

		expect(wrapper.vm.erasing).toBe(false)
		expect(wrapper.vm.tool).toBe('ellipse')
	})

	it('refuses a tool it does not know', async () => {
		const wrapper = await open()

		wrapper.vm.chooseTool('triangle')

		expect(wrapper.vm.tool).toBe('pen')
	})

	it('leaves the tool alone when a color is chosen', async () => {
		/* They are orthogonal: a color says what the ink looks like, a tool
		   says what shape it takes. */
		const wrapper = await open()
		wrapper.vm.chooseTool('rectangle')

		wrapper.vm.chooseColor('#cc0000')

		expect(wrapper.vm.tool).toBe('rectangle')
	})

	it('opens the tool menu from a pen tap', async () => {
		const wrapper = await open()

		await tap(wrapper, wrapper.find('.ink__tool-picker'), 'pointerup', { pointerType: 'pen' })

		expect(wrapper.vm.choosingTool).toBe(true)
	})

	it('closes the tool menu when a pen taps the trigger again', async () => {
		const wrapper = await open()
		wrapper.vm.choosingTool = true

		await tap(wrapper, wrapper.find('.ink__tool-picker'), 'pointerup', { pointerType: 'pen' })

		expect(wrapper.vm.choosingTool).toBe(false)
	})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- inkCanvas`
Expected: FAIL — `Cannot read properties of undefined (reading 'map')`, because
`toolChoices` does not exist.

- [ ] **Step 3: Add the choices and the chooser**

In `src/components/InkCanvas.vue`, change the `inkShape.js` import to

```js
import { DEFAULT_TOOL, INK_TOOLS, knownTool, shapePoints } from '../inkShape.js'
```

Add to `data()`, immediately after `tool`:

```js
			/* Whether the tool menu is open. NcActions manages this itself; the
			   component has to know because the menu lives outside the dialog
			   and the dialog takes the focus back from anything outside it. */
			choosingTool: false,
```

Add to `computed`, after `colorLabel()`:

```js
		/* The tools, named and with the one in use marked.
		 *
		 * Named here rather than in the module for the reason the colors are:
		 * the names are translated, and a module of geometry should not need
		 * the translation globals to be testable. An icon is also a poor label
		 * on its own to a reader who is listening rather than looking.
		 */
		toolChoices() {
			const named = {
				pen: t('notes', 'Pen'),
				line: t('notes', 'Line'),
				rectangle: t('notes', 'Rectangle'),
				ellipse: t('notes', 'Ellipse'),
			}
			return INK_TOOLS.map((key) => ({
				key,
				label: named[key],
				chosen: key === this.tool,
			}))
		},

		/* What the picker's own button says it will draw. */
		toolLabel() {
			return this.toolChoices.find((choice) => choice.chosen)?.label ?? ''
		},
```

Add to `methods`, immediately before `chooseColor(value)`:

```js
		/* Set what the pen draws.
		 *
		 * Nothing already on the page changes: a stroke keeps the shape it was
		 * drawn as, the same way it keeps its color.
		 *
		 * @param {string} key the chosen tool
		 */
		chooseTool(key) {
			this.tool = knownTool(key)
			/* Choosing a tool says the next thing is a stroke, so the eraser
			   stands down - the rule choosing a color already follows. */
			this.erasing = false
			this.choosingTool = false
		},

		/* The tool menu's own way in and out for a pen, which sends no click to
		 * anything inside this dialog. Toggles, so a menu opened by mistake can
		 * be shut without choosing a tool. */
		toggleToolPicker(event) {
			if (event.pointerType === 'pen' && this.accepting()) {
				this.choosingTool = !this.choosingTool
			}
		},
```

- [ ] **Step 4: Add the picker to the bar**

Add the icon imports beside the existing ones:

```js
import EllipseIcon from 'vue-material-design-icons/EllipseOutline.vue'
import LineIcon from 'vue-material-design-icons/VectorLine.vue'
import PenIcon from 'vue-material-design-icons/Pencil.vue'
import RectangleIcon from 'vue-material-design-icons/RectangleOutline.vue'
```

Register them in `components`, keeping it alphabetical: `CloseIcon, EllipseIcon,
EraserIcon, LineIcon, NcActionButton, NcActions, NcButton, PenIcon,
RectangleIcon, UndoIcon`.

Add to `computed`, after `toolLabel()`, so the template can name a component
without a chain of `v-if`:

```js
		/* The icon for each tool, by name, so the template does not need four
		   conditionals to show one of them. */
		toolIcons() {
			return { pen: 'PenIcon', line: 'LineIcon', rectangle: 'RectangleIcon', ellipse: 'EllipseIcon' }
		},
```

In the template, insert this as the **first** child of `<div class="ink__bar">`,
before the color picker:

```html
				<!-- The tool in use is the button, so what the next stroke will
				     be is where the eye already is. A stateful tool's usual
				     failure is "why is my pen drawing boxes". -->
				<NcActions v-model:open="choosingTool"
					class="ink__tool-picker"
					:aria-label="t('notes', 'Tool: {tool}', { tool: toolLabel })"
					:title="t('notes', 'Tool: {tool}', { tool: toolLabel })"
					:disabled="!accepting()"
					@pointerup="toggleToolPicker"
				>
					<template #icon>
						<component :is="toolIcons[tool]" :size="20" />
					</template>
					<NcActionButton v-for="choice in toolChoices"
						:key="choice.key"
						type="radio"
						:modelValue="tool"
						:value="choice.key"
						@update:modelValue="chooseTool(choice.key)"
						@click="chooseTool(choice.key)"
					>
						<template #icon>
							<component :is="toolIcons[choice.key]" :size="20" />
						</template>
						{{ choice.label }}
					</NcActionButton>
				</NcActions>
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npm run test -- inkCanvas`
Expected: PASS, every test in the file.

- [ ] **Step 6: Run the whole suite and the linters**

Run: `npm run test && npm run lint && npm run stylelint`
Expected: 23 files, 563 tests (554 plus the 9 added here). All green.

- [ ] **Step 7: Prove the eraser really stands down**

Delete `this.erasing = false` from `chooseTool`, run `npm run test -- inkCanvas`,
and confirm "turns the eraser off when a tool is chosen" fails. Restore it and
confirm it passes. Put both outputs in your report: of everything in this task
that is the one whose absence destroys work.

- [ ] **Step 8: Commit**

```bash
git add src/components/InkCanvas.vue src/tests/inkCanvas.spec.js
git commit -F - <<'MSG'
feat(ink): a picker for the pen and the three shapes

One button showing the tool in use, opening four named choices. The pen
is a member of the set rather than the absence of one, so the mode has a
single home and the button shows what the next stroke will be - a
stateful tool's usual failure is "why is my pen drawing boxes".

Built like the color picker down to the details, because every one of
them was a bug found on the device: the pen served from pointerup, the
choice bound to the click as well as the model, and the menu closing on a
choice it has already made.

Choosing a tool turns the eraser off, which is the rule choosing a color
already follows.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: Prove a shape survives the round trip

The unit tests assert a shape becomes a stroke. This asserts what a reader gets:
a rectangle drawn on the canvas is still a rectangle after the PNG, the note and
a reopen.

**Files:**
- Modify: `playwright/e2e/ink.spec.ts`

**Interfaces:**
- Consumes: the picker from Task 3, the drawing from Task 2.

- [ ] **Step 1: Write the test**

Add to `playwright/e2e/ink.spec.ts`, inside `test.describe('Ink', …)`. The
helpers `openInkedNote`, `inkOnThePage` and `inkBoxOnScreen` already exist near
the top of the file.

```ts
	test('a rectangle survives the picture and the reopen', async ({ page, request }) => {
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// The tool names itself on its button, so it is found by what it says.
		await page.getByRole('button', { name: /^Tool:/ }).click()
		await page.getByRole('menuitemradio', { name: 'Rectangle', exact: true }).click()
		await expect(page.getByRole('button', { name: 'Tool: Rectangle' })).toBeVisible()

		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 2 - 100
		const y = box.y + box.height / 2 - 60
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 200, y + 120, { steps: 10 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()

		// Reopen and measure what came back.
		await expect(page.locator('figure[data-component="image-view"] img').first()).toBeVisible()
		await page.locator('figure[data-component="image-view"] img').first().click()
		await expect(page.locator('.ink__canvas--page')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// A rectangle is its outline: ink along the edges and none through the
		// middle. Reading the pixels rather than the strokes is what makes this
		// about the drawing rather than about the metadata.
		const painted = await inkOnThePage(page)
		expect(painted).toBeGreaterThan(0)
		const shape = await inkBoxOnScreen(page)
		// Drawn 200x120 and saved at INK_DENSITY; the page sheet is at the
		// device ratio, so compare proportions rather than absolute sizes.
		expect(shape.width / shape.height).toBeGreaterThan(1.4)
		expect(shape.width / shape.height).toBeLessThan(1.9)

		const hollow = await page.locator('.ink__canvas--page').evaluate((element: HTMLCanvasElement) => {
			const context = element.getContext('2d')!
			const { data, width, height } = context.getImageData(0, 0, element.width, element.height)
			let edge = 0
			let middle = 0
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] === 0) {
					continue
				}
				const at = (i - 3) / 4
				const row = Math.floor(at / width)
				// Count ink in the middle third of the painted rows against ink
				// anywhere. A filled shape would put plenty in the middle.
				if (row > height / 3 && row < (height * 2) / 3) {
					middle++
				}
				edge++
			}
			return { edge, middle }
		})
		expect(hollow.edge).toBeGreaterThan(0)
		// The sides still cross the middle third, so this is a ratio and not a
		// zero: a filled rectangle would put far more there than its two sides.
		expect(hollow.middle / hollow.edge).toBeLessThan(0.35)

		// And the tool opens on the pen next time, unlike the color.
		await expect(page.getByRole('button', { name: 'Tool: Pen' })).toBeVisible()
	})
```

- [ ] **Step 2: Run it, and prove it bites**

This test runs after the tasks that built the behavior, so it is expected to
**pass** on the first run. A passing test you never saw fail proves nothing, so
prove it bites before trusting it.

**Before running anything here, know that the e2e suite calls
`deleteAllNotesVia()` and wipes the dev container's notes.** Ask before running
it if there is a drawing in there. The container bind-mounts this repo and serves
the built `js/`, so run `npm run build` first.

Run: `npx playwright test ink.spec.ts -g "a rectangle survives"`
Expected: PASS.

Then change `'Rectangle'` to `'Ellipse'` in both places and run it again.
Expected: FAIL on the hollow ratio or the proportions — an ellipse fills its
middle third far more than a rectangle's two sides do.

Change it back and confirm it passes again. Put both outputs in your report.

- [ ] **Step 3: Run the full ink e2e suite**

Run: `npx playwright test ink.spec.ts`
Expected: 31 passing (30 existing plus this one).

- [ ] **Step 4: Commit**

```bash
git add playwright/e2e/ink.spec.ts
git commit -F - <<'MSG'
test(ink): a rectangle survives the picture and the reopen

The unit tests say a shape becomes a stroke. This says the reader gets a
rectangle back: drawn, saved, reopened, and measured off the pixels on
the page sheet - its proportions, and the fact that it is an outline
rather than a filled box.

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: Update the running documents

**Files:**
- Modify: `docs/INK-SHAPE-DESIGN.md`
- Modify: `STATUS.md` (untracked by design — nothing to commit for it)

- [ ] **Step 1: Mark the spec built**

In `docs/INK-SHAPE-DESIGN.md`, change `Status: design, awaiting approval.` to
`Status: built.` and replace the "Open questions" section's body with the two
things the device decides: whether the 0.99 px corner reads as soft, and whether
5° is the right latitude for a line's snap.

- [ ] **Step 2: Move shapes into Closed in STATUS.md**

Add a `## Closed` entry naming what shipped — three shapes, a tool picker, and a
line that squares itself up — and a `## For Paul` bullet with the two judgments
left to the device above.

- [ ] **Step 3: Commit the spec**

```bash
git add docs/INK-SHAPE-DESIGN.md
git commit -F - <<'MSG'
docs(ink): the shape spec is built

Assisted-by: Claude Code:claude-opus-5

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 4: Do not run `dev/ipad.sh`**

The controller runs it, so that the build reaching the device is the one it has
verified. Say in your report that you skipped this step.

---

## Notes for whoever implements this

- **Order matters for 1 → 3.** Task 1 creates the module Tasks 2 and 3 import,
  and Task 3's picker sets the field Task 2 reads. Task 4 needs both.
- **The e2e suite wipes the dev container's notes.** Only Task 4 runs it.
- **If a test passes before you write the code**, that is a finding about the
  test. Make it fail on purpose before trusting it.
- **Do not adjust `SHAPE_STEP` upward.** It is under `SMOOTH_GAP` so that the
  smoothing never interpolates a shape's edge. A larger value silently bows
  straight lines, and no test of a single shape would catch it — the one that
  would is "steps closely enough that the smoothing leaves it alone".
