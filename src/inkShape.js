/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

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

/* What the points are sampled at, which is `SHAPE_STEP` less what rounding
   may add back. Each coordinate moves by at most 0.05 when it is kept to a
   tenth, so two neighbors can end up 0.05 * sqrt(2) * 2, about 0.14, further
   apart than they were computed; 0.15 covers it, which keeps `SHAPE_STEP` a
   ceiling on the points as stored and not only as computed. */
const SAMPLE_STEP = SHAPE_STEP - 0.15

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
	const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / SAMPLE_STEP))
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
 * A loop's points, brought back to the point they started from.
 *
 * The last sample repeats the first, which is what tells the renderer the path
 * is a loop and is to be closed rather than ended.
 *
 * @param {Array<Array<number>>} loop the distinct points, start first
 * @return {Array<Array<number>>} the loop, closed
 */
function closed(loop) {
	return [...loop, [loop[0][0], loop[0][1], FLAT_PRESSURE]]
}

/* Coordinates are kept to a tenth of a pixel.
 *
 * Freehand points come from offsetX and offsetY and serialize short; a shape's
 * are computed, and left alone they run to sixteen digits each. A tenth of a
 * pixel is invisible against a nib this wide and costs the file a third of
 * what the full digits do. */
function tenth(value) {
	return Math.round(value * 10) / 10
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
	return outline(tool, from, to).map(([x, y, pressure]) => [tenth(x), tenth(y), pressure])
}

/**
 * A shape's points at full precision, before they are kept.
 *
 * @param {string} tool which shape, or the pen
 * @param {Array<number>} from where the drag started, [x, y]
 * @param {Array<number>} to where it ended, [x, y]
 * @return {Array<Array<number>>} the stroke's points, or none at all
 */
function outline(tool, from, to) {
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
		/* Started from the middle of the top edge rather than a corner. The
		   join carries a round cap either way; on a straight run the cap is
		   flush with the band it ends, where on a corner it fills the corner
		   in and reads as a blot beside three identical clean ones. */
		const middle = [(left + right) / 2, top]
		const way = [middle, [right, top], [right, bottom], [left, bottom], [left, top], middle]
		const out = []
		for (let i = 0; i < way.length - 1; i++) {
			out.push(...along(way[i], way[i + 1]))
		}
		return closed(out)
	}
	const a = (right - left) / 2
	const b = (bottom - top) / 2
	const steps = Math.max(8, Math.ceil((2 * Math.PI * Math.max(a, b)) / SAMPLE_STEP))
	const out = []
	for (let step = 0; step < steps; step++) {
		const angle = (step / steps) * 2 * Math.PI
		out.push([left + a + a * Math.cos(angle), top + b + b * Math.sin(angle), FLAT_PRESSURE])
	}
	return closed(out)
}
