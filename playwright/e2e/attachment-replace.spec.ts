/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Page } from '@playwright/test'

import { expect, request as playwrightRequest, test } from '@playwright/test'
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

/**
 * Run some calls as the second seeded user, on a context of its own so that no
 * session cookie gets in the way of the Authorization header.
 *
 * @param work what to do as that user
 * @return whatever the work returns
 */
async function asSecondUser<T>(work: (api: APIRequestContext) => Promise<T>): Promise<T> {
	const api = await playwrightRequest.newContext({
		baseURL: process.env.BASE_URL ?? 'http://localhost:8089',
		extraHTTPHeaders: {
			Authorization: `Basic ${Buffer.from('test:test').toString('base64')}`,
			'OCS-APIRequest': 'true',
		},
	})
	try {
		return await work(api)
	} finally {
		await api.dispose()
	}
}

async function asAdmin<T>(work: (api: APIRequestContext) => Promise<T>): Promise<T> {
	const user = process.env.NC_USER ?? 'admin'
	const api = await playwrightRequest.newContext({
		baseURL: process.env.BASE_URL ?? 'http://localhost:8089',
		extraHTTPHeaders: {
			Authorization: `Basic ${Buffer.from(`${user}:${process.env.NC_PASS ?? 'admin'}`).toString('base64')}`,
			'OCS-APIRequest': 'true',
		},
	})
	try {
		return await work(api)
	} finally {
		await api.dispose()
	}
}

async function setNotesPath(api: APIRequestContext, notesPath: string): Promise<void> {
	const response = await api.put('/index.php/apps/notes/api/v1/settings', { data: { notesPath } })
	expect(response.ok(), `pointing the notes folder at ${notesPath}`).toBeTruthy()
}

test.describe('Overwriting an attachment of a note that is only shared to read', () => {
	test('is refused, and the file keeps what it held', async () => {
		/* Replacing overwrites, which is not something a reader of a shared
		   note may do. Deleting an attachment already asks; overwriting must. */
		const category = `Read only ${Date.now()}`
		const noteId = await createNoteViaRequest(category, 'Shared to read', 'body\n')
		const path = `.attachments.${noteId}/ink-shared.png`
		const attachment = `/index.php/apps/notes/notes/${noteId}/attachment`
		const file = (name: string, body: string) => ({ file: { name, mimeType: 'image/png', buffer: Buffer.from(body) } })

		await asAdmin(async (admin) => {
			const created = await admin.post(attachment, { multipart: file('ink-shared.png', 'original') })
			expect(created.ok(), 'the owner adds the attachment').toBeTruthy()
			const shared = await admin.post('/ocs/v2.php/apps/files_sharing/api/v1/shares', {
				form: { path: `/Notes/${category}`, shareType: '0', shareWith: 'test', permissions: '1' },
			})
			expect(shared.ok(), 'sharing the folder read-only').toBeTruthy()
		})

		try {
			const status = await asSecondUser(async (reader) => {
				await setNotesPath(reader, category)
				const listed = await (await reader.get('/index.php/apps/notes/api/v1/notes?pruneBefore=0')).json() as Array<{ id: number, readonly: boolean }>
				expect(listed.find((note) => note.id === noteId)?.readonly, 'the reader really has it read-only').toBe(true)
				const replaced = await reader.post(`${attachment}?replace=1`, { multipart: file('ink-shared.png', 'overwritten') })
				return replaced.status()
			})
			expect(status, 'the overwrite is refused as forbidden').toBe(403)

			const after = await asAdmin(async (admin) => (await admin.get(`${attachment}?path=${encodeURIComponent(path)}`)).text())
			expect(after, 'and the original is intact').toBe('original')
		} finally {
			await asSecondUser((reader) => setNotesPath(reader, 'Notes'))
		}
	})

	test('does not change how an ordinary upload is answered', async () => {
		/* The guard is on the overwrite only: adding a file to one's own note
		   is what it always was. */
		const noteId = await createNoteViaRequest('', 'Own note', 'body\n')
		const created = await asAdmin((admin) => admin.post(`/index.php/apps/notes/notes/${noteId}/attachment`, {
			multipart: { file: { name: 'plain.png', mimeType: 'image/png', buffer: Buffer.from('x') } },
		}))
		expect(created.status()).toBe(200)
	})
})

test.describe('Reading an attachment that is not there', () => {
	test('answers not found for a file that is missing', async () => {
		const noteId = await createNoteViaRequest('', 'No such file', 'body\n')
		const response = await asAdmin((admin) => admin.get(`/index.php/apps/notes/notes/${noteId}/attachment?path=${encodeURIComponent(`.attachments.${noteId}/ink-gone.png`)}`))
		expect(response.status()).toBe(404)
	})

	test('answers not found for a note that is missing', async () => {
		const response = await asAdmin((admin) => admin.get('/index.php/apps/notes/notes/2147483000/attachment?path=ink-x.png'))
		expect(response.status()).toBe(404)
	})

	test('does not call a server failure "not found"', async () => {
		/* The client takes a 404 to mean the picture was deleted and offers to
		   remove the link. A broken notes folder says nothing of the sort, so it
		   must not be answered as though it did. Pointing the folder at a plain
		   file is how to break it without touching anyone else's notes. */
		const name = `not-a-folder-${Date.now()}.txt`
		const put = await asSecondUser((reader) => reader.put(`/remote.php/dav/files/test/${name}`, { data: 'x' }))
		expect(put.ok(), 'creating the plain file').toBeTruthy()
		try {
			const status = await asSecondUser(async (reader) => {
				await setNotesPath(reader, name)
				const response = await reader.get('/index.php/apps/notes/notes/1/attachment?path=ink-x.png')
				return response.status()
			})
			expect(status, 'a failure that is not about the file').toBe(500)
		} finally {
			await asSecondUser(async (reader) => {
				await setNotesPath(reader, 'Notes')
				await reader.delete(`/remote.php/dav/files/test/${name}`)
			})
		}
	})
})
