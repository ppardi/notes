/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * What a smart category's key carries in front of its id.
 *
 * A folder category is keyed by its path, so the two share one list and have
 * to be told apart. `NoteUtil::sanitisePath` strips `:` from every segment of
 * a path, so no real category can be named into a key that starts this way.
 */
export const SMART_PREFIX = 'smart:'

/**
 * The key a node is remembered by in the arrangement.
 *
 * @param {object} node a node from the category tree
 * @return {string} its key
 */
export function orderKey(node) {
	return node.smart ? SMART_PREFIX + node.id : node.name
}

/**
 * One level of the tree, in the arranged order.
 *
 * A node the arrangement says nothing about comes first, by label, so a
 * category that has appeared since the group was arranged surfaces where it
 * will be noticed rather than being buried. The unfiled category is labelled
 * with the empty string and never carries a key, so it sorts ahead of
 * everything without needing a rule of its own.
 *
 * @param {object[]} level the nodes at this level
 * @param {string[]} order the arrangement, as a flat list of keys
 * @return {object[]} a new array, in order
 */
export function orderedLevel(level, order) {
	const slots = new Map()
	order.forEach((key, index) => {
		if (!slots.has(key)) {
			slots.set(key, index)
		}
	})

	const placed = []
	const slotless = []
	for (const node of level) {
		if (slots.has(orderKey(node))) {
			placed.push(node)
		} else {
			slotless.push(node)
		}
	}

	slotless.sort((a, b) => a.label.localeCompare(b.label))
	placed.sort((a, b) => slots.get(orderKey(a)) - slots.get(orderKey(b)))
	return [...slotless, ...placed]
}
