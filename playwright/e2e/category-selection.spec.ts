/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { deleteAllNotes, newNoteButton, noteRow } from '../support/note.ts'

async function createNoteViaApi(page: Page, category: string, title: string): Promise<number> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const headers = { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }

	const response = await page.request.post('/index.php/apps/notes/api/v1/notes', {
		headers,
		data: { category, content: `# ${title}` },
	})
	expect(response.ok(), `creating note in category "${category}"`).toBeTruthy()

	const note = await response.json() as { id: number }
	return note.id
}

function navigationLink(page: Page, name: string): Locator {
	return page.getByRole('link', { name, exact: true })
}

async function openNotesApp(page: Page): Promise<void> {
	await page.goto('/index.php/apps/notes/')
	await expect(newNoteButton(page).first()).toBeVisible()
}

test.describe('Category selection', () => {
	let workNote: number
	let personalNote: number

	test.beforeEach(async ({ page }) => {
		await login(page)
		await deleteAllNotes(page)
		workNote = await createNoteViaApi(page, 'Work', 'Work note')
		personalNote = await createNoteViaApi(page, 'Personal', 'Personal note')
	})

	test('puts the selected category in the URL', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, 'Work').click()

		await expect(page).toHaveURL(/[?&]category=Work(&|$)/)
	})

	test('keeps the selected category across a reload', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, 'Work').click()
		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeHidden()

		await page.reload()

		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeHidden()
	})

	test('moves between selections with the browser history', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, 'Work').click()
		await expect(noteRow(page, personalNote)).toBeHidden()

		await navigationLink(page, 'Personal').click()
		await expect(noteRow(page, workNote)).toBeHidden()

		await page.goBack()

		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeHidden()
	})

	test('drops the parameter for the all-notes selection', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, 'Work').click()
		await expect(page).toHaveURL(/[?&]category=Work(&|$)/)

		await navigationLink(page, 'All notes').click()

		await expect(page).not.toHaveURL(/[?&]category=/)
		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeVisible()
	})
})
