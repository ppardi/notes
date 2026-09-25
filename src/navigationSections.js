/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/* The two collapsible sections. The server keeps the same allowlist, so a
   name added here has to be added there as well or it will not be stored. */
export const SECTION_CATEGORIES = 'categories'
export const SECTION_TAGS = 'tags'

/**
 * The collapsed sections, with one section collapsed or opened.
 *
 * Only the collapsed ones are tracked: a section is open unless somebody has
 * closed it, so an open one needs no entry.
 *
 * @param {string[]} collapsed the sections currently collapsed
 * @param {string} section the section to change
 * @param {boolean} isCollapsed whether it should be collapsed
 * @return {string[]} the new list
 */
export function withSectionCollapsed(collapsed, section, isCollapsed) {
	if (!isCollapsed) {
		return collapsed.filter((name) => name !== section)
	}
	return collapsed.includes(section) ? [...collapsed] : [...collapsed, section]
}
