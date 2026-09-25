/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { SECTION_CATEGORIES, SECTION_TAGS, withSectionCollapsed } from '../navigationSections.js'

describe('withSectionCollapsed', () => {
	it('collapses a section that was open', () => {
		expect(withSectionCollapsed([], SECTION_CATEGORIES, true)).toEqual(['categories'])
	})

	it('opens a section that was collapsed', () => {
		expect(withSectionCollapsed(['categories', 'tags'], SECTION_CATEGORIES, false))
			.toEqual(['tags'])
	})

	it('does not list a section twice', () => {
		expect(withSectionCollapsed(['categories'], SECTION_CATEGORIES, true))
			.toEqual(['categories'])
	})

	it('leaves the other section alone', () => {
		expect(withSectionCollapsed(['tags'], SECTION_CATEGORIES, true))
			.toEqual(['tags', 'categories'])
		expect(withSectionCollapsed(['tags'], SECTION_TAGS, false)).toEqual([])
	})

	it('answers a new list rather than changing the one it was given', () => {
		const collapsed = ['tags']
		withSectionCollapsed(collapsed, SECTION_CATEGORIES, true)
		expect(collapsed).toEqual(['tags'])
	})
})
