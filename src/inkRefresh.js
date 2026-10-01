/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { inkAttachmentPath } from './inkLink.js'

/* The parameter that makes the URL new. Nothing reads it - not this app, not
   Text, not the server - and only its changing matters. */
const STAMP = 'inkedat'

/* Whatever this parameter was last set to, and the separator in front of it. */
const PREVIOUS = new RegExp(`([?&])${STAMP}=[^&]*&?`)

/**
 * The same URL, asking for the file again.
 *
 * The query is edited rather than reassembled: Text's picture URLs carry a
 * session token, and parsing the query out and writing it back would re-encode
 * it. The token is what Text checks before it hands the file over.
 *
 * @param {string | null} src the URL on the picture now
 * @param {number} stamp something that has not been used before
 * @return {string | null} the URL to fetch, or null when there was none
 */
function stamped(src, stamp) {
	if (!src) {
		return null
	}
	const bare = src.replace(PREVIOUS, '$1').replace(/[?&]$/, '')
	return `${bare}${bare.includes('?') ? '&' : '?'}${STAMP}=${stamp}`
}

/**
 * Show the ink that was just saved, where it is already on screen.
 *
 * Re-editing writes the file under the name the note already points at. So
 * nothing about the document changes, Text has no reason to render the image
 * again, and the browser - asked for a URL it has already fetched - answers
 * from its cache. The reader is left looking at the picture as it was before
 * they drew on it, until they leave the note and come back.
 *
 * Reaching into Text's rendered figure is not a promise Text has made, which
 * is why this reports what it found and must fail by doing nothing: the ink
 * is saved either way, and the stale picture was the behavior before this
 * existed.
 *
 * @param {ParentNode | null} root where the note is rendered
 * @param {number} noteId the note the ink belongs to
 * @param {string} id the ink's id
 * @param {number} stamp something that has not been used before
 * @return {number} how many pictures were pointed at the new file
 */
export function refreshInkPicture(root, noteId, id, stamp = Date.now()) {
	const path = inkAttachmentPath(noteId, id)
	let refreshed = 0
	for (const figure of root?.querySelectorAll?.('figure[data-src]') ?? []) {
		if (figure.getAttribute('data-src') !== path) {
			continue
		}
		for (const picture of figure.querySelectorAll('img')) {
			const next = stamped(picture.getAttribute('src'), stamp)
			if (next === null) {
				continue
			}
			picture.setAttribute('src', next)
			refreshed++
		}
	}
	return refreshed
}
