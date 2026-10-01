/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INK_COLOR, INK_COLORS, knownColor, rememberColor, rememberedColor } from '../inkPalette.js'

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

describe('knownColor', () => {
	it('passes a color from the palette through', () => {
		expect(knownColor('#cc0000')).toBe('#cc0000')
	})

	it('refuses one that is not in the palette', () => {
		/* An ink file can be copied in from anywhere, or edited. What it says
		   reaches fillStyle, so an arbitrary string must not. */
		expect(knownColor('#ff00ff')).toBe(DEFAULT_INK_COLOR)
	})

	it('refuses something that is not a color at all', () => {
		expect(knownColor('url(http://example.com/x.png)')).toBe(DEFAULT_INK_COLOR)
		expect(knownColor('')).toBe(DEFAULT_INK_COLOR)
		expect(knownColor(null)).toBe(DEFAULT_INK_COLOR)
		expect(knownColor(undefined)).toBe(DEFAULT_INK_COLOR)
	})

	it('is case insensitive, since hex is', () => {
		expect(knownColor('#CC0000')).toBe('#cc0000')
	})
})

describe('the remembered color', () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('is the default until one is chosen', () => {
		expect(rememberedColor()).toBe(DEFAULT_INK_COLOR)
	})

	it('comes back after it is set', () => {
		rememberColor('#0044cc')
		expect(rememberedColor()).toBe('#0044cc')
	})

	it('refuses a stored value that is not in the palette', () => {
		window.localStorage.setItem('notes-ink-color', '#ff00ff')
		expect(rememberedColor()).toBe(DEFAULT_INK_COLOR)
	})

	it('is the default when storage cannot be read', () => {
		/* Private browsing throws rather than returning null. The canvas has to
		   open regardless; a forgotten color is not a reason to fail.
		 *
		 * Spied on the prototype, not the instance: jsdom's Storage is exotic
		 * and treats a property defined on the instance as a named-item write,
		 * so an instance spy never fires and this test would pass without ever
		 * reaching the branch it exists for. */
		const reading = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('denied')
		})

		expect(rememberedColor()).toBe(DEFAULT_INK_COLOR)
		expect(reading).toHaveBeenCalled()
	})

	it('does not throw when storage cannot be written', () => {
		/* The color still applies to this session's strokes. Only the
		   remembering is lost, and that is not worth an error. */
		const writing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota')
		})

		expect(() => rememberColor('#0044cc')).not.toThrow()
		expect(writing).toHaveBeenCalled()
	})
})
