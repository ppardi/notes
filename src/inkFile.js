/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { inkAttachmentPath, inkFileName } from './inkLink.js'
import { embedStrokes, readStrokes } from './inkPng.js'

/**
 * Write one ink block, replacing whatever is there under the same name.
 *
 * @param {number} noteId the note it belongs to
 * @param {string} id the ink's id
 * @param {Blob} png the rendered picture
 * @param {Array<object>} strokes what drew it
 * @return {Promise<string>} the path the note should hold
 */
export async function saveInk(noteId, id, png, strokes) {
	/* The envelope is this module's business. Callers hand over a list of
	   strokes and get a list back, so nobody outside writes strokes.strokes. */
	const withStrokes = embedStrokes(new Uint8Array(await png.arrayBuffer()), { version: 1, strokes })
	const form = new FormData()
	form.append('file', new Blob([withStrokes], { type: 'image/png' }), inkFileName(id))
	const url = generateUrl(`/apps/notes/notes/${noteId}/attachment?replace=1`)
	const response = await axios.post(url, form, {
		headers: { 'Content-Type': 'multipart/form-data' },
	})
	return response.data?.filename ?? inkAttachmentPath(noteId, id)
}

/* Makes each read of an ink file a URL the browser has not seen.
 *
 * The attachment endpoint answers `private, max-age=3600` with no ETag, so a
 * second read of the same path is served out of the cache for an hour without
 * the server being asked. An ink file changes under a fixed name every time it
 * is saved, so that cached answer is the drawing as it stood before the last
 * edit - and the canvas opened on it, losing the edit as far as the reader
 * could tell. The server ignores the parameter.
 *
 * Counted as well as timed: two reads in the same millisecond are a reopen
 * straight after a save, which is exactly the case this exists for.
 */
let reads = 0

/**
 * Read one ink block back.
 *
 * @param {number} noteId the note it belongs to
 * @param {string} id the ink's id
 * @return {Promise<{png: Blob, strokes: Array<object> | null} | null>} what is there, or null
 */
export async function loadInk(noteId, id) {
	const url = generateUrl(`/apps/notes/notes/${noteId}/attachment`)
	try {
		const response = await axios.get(url, {
			params: {
				/* The server resolves this against the note's folder, so the bare
				   file name would look beside the note rather than in its
				   attachments. */
				path: inkAttachmentPath(noteId, id),
				fetched: `${Date.now()}.${++reads}`,
			},
			responseType: 'arraybuffer',
		})
		const bytes = new Uint8Array(response.data)
		return {
			png: new Blob([bytes], { type: 'image/png' }),
			strokes: readStrokes(bytes)?.strokes ?? null,
		}
	} catch (error) {
		/* Gone is an answer, not a failure: the reader deleted the picture and
		   kept the link. The caller says so and offers to tidy the link up. */
		if (error?.response?.status === 404) {
			return null
		}
		throw error
	}
}
