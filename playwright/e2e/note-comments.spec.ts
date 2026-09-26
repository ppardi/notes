/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, newNoteButton, setNoteMode, uniqueTitle } from '../support/note.ts'

function preview(page: Page): Locator {
	return page.locator('.note-preview')
}

/**
 * A note body carrying one comment, written the way the Text app writes one.
 *
 * The indentation is the syntax: a comment is a footnote definition holding an
 * indented list, one item per reply.
 *
 * @param extra more markdown to append
 * @return the body of a commented note
 */
function commented(extra = ''): string {
	return 'The quick[^comment-1] brown fox.\n'
		+ '\n'
		+ '[^comment-1]:\n'
		+ '    - @[jane](mention://user/jane) *(2026-07-15T13:12Z)*\n'
		+ '      Is this the right word?\n'
		+ extra
}

test.describe('Comments in the preview', () => {
	test.beforeEach(async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'preview')
	})

	test.afterEach(async ({ request }) => {
		await setNoteMode(request, 'rich')
	})

	test('draws a comment rather than the syntax that stores it', async ({ page }, testInfo) => {
		const title = uniqueTitle('comment-preview', testInfo)
		const noteId = await createNoteViaRequest('', title, commented())

		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(newNoteButton(page).first()).toBeVisible()
		await expect(preview(page)).toBeVisible()

		// What the note says, and who said it.
		await expect(preview(page).locator('.note-comments')).toBeVisible()
		await expect(preview(page).getByRole('heading', { name: 'Comments' })).toBeVisible()
		await expect(preview(page).locator('.note-comments__author')).toHaveText('jane')
		await expect(preview(page).locator('.note-comments__item')).toContainText('Is this the right word?')

		// Not the machinery that carried it.
		await expect(preview(page)).not.toContainText('[^comment-1]')
		await expect(preview(page)).not.toContainText('mention://user/jane')
		// A timestamp a person reads, with the stored one kept for the machine.
		const time = preview(page).locator('.note-comments__time')
		await expect(time).toHaveAttribute('datetime', '2026-07-15T13:12Z')
		await expect(time).not.toHaveText('2026-07-15T13:12Z')
	})

	test('leads from the prose to the comment and back', async ({ page }, testInfo) => {
		const title = uniqueTitle('comment-anchor', testInfo)
		const noteId = await createNoteViaRequest('', title, commented())

		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(preview(page)).toBeVisible()

		const marker = preview(page).locator('.comment-ref a')
		await expect(marker).toHaveText('1')
		await expect(marker).toHaveAttribute('href', '#comment-1')
		await expect(preview(page).locator('#comment-1')).toBeVisible()
		await expect(preview(page).locator('.note-comments__backref'))
			.toHaveAttribute('href', '#commentref-1')
	})

	test('numbers a real footnote without counting the comments', async ({ page }, testInfo) => {
		const title = uniqueTitle('comment-numbering', testInfo)
		const noteId = await createNoteViaRequest('', title, commented('\nAnd a footnote[^1].\n\n[^1]: The proverbial pangram.\n'))

		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(preview(page)).toBeVisible()

		// The comment did not take [1] from the only footnote in the note.
		await expect(preview(page).locator('.footnote-ref a')).toHaveText('[1]')
		await expect(preview(page).locator('.footnotes')).toContainText('The proverbial pangram.')
		// Each is under its own heading rather than mixed into one list.
		await expect(preview(page).locator('.note-comments')).toBeVisible()
	})
})
