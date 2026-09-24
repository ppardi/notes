/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { makeSmartCategoryId } from '../smartCategories.js'

describe('makeSmartCategoryId', () => {
	it('makes an id the server will keep', () => {
		/* The server strips anything outside this set and caps the length, so
		   an id it has to rewrite is an id that no longer matches the one the
		   navigation is holding. */
		const id = makeSmartCategoryId()
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(id.length).toBeLessThanOrEqual(32)
	})

	it('is the same length every time', () => {
		/* A run of ids that vary in length is a sign the random part is being
		   sliced out of a float, which sometimes yields one character. */
		const lengths = new Set(Array.from({ length: 200 }, () => makeSmartCategoryId().length))
		expect(lengths.size).toBe(1)
	})

	it('does not repeat itself', () => {
		const ids = new Set(Array.from({ length: 500 }, () => makeSmartCategoryId()))
		expect(ids.size).toBe(500)
	})
})
