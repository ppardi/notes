/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaApi, deleteAllNotes, newNoteButton, noteRow } from '../support/note.ts'

function tagRow(page: Page, name: string): Locator {
	return page.getByRole('link', { name, exact: true })
}

function tagsCaption(page: Page): Locator {
	return page.getByText('Tags', { exact: true })
}

async function openNotesApp(page: Page): Promise<void> {
	await page.goto('/index.php/apps/notes/')
	await expect(newNoteButton(page).first()).toBeVisible()
}

test.describe('Tags', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		/* Tag counts are assertions about the whole library, so notes left by
		   other specs would change them. */
		await deleteAllNotes(page)
	})

	test('lists the tags notes carry, with a count', async ({ page }) => {
		await createNoteViaApi(page, 'Personal', 'Kripke', 'naming #zeta and #alpha')
		await createNoteViaApi(page, 'Personal', 'Frege', 'sense #zeta')
		await openNotesApp(page)

		await expect(tagsCaption(page)).toBeVisible()
		await expect(tagRow(page, 'alpha')).toBeVisible()
		await expect(tagRow(page, 'zeta')).toBeVisible()

		const zetaCount = tagRow(page, 'zeta').locator('xpath=ancestor::li[1]')
			.locator('.app-navigation-entry__counter-wrapper')
		await expect(zetaCount).toContainText('2')
	})

	test('shows only the notes carrying the tag, and says so in the URL', async ({ page }) => {
		const tagged = await createNoteViaApi(page, 'Personal', 'Tagged', 'has one #beta')
		const untagged = await createNoteViaApi(page, 'Personal', 'Untagged', 'carries none')
		await openNotesApp(page)

		await tagRow(page, 'beta').click()

		await expect(page).toHaveURL(/[?&]tags=beta(&|$)/)
		await expect(noteRow(page, tagged)).toBeVisible()
		await expect(noteRow(page, untagged)).toBeHidden()
	})

	test('keeps the selected tag across a reload', async ({ page }) => {
		const tagged = await createNoteViaApi(page, 'Personal', 'Reloaded', 'sticky #gamma')
		const other = await createNoteViaApi(page, 'Personal', 'Other', 'different #omega')
		await openNotesApp(page)

		await tagRow(page, 'gamma').click()
		await expect(page).toHaveURL(/[?&]tags=gamma(&|$)/)

		await page.reload()
		await expect(newNoteButton(page).first()).toBeVisible()

		// The filter is still doing its job...
		await expect(noteRow(page, tagged)).toBeVisible()
		await expect(noteRow(page, other)).toBeHidden()

		// ...and the row still looks selected. Read the colour rather than the
		// class: the class sits on an inner element, and a correct class has
		// hidden an unpainted row here before.
		const background = (row: Locator) => row.locator('xpath=ancestor::li[1]')
			.locator('.app-navigation-entry').first()
			.evaluate((el) => window.getComputedStyle(el).backgroundColor)
		expect(await background(tagRow(page, 'gamma')))
			.not.toBe(await background(tagRow(page, 'omega')))
	})

	test('selecting a category clears the tag, since they are alternatives', async ({ page }) => {
		const tagged = await createNoteViaApi(page, 'Delta', 'InDelta', 'here #delta')
		const other = await createNoteViaApi(page, 'Epsilon', 'InEpsilon', 'no tag here')
		await openNotesApp(page)

		await tagRow(page, 'delta').click()
		await expect(noteRow(page, other)).toBeHidden()

		await page.getByRole('link', { name: 'Epsilon', exact: true }).click()

		await expect(page).not.toHaveURL(/[?&]tags=/)
		await expect(noteRow(page, other)).toBeVisible()
		await expect(noteRow(page, tagged)).toBeHidden()
	})

	test('drops a tag from the URL that no note carries', async ({ page }) => {
		const any = await createNoteViaApi(page, 'Personal', 'Anything', 'plain note')
		await page.goto('/index.php/apps/notes/?tags=nosuchtag')
		await expect(newNoteButton(page).first()).toBeVisible()

		// Nothing carries it, so the list is empty rather than broken.
		await expect(noteRow(page, any)).toBeHidden()
		await expect(tagRow(page, 'nosuchtag')).toHaveCount(0)
	})
})
