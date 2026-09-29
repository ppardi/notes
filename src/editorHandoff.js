/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { emit, subscribe, unsubscribe } from '@nextcloud/event-bus'

/* Long enough for the editor to save and let go, short enough that nothing is
   left waiting on an editor that is not listening. */
const CLOSE_TIMEOUT = 5000

/**
 * Ask the rich editor to let go of a note, and wait until it has.
 *
 * The editor saves before it closes, so this is also how anything that needs
 * the file on disk to be current gets it - unmounting the component on its own
 * destroys the editor without that save.
 *
 * Resolves anyway if nothing answers, so a caller is never left waiting on an
 * editor that is not there: the plain editor never registers for this, and a
 * note can be acted on from the list while no editor holds it at all.
 *
 * @param {number} noteId the note to close
 * @return {Promise<void>} once the editor has closed, or given up on
 */
export function closeEditor(noteId) {
	return new Promise((resolve) => {
		let timer = null
		const onClosed = (event) => {
			if (event?.noteId !== noteId) {
				return
			}
			if (timer !== null) {
				clearTimeout(timer)
				timer = null
			}
			unsubscribe('notes:editor:closed', onClosed)
			resolve()
		}
		subscribe('notes:editor:closed', onClosed)
		timer = setTimeout(() => {
			timer = null
			unsubscribe('notes:editor:closed', onClosed)
			resolve()
		}, CLOSE_TIMEOUT)
		emit('notes:editor:close', { noteId })
	})
}

/**
 * Let the editor have the note back.
 *
 * @param {number} noteId the note that was closed
 */
export function reopenEditor(noteId) {
	emit('notes:editor:reopen', { noteId })
}
