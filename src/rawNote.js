/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { closeEditor } from './editorHandoff.js'
import { saveNoteManually } from './NotesService.js'
import store from './store.js'

/* Long enough for a queued save to reach the server, short enough that a note
   is never stuck in the markdown editor because a save will not finish. */
const SAVE_TIMEOUT = 5000
const SAVE_POLL = 50

/**
 * Whether a note is being shown as raw markdown rather than rich text.
 *
 * @param {number} noteId the note
 * @return {boolean} true while it is
 */
export function isRawNote(noteId) {
	return store.notes.getRawNoteId() === noteId
}

/**
 * Whether the raw markdown toggle applies at all.
 *
 * It is an escape from rich text, so with the app already in plain text or
 * preview there is nothing for it to do - the setting has done it, for every
 * note - and with the Text app absent there was never any rich text to escape.
 *
 * @return {boolean} true when the toggle is worth offering
 */
export function canShowRaw() {
	return Boolean(window.OC?.appswebroots?.text)
		&& store.app?.settings?.noteMode === 'rich'
}

/**
 * Show one note as raw markdown.
 *
 * The rich editor is asked to let go first, because it saves on the way out:
 * unmounting it destroys the editor without that save, so anything typed in
 * the last few seconds would not be in the file the markdown editor then reads.
 *
 * @param {number} noteId the note to show
 */
export async function showRawMarkdown(noteId) {
	/* Only a note that is actually open has an editor to ask. Asking about one
	   that is not would wait out the whole timeout for an answer that is never
	   coming, which on a phone is every time: the list and the note are never
	   both on screen, so this is nearly always reached from a row rather than
	   from the note being read. */
	if (store.notes.getSelectedNote() === noteId) {
		await closeEditor(noteId)
	}
	store.notes.setRawNote(noteId)
}

/**
 * Put a note back into the rich editor.
 *
 * The markdown editor saves on a timer, so a change made just before this
 * would still be waiting when the rich editor reads the file. Queue it and
 * wait for it to land instead.
 *
 * @param {number} noteId the note to put back
 */
export async function showRichText(noteId) {
	if (store.notes.getNote(noteId)?.unsaved) {
		saveNoteManually(noteId)
		await waitUntilSaved(noteId)
	}
	store.notes.clearRawNote()
}

/**
 * Wait for a note to have no unsaved changes left.
 *
 * Gives up rather than waiting forever: a save that cannot finish already
 * tells the user so, and holding the note in the markdown editor on top of
 * that would only take away the one view they can still read it in.
 *
 * @param {number} noteId the note to wait for
 * @return {Promise<void>} once it is saved, or once waiting has gone on long enough
 */
function waitUntilSaved(noteId) {
	return new Promise((resolve) => {
		const started = Date.now()
		const check = () => {
			if (!store.notes.getNote(noteId)?.unsaved || Date.now() - started > SAVE_TIMEOUT) {
				resolve()
				return
			}
			setTimeout(check, SAVE_POLL)
		}
		check()
	})
}
