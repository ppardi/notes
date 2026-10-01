/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { STROKE_SIZE } from './inkRender.js'

/**
 * The eraser's width in CSS pixels.
 *
 * Far wider than the nib. What is being aimed at is a mark a couple of pixels
 * across, with a pen held in a hand, and an eraser the size of the thing it
 * rubs out would have to be aimed perfectly to do anything at all.
 */
export const ERASER_SIZE = 12

/**
 * How close the eraser's center has to come to a stroke's center line.
 *
 * Both halves: the eraser's own radius, and the ink the nib puts either side
 * of the samples. The reader aims at the mark they can see, so the edge of a
 * mark counts as the mark.
 */
export const ERASER_REACH = ERASER_SIZE / 2 + STROKE_SIZE / 2

/**
 * The eraser's outline.
 *
 * Interface rather than ink: it marks where the eraser is, so it follows the
 * same themed filter the canvas does and has no business tracking whatever
 * color the pen happens to be set to.
 */
export const ERASER_COLOR = '#000000'

/**
 * How far a point is from a line between two others, squared.
 *
 * Squared throughout: the comparison is against a fixed distance, and a
 * square root per segment per sample is work for nothing.
 *
 * @param {number} x the point
 * @param {number} y the point
 * @param {number} ax one end
 * @param {number} ay one end
 * @param {number} bx the other end
 * @param {number} by the other end
 * @return {number} the squared distance
 */
function toSegment(x, y, ax, ay, bx, by) {
	const dx = bx - ax
	const dy = by - ay
	const span = dx * dx + dy * dy
	/* Both ends in the same place: a dot, and the distance is to it. */
	let along = span === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / span
	along = Math.max(0, Math.min(1, along))
	const nx = x - (ax + along * dx)
	const ny = y - (ay + along * dy)
	return nx * nx + ny * ny
}

/**
 * Which side of a line a point falls on.
 *
 * @param {number} ax the line
 * @param {number} ay the line
 * @param {number} bx the line
 * @param {number} by the line
 * @param {number} x the point
 * @param {number} y the point
 * @return {number} positive one side, negative the other, zero on it
 */
function side(ax, ay, bx, by, x, y) {
	return (bx - ax) * (y - ay) - (by - ay) * (x - ax)
}

/**
 * How far one segment is from another, squared.
 *
 * Two segments that cross are zero apart, and no measurement from an end
 * point will say so: think of an X, where every end is a long way from the
 * other stroke and yet they meet in the middle. That is not a corner case
 * here - it is what rubbing out a line looks like - so crossing is tested
 * first, and only segments that do not cross are measured end to end.
 *
 * @param {number} ax one segment
 * @param {number} ay one segment
 * @param {number} bx one segment
 * @param {number} by one segment
 * @param {number} cx the other
 * @param {number} cy the other
 * @param {number} dx the other
 * @param {number} dy the other
 * @return {number} the squared distance
 */
function betweenSegments(ax, ay, bx, by, cx, cy, dx, dy) {
	const a = side(cx, cy, dx, dy, ax, ay)
	const b = side(cx, cy, dx, dy, bx, by)
	const c = side(ax, ay, bx, by, cx, cy)
	const d = side(ax, ay, bx, by, dx, dy)
	if ((a > 0) !== (b > 0) && (c > 0) !== (d > 0)) {
		return 0
	}
	return Math.min(
		toSegment(ax, ay, cx, cy, dx, dy),
		toSegment(bx, by, cx, cy, dx, dy),
		toSegment(cx, cy, ax, ay, bx, by),
		toSegment(dx, dy, ax, ay, bx, by),
	)
}

/**
 * The box a path's eraser can reach, so a stroke nowhere near it costs little.
 *
 * @param {Array<Array<number>>} path the points
 * @param {number} reach how far outside them to go
 * @return {Array<number>} [left, top, right, bottom]
 */
function reachOf(path, reach) {
	let left = Infinity
	let top = Infinity
	let right = -Infinity
	let bottom = -Infinity
	for (const [x, y] of path) {
		left = Math.min(left, x)
		top = Math.min(top, y)
		right = Math.max(right, x)
		bottom = Math.max(bottom, y)
	}
	return [left - reach, top - reach, right + reach, bottom + reach]
}

/**
 * Whether an eraser dragged along this path is on this stroke.
 *
 * Segment against segment, both ways round: a stroke can be two samples a
 * long way apart, and so can the eraser's path.
 *
 * @param {{points: Array<Array<number>>}} stroke the stroke
 * @param {Array<Array<number>>} path where the eraser has been
 * @param {number} near how close counts as touching, squared
 * @param {Array<number>} within the box the eraser can reach
 * @return {boolean} whether it is on it
 */
function onStroke(stroke, path, near, within) {
	const points = stroke.points
	for (let i = 0; i < points.length; i++) {
		/* The first turn of the loop is the first sample against itself, which
		   is how a stroke of one point - a dot - is measured at all. */
		const [ax, ay] = points[Math.max(0, i - 1)]
		const [bx, by] = points[i]
		/* Nearly every segment of a written page is nowhere near the eraser,
		   and this is what keeps the cost of the ones that are not down. */
		if (Math.max(ax, bx) < within[0] || Math.min(ax, bx) > within[2]
			|| Math.max(ay, by) < within[1] || Math.min(ay, by) > within[3]) {
			continue
		}
		for (let j = 0; j < path.length; j++) {
			const [cx, cy] = path[Math.max(0, j - 1)]
			const [dx, dy] = path[j]
			if (betweenSegments(ax, ay, bx, by, cx, cy, dx, dy) <= near) {
				return true
			}
		}
	}
	return false
}

/**
 * The strokes an eraser dragged along this path rubs out.
 *
 * Whole strokes, which is what makes an eraser something that can be undone
 * and saved: a stroke stays the only unit there is, so the picture and the
 * strokes that drew it can never come to disagree. The cost is that a long
 * mark goes all at once - crossing an underline takes the whole line.
 *
 * The path, not the points on it. The pen is reported tens of pixels at a
 * time, and a thin line crossed between two reports is a line the reader
 * watched the eraser go through and not take - so they went over it again,
 * and again. Measuring the samples alone measures where the eraser was seen,
 * not where it went.
 *
 * @param {Array<{points: Array<Array<number>>}>} strokes the page
 * @param {Array<Array<number>>} path where the eraser has been this time
 * @param {number} reach how close counts as touching
 * @return {Array<number>} their places on the page, highest first, so that
 *   taking one out does not move the next one
 */
export function erasedBy(strokes, path, reach = ERASER_REACH) {
	if (!path.length) {
		return []
	}
	const near = reach * reach
	const within = reachOf(path, reach)
	const hit = []
	for (let at = strokes.length - 1; at >= 0; at--) {
		if (onStroke(strokes[at], path, near, within)) {
			hit.push(at)
		}
	}
	return hit
}

/**
 * Draw the eraser where it is, so it can be aimed.
 *
 * An outline rather than a disc: what matters is seeing which marks are inside
 * it, and a filled circle hides exactly that. In the ink's own color, because
 * the sheet it is drawn on is the one the theme is applied to.
 *
 * @param {CanvasRenderingContext2D} context where to draw
 * @param {number} x where the eraser is
 * @param {number} y where the eraser is
 */
export function traceEraser(context, x, y) {
	context.beginPath()
	context.arc(x, y, ERASER_SIZE / 2, 0, Math.PI * 2)
	context.lineWidth = 1
	context.strokeStyle = ERASER_COLOR
	context.stroke()
}
