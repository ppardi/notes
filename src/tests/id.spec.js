/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { makeId } from '../id.js'

describe('makeId', () => {
	it('makes an id that survives a URL unchanged', () => {
		expect(makeId()).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it('is the same length every time', () => {
		/* A run of ids that vary in length is a sign the random part is being
		   sliced off a float, which sometimes yields one or two characters. */
		const lengths = new Set(Array.from({ length: 50 }, () => makeId().length))
		expect(lengths.size).toBe(1)
	})

	it('does not repeat itself', () => {
		const ids = new Set(Array.from({ length: 500 }, () => makeId()))
		expect(ids.size).toBe(500)
	})
})
