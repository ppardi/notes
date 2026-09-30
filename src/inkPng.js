/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Strokes travel inside the picture they drew.
 *
 * A sidecar file would show up in the note's attachment list as something the
 * reader cannot interpret, and any copy or move would separate the picture
 * from the strokes that make it editable. One file cannot be orphaned.
 */

const SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const KEYWORD = 'notes-ink'

/* Spreading an array into String.fromCharCode passes one argument per byte,
   and a page of handwriting is well past the argument limit - 200 strokes of
   50 points is 159,500 bytes, which throws RangeError. Walk it instead. */
const STRIDE = 0x8000

/**
 * @param {Uint8Array} bytes the bytes
 * @return {string} one character per byte
 */
function toBinary(bytes) {
	let out = ''
	for (let i = 0; i < bytes.length; i += STRIDE) {
		out += String.fromCharCode.apply(null, bytes.subarray(i, i + STRIDE))
	}
	return out
}

/**
 * @param {string} text one character per byte
 * @return {Uint8Array} the bytes
 */
function fromBinary(text) {
	const bytes = new Uint8Array(text.length)
	for (let i = 0; i < text.length; i++) {
		bytes[i] = text.charCodeAt(i) & 0xFF
	}
	return bytes
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
		}
		table[n] = c >>> 0
	}
	return table
})()

/**
 * @param {Uint8Array} bytes the bytes to sum
 * @return {number} their CRC-32
 */
function crc32(bytes) {
	let c = 0xFFFFFFFF
	for (let i = 0; i < bytes.length; i++) {
		c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
	}
	return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * @param {Uint8Array} png the bytes to check
 * @return {boolean} whether they start with the PNG signature
 */
function isPng(png) {
	return png.length > 8 && SIGNATURE.every((b, i) => png[i] === b)
}

/**
 * Walk the chunks, yielding each one's bounds.
 *
 * @param {Uint8Array} png the PNG
 * @yields {{type: string, start: number, end: number, dataStart: number, dataEnd: number}} each chunk
 */
function* chunks(png) {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
	let at = 8
	while (at + 8 <= png.length) {
		const length = view.getUint32(at)
		const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7])
		const end = at + 12 + length
		if (end > png.length) {
			return
		}
		yield { type, start: at, end, dataStart: at + 8, dataEnd: at + 8 + length }
		at = end
	}
}

/**
 * @param {string} text the chunk's text
 * @return {Uint8Array} a complete tEXt chunk
 */
function textChunk(text) {
	const payload = `${KEYWORD}\0${text}`
	const body = new Uint8Array(4 + payload.length)
	body.set([0x74, 0x45, 0x58, 0x74])
	for (let i = 0; i < payload.length; i++) {
		body[4 + i] = payload.charCodeAt(i) & 0xFF
	}
	const chunk = new Uint8Array(body.length + 8)
	new DataView(chunk.buffer).setUint32(0, payload.length)
	chunk.set(body, 4)
	new DataView(chunk.buffer).setUint32(chunk.length - 4, crc32(body))
	return chunk
}

/**
 * Put the strokes into the PNG, replacing any already there.
 *
 * @param {Uint8Array} png the rendered picture
 * @param {object} strokes what drew it
 * @return {Uint8Array} the PNG carrying its strokes
 */
export function embedStrokes(png, strokes) {
	if (!isPng(png)) {
		throw new Error('not a PNG')
	}
	const keep = []
	let iend = null
	for (const chunk of chunks(png)) {
		if (chunk.type === 'IEND') {
			iend = chunk
			break
		}
		const isOurs = chunk.type === 'tEXt'
			&& toBinary(png.subarray(chunk.dataStart, chunk.dataStart + KEYWORD.length)) === KEYWORD
		if (!isOurs) {
			keep.push(png.slice(chunk.start, chunk.end))
		}
	}
	if (iend === null) {
		throw new Error('PNG has no IEND')
	}
	const ours = textChunk(btoa(toBinary(new TextEncoder().encode(JSON.stringify(strokes)))))
	const tail = png.slice(iend.start)
	const size = 8 + keep.reduce((n, c) => n + c.length, 0) + ours.length + tail.length
	const out = new Uint8Array(size)
	out.set(png.slice(0, 8))
	let cursor = 8
	for (const chunk of keep) {
		out.set(chunk, cursor)
		cursor += chunk.length
	}
	out.set(ours, cursor)
	cursor += ours.length
	out.set(tail, cursor)
	return out
}

/**
 * The strokes a PNG is carrying.
 *
 * @param {Uint8Array} png the picture
 * @return {object | null} the strokes, or null when it carries none
 */
export function readStrokes(png) {
	if (!isPng(png)) {
		return null
	}
	for (const chunk of chunks(png)) {
		if (chunk.type !== 'tEXt') {
			continue
		}
		const payload = png.subarray(chunk.dataStart, chunk.dataEnd)
		const nul = payload.indexOf(0)
		if (nul < 0 || toBinary(payload.subarray(0, nul)) !== KEYWORD) {
			continue
		}
		try {
			const base64 = toBinary(payload.subarray(nul + 1))
			return JSON.parse(new TextDecoder().decode(fromBinary(atob(base64))))
		} catch {
			/* Readable as a chunk, unreadable as strokes. Treat it as an image
			   with no strokes rather than refusing to open it. */
			return null
		}
	}
	return null
}
