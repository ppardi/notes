/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { TestInfo } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNote, expectTitled, newNoteButton, noteRow, openNoteActions, uniqueTitle } from '../support/note.ts'

test.describe('Note actions', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page)).toBeVisible()
	})

	test('toggles favorite from the actions menu', async ({ page }, testInfo: TestInfo) => {
		const title = uniqueTitle('favorite', testInfo)
		const noteId = await createNote(page, title)

		const favorited = page.waitForResponse((response) => response.url().includes('/favorite'))
		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Add to favorites' }).click()
		await favorited

		await openNoteActions(page, noteId)
		await expect(page.getByRole('menuitem', { name: 'Remove from favorites' })).toBeVisible()
		await page.keyboard.press('Escape')

		const unfavorited = page.waitForResponse((response) => response.url().includes('/favorite'))
		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Remove from favorites' }).click()
		await unfavorited

		await openNoteActions(page, noteId)
		await expect(page.getByRole('menuitem', { name: 'Add to favorites' })).toBeVisible()
	})

	test('marks a favorite with an outlined star in the row text color', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('star', testInfo))

		const favorited = page.waitForResponse((response) => response.url().includes('/favorite'))
		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Add to favorites' }).click()
		await favorited

		const star = noteRow(page, noteId).locator('.material-design-icon').first()
		await expect(star).toHaveClass(/star-outline-icon/)

		// Not the hardcoded #FC0: the star takes the color of the row it marks,
		// so it stays legible whichever theme is in use.
		const { fill, text } = await star.evaluate((icon) => ({
			fill: getComputedStyle(icon.querySelector('path') as SVGPathElement).fill,
			text: getComputedStyle(icon.closest('.app-content-list-item') ?? icon).color,
		}))
		expect(fill).toBe(text)
	})

	test('closes the actions menu after opening the sidebar', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-close', testInfo))

		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Details', exact: true }).click()

		// Left open, it covers the rows underneath it.
		await expect(page.locator('.action-item__popper.v-popper__popper--shown')).toHaveCount(0)
	})

	test('closes the actions menu after toggling favorite', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('menu-close', testInfo))

		const favorited = page.waitForResponse((response) => response.url().includes('/favorite'))
		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Add to favorites' }).click()
		await favorited

		await expect(page.locator('.action-item__popper.v-popper__popper--shown')).toHaveCount(0)
	})

	test('renames a note from the actions menu', async ({ page }, testInfo: TestInfo) => {
		const title = uniqueTitle('rename', testInfo)
		const renamedTitle = `${title} renamed`
		const noteId = await createNote(page, title)

		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Rename' }).click()

		const renameInput = page.getByRole('dialog', { name: 'Actions' }).getByRole('textbox')
		await expect(renameInput).toBeVisible()
		await renameInput.fill(renamedTitle)
		await renameInput.press('Enter')

		await expect(noteRow(page, noteId)).toContainText(renamedTitle)
	})

	test('deletes a note and undoes the deletion', async ({ page }, testInfo: TestInfo) => {
		const title = uniqueTitle('delete', testInfo)
		const noteId = await createNote(page, title)
		// the undone note is looked for by title, which follows the saved file
		await expectTitled(page, noteId, title)

		await openNoteActions(page, noteId)
		await page.getByRole('menuitem', { name: 'Delete note' }).click()

		await expect(noteRow(page, noteId)).toHaveCount(0)

		const undoButton = page.getByRole('button', { name: 'Undo Delete', exact: true })
		await expect(undoButton).toBeVisible()

		const undoRequest = page.waitForResponse((response) => response.url().includes('/notes/undo') && response.request().method() === 'POST')
		await undoButton.click()
		await undoRequest

		await expect(page.getByRole('link', { name: title })).toBeVisible()
	})
})
