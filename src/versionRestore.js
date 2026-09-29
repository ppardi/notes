/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getCurrentUser } from '@nextcloud/auth'
import { getClient } from '@nextcloud/files/dav'

/* Letting go of the lock is not instant: the editor closes here while the
   server is still finishing with the session, so the first move can still be
   refused. The same shape the tag rename uses for the same reason. */
const RESTORE_ATTEMPTS = 4
const RESTORE_RETRY_DELAY = 400
const LOCKED = 423

/**
 * Put a version of a file back, the way the Files versions sidebar does.
 *
 * The sidebar's own restore is what we take over when the note is open in the
 * editor, so this has to be the same request it would have made: a MOVE from
 * the version's own path onto the restore target.
 *
 * @param {object} version the version to restore, from the sidebar's event
 * @return {Promise<void>} once it is in place
 */
export async function restoreVersion(version) {
	const uid = getCurrentUser()?.uid
	if (!uid || !version?.fileId || !version?.fileVersion) {
		throw new Error('Not enough of a version to restore')
	}
	const client = getClient()
	const from = `/versions/${uid}/versions/${version.fileId}/${version.fileVersion}`
	const onto = `/versions/${uid}/restore/target`

	for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt++) {
		try {
			await client.moveFile(from, onto)
			return
		} catch (error) {
			const locked = error?.status === LOCKED || error?.response?.status === LOCKED
			if (!locked || attempt === RESTORE_ATTEMPTS - 1) {
				throw error
			}
			await new Promise((resolve) => setTimeout(resolve, RESTORE_RETRY_DELAY))
		}
	}
}
