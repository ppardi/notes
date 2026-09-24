/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext } from '@playwright/test'

import { expect, test } from '@playwright/test'

interface SmartFolder {
	name: string
	tags: string[]
	mode: string
}

function headers(): Record<string, string> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	return {
		Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
		// without this the settings route answers 412 and nothing changes
		'OCS-APIRequest': 'true',
	}
}

/**
 * Store some smart folders and read back what the server made of them.
 *
 * Settings are stored JSON: they come back as untrusted input, and the point of
 * these tests is what survives that journey.
 *
 * @param request the request fixture
 * @param folders what to try to store
 */
async function roundTrip(request: APIRequestContext, folders: unknown): Promise<SmartFolder[]> {
	const written = await request.put('/index.php/apps/notes/settings', {
		headers: headers(),
		data: { smartFolders: folders },
	})
	expect(written.ok(), 'storing the smart folders').toBeTruthy()
	const settings = await written.json() as { smartFolders?: SmartFolder[] }
	return settings.smartFolders ?? []
}

test.describe('Smart folder settings', () => {
	test.afterEach(async ({ request }) => {
		await roundTrip(request, [])
	})

	test('keeps a well-formed folder as it was given', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ name: 'Reading', tags: ['philosophy', 'kripke'], mode: 'all' },
		])

		expect(stored).toEqual([{ name: 'Reading', tags: ['philosophy', 'kripke'], mode: 'all' }])
	})

	test('reads a tag the way a note would be read', async ({ request }) => {
		const stored = await roundTrip(request, [
			// mixed case, a hash of its own, and something no note could carry
			{ name: 'Mixed', tags: ['Philosophy', '#kripke', 'two words', 42, ''], mode: 'any' },
		])

		expect(stored).toEqual([{ name: 'Mixed', tags: ['philosophy', 'kripke'], mode: 'any' }])
	})

	test('keeps the mode to the two the filter has branches for', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ name: 'Shouting', tags: ['philosophy'], mode: 'ALL' },
			{ name: 'Nonsense', tags: ['philosophy'], mode: 'sometimes' },
			{ name: 'Missing', tags: ['philosophy'] },
		])

		expect(stored.map((folder) => folder.mode)).toEqual(['any', 'any', 'any'])
	})

	test('drops a folder that names nothing, or nothing to look for', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ name: '   ', tags: ['philosophy'], mode: 'any' },
			{ name: 'No tags', tags: [], mode: 'any' },
			{ name: 'Nothing usable', tags: ['two words'], mode: 'any' },
			{ tags: ['philosophy'], mode: 'any' },
			'not a folder at all',
			{ name: 'Survivor', tags: ['philosophy'], mode: 'any' },
		])

		expect(stored.map((folder) => folder.name)).toEqual(['Survivor'])
	})

	test('trims a name and caps its length', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ name: `  Padded  ${'x'.repeat(200)}`, tags: ['philosophy'], mode: 'any' },
		])

		expect(stored[0].name.startsWith('Padded')).toBe(true)
		expect(stored[0].name.length).toBe(128)
	})

	test('caps how many folders and how many tags each can hold', async ({ request }) => {
		const manyTags = Array.from({ length: 40 }, (_, index) => `tag${index}`)
		const many = Array.from({ length: 80 }, (_, index) => ({
			name: `Folder ${index}`,
			tags: manyTags,
			mode: 'any',
		}))

		const stored = await roundTrip(request, many)

		expect(stored).toHaveLength(64)
		expect(stored[0].tags).toHaveLength(32)
	})

	test('survives a later write that says nothing about it', async ({ request }) => {
		await roundTrip(request, [{ name: 'Reading', tags: ['philosophy'], mode: 'all' }])

		/* Settings are stored as one blob and read back through json_decode, so
		   a folder written earlier reaches validation in a different shape from
		   one that has just arrived on a request. Any other setting being
		   written is enough to send it through that path. */
		const written = await request.put('/index.php/apps/notes/settings', {
			headers: headers(),
			data: { lastViewedCategory: 'all' },
		})
		expect(written.ok(), 'writing an unrelated setting').toBeTruthy()

		const settings = await written.json() as { smartFolders?: SmartFolder[] }
		expect(settings.smartFolders).toEqual([{ name: 'Reading', tags: ['philosophy'], mode: 'all' }])
	})

	test('refuses anything that is not a list of folders', async ({ request }) => {
		expect(await roundTrip(request, 'philosophy')).toEqual([])
		expect(await roundTrip(request, 17)).toEqual([])
	})
})
