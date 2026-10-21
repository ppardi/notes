/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext } from '@playwright/test'

import { expect, test } from '@playwright/test'

function apiHeaders(): Record<string, string> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	return {
		Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
		// Without this the settings route answers 412.
		'OCS-APIRequest': 'true',
	}
}

async function putSettings(request: APIRequestContext, settings: object): Promise<void> {
	const response = await request.put('/index.php/apps/notes/settings', {
		headers: apiHeaders(),
		data: settings,
	})
	expect(response.ok(), `writing settings: HTTP ${response.status()}`).toBeTruthy()
}

async function getSettings(request: APIRequestContext): Promise<Record<string, unknown>> {
	const response = await request.get('/index.php/apps/notes/settings', { headers: apiHeaders() })
	expect(response.ok(), `reading settings: HTTP ${response.status()}`).toBeTruthy()
	return await response.json() as Record<string, unknown>
}

test.describe('Category order', () => {
	test.afterEach(async ({ request }) => {
		await putSettings(request, { categoryOrder: [] })
	})

	test('stores and returns a category order', async ({ request }) => {
		await putSettings(request, { categoryOrder: ['Beta', 'Alpha'] })
		expect(await getSettings(request)).toMatchObject({ categoryOrder: ['Beta', 'Alpha'] })
	})

	/* The cap. The first thousand keys survive in order; the rest are dropped,
	   which surfaces those categories at the top of their groups as slotless
	   rather than scrambling the arrangement. */
	test('keeps the first thousand keys and drops the rest', async ({ request }) => {
		const keys = Array.from({ length: 1200 }, (_, i) => `C${i}`)
		await putSettings(request, { categoryOrder: keys })

		const stored = (await getSettings(request)).categoryOrder as string[]
		expect(stored).toHaveLength(1000)
		expect(stored[0]).toBe('C0')
		expect(stored[999]).toBe('C999')
	})
})
