/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { erasedBy, ERASER_REACH, ERASER_SIZE } from '../inkErase.js'
import { STROKE_SIZE } from '../inkRender.js'

/* A line, as the pen draws one: samples along it. */
function line(x1, y1, x2, y2, n = 10) {
	return {
		points: Array.from({ length: n }, (_, i) => [
			x1 + ((x2 - x1) * i) / (n - 1),
			y1 + ((y2 - y1) * i) / (n - 1),
			0.5,
		]),
	}
}

describe('erasedBy', () => {
	it('rubs out a stroke the eraser is on', () => {
		expect(erasedBy([line(0, 0, 100, 0)], [[50, 0, 0.5]])).toEqual([0])
	})

	it('leaves a stroke the eraser misses', () => {
		expect(erasedBy([line(0, 0, 100, 0)], [[50, 200, 0.5]])).toEqual([])
	})

	it('reaches as far as the ink does, not only to the center line', () => {
		/* The samples are the middle of the stroke and the nib puts ink either
		   side of them. An eraser touching the edge of a mark has to take it:
		   what the reader aims at is the ink they can see. */
		const stroke = line(0, 0, 100, 0)
		const edge = STROKE_SIZE / 2 + ERASER_SIZE / 2 - 0.5
		expect(erasedBy([stroke], [[50, edge, 0.5]])).toEqual([0])
		expect(erasedBy([stroke], [[50, ERASER_REACH + 1, 0.5]])).toEqual([])
	})

	it('rubs out a long stroke between its samples', () => {
		/* A straight line can be two samples a hundred pixels apart. Measuring
		   to the samples alone would let the eraser pass through the middle of
		   a mark without touching it. */
		const sparse = { points: [[0, 0, 0.5], [200, 0, 0.5]] }
		expect(erasedBy([sparse], [[100, 0, 0.5]])).toEqual([0])
	})

	it('takes a dot, which is one sample and no segment', () => {
		expect(erasedBy([{ points: [[10, 10, 0.5]] }], [[10, 10, 0.5]])).toEqual([0])
	})

	it('names every stroke under one pass, in an order they can be taken out in', () => {
		/* Descending, so taking one out does not move the next one's place. */
		const strokes = [line(0, 0, 100, 0), line(0, 500, 100, 500), line(0, 1, 100, 1)]
		expect(erasedBy(strokes, [[50, 0, 0.5]])).toEqual([2, 0])
	})

	it('rubs out a line its path crossed between two samples', () => {
		/* The pen is not reported continuously. A swipe reports samples tens of
		   pixels apart, and a thin line crossed between two of them was a line
		   the reader watched the eraser go straight through and not take - so
		   they went over it again, and again. Testing the samples alone is
		   testing where the eraser was photographed, not where it went. */
		const upright = { points: [[50, -100, 0.5], [50, 100, 0.5]] }
		const swipe = [[20, 0, 0.5], [80, 0, 0.5]]
		expect(erasedBy([upright], swipe)).toEqual([0])
	})

	it('rubs out a line its path passed close by between two samples', () => {
		/* Not only a crossing: alongside, within the reach, counts too. */
		const along = { points: [[0, 3, 0.5], [100, 3, 0.5]] }
		expect(erasedBy([along], [[0, 0, 0.5], [100, 0, 0.5]])).toEqual([0])
	})

	it('leaves a line its path did not come near', () => {
		const far = { points: [[50, 300, 0.5], [50, 400, 0.5]] }
		expect(erasedBy([far], [[20, 0, 0.5], [80, 0, 0.5]])).toEqual([])
	})

	it('names a stroke once however many samples are on it', () => {
		const strokes = [line(0, 0, 100, 0)]
		expect(erasedBy(strokes, [[40, 0, 0.5], [50, 0, 0.5], [60, 0, 0.5]])).toEqual([0])
	})

	it('finds nothing to rub out on an empty page, or with nowhere to rub', () => {
		expect(erasedBy([], [[1, 1, 0.5]])).toEqual([])
		expect(erasedBy([line(0, 0, 10, 0)], [])).toEqual([])
	})

	it('is a good deal wider than the nib, because a finger-sized target is not', () => {
		expect(ERASER_SIZE).toBeGreaterThan(STROKE_SIZE * 3)
	})
})
