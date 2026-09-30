/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { embedStrokes, readStrokes } from '../inkPng.js'

/**
 * A byte sequence shaped like a PNG: signature, IHDR, IDAT, IEND.
 *
 * The chunk CRCs are not real, which does not matter here because nothing in
 * inkPng.js verifies them - it only walks and splices chunks. That the bytes
 * we write are loadable by a browser is proven by the end-to-end tests, which
 * render a real canvas and read the saved picture back.
 *
 * @return {Uint8Array} the bytes
 */
function tinyPng() {
	return new Uint8Array([
		0x89,
		0x50,
		0x4E,
		0x47,
		0x0D,
		0x0A,
		0x1A,
		0x0A,
		0x00,
		0x00,
		0x00,
		0x0D,
		0x49,
		0x48,
		0x44,
		0x52,
		0x00,
		0x00,
		0x00,
		0x01,
		0x00,
		0x00,
		0x00,
		0x01,
		0x08,
		0x06,
		0x00,
		0x00,
		0x00,
		0x1F,
		0x15,
		0xC4,
		0x89,
		0x00,
		0x00,
		0x00,
		0x0A,
		0x49,
		0x44,
		0x41,
		0x54,
		0x78,
		0x9C,
		0x63,
		0x00,
		0x01,
		0x00,
		0x00,
		0x05,
		0x00,
		0x01,
		0x0D,
		0x0A,
		0x2D,
		0xB4,
		0x00,
		0x00,
		0x00,
		0x00,
		0x49,
		0x45,
		0x4E,
		0x44,
		0xAE,
		0x42,
		0x60,
		0x82,
	])
}

const STROKES = { version: 1, strokes: [{ points: [[1, 2, 0.5], [3, 4, 0.6]] }] }

describe('strokes in a PNG', () => {
	it('comes back exactly as it went in', () => {
		expect(readStrokes(embedStrokes(tinyPng(), STROKES))).toEqual(STROKES)
	})

	it('leaves the PNG a PNG', () => {
		/* The signature and the IEND chunk have to survive, or the browser will
		   not draw what we saved. */
		const out = embedStrokes(tinyPng(), STROKES)
		expect([...out.slice(0, 8)]).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
		expect([...out.slice(-8)]).toEqual([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82])
	})

	it('says nothing rather than throwing when there are no strokes', () => {
		/* An image from somewhere else, or one whose metadata something has
		   stripped. The canvas opens empty over it; it must not fail to open. */
		expect(readStrokes(tinyPng())).toBeNull()
	})

	it('survives a long writing session', () => {
		/* Thousands of points is an ordinary page of handwriting. A chunk length
		   written into the wrong number of bytes truncates silently. */
		const long = {
			version: 1,
			strokes: Array.from({ length: 200 }, () => ({
				points: Array.from({ length: 50 }, (_, i) => [i, i * 2, 0.5]),
			})),
		}
		expect(readStrokes(embedStrokes(tinyPng(), long))).toEqual(long)
	})

	it('replaces the strokes rather than adding a second copy', () => {
		const once = embedStrokes(tinyPng(), STROKES)
		const twice = embedStrokes(once, { version: 1, strokes: [] })
		expect(readStrokes(twice)).toEqual({ version: 1, strokes: [] })
		expect(twice.length).toBeLessThan(once.length + 40)
	})

	it('returns null for bytes that are not a PNG', () => {
		expect(readStrokes(new Uint8Array([1, 2, 3]))).toBeNull()
	})
})
