/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** What a device that reports no pressure draws at. */
const FLAT_PRESSURE = 0.5

/* The batch this event gathered, or nothing when it carries only itself. */
function batchOf(event) {
	const coalesced = event.getCoalescedEvents?.()
	return coalesced?.length ? coalesced : null
}

/* Whether a sample is one we have not taken yet. A sample with no time at all
   is taken: a device that does not stamp its readings is no reason to draw
   nothing. */
function after(report, taken) {
	return typeof report.timeStamp !== 'number' || report.timeStamp > taken
}

/**
 * Every position this event carries that has not been taken already.
 *
 * Safari reports one pointermove per frame but the digitizer samples faster;
 * the samples in between are what make a fast stroke a curve rather than a few
 * straight segments. Safari has had getCoalescedEvents since 18.2.
 *
 * What it gathers, though, is the samples since the last animation *frame*,
 * not since the last move. On a quiet page the two are the same and the
 * batches never overlap. On a busy one Safari dispatches more than one move in
 * a frame and hands each of them the same batch - so taking every batch whole
 * put the stroke through the same run of samples twice, and the pen appeared
 * to run forward, jump back and retrace itself. Measured in a drawing made on
 * a loaded server, 49% of one stroke's samples were repeats and the path
 * jumped backwards as far as 28.9 px; the same iPad on an empty page gave
 * 0.6% and no repeats at all.
 *
 * The sample's own time is what tells them apart. Positions repeat - a pen
 * held still reports the same place for as long as it is there - but the time
 * a reading was taken does not.
 *
 * @param {PointerEvent} event the move
 * @param {number} taken the time of the last sample already taken, so the
 *   samples a previous move already reported are left out
 * @return {Array<Array<number>>} [x, y, pressure] for each sample
 */
export function samplesFrom(event, taken = -Infinity) {
	const batch = batchOf(event)
	/* An event carrying no batch is one position. A repeat of it is a repeat
	   of a place, which `withoutRepeats` already drops - and the event's own
	   stamp is no use for telling batches apart, because Safari rounds it for
	   privacy and two moves inside the same millisecond share one. */
	return batch
		? batch.filter((report) => after(report, taken)).map(toSample)
		: [toSample(event)]
}

/**
 * The time of the last position this event carries.
 *
 * Kept by the caller and handed back to `samplesFrom` on the next move, which
 * is what makes a repeated batch cost nothing.
 *
 * @param {PointerEvent} event the move
 * @param {number} taken what to keep if this event stamps nothing
 * @return {number} the newest time reported, or `taken`
 */
export function lastSampleTime(event, taken = -Infinity) {
	let latest = taken
	for (const report of batchOf(event) ?? []) {
		if (typeof report.timeStamp === 'number' && report.timeStamp > latest) {
			latest = report.timeStamp
		}
	}
	return latest
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
 * The samples that actually went somewhere.
 *
 * The Pencil's position arrives twice. Measured on the device, in a page of
 * handwriting: of 1038 gaps between consecutive samples, 513 were exactly
 * zero. A sample in the same place as the one before it says nothing that
 * one did not - pressure does not change the nib - and the pair is a flat
 * step, so the stroke the smoothing follows is a staircase. That is what put
 * visible facets in curves, and it showed up when the nib was thinned from 6
 * CSS pixels to 2.5: a wide nib covers a one-pixel stair, a fine one draws it.
 *
 * Dropped rather than averaged, because there is nothing to average: the two
 * are the same reading. It also halves what a page of handwriting stores.
 *
 * @param {Array<Array<number>>} samples what the event carried
 * @param {Array<number> | null} previous where the stroke already was, so a
 *   repeat across two reports goes too
 * @return {Array<Array<number>>} the samples that moved
 */
export function withoutRepeats(samples, previous) {
	const kept = []
	let last = previous
	for (const sample of samples) {
		if (last && sample[0] === last[0] && sample[1] === last[1]) {
			continue
		}
		kept.push(sample)
		last = sample
	}
	return kept
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
