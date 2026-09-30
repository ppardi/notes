/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * The owner Text records on the lock it holds while an editing session is
 * open - its own app id.
 */
const TEXT_EDITOR = 'text'

/**
 * What to tell someone whose note a lock is keeping them out of.
 *
 * Two different mechanisms answer a write with 423, and they are cleared in
 * different ways. The server's transactional locking holds a file for the
 * length of one write and lets go by itself. An app or a person holds the
 * other kind until they give it up, and Text takes one for as long as an
 * editing session is open - including a session left behind by a closed tab,
 * which sends no close.
 *
 * One message for both sends the reader looking in the wrong place. Naming
 * the holder is most of the fix, because the holder is what decides the
 * remedy.
 *
 * @param {object} [data] the error body from the server
 * @param {string} [data.lockOwner] who the server says holds the lock
 * @return {string} a message to show
 */
export function lockErrorMessage(data) {
	const owner = data?.lockOwner
	if (owner === TEXT_EDITOR) {
		return t('notes', 'The editor still has this note open somewhere else. Close it there, then try again.')
	}
	if (owner) {
		return t('notes', 'Note is locked by {owner}.', { owner })
	}
	return t('notes', 'Note is locked.')
}
