/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { makeId } from './id.js'

/* The id alphabet, repeated here as a guard: the id reaches a file name, and a
   URL is somewhere a note's own text can send us. */
const ID = /^[A-Za-z0-9_-]+$/

/* The shape of an ink file's name, exported so the one place that recognizes
   ink by its rendered src does not keep a second copy of the convention. */
export const INK_FILE_PATTERN = /(?:^|\/)ink-([A-Za-z0-9_-]+)\.png$/

/**
 * @return {string} an id for one ink block
 */
export function makeInkId() {
	return makeId()
}

/**
 * @param {string} id the ink's id
 * @return {string} the file name
 */
export function inkFileName(id) {
	return `ink-${id}.png`
}

/**
 * @param {number} noteId the note the ink belongs to
 * @param {string} id the ink's id
 * @return {string} the path the markdown holds
 */
export function inkAttachmentPath(noteId, id) {
	return `.attachments.${noteId}/${inkFileName(id)}`
}

/**
 * The ink id a URL names, if it names one.
 *
 * Matches on the path's tail: the document holds a relative path, while
 * openLinkHandler is handed the absolute URL the browser resolved.
 *
 * @param {string} url the href to read
 * @return {string | null} the id, or null when the URL is not ours
 */
export function inkIdFromUrl(url) {
	if (!url) {
		return null
	}
	const match = /\/apps\/notes\/ink\/([^/?#]+)\/?$/.exec(url)
	if (!match) {
		return null
	}
	let id
	try {
		id = decodeURIComponent(match[1])
	} catch {
		return null
	}
	return ID.test(id) ? id : null
}

/**
 * What one ink block looks like in the note, as the document nodes Text's
 * editor takes.
 *
 * The picture alone. It used to carry an "Edit ink" link beneath it as a
 * second way back into the canvas, on the reasoning that recognizing Text's
 * own image node was not a promise Text had made. The link never worked:
 * Text's own link bubble claims a click on a link inside the editor, so the
 * handler behind it was never reached. Tapping the ink does work, and a line
 * of text under every picture that does nothing is worse than no line at all.
 *
 * Nodes rather than markdown, because the editor's insertAtCursor reads a
 * string as HTML: markdown would land in the note as literal,
 * backslash-escaped text rather than as a picture.
 *
 * @param {number} noteId the note
 * @param {string} id the ink's id
 * @return {object[]} nodes to insert
 */
export function inkContent(noteId, id) {
	return [
		{
			type: 'image',
			attrs: { src: inkAttachmentPath(noteId, id), alt: t('notes', 'Ink') },
		},
	]
}
