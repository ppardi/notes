/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import logger from './Logger.js'

/**
 * Reach the tiptap editor behind the element Text rendered into.
 *
 * Text keeps its editor to itself: the handle it returns cannot say where the
 * caret is or take a plugin, and the only way to the real thing is the element
 * tiptap marks with itself. That is not a promise Text has made, so every
 * caller must cope with an answer of null, and this says so in the log when it
 * happens. Without that, a Text release that moves the marker would quietly
 * turn off whatever depends on it.
 *
 * @param {Element | null | undefined} root the element handed to createEditor
 * @return {object | null} the editor, or null when it cannot be found
 */
export function findTextEditor(root) {
	const editor = root?.querySelector?.('.ProseMirror')?.editor
	if (editor && typeof editor === 'object') {
		return editor
	}
	logger.warn('Could not reach the editor Text rendered; features that depend on it are off', {
		rootFound: !!root,
		proseMirrorFound: !!root?.querySelector?.('.ProseMirror'),
	})
	return null
}
