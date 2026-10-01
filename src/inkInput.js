/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** What a device that reports no pressure draws at. */
const FLAT_PRESSURE = 0.5

/**
 * Every position this event carries.
 *
 * Safari reports one pointermove per frame but the digitizer samples faster;
 * the samples in between are what make a fast stroke a curve rather than a few
 * straight segments. Safari has had getCoalescedEvents since 18.2.
 *
 * @param {PointerEvent} event the move
 * @return {Array<Array<number>>} [x, y, pressure] for each sample
 */
export function samplesFrom(event) {
	const coalesced = event.getCoalescedEvents?.()
	const events = coalesced?.length ? coalesced : [event]
	return events.map(toSample)
}

/**
 * @param {PointerEvent} e one position report
 * @return {Array<number>} [x, y, pressure]
 */
function toSample(e) {
	return [e.offsetX, e.offsetY, e.pressure > 0 ? e.pressure : FLAT_PRESSURE]
}

/**
 * Where the browser thinks the pen is going.
 *
 * Drawn but never kept. Between the nib and the last sample that has actually
 * arrived there is always a gap, and this is the browser's own guess at what
 * fills it - the one thing that can shorten a delay rather than merely stop
 * adding to it. Safari has had it since 18.2.
 *
 * @param {PointerEvent} event the move
 * @return {Array<Array<number>>} samples ahead of the pen, or none
 */
export function predictedFrom(event) {
	const ahead = event.getPredictedEvents?.()
	return ahead?.length ? ahead.map(toSample) : []
}

/**
 * Whether this event draws.
 *
 * A finger never does. A hand resting on the screen arrives as touch and so
 * does a finger meaning to write; nothing in the event tells them apart, and
 * on the device this is built for the hand is far more often what landed.
 * Deciding by whether a pen has been seen lately was worse than it sounds: on
 * a page nobody has written on yet no pen has been seen, so the first thing a
 * resting palm did was draw.
 *
 * Drawing with a finger is a choice worth offering one day. It is not one for
 * the app to make on its own.
 *
 * @param {PointerEvent} event the event
 * @return {boolean} whether to draw
 */
export function shouldDraw(event) {
	return event.pointerType !== 'touch'
}
