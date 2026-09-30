/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, deleteNoteAttachment, noteAttachment, noteContent, replaceNoteAttachment, setNoteMode } from '../support/note.ts'

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

		await page.getByRole('link', { name: 'Edit ink' }).click()
		await expect(page.locator('.ink__canvas')).toBeVisible()
		// The strokes came back, so this is the same ink and not a new block.
		// Scoped to the canvas: the editor's own toolbar has an Undo too.
		await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeEnabled()

		// Finishing again replaces the file; it must not add a second block.
		// Asserted on the editor's DOM, which changes at once, rather than on the
		// file, which a debounced autosave writes whenever it likes.
		await page.getByRole('button', { name: 'Done' }).click()
		await expect(page.locator('.ink__canvas')).toBeHidden()
		// By alt text: the editor draws other images of its own, such as the
		// icon beside a link.
		await expect(page.locator('.ProseMirror img[alt="Ink"]')).toHaveCount(1)
		await expect(page.getByRole('link', { name: 'Edit ink' })).toHaveCount(1)
	})

	test('reopens the ink when the ink itself is tapped', async ({ page, request }) => {
		await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas')).toBeHidden()

		await page.locator('figure[data-component="image-view"]').click()
		await expect(page.locator('.ink__canvas')).toBeVisible()
		// The strokes came back, so the tap reached the same ink and not a new block.
		await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeEnabled()
	})

	test('leaves an ordinary image alone when it is tapped', async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		const noteId = await createNoteViaRequest('', 'Photo', 'Typed already.\n\n![holiday](.attachments.1/holiday.png)\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		// Only a tap on ink is claimed. A photo has to keep doing what Text does
		// with a photo, so no canvas may open for it.
		const photo = page.locator('figure[data-component="image-view"]')
		await expect(photo).toHaveCount(1)
		await photo.click()
		await expect(page.locator('.ink__canvas')).toBeHidden()
	})

	test('leaves ink-shaped images from elsewhere alone when they are tapped', async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		// Named like ink, but one is another note's and one is on another host.
		const noteId = await createNoteViaRequest('', 'Foreign ink', 'Typed already.\n\n![other](.attachments.99999/ink-abc123.png)\n\n![web](https://links.example.test/ink-abc123.png)\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		const figures = page.locator('figure[data-component="image-view"]')
		await expect(figures).toHaveCount(2)
		await figures.nth(0).click()
		await expect(page.locator('.ink__canvas')).toBeHidden()
		await figures.nth(1).click()
		await expect(page.locator('.ink__canvas')).toBeHidden()
	})

	test('keeps exactly one tap listener across the editor being closed and reopened', async ({ page, request }) => {
		// Count the live capture-phase click listeners the component registers.
		// A second registration, or one left behind on a closed editor, is what
		// the remove-before-add and the remove-on-destroy are there to prevent.
		await page.addInitScript(() => {
			const live: Array<[EventTarget, unknown]> = []
			const add = EventTarget.prototype.addEventListener
			const remove = EventTarget.prototype.removeEventListener
			const isOurs = (type: string, listener: unknown, options: unknown): boolean => type === 'click'
				&& (options === true || (typeof options === 'object' && options !== null && (options as AddEventListenerOptions).capture === true))
				&& typeof listener === 'function'
				&& listener.name.includes('onEditorClick')
			EventTarget.prototype.addEventListener = function(type: string, listener: any, options?: any) {
				if (isOurs(type, listener, options) && !live.some(([t, l]) => t === this && l === listener)) {
					live.push([this, listener])
				}
				return add.call(this, type, listener, options)
			}
			EventTarget.prototype.removeEventListener = function(type: string, listener: any, options?: any) {
				if (isOurs(type, listener, options)) {
					const at = live.findIndex(([t, l]) => t === this && l === listener)
					if (at !== -1) {
						live.splice(at, 1)
					}
				}
				return remove.call(this, type, listener, options)
			}
			;(window as any).__inkTapListeners = () => live.length
		})

		const noteId = await openInkedNote(page, request)
		const listeners = async (): Promise<number> => await page.evaluate(() => (window as any).__inkTapListeners())
		await expect.poll(listeners).toBe(1)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas')).toBeHidden()

		// The close-and-reopen dance other parts of the app run around a write.
		await page.evaluate((id) => (window as any)._nc_event_bus.emit('notes:editor:close', { noteId: id }), noteId)
		await expect.poll(listeners).toBe(0)
		await page.evaluate((id) => (window as any)._nc_event_bus.emit('notes:editor:reopen', { noteId: id }), noteId)
		await expect.poll(listeners).toBe(1)

		// And the tap still works on the recreated editor.
		await page.locator('figure[data-component="image-view"]').click()
		await expect(page.locator('.ink__canvas')).toBeVisible()
	})

	test('records a stroke started in the top-left corner of the canvas', async ({ page, request }) => {
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		await expect(page.locator('.ink__canvas')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// Where the header and the sidebar used to be painted over the canvas.
		const box = (await page.locator('.ink__canvas').boundingBox())!
		await page.mouse.move(box.x + 50, box.y + 50)
		await page.mouse.down()
		await page.mouse.move(box.x + 150, box.y + 120, { steps: 10 })
		await page.mouse.up()
		await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeEnabled()
	})

	test('leaves an ordinary link to the browser, in a new tab', async ({ page, request, context }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		// A host that does not exist, answered locally, so the test needs no network.
		await context.route('https://links.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }))
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

	test('leaves an ink-shaped link on another host to the browser', async ({ page, request, context }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		await context.route('https://links.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }))
		const noteId = await createNoteViaRequest('', 'Foreign', '[Someone else\'s ink](https://links.example.test/index.php/apps/notes/ink/abc123)\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		const opened = context.waitForEvent('page')
		await page.getByRole('link', { name: 'Someone else\'s ink' }).click()
		const tab = await opened
		expect(tab.url()).toBe('https://links.example.test/index.php/apps/notes/ink/abc123')
		// It is another server's ink, not ours: no canvas opens here.
		await expect(page.locator('.ink__canvas')).toBeHidden()
	})

	test('says so when the ink a link points at is gone', async ({ page, request }) => {
		/* Deleting the picture leaves the link, because Text will not keep a
		   link attached to an image. Following it must not open a canvas that
		   would write a file the note no longer mentions. */
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas')).toBeHidden()
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')

		const path = (await noteContent(noteId)).match(/\.attachments\.\d+\/(ink-[A-Za-z0-9_-]+\.png)/)![0]
		await deleteNoteAttachment(noteId, path)

		await page.getByRole('link', { name: 'Edit ink' }).click()
		await expect(page.locator('.ink__canvas')).toBeHidden()
		await expect(page.getByText(/picture for this ink could not be found/i)).toBeVisible()
		// A missing file is not proof of deletion, and the link may be all that is left.
		await expect(page.getByText(/no longer|delete the link/i)).toHaveCount(0)
	})

	test('keeps the image and the link through an edit', async ({ page, request }) => {
		/* Text discards a link wrapped around an image on the first save. These
		   are two blocks precisely so they survive; assert that they do. */
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas')).toBeHidden()

		await page.locator('.ProseMirror').click()
		await page.keyboard.press('Control+End')
		await page.keyboard.type(' more typing')
		await expect.poll(async () => (await noteContent(noteId)).includes('more typing'), { timeout: 15000 }).toBe(true)

		const after = await noteContent(noteId)
		expect(after).toMatch(/!\[[^\]]*\]\(\.attachments\.\d+\/ink-[A-Za-z0-9_-]+\.png\)/)
		expect(after).toMatch(/\]\(.*\/apps\/notes\/ink\/[A-Za-z0-9_-]+\)/)
	})

	test('says so when the ink cannot be read at all', async ({ page, request }) => {
		/* Not a 404 - a server that answers badly. loadInk rethrows anything
		   that is not "gone", and nothing awaits openInk, so without a catch
		   this is an unhandled rejection and a canvas that never opens. */
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas')).toBeHidden()
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')

		await page.route('**/attachment?*', (route) => route.fulfill({ status: 500 }))
		await page.getByRole('link', { name: 'Edit ink' }).click()
		await expect(page.locator('.ink__canvas')).toBeHidden()
		await expect(page.getByText(/could not be opened/i)).toBeVisible()
		// Not told the ink is gone: it may well still be there.
		await expect(page.getByText(/could not be found|no longer/i)).toHaveCount(0)
	})

	test('shows the picture and refuses to replace it when its strokes cannot be read', async ({ page, request }) => {
		/* A preview, or a copy that lost its metadata chunk, is still the only
		   handwriting there is. Done would replace the file by name with a
		   blank page, so the canvas must show it, say so, and not save. */
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas')).toBeHidden()
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')

		const path = (await noteContent(noteId)).match(/\.attachments\.\d+\/(ink-[A-Za-z0-9_-]+\.png)/)!
		// A valid one-pixel PNG with no stroke chunk in it.
		const plain = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
		await replaceNoteAttachment(noteId, path[1], plain)

		await page.getByRole('link', { name: 'Edit ink' }).click()
		await expect(page.locator('.ink__canvas')).toBeVisible()
		await expect(page.locator('.ink__backdrop')).toBeVisible()
		await expect(page.getByText(/strokes of this ink could not be read/i)).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled()

		// Drawing is refused too, so there is nothing to save in the first place.
		const box = (await page.locator('.ink__canvas').boundingBox())!
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 70, { steps: 5 })
		await page.mouse.up()
		await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeDisabled()

		await page.getByRole('button', { name: 'Cancel' }).click()
		await expect(page.locator('.ink__canvas')).toBeHidden()
		expect((await noteAttachment(noteId, path[0])).equals(plain), 'the file on disk is untouched').toBe(true)
	})
})
