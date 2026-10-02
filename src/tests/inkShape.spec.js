/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { SMOOTH_GAP } from '../inkRender.js'
import { DEFAULT_TOOL, INK_TOOLS, knownTool, LINE_SNAP, SHAPE_MINIMUM, SHAPE_STEP, shapePoints, straighten } from '../inkShape.js'

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

	it('keeps every coordinate to a tenth of a pixel, so a shape does not bloat the file', () => {
		for (const tool of ['line', 'rectangle', 'ellipse']) {
			for (const [x, y] of shapePoints(tool, [3.3, 4.7], [333.3, 221.7])) {
				expect(Math.round(x * 10) / 10).toBe(x)
				expect(Math.round(y * 10) / 10).toBe(y)
			}
		}
	})

	it('still steps no further than SHAPE_STEP once the points are rounded', () => {
		/* Rounding can widen a gap, so the sampling leaves room for it. */
		for (const tool of ['line', 'rectangle', 'ellipse']) {
			for (let width = 10; width < 800; width += 37) {
				for (let height = 10; height < 500; height += 41) {
					expect(longestStep(shapePoints(tool, [3.3, 4.7], [3.3 + width, 4.7 + height]))).toBeLessThanOrEqual(SHAPE_STEP)
				}
			}
		}
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
		it('closes exactly where it started, and goes no further', () => {
			/* The renderer closes the path, so there is no join to cover and
			   nothing to gain by carrying on past it. */
			const points = shapePoints('rectangle', [0, 0], [100, 60])
			expect(points.at(-1)).toEqual(points[0])
			expect(points.filter(([x, y]) => x === points[0][0] && y === points[0][1])).toHaveLength(2)
		})

		it('starts from the middle of an edge rather than a corner', () => {
			/* The join carries a round cap. On a straight run the cap is flush
			   with the band it ends; on a corner it fills the corner in, and
			   that reads as a blot where three identical corners do not. */
			const points = shapePoints('rectangle', [0, 0], [100, 60])
			expect(points[0]).toEqual([50, 0, 0.5])
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
			const forwards = shapePoints('rectangle', [10, 20], [110, 80])
			const backwards = shapePoints('rectangle', [110, 80], [10, 20])
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
				/* Kept to a tenth of a pixel, so on the ellipse to within that. */
				expect(u * u + v * v).toBeCloseTo(1, 2)
			}
		})

		it('closes exactly where it started, and goes no further', () => {
			const points = shapePoints('ellipse', [0, 0], [200, 100])
			expect(points.at(-1)).toEqual(points[0])
		})

		it('steps closely enough that the smoothing leaves it alone', () => {
			expect(longestStep(shapePoints('ellipse', [0, 0], [400, 250]))).toBeLessThanOrEqual(SHAPE_STEP)
		})

		it('is drawn the same whichever corner it was dragged from', () => {
			const forwards = shapePoints('ellipse', [0, 0], [200, 100])
			const backwards = shapePoints('ellipse', [200, 100], [0, 0])
			expect(backwards).toEqual(forwards)
		})
	})
})
