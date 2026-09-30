/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { INK_FILE_PATTERN } from './inkLink.js'

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

/**
 * The ink id of the image a click landed in.
 *
 * @param {Element | null} target what was clicked
 * @return {string | null} the id, or null when it is not ink
 */
export function inkIdFromNode(target) {
	const figure = target?.closest?.(FIGURE)
	if (!figure) {
		return null
	}
	return INK_FILE_PATTERN.exec(figure.getAttribute('data-src') ?? '')?.[1] ?? null
}
