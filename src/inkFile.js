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
			/* The server resolves this against the note's folder, so the bare file
			   name would look beside the note rather than in its attachments. */
			params: { path: inkAttachmentPath(noteId, id) },
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
