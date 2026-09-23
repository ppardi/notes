/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'

import { expect, request as playwrightRequest } from '@playwright/test'
import { NoteEditor } from './sections/NoteEditor.ts'

export function uniqueTitle(prefix: string, testInfo: TestInfo): string {
	return `Playwright ${prefix} ${testInfo.parallelIndex}-${Date.now()}`
}

function apiUser(): string {
	return process.env.NC_USER ?? 'admin'
}

/**
 * Run some API calls on a request context with an empty cookie jar.
 *
 * A context carrying a Nextcloud session cookie is answered as a session
 * request, and WebDAV then refuses it for want of a CSRF token however good the
 * Authorization header is. A context of its own keeps that header the only
 * thing authenticating these calls.
 *
 * @param work what to do with the context
 * @return whatever the work returns
 */
async function onOwnContext<T>(work: (api: APIRequestContext) => Promise<T>): Promise<T> {
	const api = await playwrightRequest.newContext({
		baseURL: process.env.BASE_URL ?? 'http://localhost:8089',
	})
	try {
		return await work(api)
	} finally {
		await api.dispose()
	}
}

function apiHeaders(): Record<string, string> {
	const password = process.env.NC_PASS ?? 'admin'
	return { Authorization: `Basic ${Buffer.from(`${apiUser()}:${password}`).toString('base64')}` }
}

/**
 * Create a note and rewrite it through WebDAV until it has one version per
 * given revision. Writing goes around the app on purpose, so the note keeps its
 * file name instead of being retitled from the changed content.
 *
 * @param revisions The contents to write, oldest first
 * @return The id of the created note
 */
export async function createNoteRevisions(revisions: string[]): Promise<number> {
	expect(revisions.length, 'revisions to write').toBeGreaterThan(0)

	return onOwnContext(async (request) => {
		const created = await request.post('/index.php/apps/notes/api/v1/notes', {
			headers: apiHeaders(),
			data: { content: revisions[0] },
		})
		expect(created.ok(), 'creating the note').toBeTruthy()

		const note = await created.json()
		const path = note.internalPath.split('/').map(encodeURIComponent).join('/')

		for (const content of revisions.slice(1)) {
			// recent versions are thinned out to one per two seconds
			await new Promise((resolve) => setTimeout(resolve, 3500))
			const written = await request.put(`/remote.php/dav/files/${apiUser()}${path}`, {
				headers: apiHeaders(),
				data: content,
			})
			expect(written.ok(), `writing a revision (HTTP ${written.status()})`).toBeTruthy()
		}

		return note.id as number
	})
}

/**
 * Remove every note, on a request context of its own.
 *
 * @see onOwnContext for why these calls do not use the page's own context
 */
export async function deleteAllNotesVia(): Promise<void> {
	return onOwnContext(async (request) => {
		const headers = apiHeaders()
		const response = await request.get('/index.php/apps/notes/api/v1/notes', { headers })
		expect(response.ok()).toBeTruthy()

		for (const note of await response.json()) {
			const deletion = await request.delete(`/index.php/apps/notes/api/v1/notes/${note.id}`, { headers })
			expect(deletion.ok(), `deleting note ${note.id}`).toBeTruthy()
		}
	})
}

/**
 * Create a note through the API, on a request context of its own.
 *
 * @param category The category to file it in
 * @param title The note's title
 * @param body Text to put under the title
 * @return The id of the created note
 */
export async function createNoteViaRequest(category: string, title: string, body = ''): Promise<number> {
	return onOwnContext(async (request) => {
		const response = await request.post('/index.php/apps/notes/api/v1/notes', {
			headers: apiHeaders(),
			data: { category, title, content: `# ${title}\n\n${body}` },
		})
		expect(response.ok(), `creating note in "${category}"`).toBeTruthy()
		return (await response.json() as { id: number }).id
	})
}

/**
 * Switch the editor the app renders: `rich`, `edit` or `preview`.
 *
 * Takes the isolated `request` fixture rather than `page.request`, whose basic
 * auth would replace the session cookie the browser is logged in with.
 *
 * @param request The request fixture to use
 * @param mode The editor mode to switch to
 */
export async function setNoteMode(request: APIRequestContext, mode: string): Promise<void> {
	const response = await request.put('/index.php/apps/notes/api/v1/settings', {
		headers: apiHeaders(),
		data: { noteMode: mode },
	})
	expect(response.ok(), `switching to the ${mode} editor`).toBeTruthy()
}

export function currentNoteId(page: Page): number | null {
	const match = page.url().match(/\/note\/(\d+)(?:\?.*)?$/)
	return match ? Number(match[1]) : null
}

export function newNoteButton(page: Page): Locator {
	return page.getByRole('button', { name: 'New note', exact: true })
}

export function noteRow(page: Page, noteId: number): Locator {
	return page.locator(`a[href$="/note/${noteId}"], a[href*="/note/${noteId}?"]`).first()
		.locator('xpath=ancestor::li[1]')
}

/**
 * Wait until the list shows a note under the title just typed into it.
 *
 * The rich editor's file is written by the Text app rather than by Notes, and
 * a note is retitled from the file, so the title in the list can lag several
 * seconds behind the typing.
 *
 * @param page The page under test
 * @param noteId The note that was typed into
 * @param title The title it should end up under
 */
export async function expectTitled(page: Page, noteId: number, title: string): Promise<void> {
	await expect(noteRow(page, noteId)).toContainText(title, { timeout: 20000 })
}

export async function openNoteActions(page: Page, noteId: number): Promise<Locator> {
	const row = noteRow(page, noteId)
	await row.hover()
	await row.locator('.action-item__menutoggle').click()
	return row
}

export async function waitForNoteRoute(page: Page, previousNoteId: number | null): Promise<number> {
	await expect.poll(() => currentNoteId(page)).not.toBe(previousNoteId)

	const noteId = currentNoteId(page)
	if (noteId === null || noteId === previousNoteId) {
		throw new Error('Expected to navigate to a note route')
	}

	return noteId
}

/**
 * Remove every note of the logged in user, so the app lands on the welcome screen.
 *
 * @param page The page object to use
 */
export async function deleteAllNotes(page: Page): Promise<void> {
	const headers = apiHeaders()

	const response = await page.request.get('/index.php/apps/notes/api/v1/notes', { headers })
	expect(response.ok()).toBeTruthy()

	for (const note of await response.json()) {
		const deletion = await page.request.delete(`/index.php/apps/notes/api/v1/notes/${note.id}`, { headers })
		expect(deletion.ok(), `deleting note ${note.id}`).toBeTruthy()
	}
}

export async function createNote(page: Page, title: string): Promise<number> {
	const previousNoteId = currentNoteId(page)
	await newNoteButton(page).click()
	const noteId = await waitForNoteRoute(page, previousNoteId)

	const editor = new NoteEditor(page)
	await editor.type(title)
	await editor.expectText(title)

	return noteId
}

/**
 * Create a note straight through the API, skipping the editor.
 *
 * The title has to be explicit: given only content, the API files the note as
 * "New note", which no search for its text would ever find.
 *
 * @param page The page whose request context (and session) to use
 * @param category The category to file it in
 * @param title The note's title
 * @param body Text to put under the title
 */
export async function createNoteViaApi(page: Page, category: string, title: string, body = ''): Promise<number> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const headers = { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
	const response = await page.request.post('/index.php/apps/notes/api/v1/notes', {
		headers,
		data: { category, title, content: `# ${title}\n\n${body}` },
	})
	expect(response.ok(), `creating note in "${category}"`).toBeTruthy()
	return (await response.json() as { id: number }).id
}
