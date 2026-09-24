/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * An id for a new smart category.
 *
 * It only has to be unique among one person's own categories, and the server
 * keeps only these characters - an id it had to rewrite would no longer match
 * the one the navigation just routed to.
 *
 * @return {string} the id
 */
export function makeSmartCategoryId() {
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
/**
 * Whether a category path is inside another one, or is it.
 *
 * @param {string} path the path to test
 * @param {string} ancestor the path it might be under
 * @return {boolean} whether it is
 */
function isWithin(path, ancestor) {
	return path === ancestor || path.startsWith(ancestor + '/')
}

/**
 * The smart categories, following a renamed category.
 *
 * Renaming a category rewrites the folder paths of every note below it, and a
 * smart category filed there has to come along or it silently ends up with a
 * parent nothing can match.
 *
 * @param {Array<object>} smartCategories the stored records
 * @param {string} oldPath the category's path before the rename
 * @param {string} newPath its path after
 * @return {Array<object>|null} the new records, or null when none moved
 */
export function reparentOnRename(smartCategories, oldPath, newPath) {
	let moved = false
	const updated = smartCategories.map((entry) => {
		if (!isWithin(entry.parent, oldPath)) {
			return entry
		}
		moved = true
		return { ...entry, parent: newPath + entry.parent.slice(oldPath.length) }
	})
	return moved ? updated : null
}

/**
 * The smart categories, after a category below them was deleted.
 *
 * A smart category holds no notes of its own, so deleting the folder it was
 * filed in is no reason to destroy it. It moves up to where the deleted
 * category was instead.
 *
 * @param {Array<object>} smartCategories the stored records
 * @param {string} path the deleted category's path
 * @return {Array<object>|null} the new records, or null when none moved
 */
export function reparentOnDelete(smartCategories, path) {
	const separator = path.lastIndexOf('/')
	const grandparent = separator === -1 ? '' : path.slice(0, separator)
	let moved = false
	const updated = smartCategories.map((entry) => {
		if (!isWithin(entry.parent, path)) {
			return entry
		}
		moved = true
		return { ...entry, parent: grandparent }
	})
	return moved ? updated : null
}
