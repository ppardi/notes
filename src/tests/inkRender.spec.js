/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { CROP_MARGIN, INK_COLOR, inkBounds, shiftStrokes, STROKE_SIZE, traceStroke } from '../inkRender.js'

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

describe('traceStroke', () => {
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

	it('is one colour on transparency, so the theme can be applied where it is shown', () => {
		expect(INK_COLOR).toBe('#000000')
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
		/* The samples are the centre line; the nib puts ink either side of it.
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
