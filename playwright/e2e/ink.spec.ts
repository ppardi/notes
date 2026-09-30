/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, noteAttachment, noteContent, setNoteMode } from '../support/note.ts'

async function openInkedNote(page: Page, request: Parameters<typeof setNoteMode>[0]): Promise<number> {
	await login(page)
	await deleteAllNotesVia()
	await setNoteMode(request, 'rich')
	const noteId = await createNoteViaRequest('', 'Inked', 'Typed already.\n')
	await page.goto(`/index.php/apps/notes/note/${noteId}`)
	await expect(page.locator('.ProseMirror').first()).toBeVisible()
	return noteId
}

async function drawAndFinish(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Ink', exact: true }).click()
	const canvas = page.locator('.ink__canvas')
	await expect(canvas).toBeVisible()
	// The canvas takes no strokes until it has looked for ink already there, and
	// Done is disabled until it has. Drawing before that drops the stroke silently.
	await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

	// Draw from the middle. The canvas is fixed to the whole viewport but sits
	// inside the content area's stacking context, so the app header and the
	// navigation sidebar are painted over its top and left edges and swallow a
	// stroke that starts there.
	const box = (await canvas.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	await page.mouse.move(x, y)
	await page.mouse.down()
	await page.mouse.move(x + 100, y + 70, { steps: 10 })
	await page.mouse.up()
	// A stroke that landed is what makes Undo available.
	await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeEnabled()
	await page.getByRole('button', { name: 'Done' }).click()
}

test.describe('Ink', () => {
	test('puts an image and a link into the note', async ({ page, request }) => {
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)

		const image = new RegExp(`!\\[[^\\]]*\\]\\((\\.attachments\\.${noteId}/ink-[A-Za-z0-9_-]+\\.png)\\)`)
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toMatch(image)
		const after = await noteContent(noteId)

		expect(after).toMatch(/\]\(.*\/apps\/notes\/ink\/[A-Za-z0-9_-]+\)/)

		// The image and its link are two blocks, never one inside the other.
		expect(after).not.toMatch(/\[!\[/)
		expect(after).toMatch(/!\[[^\]]*\]\([^)]*\)\n\n\[[^\]]*\]\([^)]*\/apps\/notes\/ink\/[^)]*\)/)

		// The title stays the first line, and the ink comes after what was typed.
		expect(after.split('\n')[0]).toBe('# Inked')
		expect(after.indexOf('Typed already.')).toBeGreaterThan(-1)
		expect(after.indexOf('![')).toBeGreaterThan(after.indexOf('Typed already.'))

		// The drawing itself reached the server, and is a PNG.
		const src = image.exec(after)![1]
		const bytes = await noteAttachment(noteId, src)
		expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
	})

	test('does not delete the text that was selected', async ({ page, request }) => {
		const noteId = await openInkedNote(page, request)
		await page.getByText('Typed already.').click({ clickCount: 3 })
		await drawAndFinish(page)

		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')
		const after = await noteContent(noteId)
		expect(after.split('\n')[0]).toBe('# Inked')
		expect(after).toContain('Typed already.')
		expect(after.indexOf('![')).toBeGreaterThan(after.indexOf('Typed already.'))
	})

	test('reopens the ink from its link, with the strokes still there', async ({ page, request }) => {
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas')).toBeHidden()
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')
		const before = await noteContent(noteId)

		await page.getByRole('link', { name: 'Edit ink' }).click()
		await expect(page.locator('.ink__canvas')).toBeVisible()
		// The strokes came back, so this is the same ink and not a new block.
		// Scoped to the canvas: the editor's own toolbar has an Undo too.
		await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeEnabled()

		// Finishing again replaces the file; it must not add a second block.
		await page.getByRole('button', { name: 'Done' }).click()
		await expect(page.locator('.ink__canvas')).toBeHidden()
		await page.waitForTimeout(3000)
		expect(await noteContent(noteId)).toBe(before)
	})

	test('leaves an ordinary link to the browser, in a new tab', async ({ page, request, context }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		// A host that does not exist, answered locally, so the test needs no network.
		await context.route('https://links.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }))
		const noteId = await createNoteViaRequest('', 'Linked', '[A web page](https://links.example.test/ordinary-link)\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		const opened = context.waitForEvent('page')
		await page.getByRole('link', { name: 'A web page' }).click()
		const tab = await opened
		expect(tab.url()).toContain('ordinary-link')
		// The note itself stayed where it was, and no canvas opened.
		await expect(page.locator('.ink__canvas')).toBeHidden()
		expect(page.url()).toContain(`/apps/notes/note/${noteId}`)
	})
})
