/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** How long a pen is remembered, so a palm landing after it is still ignored. */
export const PEN_SEEN_MS = 1000

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
	return events.map((e) => [
		e.offsetX,
		e.offsetY,
		e.pressure > 0 ? e.pressure : FLAT_PRESSURE,
	])
}

/**
 * Whether this event draws.
 *
 * @param {PointerEvent} event the event
 * @param {boolean} penSeen whether a pen has been in use recently
 * @return {boolean} whether to draw
 */
export function shouldDraw(event, penSeen) {
	if (event.pointerType === 'touch') {
		/* Palm rejection. A hand resting on the screen arrives as touch, and
		   once a pen is in play touch is never the thing being drawn with. */
		return !penSeen
	}
	return true
}
