/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getStroke } from 'perfect-freehand'

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

/* What a stroke whose points are a construction rather than a hand is drawn
   with.
 *
 * perfect-freehand smooths the path it is given - `streamline` defaults to 0.5
 * - which is what keeps handwriting from showing the pen's own jitter. On a
 * shape there is no jitter to take out and the smoothing has nothing to do but
 * cut the corners: a rectangle's corner came out 1.75 px inside where the nib
 * alone would put it, against the 1.77 px outside a square join reaches, so the
 * edges were seen to taper into every turn. Off, the corner is square to within
 * a quarter of a pixel. */
const RULED = { ...STROKE, streamline: 0 }

/**
 * Image pixels per CSS pixel of drawing in a saved picture.
 *
 * Half of a pair, and neither half makes sense alone: the note shows ink at
 * `1 / INK_DENSITY` of its natural size, so a drawing appears at the size it
 * was drawn and carries this many pixels for every one the screen has.
 *
 * Markdown cannot say how big to show an image - Text renders a size suffix
 * and an <img> tag as literal text - so an image is laid out at one image
 * pixel per CSS pixel, and on a 2x screen every pixel is therefore doubled.
 * Saving at a higher density changes nothing on its own, because the picture
 * is then shown that much larger as well. Only the two together are a fix.
 *
 * Fixed rather than the drawing device's own pixel ratio, which was the other
 * half of the fault: the same handwriting came out twice the size in the note
 * if it had been written on the iPad rather than the Mac. A drawing is now the
 * same file wherever it was made. 2 is crisp on the retina screens this is
 * for; 3 would cost 2.25x the pixels to improve only phones.
 */
export const INK_DENSITY = 2

/**
 * How far outside the samples a saved picture reaches, in CSS pixels.
 *
 * The samples are the stroke's center line and the nib puts ink either side
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
 * The longest step a drawn path may take, in CSS pixels.
 *
 * Chosen against what the Pencil actually reports: on a page of handwriting
 * the median step was 4.3 px, so an ordinary stroke is left alone and only
 * the fast ones - which reached 17 px - are filled in.
 */
export const SMOOTH_GAP = 6

/**
 * One point on the curve through four, at t between the middle two.
 *
 * A Catmull-Rom spline: it passes through the points it is given rather than
 * being pulled towards them, which is what lets a filled-in path still be the
 * path the pen took. Uniform rather than centripetal - at these spacings the
 * difference is far under a pixel, and the arithmetic is half the size.
 *
 * @param {Array<number>} p0 the point before
 * @param {Array<number>} p1 the start
 * @param {Array<number>} p2 the end
 * @param {Array<number>} p3 the point after
 * @param {number} t how far along, 0 to 1
 * @return {Array<number>} [x, y, pressure]
 */
function between(p0, p1, p2, p3, t) {
	const t2 = t * t
	const t3 = t2 * t
	const at = (a, b, c, d) => 0.5 * ((2 * b) + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
	return [
		at(p0[0], p1[0], p2[0], p3[0]),
		at(p0[1], p1[1], p2[1], p3[1]),
		p1[2] + (p2[2] - p1[2]) * t,
	]
}

/**
 * The same path, stepping a few pixels at a time.
 *
 * The pen is not reported continuously: writing fast, the iPad left up to 17
 * CSS pixels between one reading and the next, and two long segments meeting
 * is a corner. At a 2.5 px nib that corner is plainly visible, which is what
 * "a couple of rough corners" was.
 *
 * Filled from a curve through the readings, not from the straight line
 * between them - a straight fill would put more points on the same corner and
 * change nothing. The readings themselves are all kept and all passed
 * through, so this rounds the turn without moving where the pen went.
 *
 * Done when drawing, never when saving: the file holds what the pen did, and
 * how smoothly it is drawn is a decision that can be taken again later.
 *
 * The steps are cut from the straight line between two readings while what
 * is drawn is the curve through them, which is longer - so a step comes out a
 * little over the gap asked for rather than exactly under it.
 *
 * @param {Array<Array<number>>} points the stroke's samples
 * @param {number} maxGap the longest step to leave alone
 * @return {Array<Array<number>>} the path to draw
 */
export function smoothed(points, maxGap = SMOOTH_GAP) {
	if (points.length < 2) {
		return points
	}
	const out = [points[0]]
	for (let i = 1; i < points.length; i++) {
		const p1 = points[i - 1]
		const p2 = points[i]
		const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / maxGap)
		if (steps > 1) {
			/* The ends have no point beyond them to curve away from, so they
			   stand in for their own neighbor and the curve runs straight
			   into them. */
			const p0 = points[i - 2] ?? p1
			const p3 = points[i + 1] ?? p2
			for (let step = 1; step < steps; step++) {
				out.push(between(p0, p1, p2, p3, step / steps))
			}
		}
		out.push(p2)
	}
	return out
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
 * A ruled stroke is one whose points were computed rather than drawn - a line,
 * a rectangle, an ellipse. Those are traced without the smoothing a hand needs,
 * which is what keeps a corner square.
 *
 * The fill is whatever `fillStyle` the context carries, so the caller must set
 * it before calling: a stroke traced without one is drawn in the last color
 * the context held, which for the picture saved to the file is a wrong color
 * in the one artifact every other client sees.
 *
 * @param {CanvasRenderingContext2D} context where to trace
 * @param {Array<Array<number>>} points the stroke's [x, y, pressure] samples
 * @param {boolean} ruled whether the points are a construction rather than a
 *   hand's path, and so are to be drawn exactly rather than smoothed
 */
export function traceStroke(context, points, ruled = false) {
	const outline = getStroke(smoothed(points), ruled ? RULED : STROKE)
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
