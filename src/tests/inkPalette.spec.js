/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_INK_COLOR, INK_COLORS } from '../inkPalette.js'

describe('the palette', () => {
	it('offers the six measured colors, in order', () => {
		expect(INK_COLORS.map((color) => color.value)).toEqual([
			'#000000',
			'#cc0000',
			'#b35900',
			'#008800',
			'#0044cc',
			'#7733cc',
		])
	})

	it('starts at black, which is what every drawing made before color is', () => {
		expect(DEFAULT_INK_COLOR).toBe('#000000')
		expect(INK_COLORS[0].value).toBe(DEFAULT_INK_COLOR)
	})

	it('gives every color a key, so the picker can name it without reading hex', () => {
		expect(INK_COLORS.map((color) => color.key)).toEqual([
			'ink',
			'red',
			'orange',
			'green',
			'blue',
			'purple',
		])
	})
})
