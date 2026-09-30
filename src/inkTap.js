/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { INK_FILE_PATTERN, inkAttachmentPath } from './inkLink.js'

/**
 * Reading the ink out of Text's own image node.
 *
 * This is not a promise Text has made. It renders images as a node view with
 * `data-component="image-view"` and the source in `data-src`, and a release
 * could change either. That is why the note also carries a link: when this
 * stops matching, the ink is still reachable, and this must fail by doing
 * nothing rather than by swallowing the tap.
 */

const FIGURE = 'figure[data-component="image-view"][data-src]'

/* Text draws its own controls inside that figure - a delete button, a caption
   field. They are Text's to handle: a tap on one must do what the control
   says, not open the canvas. */
const CONTROL = 'button, a, input, textarea, select, [role="button"], [contenteditable="true"]'

/**
 * The ink id of the image a click landed in.
 *
 * Only ink that belongs to this note is claimed. A block of ink lives in one
 * note's attachment folder, so an image that merely has an ink-shaped name -
 * one from elsewhere on the web, or one pasted in from another note - is left
 * to Text like any other image. Claiming it would open a canvas on an id this
 * note does not own, and finishing would write an orphan file into its folder.
 *
 * @param {Element | null} target what was clicked
 * @param {number | string} noteId the note being edited
 * @return {string | null} the id, or null when it is not this note's ink
 */
export function inkIdFromNode(target, noteId) {
	const figure = target?.closest?.(FIGURE)
	if (!figure) {
		return null
	}
	/* Not everything that looks like a control is one of Text's: the picture
	   itself is wrapped in a button ("Open image"), and a tap on that is the
	   tap this whole feature is for. The control a tap is left to is one
	   beside the picture, not one the picture is inside. */
	const picture = figure.querySelector('img')
	const control = target.closest(CONTROL)
	if (control && figure.contains(control) && !(picture && control.contains(picture))) {
		return null
	}
	const src = figure.getAttribute('data-src') ?? ''
	const id = INK_FILE_PATTERN.exec(src)?.[1]
	if (!id || src !== inkAttachmentPath(noteId, id)) {
		return null
	}
	return id
}
