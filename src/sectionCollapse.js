/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { withSectionCollapsed } from './navigationSections.js'
import { setSettings } from './NotesService.js'
import store from './store.js'

/**
 * Read and write one navigation section's collapsed state.
 *
 * Both lists held their own copy of this, and the copies had already drifted:
 * one returned the settings write so a caller could await it, the other threw
 * it away. Whether the section can be waited for is not a thing the Tags list
 * and the Categories list should answer differently.
 *
 * @param {string} section one of the SECTION_* names
 * @return {object} a mixin providing `collapsed`, `setSectionCollapsed` and
 *                  `toggleSection`
 */
export function sectionCollapse(section) {
	return {
		computed: {
			collapsed() {
				return (store.app.settings?.collapsedSections ?? []).includes(section)
			},
		},

		methods: {
			/**
			 * Collapse or open the section, and store it.
			 *
			 * @param {boolean} isCollapsed whether it should be collapsed
			 * @return {Promise} the settings write, for callers that have to
			 *                   wait for the section to have drawn itself
			 */
			setSectionCollapsed(isCollapsed) {
				const collapsed = store.app.settings?.collapsedSections ?? []
				return setSettings({
					collapsedSections: withSectionCollapsed(collapsed, section, isCollapsed),
				})
			},

			toggleSection() {
				return this.setSectionCollapsed(!this.collapsed)
			},
		},
	}
}
