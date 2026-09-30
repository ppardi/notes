/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia } from '../support/note.ts'

/**
 * Upload one attachment and return the name the server gave it.
 *
 * @param page the logged-in page, for its session and request token
 * @param noteId the note to attach to
 * @param name the file name to ask for
 * @param body the bytes to send
 * @param replace whether to replace a file of that name
 */
async function upload(page: Page, noteId: number, name: string, body: string, replace: boolean): Promise<string> {
	const token = await page.evaluate(() => document.head.getAttribute('data-requesttoken') ?? '')
	const url = `/index.php/apps/notes/notes/${noteId}/attachment${replace ? '?replace=1' : ''}`
	const response = await page.request.post(url, {
		headers: { requesttoken: token },
		multipart: { file: { name, mimeType: 'image/png', buffer: Buffer.from(body) } },
	})
	expect(response.ok(), `uploading ${name}`).toBeTruthy()
	return (await response.json() as { filename: string }).filename
}

test.describe('Replacing an attachment', () => {
	test('keeps the name instead of picking a free one', async ({ page }) => {
		/* Ink is saved under the name the note already points at. Without this,
		   a second save writes "ink-abc (1).png", orphans the first and forces
		   the note's markdown to be rewritten on every edit. */
		await login(page)
		await deleteAllNotesVia()
		const noteId = await createNoteViaRequest('', 'Attachments', 'body\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)

		const first = await upload(page, noteId, 'ink-abc123.png', 'one', false)
		expect(first).toBe(`.attachments.${noteId}/ink-abc123.png`)

		const replaced = await upload(page, noteId, 'ink-abc123.png', 'two', true)
		expect(replaced, 'the replaced file keeps its name').toBe(first)

		const token = await page.evaluate(() => document.head.getAttribute('data-requesttoken') ?? '')
		const read = await page.request.get(
			`/index.php/apps/notes/notes/${noteId}/attachment?path=${encodeURIComponent(first)}`,
			{ headers: { requesttoken: token } },
		)
		expect(await read.text(), 'and holds the newer bytes').toBe('two')
	})

	test('still picks a free name when not asked to replace', async ({ page }) => {
		/* Ordinary uploads must not start overwriting each other. */
		await login(page)
		await deleteAllNotesVia()
		const noteId = await createNoteViaRequest('', 'Attachments', 'body\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)

		const first = await upload(page, noteId, 'photo.png', 'one', false)
		const second = await upload(page, noteId, 'photo.png', 'two', false)
		expect(second).not.toBe(first)
	})
})
