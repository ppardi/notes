/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
const get = vi.fn()
vi.mock('@nextcloud/axios', () => ({ default: { post: (...a) => post(...a), get: (...a) => get(...a) } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (p) => `/index.php${p}` }))

const { loadInk, saveInk } = await import('../inkFile.js')

/**
 * A PNG-shaped blob: signature, IHDR, IDAT, IEND. The CRCs are not real,
 * because inkPng.js only walks and splices chunks and never checks them.
 *
 * @return {Blob} the picture
 */
function tinyPng() {
	const chunk = (type, data) => [0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0]
	return new Blob([new Uint8Array([
		...[...'\x89PNG\r\n\x1a\n'].map((c) => c.charCodeAt(0)),
		...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
		...chunk('IDAT', [1, 2, 3]),
		...chunk('IEND', []),
	])], { type: 'image/png' })
}

describe('saveInk', () => {
	beforeEach(() => {
		post.mockReset()
		get.mockReset()
	})

	it('asks to replace, so the note keeps pointing at the same file', () => {
		/* Without replace the server picks a free name and the note's markdown
		   has to be rewritten on every edit. */
		post.mockResolvedValue({ data: { filename: '.attachments.5/ink-abc.png' } })
		return saveInk(5, 'abc', tinyPng(), [])
			.then(() => {
				expect(post.mock.calls[0][0]).toContain('replace=1')
			})
	})

	it('hands back the path the note should hold', async () => {
		post.mockResolvedValue({ data: { filename: '.attachments.5/ink-abc.png' } })
		await expect(saveInk(5, 'abc', tinyPng(), []))
			.resolves.toBe('.attachments.5/ink-abc.png')
	})

	it('rejects rather than resolving when the upload fails', async () => {
		/* The canvas keeps the strokes and stays open. Resolving here would
		   close it over a page of handwriting that never reached the server. */
		post.mockRejectedValue(new Error('network'))
		await expect(saveInk(5, 'abc', tinyPng(), []))
			.rejects.toThrow()
	})
})

describe('loadInk', () => {
	beforeEach(() => {
		post.mockReset()
		get.mockReset()
	})

	it('says nothing is there when the file is gone', async () => {
		get.mockRejectedValue({ response: { status: 404 } })
		await expect(loadInk(5, 'abc')).resolves.toBeNull()
	})

	it('rethrows anything that is not a 404', async () => {
		/* A server error is not "the picture is gone". Answering null would
		   offer to delete a link to a picture that is merely unreachable. */
		get.mockRejectedValue({ response: { status: 500 } })
		await expect(loadInk(5, 'abc')).rejects.toEqual({ response: { status: 500 } })
		get.mockRejectedValue(new Error('network'))
		await expect(loadInk(5, 'abc')).rejects.toThrow('network')
	})

	it('asks for the file by its path in the attachment folder', async () => {
		/* The server looks a bare name up beside the note, where it never is,
		   and answers 404 - which reads as "the ink was deleted". */
		get.mockResolvedValue({ data: await tinyPng().arrayBuffer() })
		await loadInk(5, 'abc')
		expect(get.mock.calls[0][1].params.path).toBe('.attachments.5/ink-abc.png')
	})

	it('hands back where the ink was, so it can be put there again', async () => {
		/* A block is cropped to the writing, so the strokes in the file start
		   at the picture's own corner. Without the corner itself, opening the
		   drawing a second time puts it somewhere it never was. */
		post.mockResolvedValue({ data: { filename: '.attachments.5/ink-abc.png' } })
		const strokes = [{ points: [[5, 5, 0.5]] }]
		await saveInk(5, 'abc', tinyPng(), strokes, [400, 300])
		const uploaded = post.mock.calls[0][1].get('file')
		get.mockResolvedValue({ data: await uploaded.arrayBuffer() })

		await expect(loadInk(5, 'abc')).resolves.toMatchObject({ origin: [400, 300] })
	})

	it('says nothing about where ink saved by an earlier build was', async () => {
		/* Those files carry strokes and no origin, and must open rather than
		   fail - in the corner, as they did then. */
		post.mockResolvedValue({ data: { filename: '.attachments.5/ink-abc.png' } })
		await saveInk(5, 'abc', tinyPng(), [{ points: [[5, 5, 0.5]] }])
		const uploaded = post.mock.calls[0][1].get('file')
		get.mockResolvedValue({ data: await uploaded.arrayBuffer() })

		const loaded = await loadInk(5, 'abc')
		expect(loaded.strokes).toHaveLength(1)
		expect(loaded.origin).toBeNull()
	})

	it('does not let the browser answer out of its cache', async () => {
		/* The attachment endpoint sends `max-age=3600` and no ETag, so a second
		   read of the same path is answered from the cache for an hour without
		   asking the server. The file changes under a fixed name every time the
		   ink is saved, so that answer is the drawing as it was before the last
		   edit - which is what the canvas then opened on. */
		get.mockResolvedValue({ data: await tinyPng().arrayBuffer() })
		await loadInk(5, 'abc')
		await loadInk(5, 'abc')
		const asked = get.mock.calls.map(([, config]) => config.params.fetched)
		expect(asked[0]).toBeDefined()
		expect(asked[1]).not.toBe(asked[0])
	})

	it('hands back the strokes as a plain list, not the envelope', async () => {
		/* What saveInk uploads is what loadInk must read back. */
		post.mockResolvedValue({ data: { filename: '.attachments.5/ink-abc.png' } })
		const strokes = [{ points: [[1, 2], [3, 4]] }]
		await saveInk(5, 'abc', tinyPng(), strokes)
		const uploaded = post.mock.calls[0][1].get('file')
		get.mockResolvedValue({ data: await uploaded.arrayBuffer() })
		const loaded = await loadInk(5, 'abc')
		expect(loaded.strokes).toEqual(strokes)
		expect(loaded.png).toBeInstanceOf(Blob)
	})

	it('reports no strokes for a picture that carries none', async () => {
		get.mockResolvedValue({ data: await tinyPng().arrayBuffer() })
		const loaded = await loadInk(5, 'abc')
		expect(loaded.strokes).toBeNull()
	})
})
