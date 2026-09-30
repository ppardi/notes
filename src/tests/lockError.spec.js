/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { lockErrorMessage } from '../lockError.js'

beforeAll(() => {
	// t is a Nextcloud global in the app; here it only has to interpolate.
	globalThis.t = (app, text, params) => Object.entries(params ?? {})
		.reduce((out, [key, value]) => out.replace(`{${key}}`, value), text)
})

describe('lockErrorMessage', () => {
	it('says what to do when the editor is the one holding the note', () => {
		/* By far the common case, and the one with a remedy the reader can
		   act on without a shell: the note is open somewhere they forgot. */
		const message = lockErrorMessage({ errorType: 'ManuallyLocked', lockOwner: 'text' })
		expect(message).toMatch(/editor/i)
		expect(message).toMatch(/close/i)
	})

	it('names whoever else is holding it', () => {
		const message = lockErrorMessage({ errorType: 'ManuallyLocked', lockOwner: 'alice' })
		expect(message).toContain('alice')
	})

	it('falls back when the server named no one', () => {
		/* A transactional lock has no owner to name. Saying nothing more than
		   "locked" is right here - it is the only case where it is. */
		expect(lockErrorMessage({ errorType: 'Exception' })).toBe('Note is locked.')
		expect(lockErrorMessage(undefined)).toBe('Note is locked.')
	})
})
