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

	const box = (await canvas.boundingBox())!
	await page.mouse.move(box.x + 50, box.y + 50)
	await page.mouse.down()
	await page.mouse.move(box.x + 150, box.y + 120, { steps: 10 })
	await page.mouse.up()
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
})
