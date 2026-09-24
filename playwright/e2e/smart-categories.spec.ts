/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, setSmartCategories } from '../support/note.ts'

/* Real category rows are found by their title, the way every other category
   spec finds them. A smart category's title carries its tags instead - a
   tooltip saying what it is looking for is worth more than matching that
   convention - so its rows are found through the class they carry, which also
   keeps a smart category and a real one of the same name apart. */
function categoryLink(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true }).first()
}

function smartRow(page: Page, name: string): Locator {
	return page.locator('.smart-category-entry')
		.filter({ has: page.getByRole('link', { name, exact: true }) })
		.first()
}

function smartLink(page: Page, name: string): Locator {
	return smartRow(page, name).getByRole('link', { name, exact: true }).first()
}

/**
 * How far a row is indented, which is what says where it sits in the tree.
 *
 * @param locator the row's link
 */
async function indentOf(locator: Locator): Promise<number> {
	const box = await locator.boundingBox()
	return Math.round(box?.x ?? -1)
}

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

	test('shows a row with its count, and opens it when clicked', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await createNoteViaRequest('', 'Word and Object', 'Also #philosophy')
		await createNoteViaRequest('', 'Shopping', 'Milk')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)

		await expect(smartLink(page, 'Reading')).toBeVisible()
		await expect(smartRow(page, 'Reading').locator('.app-navigation-entry__counter-wrapper').first())
			.toContainText('2')

		await smartLink(page, 'Reading').click()

		await expect(page).toHaveURL(/smart=reading/)
		await expect(page.getByRole('link', { name: 'Word and Object' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'Shopping' })).toHaveCount(0)
	})

	test('sits under its parent, and is painted as current when open', async ({ page }) => {
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: 'Work' },
			{ id: 'other', name: 'Other', tags: ['kripke'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)

		/* Indent is what says where a row sits, the same way the category tree
		   specs prove nesting. */
		await expect(smartLink(page, 'Reading')).toBeVisible()
		expect(await indentOf(smartLink(page, 'Reading')))
			.toBeGreaterThan(await indentOf(categoryLink(page, 'Work')))
		expect(await indentOf(smartLink(page, 'Other')))
			.toBe(await indentOf(categoryLink(page, 'Work')))

		await smartLink(page, 'Reading').click()

		/* Class and paint together: the class has sat on an inner element while
		   nothing was painted, and the paint picks up hover from the last
		   click. */
		await page.mouse.move(600, 600)
		const background = (name: string) => smartRow(page, name)
			.locator('.app-navigation-entry').first()
			.evaluate((element) => window.getComputedStyle(element).backgroundColor)
		expect(await background('Reading')).not.toBe(await background('Other'))
	})

	test('refuses a note dropped onto it', async ({ page }) => {
		/* Tags live in the note's text, so filing a note here would mean editing
		   the note body. The drop must also not fall through to the parent
		   category, which would file the note somewhere the pointer never was. */
		await createNoteViaRequest('', 'Shopping', 'Milk')
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: 'Work' },
		])

		await openNotesApp(page)
		await categoryLink(page, 'Unfiled').click()

		const note = page.getByRole('link', { name: 'Shopping' })
		await note.dragTo(smartLink(page, 'Reading'))

		// still where it was: neither tagged, nor filed into Work
		await expect(page.getByRole('link', { name: 'Shopping' })).toBeVisible()
		await categoryLink(page, 'Work').click()
		await expect(page.getByRole('link', { name: 'Shopping' })).toHaveCount(0)
	})
})
