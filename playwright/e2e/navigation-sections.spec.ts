/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, setCollapsedSections } from '../support/note.ts'

function caption(page: Page, name: string): Locator {
	return page.locator('.app-navigation-caption').filter({ hasText: name }).first()
}

function categoryLink(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true }).first()
}

function tagLink(page: Page, name: string): Locator {
	return page.locator('.tag-entry').getByRole('link', { name, exact: true }).first()
}

async function openNotesApp(page: Page): Promise<void> {
	await page.goto('/index.php/apps/notes/')
	await expect(page.locator('#app-navigation-vue')).toBeVisible()
}

test.describe('Collapsing the navigation sections', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		await deleteAllNotesVia()
		/* Collapsing is stored, so it outlives a test: every one of these
		   starts from both sections open. */
		await setCollapsedSections([])
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
	})

	test('collapses the categories away, and remembers it', async ({ page }) => {
		/* Both sections share one scroll area, so a long category list pushes
		   the tags out of sight entirely. Collapsing is what gets them back. */
		await openNotesApp(page)
		await expect(categoryLink(page, 'Work')).toBeVisible()

		await caption(page, 'Categories').click()

		await expect(categoryLink(page, 'Work')).toBeHidden()
		/* The heading stays: it is what you click to bring them back. */
		await expect(caption(page, 'Categories')).toBeVisible()
		/* And the other section is untouched. */
		await expect(tagLink(page, 'philosophy')).toBeVisible()

		await page.reload()
		await expect(caption(page, 'Categories')).toBeVisible()
		await expect(categoryLink(page, 'Work')).toBeHidden()

		await caption(page, 'Categories').click()
		await expect(categoryLink(page, 'Work')).toBeVisible()
	})

	test('collapses the tags away independently', async ({ page }) => {
		await openNotesApp(page)
		await expect(tagLink(page, 'philosophy')).toBeVisible()

		await caption(page, 'Tags').click()

		await expect(tagLink(page, 'philosophy')).toBeHidden()
		await expect(categoryLink(page, 'Work')).toBeVisible()
	})

	test('does not collapse when the heading menu is used', async ({ page }) => {
		/* The heading carries the "add category" menu, and it is also a drop
		   target for notes. Neither may double as the collapse control. */
		await openNotesApp(page)

		await caption(page, 'Categories')
			.getByRole('button', { name: 'Add category', exact: true }).click()
		await expect(page.getByRole('menuitem', { name: 'New category' })).toBeVisible()
		await page.keyboard.press('Escape')

		await expect(categoryLink(page, 'Work')).toBeVisible()
	})
})
