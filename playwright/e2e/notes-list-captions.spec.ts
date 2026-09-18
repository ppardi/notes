/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { deleteAllNotes, newNoteButton } from '../support/note.ts'

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

function caption(page: Page, name: string): Locator {
	return page.getByRole('heading', { level: 3, name, exact: true })
}

async function openNotesApp(page: Page): Promise<void> {
	await page.goto('/index.php/apps/notes/')
	await expect(newNoteButton(page).first()).toBeVisible()
}

test.describe('Note list captions', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		await deleteAllNotes(page)
	})

	test('shows the timeslot caption in All notes when every note shares one timeslot', async ({ page }) => {
		await createNoteViaApi(page, '', 'Only note')

		await openNotesApp(page)
		await navigationLink(page, 'All notes').click()

		await expect(caption(page, 'Today')).toBeVisible()
	})
})
