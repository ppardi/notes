/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page, TestInfo } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNote, createNoteRevisions, createNoteViaRequest, deleteAllNotesVia, newNoteButton, noteRow, openNoteActions, setNoteMode, uniqueTitle } from '../support/note.ts'
import { NoteEditor } from '../support/sections/NoteEditor.ts'

interface EventBusWindow extends Window {
	_nc_event_bus: {
		emit: (name: string, payload: unknown) => void
	}
}

interface NodeLike {
	mtime: Date
	clone: () => NodeLike
}

function sidebar(page: Page): Locator {
	return page.locator('[data-cy-notes-sidebar]')
}

function tabButton(page: Page, tabId: string): Locator {
	return sidebar(page).locator(`#tab-button-${tabId}`)
}

function versionsList(page: Page): Locator {
	return sidebar(page).locator('[data-files-versions-versions-list]')
}

// scoped to the list rather than the sidebar: the sharing tab's element reports
// itself as its own shadow root, which sends a piercing query into a loop
function versionEntries(page: Page): Locator {
	return page.locator('[data-files-versions-versions-list] [data-files-versions-version]')
}

function subname(page: Page): Locator {
	return sidebar(page).locator('.app-sidebar-header__subname')
}

function detailRow(page: Page, label: string): Locator {
	return sidebar(page).locator('.note-info__row')
		.filter({ has: page.getByText(label, { exact: true }) })
		.locator('.note-info__value')
}

/* The notes folder itself, which the app calls Unfiled: the notes the editor
   creates land there too, so the list shows both kinds together. */
const SIDEBAR_CATEGORY = ''

/**
 * A note with a body, written straight through the API.
 *
 * Typing it is no good here: the rich editor inserts at the caret, which sits
 * on the title line, so a body typed after a title comes out merged into it.
 * These tests are about what the sidebar reads, not about typing, so the API
 * says exactly what the note holds.
 *
 * @param title the note's title
 * @param body the text under it, four words by default so the estimate is a
 *             round minute
 */
async function noteWithBody(title: string, body = 'four plain words here'): Promise<number> {
	return createNoteViaRequest(SIDEBAR_CATEGORY, title, body)
}

/**
 * Bring notes written through the API into the list.
 *
 * The app syncs on a timer, so a note written behind its back takes up to half
 * a minute to appear — long enough to spend a test's whole budget waiting for
 * its row. Reloading asks for the list at once, and lands back on the parked
 * note rather than on any of these.
 *
 * @param page the page under test
 */
async function showNewNotes(page: Page): Promise<void> {
	await page.reload()
	await expect(newNoteButton(page).first()).toBeVisible()
}

async function openSidebarFromActions(page: Page, noteId: number, action: string): Promise<void> {
	await openNoteActions(page, noteId)
	await page.getByRole('menuitem', { name: action, exact: true }).click()
	await expect(sidebar(page)).toBeVisible({ timeout: 15000 })
}

test.describe('Note sidebar', () => {
	test.beforeEach(async ({ page }) => {
		/* Every test makes the notes it needs. Left to accumulate, they pass
		   forty and the list stops showing all of them, so a note this spec
		   just made can be missing from it. */
		await deleteAllNotesVia()
		/* One note for the editor to hold, so that it does not reach for the
		   notes the tests make: the rich editor reads a note's body through the
		   Text app, which both fills the store behind a test that wants it
		   empty and locks the file against anything written from outside. */
		await createNoteViaRequest(SIDEBAR_CATEGORY, 'Parked')
		await login(page)
		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page).first()).toBeVisible()
		await expect(new NoteEditor(page).surface).toContainText('Parked')
	})

	test('opens the versions tab from the actions menu', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('versions', testInfo))

		await openSidebarFromActions(page, noteId, 'Versions')

		await expect(tabButton(page, 'files_versions')).toHaveAttribute('aria-selected', 'true')
		await expect(versionsList(page)).toBeAttached({ timeout: 15000 })
	})

	test('reloads the versions list when the note is updated', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-reload', testInfo))

		await openSidebarFromActions(page, noteId, 'Versions')
		await expect(versionEntries(page).first()).toBeVisible({ timeout: 15000 })

		let reloads = 0
		page.on('request', (request) => {
			if (request.method() === 'PROPFIND' && request.url().includes('/remote.php/dav/versions/')) {
				reloads += 1
			}
		})

		// what files_versions hands out once it has restored a version
		await page.evaluate(() => {
			const tab = document.querySelector('files-versions_sidebar-tab') as unknown as { node: NodeLike }
			const node = tab.node.clone()
			node.mtime = new Date(node.mtime.getTime() - 60000)
			;(window as unknown as EventBusWindow)._nc_event_bus.emit('files:node:updated', node)
		})

		await expect.poll(() => reloads, { timeout: 15000 }).toBeGreaterThan(0)
	})

	test('keeps the editor behind a spinner while a restored version loads', async ({ page }) => {
		const noteId = await createNoteRevisions([
			'Restore spinner\n\nrevision one',
			'Restore spinner\n\nrevision two',
		])
		// the editor has to hold this note, not whichever one was open before
		await page.goto(`/index.php/apps/notes/note/${noteId}`)

		// hold the restore long enough to observe what the editor does meanwhile
		await page.route('**/remote.php/dav/versions/**', async (route) => {
			if (route.request().method() === 'MOVE') {
				await new Promise((resolve) => setTimeout(resolve, 3000))
			}
			await route.continue()
		})

		await openSidebarFromActions(page, noteId, 'Versions')

		const entries = versionEntries(page)
		await expect(entries.nth(1)).toBeVisible({ timeout: 15000 })

		// Text brings a second element carrying the same class, so this names ours
		const editor = page.locator('.text-editor, .note-editor').first()
		const spinner = page.locator('#app-content-vue.loading, .text-editor-wrapper.loading')
		await expect(editor).toBeVisible()

		await entries.last().hover()
		await entries.last().locator('.action-item__menutoggle').first().click()
		await page.getByRole('menuitem', { name: 'Restore version' }).click()

		// the editor is gone while the restore runs, so it cannot be typed into
		await expect(spinner).toBeVisible()
		await expect(editor).toBeHidden()

		await expect(editor).toBeVisible({ timeout: 20000 })

		/* What the note ends up holding is deliberately not asserted here. The
		   Text app locks a note it has open, and a restore is a write from
		   outside that lock: it comes back as 423 and the note keeps the version
		   it had. This is about the editor not being left behind the spinner,
		   which is what happens either way. */
	})

	test('gives the editor back when a restore fails', async ({ page }) => {
		const noteId = await createNoteRevisions([
			'Restore failure\n\nrevision one',
			'Restore failure\n\nrevision two',
		])
		await page.goto(`/index.php/apps/notes/note/${noteId}`)

		await page.route('**/remote.php/dav/versions/**', async (route) => {
			if (route.request().method() === 'MOVE') {
				await new Promise((resolve) => setTimeout(resolve, 1000))
				await route.fulfill({ status: 500 })
				return
			}
			await route.continue()
		})

		await openSidebarFromActions(page, noteId, 'Versions')

		const entries = versionEntries(page)
		await expect(entries.nth(1)).toBeVisible({ timeout: 15000 })

		const editor = page.locator('.text-editor, .note-editor').first()
		await expect(editor).toBeVisible()

		await entries.last().hover()
		await entries.last().locator('.action-item__menutoggle').first().click()
		await page.getByRole('menuitem', { name: 'Restore version' }).click()

		await expect(page.locator('#app-content-vue.loading, .text-editor-wrapper.loading')).toBeVisible()

		// a failed restore must not leave the editor behind the spinner
		await expect(editor).toBeVisible({ timeout: 15000 })
	})

	test('shows the size, the modification date and the owner of the note', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-subname', testInfo))

		await openSidebarFromActions(page, noteId, 'Share')

		await expect(subname(page)).toBeVisible({ timeout: 15000 })
		await expect(subname(page)).toContainText(/\d+(\.\d+)?\s?(B|KB|MB|GB)/)
		await expect(subname(page).locator('[data-timestamp]')).toBeVisible()
		await expect(subname(page).locator('.user-bubble__content')).toContainText('admin')
	})

	test('renders the allow-listed tabs and the details one only', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-tabs', testInfo))

		await openSidebarFromActions(page, noteId, 'Share')

		await expect(tabButton(page, 'sharing')).toBeVisible()
		await expect(tabButton(page, 'files_versions')).toBeVisible()
		await expect(tabButton(page, 'notes-info')).toBeVisible()
		await expect(sidebar(page).getByRole('tab')).toHaveCount(3)
	})

	test('switches between the sharing and versions tabs', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-switch', testInfo))

		await openSidebarFromActions(page, noteId, 'Share')
		await expect(page.getByText('Internal shares')).toBeVisible({ timeout: 15000 })

		await tabButton(page, 'files_versions').click()
		await expect(tabButton(page, 'files_versions')).toHaveAttribute('aria-selected', 'true')
		await expect(versionsList(page)).toBeAttached({ timeout: 15000 })

		await tabButton(page, 'sharing').click()
		await expect(tabButton(page, 'sharing')).toHaveAttribute('aria-selected', 'true')
		await expect(page.getByText('Internal shares')).toBeVisible()
	})

	test('fills the sharing icon only while its tab is active', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-icons', testInfo))

		await openSidebarFromActions(page, noteId, 'Share')

		await expect(tabButton(page, 'sharing').locator('.share-variant-icon')).toBeVisible()
		await expect(tabButton(page, 'sharing').locator('.share-variant-outline-icon')).toHaveCount(0)

		await tabButton(page, 'files_versions').click()

		await expect(tabButton(page, 'sharing').locator('.share-variant-outline-icon')).toBeVisible()
		await expect(tabButton(page, 'sharing').locator('.share-variant-icon')).toHaveCount(0)
	})

	test('lines the tab icons up with each other', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-align', testInfo))

		await openSidebarFromActions(page, noteId, 'Share')
		await expect(tabButton(page, 'files_versions')).toBeVisible()

		const icons = await page.evaluate(() => {
			const box = (id: string) => {
				const selector = `#tab-button-${id} :is(.icon-vue, .material-design-icon)`
				const { y, height } = document.querySelector(selector)!.getBoundingClientRect()
				return { y, height }
			}
			return { sharing: box('sharing'), versions: box('files_versions') }
		})

		expect(icons.versions.y).toBeCloseTo(icons.sharing.y, 0)
		expect(icons.versions.height).toBeCloseTo(icons.sharing.height, 0)
	})

	test('falls back to the first tab when the requested one is unavailable', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-fallback', testInfo))

		await page.evaluate((id) => {
			(window as unknown as EventBusWindow)._nc_event_bus
				.emit('notes:sidebar:open', { noteId: id, tab: 'not-a-note-sidebar-tab' })
		}, noteId)

		await expect(sidebar(page)).toBeVisible({ timeout: 15000 })
		await expect(tabButton(page, 'sharing')).toHaveAttribute('aria-selected', 'true')
		await expect(page.getByText('Internal shares')).toBeVisible({ timeout: 15000 })
	})

	test('opens the details tab from the actions menu', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-details', testInfo))

		await openSidebarFromActions(page, noteId, 'Details')

		await expect(tabButton(page, 'notes-info')).toHaveAttribute('aria-selected', 'true')
		await expect(detailRow(page, 'Category')).toHaveText('Unfiled')
		await expect(detailRow(page, 'Path')).toContainText('.md')
	})

	test('fills the details icon only while its tab is active', async ({ page }, testInfo: TestInfo) => {
		const noteId = await createNote(page, uniqueTitle('sidebar-details-icon', testInfo))

		await openSidebarFromActions(page, noteId, 'Details')

		await expect(tabButton(page, 'notes-info').locator('.information-icon')).toBeVisible()
		await expect(tabButton(page, 'notes-info').locator('.information-outline-icon')).toHaveCount(0)

		await tabButton(page, 'sharing').click()

		await expect(tabButton(page, 'notes-info').locator('.information-outline-icon')).toBeVisible()
		await expect(tabButton(page, 'notes-info').locator('.information-icon')).toHaveCount(0)
	})

	test('estimates the reading time from the note body', async ({ page }, testInfo: TestInfo) => {
		const noteId = await noteWithBody(uniqueTitle('sidebar-reading', testInfo))
		await showNewNotes(page)

		await openSidebarFromActions(page, noteId, 'Details')

		await expect(detailRow(page, 'Reading time')).toHaveText('1 minute')
	})

	test('loads the body of a note that has never been opened', async ({ page }, testInfo: TestInfo) => {
		const noteId = await noteWithBody(uniqueTitle('sidebar-body', testInfo))
		// never opened, so the store holds no body and the tab has to fetch it
		await showNewNotes(page)

		await openSidebarFromActions(page, noteId, 'Share')
		await tabButton(page, 'notes-info').click()

		await expect(detailRow(page, 'Reading time')).toHaveText('1 minute', { timeout: 15000 })
	})

	test('loads the body of the note it moves to while another body is still on its way', async ({ page }, testInfo: TestInfo) => {
		const held = await noteWithBody(uniqueTitle('sidebar-held', testInfo))
		const wanted = await noteWithBody(uniqueTitle('sidebar-wanted', testInfo))

		await showNewNotes(page)
		// the parked note carries the route, so the editor has loaded neither of
		// the two bodies the tab is after

		// keep the first body on its way while the sidebar is sent to the second
		await page.route(`**/apps/notes/notes/${held}`, async (route) => {
			if (route.request().method() !== 'GET') {
				return route.continue()
			}
			await new Promise((resolve) => setTimeout(resolve, 5000))
			await route.continue()
		})

		await openSidebarFromActions(page, held, 'Details')
		await openSidebarFromActions(page, wanted, 'Details')

		await expect(detailRow(page, 'Reading time')).toHaveText('1 minute', { timeout: 15000 })
	})

	test('follows the note the list navigates to', async ({ page }, testInfo: TestInfo) => {
		const first = await noteWithBody(uniqueTitle('sidebar-first', testInfo))
		const second = await noteWithBody(uniqueTitle('sidebar-second', testInfo))
		await showNewNotes(page)

		await openSidebarFromActions(page, second, 'Details')
		const shown = await detailRow(page, 'Path').textContent()

		await noteRow(page, first).getByRole('link').first().click()

		await expect(page).toHaveURL(new RegExp(`/note/${first}(\\?.*)?$`))
		await expect(detailRow(page, 'Path')).not.toHaveText(shown ?? '')
	})

	test('marks the reading time unavailable when the note body cannot be loaded', async ({ page }, testInfo: TestInfo) => {
		const noteId = await noteWithBody(uniqueTitle('sidebar-unreadable', testInfo))

		// never opened, so the tab has to fetch the body — and cannot
		await page.route(
			`**/apps/notes/notes/${noteId}`,
			(route) => route.request().method() === 'GET' ? route.abort() : route.continue(),
		)
		await page.goto('/index.php/apps/notes/')

		await openSidebarFromActions(page, noteId, 'Details')

		const readingTime = detailRow(page, 'Reading time')
		await expect(readingTime).toHaveText(/^—/)
		await expect(readingTime.locator('.hidden-visually'))
			.toHaveText('The note content could not be loaded.')
	})

	// The editor's own actions menu only exists in the markdown editor; the rich
	// editor brings its own menu bar.
	test.describe('markdown editor', () => {
		test.beforeEach(async ({ page, request }) => {
			await setNoteMode(request, 'edit')
			await page.reload()
		})

		test.afterEach(async ({ request }) => {
			await setNoteMode(request, 'rich')
		})

		test('opens the sidebar from the editor actions menu', async ({ page }, testInfo: TestInfo) => {
			await createNote(page, uniqueTitle('sidebar-editor-menu', testInfo))

			await page.locator('.action-buttons .action-item__menutoggle').first().click()
			await page.getByRole('menuitem', { name: 'Open sidebar', exact: true }).click()

			await expect(sidebar(page)).toBeVisible({ timeout: 15000 })
			await expect(tabButton(page, 'sharing')).toHaveAttribute('aria-selected', 'true')
			await expect(page.getByText('Internal shares')).toBeVisible({ timeout: 15000 })
		})
	})
})
