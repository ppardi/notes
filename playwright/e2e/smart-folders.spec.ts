/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaApi, deleteAllNotes, newNoteButton, noteRow } from '../support/note.ts'

function folderRow(page: Page, name: string): Locator {
	return navigationRow(page, name).locator('xpath=ancestor::li[1]').first()
}

/**
 * How many smart folder rows are painted as the current one.
 *
 * Read from what is painted rather than from a class: the class sits on an
 * inner element, and a correct class has hidden an unlit row here before. The
 * pointer is moved away first, since hovering paints a row too.
 *
 * @param page the page under test
 */
async function litFolders(page: Page): Promise<number> {
	await page.mouse.move(0, 0)
	return page.locator('.smart-folder-entry .app-navigation-entry').evaluateAll(
		(rows) => rows.filter((row) => window.getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
	)
}

/**
 * Name the folder being saved, taking whatever the field suggests.
 *
 * @param page the page under test
 * @param name the name to type, or '' to accept the suggestion
 */
async function nameTheFolder(page: Page, name: string): Promise<void> {
	const field = page.locator('.smart-folder-entry input[type="text"]').first()
	await expect(field).toBeVisible()
	if (name !== '') {
		await field.fill(name)
	}
	await field.press('Enter')
}

function navigationRow(page: Page, name: string): Locator {
	return page.getByRole('link', { name, exact: true })
}

function tagsCaption(page: Page): Locator {
	return page.locator('.app-navigation-caption').filter({ hasText: 'Tags' }).first()
}

async function openNotesApp(page: Page): Promise<void> {
	await page.goto('/index.php/apps/notes/')
	await expect(newNoteButton(page).first()).toBeVisible()
}

/**
 * Choose an item from the Tags heading's actions.
 *
 * A lone action is drawn as a button of its own and several go behind a menu,
 * which is the component's business rather than this spec's — so this takes
 * either.
 *
 * @param page the page under test
 * @param action the action to choose
 */
async function fromTagsMenu(page: Page, action: string): Promise<void> {
	await tagsCaption(page).hover()
	const alone = tagsCaption(page).getByRole('button', { name: action, exact: true })
	if (await alone.count() > 0) {
		await alone.click()
		return
	}
	await tagsCaption(page).getByRole('button', { name: 'Actions', exact: true }).click()
	await page.getByRole('menuitem', { name: action, exact: true }).click()
}

/**
 * Add a tag to the selection rather than replacing it.
 *
 * @param page the page under test
 * @param tag the tag to add
 */
async function alsoSelect(page: Page, tag: string): Promise<void> {
	await navigationRow(page, tag).click({ modifiers: ['ControlOrMeta'] })
}

/**
 * Forget every saved query, so one test cannot seed the next.
 *
 * @param request the request fixture
 */
async function clearSmartFolders(request: APIRequestContext): Promise<void> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const response = await request.put('/index.php/apps/notes/settings', {
		headers: {
			Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
			'OCS-APIRequest': 'true',
		},
		data: { smartFolders: [] },
	})
	expect(response.ok(), 'clearing the smart folders').toBeTruthy()
}

test.describe('Smart folders', () => {
	let both: number
	let onlyPhilosophy: number
	let onlyKripke: number

	test.beforeEach(async ({ page, request }) => {
		await clearSmartFolders(request)
		await login(page)
		await deleteAllNotes(page)
		both = await createNoteViaApi(page, 'Personal', 'Naming and Necessity', 'on #philosophy and #kripke')
		onlyPhilosophy = await createNoteViaApi(page, 'Personal', 'Tractatus', 'on #philosophy')
		onlyKripke = await createNoteViaApi(page, 'Personal', 'A letter', 'about #kripke')
	})

	test.afterEach(async ({ request }) => {
		await clearSmartFolders(request)
	})

	test('adding a second tag narrows the list', async ({ page }) => {
		await openNotesApp(page)

		await navigationRow(page, 'philosophy').click()
		await expect(noteRow(page, both)).toBeVisible()
		await expect(noteRow(page, onlyPhilosophy)).toBeVisible()
		await expect(noteRow(page, onlyKripke)).toBeHidden()

		await alsoSelect(page, 'kripke')

		// both tags, and only the note carrying both
		await expect(page).toHaveURL(/[?&]mode=all(&|$)/)
		await expect(noteRow(page, both)).toBeVisible()
		await expect(noteRow(page, onlyPhilosophy)).toBeHidden()
		await expect(noteRow(page, onlyKripke)).toBeHidden()
	})

	test('the menu widens it again, and back', async ({ page }) => {
		await openNotesApp(page)
		await navigationRow(page, 'philosophy').click()
		await alsoSelect(page, 'kripke')

		await fromTagsMenu(page, 'Match any tag')

		await expect(noteRow(page, both)).toBeVisible()
		await expect(noteRow(page, onlyPhilosophy)).toBeVisible()
		await expect(noteRow(page, onlyKripke)).toBeVisible()

		await fromTagsMenu(page, 'Match all tags')

		await expect(noteRow(page, onlyPhilosophy)).toBeHidden()
	})

	test('a second click on a chosen tag takes it back out', async ({ page }) => {
		await openNotesApp(page)
		await navigationRow(page, 'philosophy').click()
		await alsoSelect(page, 'kripke')
		await expect(noteRow(page, onlyPhilosophy)).toBeHidden()

		await alsoSelect(page, 'kripke')

		await expect(noteRow(page, onlyPhilosophy)).toBeVisible()
		await expect(noteRow(page, onlyKripke)).toBeHidden()
	})

	test('saves what is on screen as a smart folder, and goes back to it', async ({ page }) => {
		await openNotesApp(page)
		await navigationRow(page, 'philosophy').click()
		await alsoSelect(page, 'kripke')

		await fromTagsMenu(page, 'Save as smart folder')
		await page.getByPlaceholder('#philosophy #kripke', { exact: true }).fill('Kripke reading')
		await page.getByPlaceholder('#philosophy #kripke', { exact: true }).press('Enter')

		await expect(navigationRow(page, 'Kripke reading')).toBeVisible()

		// away, and back through the saved query
		await navigationRow(page, 'Personal').click()
		await expect(noteRow(page, onlyKripke)).toBeVisible()

		await navigationRow(page, 'Kripke reading').click()
		await expect(noteRow(page, both)).toBeVisible()
		await expect(noteRow(page, onlyPhilosophy)).toBeHidden()
		await expect(noteRow(page, onlyKripke)).toBeHidden()
	})

	test('a saved folder survives a reload, and says how many notes it holds', async ({ page }) => {
		await openNotesApp(page)
		await navigationRow(page, 'philosophy').click()
		await fromTagsMenu(page, 'Save as smart folder')
		await page.getByPlaceholder('#philosophy', { exact: true }).fill('Philosophy')
		await page.getByPlaceholder('#philosophy', { exact: true }).press('Enter')
		await expect(navigationRow(page, 'Philosophy')).toBeVisible()

		await page.reload()
		await expect(newNoteButton(page).first()).toBeVisible()

		const row = navigationRow(page, 'Philosophy').locator('xpath=ancestor::li[1]')
		await expect(row).toBeVisible()
		await expect(row.locator('.app-navigation-entry__counter-wrapper')).toContainText('2')
	})

	test('renames and deletes a saved folder', async ({ page }) => {
		await openNotesApp(page)
		await navigationRow(page, 'philosophy').click()
		await fromTagsMenu(page, 'Save as smart folder')
		await page.getByPlaceholder('#philosophy', { exact: true }).fill('First name')
		await page.getByPlaceholder('#philosophy', { exact: true }).press('Enter')
		await expect(navigationRow(page, 'First name')).toBeVisible()

		const row = navigationRow(page, 'First name').locator('xpath=ancestor::li[1]').first()
		await row.hover()
		await row.getByRole('button', { name: 'Actions', exact: true }).click()
		await page.getByRole('menuitem', { name: 'Rename smart folder', exact: true }).click()
		const rename = page.getByPlaceholder('First name', { exact: true })
		await rename.fill('Second name')
		await rename.press('Enter')

		await expect(navigationRow(page, 'Second name')).toBeVisible()
		await expect(navigationRow(page, 'First name')).toHaveCount(0)

		const renamed = navigationRow(page, 'Second name').locator('xpath=ancestor::li[1]').first()
		await renamed.hover()
		await renamed.getByRole('button', { name: 'Actions', exact: true }).click()
		await page.getByRole('menuitem', { name: 'Delete smart folder', exact: true }).click()

		await expect(navigationRow(page, 'Second name')).toHaveCount(0)
		// and the heading goes with the last one
		await expect(page.locator('.app-navigation-caption').filter({ hasText: 'Smart folders' })).toHaveCount(0)
	})

	test('takes the tags as its name when none is typed', async ({ page }) => {
		await openNotesApp(page)
		await navigationRow(page, 'philosophy').click()
		await alsoSelect(page, 'kripke')

		await fromTagsMenu(page, 'Save as smart folder')
		// straight to Enter, as anyone expecting to type tags would
		await nameTheFolder(page, '')

		/* Something has to be left behind, and what it is called has to say
		   what it holds. */
		await expect(navigationRow(page, '#philosophy #kripke')).toBeVisible()
		await expect(folderRow(page, '#philosophy #kripke')
			.locator('.app-navigation-entry__counter-wrapper')).toContainText('1')
	})

	test('lights only the folder that was opened, not every one holding those tags', async ({ page }) => {
		await openNotesApp(page)
		await navigationRow(page, 'philosophy').click()
		await fromTagsMenu(page, 'Save as smart folder')
		await nameTheFolder(page, 'First')
		await expect(navigationRow(page, 'First')).toBeVisible()

		// a second folder looking for exactly the same thing
		await navigationRow(page, 'philosophy').click()
		await fromTagsMenu(page, 'Save as smart folder')
		await nameTheFolder(page, 'Second')
		await expect(navigationRow(page, 'Second')).toBeVisible()

		await navigationRow(page, 'First').click()

		/* Both hold the same tags, so working the highlight out from the tags
		   lights both — which reads as a fault. */
		expect(await litFolders(page), 'only the folder that was clicked is lit').toBe(1)
	})

	test('takes the filter on screen as a folder’s new meaning', async ({ page }) => {
		await openNotesApp(page)
		await navigationRow(page, 'philosophy').click()
		await fromTagsMenu(page, 'Save as smart folder')
		await nameTheFolder(page, 'Reading')
		await expect(navigationRow(page, 'Reading')).toBeVisible()

		// open it, then change what is on screen
		await navigationRow(page, 'Reading').click()
		await alsoSelect(page, 'kripke')

		await fromTagsMenu(page, 'Update “Reading”')

		// it now means both tags, which its count says
		await expect(folderRow(page, 'Reading')
			.locator('.app-navigation-entry__counter-wrapper')).toContainText('1')

		await navigationRow(page, 'Personal').click()
		await navigationRow(page, 'Reading').click()
		await expect(noteRow(page, both)).toBeVisible()
		await expect(noteRow(page, onlyPhilosophy)).toBeHidden()
	})

	test('offers nothing to save until something is filtered', async ({ page }) => {
		await openNotesApp(page)

		// the heading has no menu at all while no tag is chosen
		await tagsCaption(page).hover()
		await expect(tagsCaption(page).getByRole('button')).toHaveCount(0)

		await navigationRow(page, 'philosophy').click()
		await tagsCaption(page).hover()
		await expect(tagsCaption(page).getByRole('button').first()).toBeVisible()
	})

	test('a folder naming a tag nobody uses any more shows an empty list', async ({ page, request }) => {
		const user = process.env.NC_USER ?? 'admin'
		const password = process.env.NC_PASS ?? 'admin'
		await request.put('/index.php/apps/notes/settings', {
			headers: {
				Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
				'OCS-APIRequest': 'true',
			},
			data: { smartFolders: [{ name: 'Gone', tags: ['vanished'], mode: 'any' }] },
		})

		await openNotesApp(page)
		await navigationRow(page, 'Gone').click()

		// empty rather than broken: the tag may come back
		await expect(noteRow(page, both)).toBeHidden()
		await expect(noteRow(page, onlyPhilosophy)).toBeHidden()
		await expect(navigationRow(page, 'Gone')).toBeVisible()
	})
})
