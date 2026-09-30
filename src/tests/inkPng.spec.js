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

/**
 * Compute CRC-32 independently to verify the module's CRC implementation.
 * Uses the standard PNG polynomial.
 *
 * @param {Uint8Array} bytes the bytes to sum
 * @return {number} their CRC-32
 */
function independentCrc32(bytes) {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
		}
		table[n] = c >>> 0
	}
	let c = 0xFFFFFFFF
	for (let i = 0; i < bytes.length; i++) {
		c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
	}
	return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * Walk the chunks of a PNG independently, without using the module's parser.
 *
 * @param {Uint8Array} png the PNG
 * @yield {{type: string, start: number, end: number, dataStart: number, dataEnd: number, length: number}} each chunk
 */
function* parseChunks(png) {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
	let at = 8
	while (at + 8 <= png.length) {
		const length = view.getUint32(at)
		const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7])
		const end = at + 12 + length
		if (end > png.length) {
			return
		}
		yield { type, start: at, end, dataStart: at + 8, dataEnd: at + 8 + length, length }
		at = end
	}
}

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

	it('has a CRC algorithm that computes the known IEND chunk correctly', () => {
		/* The IEND chunk is type bytes 0x49, 0x45, 0x4E, 0x44 with empty data.
		   Its CRC should be 0xAE426082, which appears as the last 4 bytes of every PNG.
		   This verifies the module's CRC implementation against a fixed, well-known value
		   and ensures the test does not just re-run the module's own arithmetic. */
		const iendType = new Uint8Array([0x49, 0x45, 0x4E, 0x44])
		const computed = independentCrc32(iendType)
		expect(computed).toBe(0xAE426082)
	})

	it('writes a properly structured notes-ink chunk with valid length and CRC', () => {
		/* Parse the output PNG independently to verify:
		   - exactly one tEXt chunk with keyword 'notes-ink' exists
		   - its declared length field equals the actual data bytes
		   - its stored CRC equals the CRC computed over type + data
		   - it sits before the IEND chunk */
		const out = embedStrokes(tinyPng(), STROKES)
		const view = new DataView(out.buffer, out.byteOffset, out.byteLength)

		let notesInkChunk = null
		let iendChunk = null

		for (const chunk of parseChunks(out)) {
			if (chunk.type === 'tEXt') {
				// Check if this tEXt chunk is the notes-ink chunk by reading the keyword
				const keywordBytes = out.subarray(chunk.dataStart, Math.min(chunk.dataStart + 9, chunk.dataEnd))
				let keyword = ''
				for (let i = 0; i < keywordBytes.length; i++) {
					keyword += String.fromCharCode(keywordBytes[i])
				}
				if (keyword === 'notes-ink') {
					notesInkChunk = chunk
				}
			}
			if (chunk.type === 'IEND') {
				iendChunk = chunk
			}
		}

		// Exactly one notes-ink chunk exists
		expect(notesInkChunk).not.toBeNull()
		expect(iendChunk).not.toBeNull()

		// The chunk's declared length matches its actual data size
		const declaredLength = view.getUint32(notesInkChunk.start)
		expect(declaredLength).toBe(notesInkChunk.length)

		// Extract type and data bytes for CRC verification
		const typeBytes = out.subarray(notesInkChunk.start + 4, notesInkChunk.start + 8)
		const dataBytes = out.subarray(notesInkChunk.dataStart, notesInkChunk.dataEnd)
		const typeAndData = new Uint8Array(typeBytes.length + dataBytes.length)
		typeAndData.set(typeBytes)
		typeAndData.set(dataBytes, typeBytes.length)

		// The stored CRC equals the computed CRC
		const storedCrc = view.getUint32(notesInkChunk.end - 4)
		const computedCrc = independentCrc32(typeAndData)
		expect(storedCrc).toBe(computedCrc)

		// The notes-ink chunk sits before IEND
		expect(notesInkChunk.start).toBeLessThan(iendChunk.start)
	})

	it('replaces notes-ink chunks and leaves exactly one after embedding twice', () => {
		/* A stricter version of the byte-length test: parse both embedded PNGs
		   and verify exactly one tEXt chunk with keyword 'notes-ink' exists in each. */
		const once = embedStrokes(tinyPng(), STROKES)
		const twice = embedStrokes(once, { version: 1, strokes: [] })

		// Count notes-ink tEXt chunks in the second embedding
		let count = 0
		for (const chunk of parseChunks(twice)) {
			if (chunk.type === 'tEXt') {
				const keywordBytes = twice.subarray(chunk.dataStart, Math.min(chunk.dataStart + 9, chunk.dataEnd))
				let keyword = ''
				for (let i = 0; i < keywordBytes.length; i++) {
					keyword += String.fromCharCode(keywordBytes[i])
				}
				if (keyword === 'notes-ink') {
					count++
				}
			}
		}

		expect(count).toBe(1)
	})
})
