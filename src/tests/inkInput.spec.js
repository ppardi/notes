/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { samplesFrom, shouldDraw } from '../inkInput.js'

/**
 * @param {object} fields what the event carries
 * @return {object} something shaped like a PointerEvent
 */
function pointer(fields) {
	return {
		pointerType: 'pen',
		offsetX: 0,
		offsetY: 0,
		pressure: 0.5,
		getCoalescedEvents: undefined,
		...fields,
	}
}

describe('samplesFrom', () => {
	it('takes every sample the digitizer gave, not one per frame', () => {
		/* Without this a fast stroke is drawn as a few straight segments. */
		const coalesced = [
			pointer({ offsetX: 1, offsetY: 1, pressure: 0.1 }),
			pointer({ offsetX: 2, offsetY: 2, pressure: 0.2 }),
		]
		const event = pointer({ offsetX: 3, offsetY: 3, getCoalescedEvents: () => coalesced })
		expect(samplesFrom(event)).toEqual([[1, 1, 0.1], [2, 2, 0.2]])
	})

	it('falls back to the event itself where coalescing is missing', () => {
		expect(samplesFrom(pointer({ offsetX: 7, offsetY: 8, pressure: 0.3 }))).toEqual([[7, 8, 0.3]])
	})

	it('falls back when getCoalescedEvents returns an empty list', () => {
		/* An empty list should not erase the event's own position. */
		expect(samplesFrom(pointer({ offsetX: 7, offsetY: 8, pressure: 0.3, getCoalescedEvents: () => [] }))).toEqual([[7, 8, 0.3]])
	})

	it('gives a mouse a usable pressure', () => {
		/* A mouse reports 0.5 while down and 0 otherwise; a pen that reports 0
		   on contact would otherwise draw nothing at all. */
		expect(samplesFrom(pointer({ pointerType: 'mouse', pressure: 0 }))[0][2]).toBe(0.5)
	})

	it('substitutes flat pressure per sample in a coalesced run', () => {
		/* A coalesced run can have mixed pressure values; each zero must become FLAT_PRESSURE. */
		const coalesced = [
			pointer({ offsetX: 1, offsetY: 1, pressure: 0 }),
			pointer({ offsetX: 2, offsetY: 2, pressure: 0.4 }),
		]
		const event = pointer({ offsetX: 3, offsetY: 3, getCoalescedEvents: () => coalesced })
		expect(samplesFrom(event)).toEqual([[1, 1, 0.5], [2, 2, 0.4]])
	})
})

describe('shouldDraw', () => {
	it('draws for a pen', () => {
		expect(shouldDraw(pointer({ pointerType: 'pen' }), false)).toBe(true)
	})

	it('draws for a pen even after a pen has been seen', () => {
		/* A pen must draw after the first stroke, or the feature is unusable. */
		expect(shouldDraw(pointer({ pointerType: 'pen' }), true)).toBe(true)
	})

	it('draws for a finger when no pen has been seen', () => {
		/* The feature is for a Pencil but must not be unusable without one. */
		expect(shouldDraw(pointer({ pointerType: 'touch' }), false)).toBe(true)
	})

	it('ignores a finger once a pen has been seen', () => {
		/* This is palm rejection: the hand resting on the screen is touch. */
		expect(shouldDraw(pointer({ pointerType: 'touch' }), true)).toBe(false)
	})

	it('still draws for a mouse after a pen has been seen', () => {
		expect(shouldDraw(pointer({ pointerType: 'mouse' }), true)).toBe(true)
	})
})
