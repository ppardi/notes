/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, newNoteButton, noteContent, noteRow, openNoteActions, setNoteMode } from '../support/note.ts'

/* The rich editor is the Text app's; the markdown one is ours. Which of the
   two is on screen is the whole question here. */
function richEditor(page: Page): Locator {
	return page.locator('.ProseMirror').first()
}

function markdownEditor(page: Page): Locator {
	return page.locator('.note-editor')
}

async function openNote(page: Page, noteId: number): Promise<void> {
	await page.goto(`/index.php/apps/notes/note/${noteId}`)
}

test.describe('Raw markdown for one note', () => {
	test.beforeEach(async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page)).toBeVisible()
	})

	test.describe('on a phone', () => {
		test.use({ viewport: { width: 390, height: 844 } })

		/* The app opens the last note it was on, and the list is not on screen
		   while a note is, so getting to a row means going back first - which is
		   the whole reason the way in cannot live on the note being read. */
		async function showTheList(page: Page, noteId: number): Promise<void> {
			await page.goto('/index.php/apps/notes/')
			await page.waitForTimeout(500)
			if (!await noteRow(page, noteId).isVisible().catch(() => false)) {
				await page.locator('.app-content-wrapper button.button-vue').first().click()
			}
			await expect(noteRow(page, noteId)).toBeVisible()
		}

		test('opens a note as markdown from the list', async ({ page }) => {
			/* The list and the note are never both on screen here, so the way in
			   cannot be an action on the note being read: by the time its row can
			   be reached, it is not the note being read any more. The action opens
			   the note it is on. */
			const noteId = await createNoteViaRequest('', 'Groceries', '## Fruit\n\nApples')
			await showTheList(page, noteId)

			await openNoteActions(page, noteId)
			await page.getByRole('menuitem', { name: 'Edit markdown' }).click()

			await expect(markdownEditor(page)).toContainText('## Fruit')
			await expect(page).toHaveURL(new RegExp(`/note/${noteId}`))
		})

		test('offers the way back from the editor own menu', async ({ page }) => {
			const noteId = await createNoteViaRequest('', 'Groceries', '## Fruit')
			await showTheList(page, noteId)
			await openNoteActions(page, noteId)
			await page.getByRole('menuitem', { name: 'Edit markdown' }).click()
			await expect(markdownEditor(page)).toContainText('## Fruit')

			await page.locator('.action-buttons .action-item__menutoggle').first().click()
			await page.getByRole('menuitem', { name: 'Rich text' }).click()
			await expect(richEditor(page).getByRole('heading', { name: 'Fruit' })).toBeVisible()
		})
	})

	test('shows the markdown behind a note, and puts it back', async ({ page }) => {
		const noteId = await createNoteViaRequest('', 'Groceries', '## Fruit\n\nApples')
		await openNote(page, noteId)
		await expect(richEditor(page).getByRole('heading', { name: 'Fruit' })).toBeVisible()

		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Edit markdown' }).click()

		/* The syntax itself, which is the point: the rich editor renders it away. */
		await expect(markdownEditor(page)).toContainText('## Fruit')
		await expect(richEditor(page)).toHaveCount(0)

		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Rich text' }).click()
		await expect(richEditor(page).getByRole('heading', { name: 'Fruit' })).toBeVisible()
	})

	test('offers the way back from the editor own menu', async ({ page }) => {
		const noteId = await createNoteViaRequest('', 'Groceries', '## Fruit')
		await openNote(page, noteId)
		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Edit markdown' }).click()
		await expect(markdownEditor(page)).toContainText('## Fruit')

		/* The markdown editor carries its own menu, so the way back is on the
		   note being read rather than over in the list. */
		await page.locator('.action-buttons .action-item__menutoggle').first().click()
		await page.getByRole('menuitem', { name: 'Rich text' }).click()
		await expect(richEditor(page).getByRole('heading', { name: 'Fruit' })).toBeVisible()
	})

	test('keeps an edit made in the markdown', async ({ page }) => {
		const noteId = await createNoteViaRequest('', 'Groceries', '## Fruit')
		await openNote(page, noteId)
		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Edit markdown' }).click()
		await expect(markdownEditor(page)).toContainText('## Fruit')

		await markdownEditor(page).click()
		await page.keyboard.press('End')
		await page.keyboard.type('\n\nPears')

		await expect.poll(() => noteContent(noteId), { timeout: 15000 }).toContain('Pears')
	})

	test('is forgotten when another note is opened', async ({ page }) => {
		const raw = await createNoteViaRequest('', 'Groceries', '## Fruit')
		const other = await createNoteViaRequest('', 'Reading', '## Books')
		await openNote(page, raw)
		await openNoteActions(page, raw)
		await page.getByRole('menuitem', { name: 'Edit markdown' }).click()
		await expect(markdownEditor(page)).toContainText('## Fruit')

		await openNote(page, other)
		await expect(richEditor(page).getByRole('heading', { name: 'Books' })).toBeVisible()

		/* And the note it was turned on for is rich again too: it lasts as long
		   as you are reading that note, and no longer. */
		await openNote(page, raw)
		await expect(richEditor(page).getByRole('heading', { name: 'Fruit' })).toBeVisible()
	})

	test('is forgotten on reload', async ({ page }) => {
		const noteId = await createNoteViaRequest('', 'Groceries', '## Fruit')
		await openNote(page, noteId)
		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Edit markdown' }).click()
		await expect(markdownEditor(page)).toContainText('## Fruit')

		await page.reload()
		await expect(richEditor(page).getByRole('heading', { name: 'Fruit' })).toBeVisible()
	})

	test('is not offered while the whole app is already in plain text', async ({ page, request }) => {
		const noteId = await createNoteViaRequest('', 'Groceries', '## Fruit')
		await setNoteMode(request, 'edit')
		await page.reload()
		await openNote(page, noteId)
		await expect(markdownEditor(page)).toContainText('## Fruit')

		/* There is nothing for it to escape from: the setting has already done
		   it, for every note. */
		await openNoteActions(page, noteId)
		/* The menu really is open: without this the two counts below are zero
		   because nothing is on screen, and the test passes saying nothing. */
		await expect(page.getByRole('menuitem', { name: 'Details' })).toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Edit markdown' })).toHaveCount(0)
		await expect(page.getByRole('menuitem', { name: 'Rich text' })).toHaveCount(0)
	})

	test.afterEach(async ({ request }) => {
		await setNoteMode(request, 'rich')
	})
})
