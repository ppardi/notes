/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, setSmartCategories } from '../support/note.ts'

async function openNotesApp(page: Page): Promise<void> {
	await page.goto('/index.php/apps/notes/')
	await expect(page.locator('#app-navigation-vue')).toBeVisible()
}

test.describe('Smart categories', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		await deleteAllNotesVia()
		await setSmartCategories([])
	})

	test('lands somewhere real when the record has gone', async ({ page }) => {
		/* A link kept from before the category was deleted, or a second tab that
		   deleted it. Leaving the list empty with nothing selected reads as a
		   broken app. */
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')

		await page.goto('/index.php/apps/notes/?smart=doesnotexist')

		await expect(page.locator('#app-navigation-vue')).toBeVisible()
		await expect(page).not.toHaveURL(/smart=/)
		await expect(page.getByRole('link', { name: 'Naming and Necessity' })).toBeVisible()
	})

	test('opens like a folder, not like the all-notes list', async ({ page }) => {
		/* Grouping and sort both branch on there being no selected category,
		   and opening a smart category clears it - so without the selection
		   reaching the store, this list comes back under "Today". */
		const work = await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		const personal = await createNoteViaRequest('Personal', 'Rigid Designators', 'Also #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await page.goto('/index.php/apps/notes/?smart=reading')

		await expect(page.getByRole('link', { name: 'Rigid Designators' })).toBeVisible()
		await expect(page.getByText('Today', { exact: true })).toHaveCount(0)

		/* Ordered by where the notes are really filed, so Personal comes before
		   Work however recently either was touched. */
		const order = await page.locator('.notes-list a[href*="/note/"]')
			.evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
		expect(order.findIndex((href) => href.includes(`/note/${personal}`)))
			.toBeLessThan(order.findIndex((href) => href.includes(`/note/${work}`)))
	})

	test('shows the notes a stored category names', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await createNoteViaRequest('', 'Shopping', 'Milk')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await page.goto('/index.php/apps/notes/?smart=reading')

		await expect(page.getByRole('link', { name: 'Naming and Necessity' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'Shopping' })).toHaveCount(0)
	})
})
