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
/** The nib's width in CSS pixels, exported so a caller can tell how far a
 *  stroke's ink spreads beyond the points it was drawn from. */
export const STROKE_SIZE = 6

const STROKE = { size: STROKE_SIZE, thinning: 0, simulatePressure: false }

/* Below this, perfect-freehand has not returned a shape worth curving. */
const CURVABLE = 4

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
