/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getStroke } from 'perfect-freehand'

/**
 * What every stroke is drawn and saved in.
 *
 * One colour on transparency, so the theme is applied where the ink is shown
 * rather than baked into the file: a page written on a light screen reads on
 * a dark one, and the other way round. Ink saved before this was black too,
 * so it follows the theme now without being rewritten.
 */
export const INK_COLOR = '#000000'

/* size is the nib in CSS pixels. thinning is how much pressure narrows it, and
   it is off: a mouse reports one flat pressure and so draws a uniform line,
   while a stylus reports real pressure and drew a line that swelled and
   tapered - a fountain pen where a pen was wanted. The nib is the same width
   however hard it is pressed, on every device. */
/**
 * The nib's width in CSS pixels, exported so a caller can tell how far a
 * stroke's ink spreads beyond the points it was drawn from.
 *
 * A drafting pen rather than a marker. This is the one number to change if
 * the line wants to be finer or heavier; everything else follows from it.
 */
export const STROKE_SIZE = 2.5

const STROKE = { size: STROKE_SIZE, thinning: 0, simulatePressure: false }

/**
 * How far outside the samples a saved picture reaches, in CSS pixels.
 *
 * The samples are the stroke's centre line and the nib puts ink either side
 * of it, so a crop taken at the samples would shave the writing lengthwise.
 * Beyond that it is margin: ink flush against the edge of a picture reads as
 * if it were cut off.
 */
export const CROP_MARGIN = STROKE_SIZE * 2

/**
 * The rectangle a set of strokes puts ink in, in CSS pixels.
 *
 * What the reader wants in the note is the writing, not the screen it was
 * written on - a full page saved whole is a few words in a field of white
 * space.
 *
 * @param {Array<{points: Array<Array<number>>}>} strokes the finished strokes
 * @param {number} margin how far outside the samples to reach
 * @return {Array<number> | null} [x, y, width, height], or null when nothing is drawn
 */
export function inkBounds(strokes, margin = CROP_MARGIN) {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const stroke of strokes) {
		for (const [x, y] of stroke.points) {
			minX = Math.min(minX, x)
			minY = Math.min(minY, y)
			maxX = Math.max(maxX, x)
			maxY = Math.max(maxY, y)
		}
	}
	if (minX === Infinity) {
		return null
	}
	return [minX - margin, minY - margin, maxX - minX + margin * 2, maxY - minY + margin * 2]
}

/**
 * The same strokes, moved.
 *
 * A copy: what is on screen keeps the coordinates the pen drew it at, and
 * only what is written to the file is moved to the picture's own corner.
 *
 * @param {Array<{points: Array<Array<number>>}>} strokes the strokes to move
 * @param {number} dx how far right
 * @param {number} dy how far down
 * @return {Array<object>} the moved strokes
 */
export function shiftStrokes(strokes, dx, dy) {
	return strokes.map((stroke) => ({
		...stroke,
		points: stroke.points.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest]),
	}))
}

/* Below this, perfect-freehand has not returned a shape worth curving. */
const CURVABLE = 4

/**
 * Ink back where it was drawn, as far as this screen allows.
 *
 * A saved block is cropped to the writing and its strokes moved into the
 * picture's own corner, which is what makes the file the size of the drawing
 * rather than the size of a screen. Opening it without putting it back meant
 * the drawing jumped to the top left - so the first time a reader opened it
 * they saw it where they had written it, and every time after that somewhere
 * else. The origin saved beside the strokes is what undoes that.
 *
 * Where the screen cannot hold it at that offset the ink is brought on rather
 * than left hanging off the edge: an iPad is a different width in portrait,
 * and ink outside the canvas can be neither seen nor rubbed out. A drawing
 * longer than the screen starts at the top, because no offset would show all
 * of it and the top is where reading starts.
 *
 * @param {Array<{points: Array<Array<number>>}>} strokes the saved strokes
 * @param {Array<number> | null | undefined} origin where it was, or nothing
 *   for a block saved before positions were kept
 * @param {number} width the canvas, in CSS pixels
 * @param {number} height the canvas, in CSS pixels
 * @return {Array<object>} the strokes, placed
 */
export function placeInk(strokes, origin, width, height) {
	const bounds = inkBounds(strokes)
	if (!bounds || !origin) {
		return strokes
	}
	const [left, top, pictureWidth, pictureHeight] = bounds
	const x = Math.max(0, Math.min(origin[0], width - pictureWidth))
	const y = Math.max(0, Math.min(origin[1], height - pictureHeight))
	return shiftStrokes(strokes, x - left, y - top)
}

/**
 * Trace one stroke's outline onto a context and fill it.
 *
 * perfect-freehand returns the outline as a polygon. Joining its points with
 * straight lines is what gives a stroke visible facets, most of all where it
 * turns - which is most of handwriting. Instead each point is the control
 * point of a quadratic curve ending halfway to the next, the curve that passes
 * smoothly through the polygon's corners. The loop runs one past the end so
 * the curve comes back round to where it started and the closing join is as
 * smooth as the rest.
 *
 * @param {CanvasRenderingContext2D} context where to trace
 * @param {Array<Array<number>>} points the stroke's [x, y, pressure] samples
 */
export function traceStroke(context, points) {
	const outline = getStroke(points, STROKE)
	if (!outline.length) {
		return
	}
	context.beginPath()
	context.moveTo(outline[0][0], outline[0][1])
	if (outline.length < CURVABLE) {
		/* A dot, or the first sample of a stroke: too small to curve, and at
		   this size its straight edges are under a pixel. */
		for (const [x, y] of outline.slice(1)) {
			context.lineTo(x, y)
		}
	} else {
		for (let i = 1; i <= outline.length; i++) {
			const [ax, ay] = outline[i % outline.length]
			const [bx, by] = outline[(i + 1) % outline.length]
			context.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2)
		}
	}
	context.closePath()
	context.fill()
}
