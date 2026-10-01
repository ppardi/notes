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
 * How close the eraser's centre has to come to a stroke's centre line.
 *
 * Both halves: the eraser's own radius, and the ink the nib puts either side
 * of the samples. The reader aims at the mark they can see, so the edge of a
 * mark counts as the mark.
 */
export const ERASER_REACH = ERASER_SIZE / 2 + STROKE_SIZE / 2

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
 * Whether an eraser at this point is on this stroke.
 *
 * Measured to the segments between the samples, not to the samples alone: a
 * straight line can be two samples a long way apart, and an eraser dragged
 * through the middle of it would otherwise pass through the mark without
 * touching anything.
 *
 * @param {{points: Array<Array<number>>}} stroke the stroke
 * @param {number} x where the eraser is
 * @param {number} y where the eraser is
 * @param {number} reach how close counts as touching
 * @return {boolean} whether it is on it
 */
function onStroke(stroke, x, y, reach) {
	const points = stroke.points
	const near = reach * reach
	if (points.length === 1) {
		const [ax, ay] = points[0]
		return toSegment(x, y, ax, ay, ax, ay) <= near
	}
	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1]
		const [bx, by] = points[i]
		if (toSegment(x, y, ax, ay, bx, by) <= near) {
			return true
		}
	}
	return false
}

/**
 * The strokes an eraser passing through these points rubs out.
 *
 * Whole strokes, which is what makes an eraser something that can be undone
 * and saved: a stroke stays the only unit there is, so the picture and the
 * strokes that drew it can never come to disagree. The cost is that a long
 * mark goes all at once - crossing an underline takes the whole line.
 *
 * @param {Array<{points: Array<Array<number>>}>} strokes the page
 * @param {Array<Array<number>>} points where the eraser has been this time
 * @param {number} reach how close counts as touching
 * @return {Array<number>} their places on the page, highest first, so that
 *   taking one out does not move the next one
 */
export function erasedBy(strokes, points, reach = ERASER_REACH) {
	const hit = []
	for (let at = strokes.length - 1; at >= 0; at--) {
		if (points.some(([x, y]) => onStroke(strokes[at], x, y, reach))) {
			hit.push(at)
		}
	}
	return hit
}
