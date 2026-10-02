/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { CROP_MARGIN, inkBounds, placeInk, shiftStrokes, SMOOTH_GAP, smoothed, STROKE_SIZE, traceStroke } from '../inkRender.js'

/* Records what was asked of a canvas, so a test can say what the drawing is
   made of without a canvas to look at. */
function recorder() {
	const calls = []
	const context = new Proxy({ fillStyle: null }, {
		get: (target, name) => (name in target
			? target[name]
			: (...args) => calls.push([name, ...args])),
		set: (target, name, value) => (target[name] = value) || true,
	})
	return { context, calls, names: () => calls.map(([name]) => name) }
}

/* A short handwritten curve: enough samples for perfect-freehand to return a
   real outline rather than the few points it gives a dot. */
const CURVE = Array.from({ length: 12 }, (_, i) => [i * 4, Math.sin(i / 2) * 10, 0.5])

/* A path that turns a square corner, sampled as a shape is. */
const RIGHT_ANGLE = [
	...Array.from({ length: 21 }, (_, i) => [i * 5, 0, 0.5]),
	...Array.from({ length: 20 }, (_, i) => [100, (i + 1) * 5, 0.5]),
]

/* How far the traced outline reaches past a corner, along the diagonal
   pointing out of it. A square join reaches STROKE_SIZE / 2 * sqrt(2) beyond
   the corner; a path smoothed into the turn falls short of it, and the edge
   is seen to taper into the corner. */
function pastTheCorner(calls, corner, out) {
	let furthest = -Infinity
	for (const [name, ...args] of calls) {
		const traced = name === 'quadraticCurveTo'
			? [[args[0], args[1]], [args[2], args[3]]]
			: name === 'moveTo' || name === 'lineTo'
				? [[args[0], args[1]]]
				: []
		for (const [x, y] of traced) {
			furthest = Math.max(furthest, (x - corner[0]) * out[0] + (y - corner[1]) * out[1])
		}
	}
	return furthest
}

describe('traceStroke', () => {
	it('keeps a ruled corner square, where a hand is smoothed into the turn', () => {
		/* perfect-freehand smooths the path it is given, which is right for a
		   hand and wrong for a construction: it cuts the corner of a rectangle
		   into a long chamfer that reads as the edges tapering away. Ruled
		   says the points are exact and are not to be smoothed. */
		const away = [Math.SQRT1_2, -Math.SQRT1_2]
		const hand = recorder()
		traceStroke(hand.context, RIGHT_ANGLE)
		const ruled = recorder()
		traceStroke(ruled.context, RIGHT_ANGLE, true)

		expect(pastTheCorner(ruled.calls, [100, 0], away))
			.toBeGreaterThan(pastTheCorner(hand.calls, [100, 0], away) + 1)
	})

	it('reaches a ruled corner within half a nib of the join itself', () => {
		const ruled = recorder()
		traceStroke(ruled.context, RIGHT_ANGLE, true)

		/* A square join puts the outer corner STROKE_SIZE / 2 * sqrt(2) out
		   along the diagonal. Within half a nib of that is a corner, not a
		   taper. */
		const square = (STROKE_SIZE / 2) * Math.SQRT2
		expect(pastTheCorner(ruled.calls, [100, 0], [Math.SQRT1_2, -Math.SQRT1_2]))
			.toBeGreaterThan(square - STROKE_SIZE / 2)
	})

	it('draws the outline as curves, so a stroke has no facets', () => {
		const { context, names } = recorder()
		traceStroke(context, CURVE)
		expect(names()).toContain('quadraticCurveTo')
		expect(names()).not.toContain('lineTo')
	})

	it('closes and fills the outline', () => {
		const { context, names } = recorder()
		traceStroke(context, CURVE)
		expect(names()).toContain('beginPath')
		expect(names().at(-2)).toBe('closePath')
		expect(names().at(-1)).toBe('fill')
	})

	it('covers the whole outline, ending back where it started', () => {
		const { context, calls } = recorder()
		traceStroke(context, CURVE)
		const curves = calls.filter(([name]) => name === 'quadraticCurveTo')
		const [, startX, startY] = calls.find(([name]) => name === 'moveTo')
		const [, , , endX, endY] = curves.at(-1)
		/* The last curve ends halfway back to the first point, which is what
		   closePath then joins - a smooth corner rather than a notch. */
		expect(Math.hypot(endX - startX, endY - startY)).toBeLessThan(10)
		expect(curves.length).toBeGreaterThan(4)
	})

	it('still marks the page for a tap that is barely a stroke', () => {
		const { context, names } = recorder()
		traceStroke(context, [[5, 5, 0.5]])
		expect(names()).toContain('fill')
	})

	it('draws nothing at all for no samples', () => {
		const { context, names } = recorder()
		traceStroke(context, [])
		expect(names()).toEqual([])
	})

	it('is the same width however hard the pen is pressed', () => {
		/* A mouse reports one flat pressure, so a mouse stroke is uniform and
		   reads as a pen. A stylus reports real pressure, and width that
		   follows it reads as a fountain pen - which is not what this is for.
		   The same path drawn softly and hard must come out the same. */
		const path = (pressure) => Array.from({ length: 12 }, (_, i) => [i * 4, Math.sin(i / 2) * 10, pressure])
		const extent = (points) => {
			const { context, calls } = recorder()
			traceStroke(context, points)
			const coords = calls.flatMap(([, ...args]) => args)
			const xs = coords.filter((_, i) => i % 2 === 0)
			const ys = coords.filter((_, i) => i % 2 === 1)
			return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
		}
		const [softWidth, softHeight] = extent(path(0.1))
		const [hardWidth, hardHeight] = extent(path(0.9))
		expect(hardWidth).toBeCloseTo(softWidth, 6)
		expect(hardHeight).toBeCloseTo(softHeight, 6)
	})
})

describe('inkBounds', () => {
	it('is the rectangle the writing is in, not the page it was written on', () => {
		/* The canvas is the size of the screen and the writing is a few words
		   somewhere on it. Saved whole, the note is mostly white space. */
		const strokes = [
			{ points: [[400, 300, 0.5], [420, 330, 0.5]] },
			{ points: [[500, 280, 0.5]] },
		]
		const [x, y, width, height] = inkBounds(strokes)
		expect(x).toBe(400 - CROP_MARGIN)
		expect(y).toBe(280 - CROP_MARGIN)
		expect(width).toBe(100 + CROP_MARGIN * 2)
		expect(height).toBe(50 + CROP_MARGIN * 2)
	})

	it('leaves room for the ink a stroke spreads beyond its samples', () => {
		/* The samples are the center line; the nib puts ink either side of it.
		   A crop taken at the samples would shave the stroke lengthwise. */
		expect(CROP_MARGIN).toBeGreaterThanOrEqual(STROKE_SIZE)
	})

	it('has a size even for a single dot', () => {
		const [, , width, height] = inkBounds([{ points: [[10, 10, 0.5]] }])
		expect(width).toBeGreaterThan(0)
		expect(height).toBeGreaterThan(0)
	})

	it('is nothing at all for a page nobody wrote on', () => {
		expect(inkBounds([])).toBeNull()
		expect(inkBounds([{ points: [] }])).toBeNull()
	})
})

describe('shiftStrokes', () => {
	it('moves every sample of every stroke', () => {
		const strokes = [{ points: [[10, 20, 0.4], [30, 40, 0.6]] }]
		expect(shiftStrokes(strokes, -5, -10)).toEqual([
			{ points: [[5, 10, 0.4], [25, 30, 0.6]] },
		])
	})

	it('leaves the strokes it was given alone', () => {
		/* The drawing on screen keeps the coordinates the pen drew it at;
		   only what is written to the file is moved. */
		const strokes = [{ points: [[10, 20, 0.4]] }]
		shiftStrokes(strokes, -5, -10)
		expect(strokes).toEqual([{ points: [[10, 20, 0.4]] }])
	})

	it('puts the ink at the margin when it is moved to its own bounds', () => {
		const strokes = [{ points: [[400, 300, 0.5], [420, 330, 0.5]] }]
		const [x, y] = inkBounds(strokes)
		const moved = shiftStrokes(strokes, -x, -y)
		expect(moved[0].points[0]).toEqual([CROP_MARGIN, CROP_MARGIN, 0.5])
	})
})

describe('placeInk', () => {
	/* What a saved block looks like coming back: its own coordinates, the ink
	   a margin inside the picture, as shiftStrokes left it when it was
	   cropped. The origin saved with it is the picture's corner, so what is
	   put back is the rectangle the picture occupied. */
	const saved = (width, height) => [{
		points: [
			[CROP_MARGIN, CROP_MARGIN, 0.5],
			[width - CROP_MARGIN, height - CROP_MARGIN, 0.5],
		],
	}]
	const boxOf = (strokes) => inkBounds(strokes).slice(0, 2)

	it('puts the ink back where it was drawn', () => {
		/* Opening a drawing and seeing it jump to a corner reads as a drawing
		   that has been moved. The first open and every one after it have to
		   look the same. */
		expect(boxOf(placeInk(saved(100, 60), [400, 300], 800, 600))).toEqual([400, 300])
	})

	it('brings ink back on when it would hang off the right', () => {
		/* The iPad is a different width in portrait, and ink written at the
		   right of a landscape screen would be off the edge of a narrow one:
		   invisible, and beyond the eraser. Moved on just enough. */
		expect(boxOf(placeInk(saved(100, 60), [700, 10], 400, 600))).toEqual([300, 10])
	})

	it('starts a page longer than the screen at the top of it', () => {
		/* No offset would show all of it, and the top is where reading starts. */
		expect(boxOf(placeInk(saved(100, 2000), [50, 900], 800, 600))).toEqual([50, 0])
	})

	it('never places ink above or to the left of the page', () => {
		expect(boxOf(placeInk(saved(100, 60), [-200, -50], 800, 600))).toEqual([0, 0])
	})

	it('leaves ink saved before positions were kept where it is', () => {
		/* Blocks saved by an earlier build carry no origin. They open in the
		   corner, as they did then, rather than somewhere invented. */
		const strokes = saved(100, 60)
		expect(placeInk(strokes, null, 800, 600)).toBe(strokes)
		expect(placeInk(strokes, undefined, 800, 600)).toBe(strokes)
	})

	it('has nothing to place for a page with no ink', () => {
		expect(placeInk([], [10, 10], 800, 600)).toEqual([])
	})
})

describe('smoothed', () => {
	const gapAfter = (points) => points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]))

	it('leaves a path the pen reported closely alone', () => {
		/* Most of a stroke arrives a pixel or two at a time and needs nothing. */
		const close = [[0, 0, 0.5], [2, 0, 0.5], [4, 1, 0.5], [6, 1, 0.5]]
		expect(smoothed(close)).toEqual(close)
	})

	it('fills a gap the pen left when it moved fast', () => {
		/* A fast stroke is reported tens of pixels at a time, and two long
		   segments meeting is a corner - which is what a letter written
		   quickly came out with. */
		const fast = [[0, 0, 0.5], [40, 0, 0.5], [60, 40, 0.5]]
		const filled = smoothed(fast)
		/* The steps are cut from the straight line between two readings while
		   the path drawn is the curve through them, which is longer - so the
		   bound is about the gap, not exactly it. */
		expect(Math.max(...gapAfter(filled))).toBeLessThan(SMOOTH_GAP * 1.5)
		expect(filled.length).toBeGreaterThan(fast.length * 3)
	})

	it('still passes through every place the pen was', () => {
		/* The filling is between the readings, never instead of them: what the
		   pen did is what is drawn. */
		const fast = [[0, 0, 0.5], [40, 0, 0.5], [60, 40, 0.5]]
		for (const point of fast) {
			expect(smoothed(fast).some((p) => p[0] === point[0] && p[1] === point[1])).toBe(true)
		}
	})

	it('keeps a straight line straight', () => {
		/* Filling a gap must not put a bulge in a line somebody ruled. */
		const straight = [[0, 0, 0.5], [50, 0, 0.5], [100, 0, 0.5]]
		for (const [, y] of smoothed(straight)) {
			expect(Math.abs(y)).toBeLessThan(0.001)
		}
	})

	it('rounds a corner rather than cutting it', () => {
		/* The filled points belong to a curve through the readings, so the
		   turn is carried by several points instead of one. */
		const corner = [[0, 0, 0.5], [40, 0, 0.5], [40, 40, 0.5]]
		const filled = smoothed(corner)
		const turn = filled.filter(([x, y]) => x > 30 && y > 0 && y < 30)
		expect(turn.length).toBeGreaterThan(1)
	})

	it('carries the pressure across, so a sample keeps its shape', () => {
		const filled = smoothed([[0, 0, 0.2], [40, 0, 0.8]])
		for (const point of filled) {
			expect(point).toHaveLength(3)
			expect(point[2]).toBeGreaterThanOrEqual(0.2)
			expect(point[2]).toBeLessThanOrEqual(0.8)
		}
	})

	it('has nothing to fill in a dot or an empty stroke', () => {
		expect(smoothed([])).toEqual([])
		expect(smoothed([[1, 1, 0.5]])).toEqual([[1, 1, 0.5]])
	})
})
