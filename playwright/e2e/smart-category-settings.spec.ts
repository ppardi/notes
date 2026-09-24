/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext } from '@playwright/test'

import { expect, test } from '@playwright/test'

interface SmartCategory {
	id: string
	name: string
	tags: string[]
	mode: string
	parent: string
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
 * Store some smart categories and read back what the server made of them.
 *
 * Settings are stored JSON: they come back as untrusted input, and the point of
 * these tests is what survives that journey.
 *
 * @param request the request fixture
 * @param categories what to try to store
 */
async function roundTrip(request: APIRequestContext, categories: unknown): Promise<SmartCategory[]> {
	const written = await request.put('/index.php/apps/notes/settings', {
		headers: headers(),
		data: { smartCategories: categories },
	})
	expect(written.ok(), 'storing the smart categories').toBeTruthy()
	const settings = await written.json() as { smartCategories?: SmartCategory[] }
	return settings.smartCategories ?? []
}

test.describe('Smart category settings', () => {
	test.afterEach(async ({ request }) => {
		await roundTrip(request, [])
	})

	test('keeps a well-formed record as it was given', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ id: 'abc123', name: 'Reading', tags: ['philosophy', 'kripke'], mode: 'all', parent: 'Work' },
		])

		expect(stored).toEqual([
			{ id: 'abc123', name: 'Reading', tags: ['philosophy', 'kripke'], mode: 'all', parent: 'Work' },
		])
	})

	test('drops a record with no usable id, and refuses a duplicate one', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ name: 'No id', tags: ['philosophy'], mode: 'any', parent: '' },
			{ id: '   ', name: 'Blank id', tags: ['philosophy'], mode: 'any', parent: '' },
			{ id: 'keep', name: 'First', tags: ['philosophy'], mode: 'any', parent: '' },
			{ id: 'keep', name: 'Second', tags: ['kripke'], mode: 'any', parent: '' },
		])

		expect(stored.map((entry) => entry.name)).toEqual(['First'])
	})

	test('reads a parent the way a category path is read', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ id: 'a', name: 'Padded', tags: ['philosophy'], mode: 'any', parent: ' Work / Projects / ' },
			{ id: 'b', name: 'Top', tags: ['philosophy'], mode: 'any', parent: '///' },
			{ id: 'c', name: 'Missing', tags: ['philosophy'], mode: 'any' },
		])

		expect(stored.map((entry) => entry.parent)).toEqual(['Work/Projects', '', ''])
	})

	test('reads a tag the way a note would be read', async ({ request }) => {
		const stored = await roundTrip(request, [
			// mixed case, a hash of its own, and something no note could carry
			{ id: 'a', name: 'Mixed', tags: ['Philosophy', '#kripke', 'two words', 42, ''], mode: 'any', parent: '' },
		])

		expect(stored).toEqual([
			{ id: 'a', name: 'Mixed', tags: ['philosophy', 'kripke'], mode: 'any', parent: '' },
		])
	})

	test('keeps the mode to the two the filter has branches for', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ id: 'a', name: 'Shouting', tags: ['philosophy'], mode: 'ALL', parent: '' },
			{ id: 'b', name: 'Nonsense', tags: ['philosophy'], mode: 'sometimes', parent: '' },
			{ id: 'c', name: 'Missing', tags: ['philosophy'], parent: '' },
		])

		expect(stored.map((entry) => entry.mode)).toEqual(['any', 'any', 'any'])
	})

	test('drops a record that names nothing, or nothing to look for', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ id: 'a', name: '   ', tags: ['philosophy'], mode: 'any', parent: '' },
			{ id: 'b', name: 'No tags', tags: [], mode: 'any', parent: '' },
			{ id: 'c', name: 'Nothing usable', tags: ['two words'], mode: 'any', parent: '' },
			{ id: 'd', tags: ['philosophy'], mode: 'any', parent: '' },
			'not a record at all',
			{ id: 'e', name: 'Survivor', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		expect(stored.map((entry) => entry.name)).toEqual(['Survivor'])
	})

	test('trims a name and caps its length', async ({ request }) => {
		const stored = await roundTrip(request, [
			{ id: 'a', name: `  Padded  ${'x'.repeat(200)}`, tags: ['philosophy'], mode: 'any', parent: '' },
		])

		expect(stored[0].name.startsWith('Padded')).toBe(true)
		expect(stored[0].name.length).toBe(128)
	})

	test('caps how many records and how many tags each can hold', async ({ request }) => {
		const manyTags = Array.from({ length: 40 }, (_, index) => `tag${index}`)
		const many = Array.from({ length: 80 }, (_, index) => ({
			id: `id${index}`,
			name: `Category ${index}`,
			tags: manyTags,
			mode: 'any',
			parent: '',
		}))

		const stored = await roundTrip(request, many)

		expect(stored).toHaveLength(64)
		expect(stored[0].tags).toHaveLength(32)
	})

	test('survives a later write that says nothing about it', async ({ request }) => {
		await roundTrip(request, [
			{ id: 'abc123', name: 'Reading', tags: ['philosophy'], mode: 'all', parent: 'Work' },
		])

		/* Settings are stored as one blob and read back through json_decode, so a
		   record written earlier reaches validation as an object rather than an
		   array. Any other setting being written sends it down that path. */
		const written = await request.put('/index.php/apps/notes/settings', {
			headers: headers(),
			data: { lastViewedCategory: 'all' },
		})
		expect(written.ok(), 'writing an unrelated setting').toBeTruthy()

		const settings = await written.json() as { smartCategories?: SmartCategory[] }
		expect(settings.smartCategories).toEqual([
			{ id: 'abc123', name: 'Reading', tags: ['philosophy'], mode: 'all', parent: 'Work' },
		])
	})

	test('refuses anything that is not a list of records', async ({ request }) => {
		expect(await roundTrip(request, 'philosophy')).toEqual([])
		expect(await roundTrip(request, 17)).toEqual([])
	})
})
