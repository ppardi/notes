/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaApi, deleteAllNotes, newNoteButton, noteRow } from '../support/note.ts'
import { NoteEditor } from '../support/sections/NoteEditor.ts'

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

	test('shows a tag as soon as it is typed, without a reload', async ({ page }) => {
		await createNoteViaApi(page, 'Personal', 'Untagged so far', 'nothing here yet')
		await openNotesApp(page)
		await expect(tagsCaption(page)).toHaveCount(0)

		await page.getByRole('link', { name: 'Untagged so far', exact: true }).click()
		const editor = new NoteEditor(page)
		await editor.type('now tagged #fresh')
		await editor.expectText('now tagged #fresh')

		/* No reload: the save has to bring the parsed tags back on its own.
		   Which editor this exercises depends on the instance. Without the Text
		   app it is the plain one, which learns the tags from its own save
		   response; with Text installed it is the rich editor, which has to ask
		   for them because Text writes the file itself. */
		await expect(tagRow(page, 'fresh')).toBeVisible({ timeout: 15000 })
	})

	test('renames a tag from its actions menu, in the notes and in the list', async ({ page }) => {
		const one = await createNoteViaApi(page, 'Personal', 'First', 'about #oldname here')
		const two = await createNoteViaApi(page, 'Personal', 'Second', 'also #oldname')
		const untouched = await createNoteViaApi(page, 'Personal', 'Third', 'a different #keeper')
		await openNotesApp(page)

		const row = tagRow(page, 'oldname').locator('xpath=ancestor::li[1]').first()
		await row.hover()
		await row.getByRole('button', { name: 'Actions', exact: true }).click()
		await page.getByRole('menuitem', { name: 'Rename tag', exact: true }).click()

		const input = page.getByPlaceholder('oldname', { exact: true })
		await expect(input).toBeVisible()
		await input.fill('newname')
		await input.press('Enter')

		await expect(tagRow(page, 'newname')).toBeVisible()
		await expect(tagRow(page, 'oldname')).toHaveCount(0)
		await expect(tagRow(page, 'keeper')).toBeVisible()

		// The notes themselves were rewritten, not just the list.
		await tagRow(page, 'newname').click()
		await expect(noteRow(page, one)).toBeVisible()
		await expect(noteRow(page, two)).toBeVisible()
		await expect(noteRow(page, untouched)).toBeHidden()
	})

	test('follows the selection when the tag being viewed is renamed', async ({ page }) => {
		const note = await createNoteViaApi(page, 'Personal', 'Followed', 'tagged #before')
		await openNotesApp(page)

		await tagRow(page, 'before').click()
		await expect(page).toHaveURL(/[?&]tags=before(&|$)/)

		const row = tagRow(page, 'before').locator('xpath=ancestor::li[1]').first()
		await row.hover()
		await row.getByRole('button', { name: 'Actions', exact: true }).click()
		await page.getByRole('menuitem', { name: 'Rename tag', exact: true }).click()
		const input = page.getByPlaceholder('before', { exact: true })
		await input.fill('after')
		await input.press('Enter')

		/* The view must not empty itself as the notes leave the old tag, so the
		   selection moves to the new name. */
		await expect(page).toHaveURL(/[?&]tags=after(&|$)/)
		await expect(noteRow(page, note)).toBeVisible()
	})

	test('merges two tags when one is renamed to the other', async ({ page }) => {
		const a = await createNoteViaApi(page, 'Personal', 'MergeA', 'tagged #mergefrom')
		const b = await createNoteViaApi(page, 'Personal', 'MergeB', 'tagged #mergeinto')
		await openNotesApp(page)

		const row = tagRow(page, 'mergefrom').locator('xpath=ancestor::li[1]').first()
		await row.hover()
		await row.getByRole('button', { name: 'Actions', exact: true }).click()
		await page.getByRole('menuitem', { name: 'Rename tag', exact: true }).click()
		const input = page.getByPlaceholder('mergefrom', { exact: true })
		await input.fill('mergeinto')
		await input.press('Enter')

		await expect(tagRow(page, 'mergefrom')).toHaveCount(0)
		await expect(tagRow(page, 'mergeinto')).toBeVisible()

		await tagRow(page, 'mergeinto').click()
		await expect(noteRow(page, a)).toBeVisible()
		await expect(noteRow(page, b)).toBeVisible()
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
