/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { inkIdFromNode } from '../inkTap.js'

/**
 * @param {string} src what Text put in data-src
 * @return {Element} a figure shaped like Text's image node
 */
function figure(src) {
	const el = document.createElement('figure')
	el.setAttribute('data-component', 'image-view')
	el.setAttribute('data-src', src)
	const inner = document.createElement('span')
	el.append(inner)
	document.body.append(el)
	return inner
}

describe('inkIdFromNode', () => {
	it('finds the ink a tap landed in', () => {
		expect(inkIdFromNode(figure('.attachments.85110/ink-abc123.png'))).toBe('abc123')
	})

	it('ignores an ordinary image', () => {
		/* Tapping a photo must still do what Text does with a photo. */
		expect(inkIdFromNode(figure('.attachments.85110/holiday.png'))).toBeNull()
	})

	it('ignores a tap outside any image', () => {
		expect(inkIdFromNode(document.createElement('p'))).toBeNull()
		expect(inkIdFromNode(null)).toBeNull()
	})

	it('does not claim a name that only looks like ink', () => {
		expect(inkIdFromNode(figure('.attachments.85110/ink-.png'))).toBeNull()
		expect(inkIdFromNode(figure('.attachments.85110/ink-a b.png'))).toBeNull()
	})
})
