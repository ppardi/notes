/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { predictedFrom, samplesFrom, shouldDraw } from '../inkInput.js'

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
		expect(shouldDraw(pointer({ pointerType: 'pen' }))).toBe(true)
	})

	it('draws for a mouse', () => {
		expect(shouldDraw(pointer({ pointerType: 'mouse' }))).toBe(true)
	})

	it('never draws for a finger', () => {
		/* A hand resting on the screen arrives as touch, and so does a finger
		   meaning to write. They cannot be told apart, and on the device this
		   is for the hand is far more often what landed. Letting a finger draw
		   is a choice to be offered, not one to be made by the app. */
		expect(shouldDraw(pointer({ pointerType: 'touch' }))).toBe(false)
	})

	it('never draws for a finger, whatever else has happened', () => {
		/* There is no state that turns this back on - no "unless a pen has
		   been seen", which is what let the first palm of a fresh page draw. */
		expect(shouldDraw(pointer({ pointerType: 'touch' }), true)).toBe(false)
		expect(shouldDraw(pointer({ pointerType: 'touch' }), false)).toBe(false)
	})

	it('draws for a pointer that will not say what it is', () => {
		/* Some browsers report nothing. Refusing those would make the canvas
		   take no input at all, which is worse than taking a stray touch. */
		expect(shouldDraw(pointer({ pointerType: '' }))).toBe(true)
		expect(shouldDraw(pointer({ pointerType: undefined }))).toBe(true)
	})
})

describe('predictedFrom', () => {
	it('takes where the browser thinks the pen is going', () => {
		/* Safari has had this since 18.2: ink can be drawn ahead of the
		   samples that have arrived, which is the one thing that shortens a
		   delay rather than merely stopping adding to it. */
		const ahead = [pointer({ offsetX: 10, offsetY: 11, pressure: 0.4 }), pointer({ offsetX: 20, offsetY: 21, pressure: 0.4 })]
		expect(predictedFrom(pointer({ getPredictedEvents: () => ahead }))).toEqual([[10, 11, 0.4], [20, 21, 0.4]])
	})

	it('gives nothing where the browser will not guess', () => {
		expect(predictedFrom(pointer({}))).toEqual([])
		expect(predictedFrom(pointer({ getPredictedEvents: () => [] }))).toEqual([])
	})

	it('gives a prediction with no pressure the same flat value as a sample', () => {
		const event = pointer({ getPredictedEvents: () => [pointer({ offsetX: 1, offsetY: 2, pressure: 0 })] })
		expect(predictedFrom(event)).toEqual([[1, 2, 0.5]])
	})
})
