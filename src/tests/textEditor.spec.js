/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.fn()
vi.mock('../Logger.js', () => ({ default: { warn: (...a) => warn(...a), debug: () => {}, error: () => {} } }))

/* Stubbing in mount() is too late: the import of the real NcButton is what
   fails, because it pulls a .css file that Node cannot load. */
vi.mock('@nextcloud/vue/components/NcButton', () => ({ default: { name: 'NcButton', template: '<button><slot /></button>' } }))
vi.mock('@nextcloud/vue/composables/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@nextcloud/dialogs', () => ({ showError: () => {} }))
vi.mock('../components/TagCompletion.vue', () => ({ default: { name: 'TagCompletion', template: '<div />' } }))
vi.mock('../components/InkCanvas.vue', () => ({ default: { name: 'InkCanvas', template: '<div />' } }))
vi.mock('../NotesService.js', () => ({ queueCommand: () => {}, refreshNote: () => {} }))
vi.mock('../store.js', () => ({ default: {} }))

const { findTextEditor } = await import('../textEditor.js')
const NoteRich = (await import('../components/NoteRich.vue')).default

beforeEach(() => {
	warn.mockReset()
})

/* The element Text renders into, with the ProseMirror node tiptap marks. */
function rendered(editor) {
	const root = document.createElement('div')
	const prose = document.createElement('div')
	prose.className = 'ProseMirror'
	prose.editor = editor
	root.append(prose)
	return root
}

describe('findTextEditor', () => {
	it('returns the editor tiptap left on its element, without a word', () => {
		const editor = { commands: {} }
		expect(findTextEditor(rendered(editor))).toBe(editor)
		expect(warn).not.toHaveBeenCalled()
	})

	it('says so, and returns null, when Text has no editor element', () => {
		expect(findTextEditor(document.createElement('div'))).toBeNull()
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('says so when the element has lost its editor property', () => {
		expect(findTextEditor(rendered(undefined))).toBeNull()
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('says so when there is no element at all', () => {
		expect(findTextEditor(null)).toBeNull()
		expect(warn).toHaveBeenCalledTimes(1)
	})
})

describe('NoteRich reaches the editor through it', () => {
	/* Both callers must ask the one accessor. Two inline copies are how the
	   silent fallback in placeCaretForInk went unnoticed. */
	it('logs when the caret cannot be placed because the editor is out of reach', () => {
		const focus = vi.fn()
		NoteRich.methods.placeCaretForInk.call({
			$refs: { editor: document.createElement('div') },
			editor: { focus },
		})
		expect(warn).toHaveBeenCalled()
		expect(focus).toHaveBeenCalled()
	})

	it('logs when heading folding cannot be installed because the editor is out of reach', async () => {
		await NoteRich.methods.installHeadingFold.call({
			$refs: { editor: document.createElement('div') },
			$nextTick: () => Promise.resolve(),
		})
		expect(warn).toHaveBeenCalled()
	})

	it('puts the caret at the end when it is in the first block', () => {
		const commands = { focus: vi.fn(), setTextSelection: vi.fn() }
		const tiptap = { commands, state: { selection: { $to: { index: () => 0 }, empty: true } } }
		NoteRich.methods.placeCaretForInk.call({ $refs: { editor: rendered(tiptap) }, editor: {} })
		expect(commands.focus).toHaveBeenCalledWith('end')
		expect(warn).not.toHaveBeenCalled()
	})
})
