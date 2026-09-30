/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The module answers from what the URL said when it loaded, so each case
   needs it loaded afresh against a different URL. */
async function loadWith(search) {
	vi.resetModules()
	vi.stubGlobal('location', { search, href: 'https://example.test/apps/notes/note/1' + search })
	return (await import('../inkStats.js')).statsWanted
}

beforeEach(() => {
	window.sessionStorage.clear()
})

describe('statsWanted', () => {
	it('is off when nothing has asked', async () => {
		expect((await loadWith(''))()).toBe(false)
	})

	it('is on when the URL asks', async () => {
		expect((await loadWith('?inkstats=1'))()).toBe(true)
	})

	it('stays on after the app rewrites the URL', async () => {
		/* The note router drops query parameters it does not know on its first
		   navigation, and it does that before the canvas is ever opened. The
		   answer has to be taken at load and kept. */
		const on = await loadWith('?inkstats=1')
		on()
		expect((await loadWith('?category='))()).toBe(true)
	})

	it('is turned off again by asking for that', async () => {
		const on = await loadWith('?inkstats=1')
		on()
		expect((await loadWith('?inkstats=0'))()).toBe(false)
		expect((await loadWith(''))()).toBe(false)
	})

	it('is on when a second question mark swallowed the question', async () => {
		/* A note in a category already has a query, so appending "?inkstats=1"
		   makes it part of the category's value rather than a parameter of its
		   own. That is a reasonable thing to type and an unreasonable thing to
		   ignore. */
		expect((await loadWith('?category=Writing/Substack?inkstats=1'))()).toBe(true)
	})

	it('is on when asked for with no value at all', async () => {
		expect((await loadWith('?inkstats'))()).toBe(true)
	})

	it('is still turned off by a malformed no', async () => {
		const on = await loadWith('?inkstats=1')
		on()
		expect((await loadWith('?category=Writing?inkstats=0'))()).toBe(false)
	})

	it('is not turned on by a note that merely mentions it', async () => {
		/* The loose reading must still need the word followed by a value. */
		expect((await loadWith('?category=about%20inkstats%20and%20lag'))()).toBe(false)
	})

	it('says no rather than throwing where storage is refused', async () => {
		/* Private browsing can refuse sessionStorage outright. */
		const refuse = () => {
			throw new Error('denied')
		}
		vi.stubGlobal('sessionStorage', { getItem: refuse, setItem: refuse, removeItem: refuse })
		expect((await loadWith(''))()).toBe(false)
		vi.unstubAllGlobals()
	})
})
