/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * An id that survives a URL and a file name unchanged.
 *
 * @return {string} the id
 */
export function makeId() {
	const uuid = globalThis.crypto?.randomUUID?.()
	if (uuid) {
		return uuid.replaceAll('-', '')
	}
	/* Plain http is not a secure context, and randomUUID is withheld there -
	   which a self-hosted server on a LAN reaches often enough to matter. Two
	   padded base-36 runs give a fixed sixteen characters; slicing a random
	   float instead would sometimes give one or two, and short ids collide. */
	const run = () => Math.floor(Math.random() * (36 ** 8)).toString(36).padStart(8, '0')
	return run() + run()
}
