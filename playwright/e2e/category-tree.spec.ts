/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Locator, Page } from '@playwright/test'

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
	expect(response.ok(), `creating note in "${category}"`).toBeTruthy()

	const note = await response.json() as { id: number }
	return note.id
}

function categoryRow(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true })
		.locator('xpath=ancestor::div[contains(@class,"app-navigation-entry")][1]')
}

/* The entry div, not the li: a parent's li also contains its descendants. */
function categoryCounter(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true })
		.locator('xpath=ancestor::div[contains(@class,"app-navigation-entry")][1]')
		.locator('.app-navigation-entry__counter-wrapper')
		.first()
}

function categoryLink(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true }).first()
}

async function indentOf(page: Page, name: string): Promise<number> {
	const box = await categoryLink(page, name).boundingBox()
	return Math.round(box?.x ?? -1)
}

/* The selected category is remembered server-side, so leaving one selected
   would change where unrelated specs start. The request fixture carries no
   session cookie, which the settings route needs. */
async function clearStoredCategory(request: APIRequestContext): Promise<void> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const headers = { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
	await request.put('/index.php/apps/notes/settings', {
		headers,
		data: { lastViewedCategory: 'all' },
	})
}

test.describe('Category tree', () => {
	let deepNote: number
	let sageNote: number

	test.beforeEach(async ({ page }) => {
		await login(page)
		await deleteAllNotes(page)
		deepNote = await createNoteViaApi(page, 'PROJECTS/Apps/SAGE/Architecture', 'Deep note')
		sageNote = await createNoteViaApi(page, 'PROJECTS/Apps/SAGE', 'SAGE note')
		await createNoteViaApi(page, 'PROJECTS/Apps/Deskspace', 'Deskspace note')

		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page).first()).toBeVisible()
	})

	test.afterEach(async ({ request }) => {
		await clearStoredCategory(request)
	})

	test('shows categories the notes never declared', async ({ page }) => {
		// No note is filed in PROJECTS or PROJECTS/Apps directly.
		await expect(categoryLink(page, 'PROJECTS')).toBeVisible()
		await expect(categoryLink(page, 'Apps')).toBeVisible()
	})

	test('indents each level below its parent', async ({ page }) => {
		const projects = await indentOf(page, 'PROJECTS')
		const apps = await indentOf(page, 'Apps')
		const sage = await indentOf(page, 'SAGE')
		const architecture = await indentOf(page, 'Architecture')

		expect(apps).toBeGreaterThan(projects)
		expect(sage).toBeGreaterThan(apps)
		expect(architecture).toBeGreaterThan(sage)
	})

	test('counts only the notes filed directly in a category', async ({ page }) => {
		await expect(categoryCounter(page, 'SAGE')).toContainText('1')
		await expect(categoryCounter(page, 'Architecture')).toContainText('1')
		await expect(categoryCounter(page, 'Deskspace')).toContainText('1')
	})

	test('shows only the notes of the selected category, not those below it', async ({ page }) => {
		await categoryLink(page, 'SAGE').click()

		await expect(noteRow(page, sageNote)).toBeVisible()
		await expect(noteRow(page, deepNote)).toBeHidden()
	})

	test('remembers a collapsed category across a reload', async ({ page }) => {
		await expect(categoryLink(page, 'SAGE')).toBeVisible()

		const stored = page.waitForResponse((response) => response.url().includes('/apps/notes/settings') && response.request().method() === 'PUT')
		await categoryRow(page, 'Apps').getByRole('button', { name: 'Collapse' }).first().click()
		await stored

		await expect(categoryLink(page, 'SAGE')).toBeHidden()

		await page.reload()
		await expect(newNoteButton(page).first()).toBeVisible()

		await expect(categoryLink(page, 'Apps')).toBeVisible()
		await expect(categoryLink(page, 'SAGE')).toBeHidden()
	})

	test('selects a nested category from the tree', async ({ page }) => {
		await categoryLink(page, 'SAGE').click()

		await expect(page).toHaveURL(/[?&]category=PROJECTS\/Apps\/SAGE(&|$)/)
		await expect(categoryLink(page, 'SAGE')).toHaveAttribute('aria-current', 'page')
	})
})
