/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Schema } from 'prosemirror-model'
import { EditorState, Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { borrowProseMirror, foldToggleButton, hasTopLevelHeading, headingFoldPlugin } from '../proseMirrorHeadingFold.js'

/* The classes the plugin would borrow from a running Text editor. */
const pm = { Plugin, Decoration, DecorationSet }

/* Enough of Text's schema to hold a note: headings, prose and a list. */
const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
		heading: {
			group: 'block',
			content: 'inline*',
			attrs: { level: { default: 1 } },
			toDOM: (node) => ['h' + node.attrs.level, 0],
		},
		bulletList: { group: 'block', content: 'listItem+', toDOM: () => ['ul', 0] },
		listItem: { content: 'paragraph+', toDOM: () => ['li', 0] },
		text: { group: 'inline' },
	},
})

/**
 * Build a document from a terse description, one top-level block per entry.
 *
 * `h2:Groceries` is a level-two heading, `p:Intro` a paragraph, and
 * `ul:milk|bread` a bullet list of two items.
 *
 * @param {Array<string>} blocks the blocks to build
 * @return {object} a ProseMirror document
 */
function docOf(blocks) {
	const nodes = blocks.map((entry) => {
		const [kind, body = ''] = [entry.slice(0, entry.indexOf(':')), entry.slice(entry.indexOf(':') + 1)]
		if (kind === 'p') {
			return schema.nodes.paragraph.create(null, body ? schema.text(body) : null)
		}
		if (kind === 'ul') {
			return schema.nodes.bulletList.create(null, body.split('|').map((item) => schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text(item)))))
		}
		return schema.nodes.heading.create({ level: Number(kind.slice(1)) }, schema.text(body))
	})
	return schema.nodes.doc.create(null, nodes)
}

/* The plugin behind the state most recently built by stateOf(). It is its
   own key, so reading its state and addressing metadata both go through it. */
let plugin = null

/**
 * A fresh editor state carrying the fold plugin.
 *
 * @param {Array<string>} blocks the blocks to build
 * @return {object} an EditorState
 */
function stateOf(blocks) {
	plugin = headingFoldPlugin(pm, {
		collapseLabel: 'Collapse section',
		expandLabel: 'Expand section',
		formatHidden: (n) => `${n} hidden`,
	})
	return EditorState.create({ doc: docOf(blocks), plugins: [plugin] })
}

/**
 * Where each top-level heading sits.
 *
 * @param {object} doc the document
 * @return {Array<number>} one position per heading, in order
 */
function headingPositions(doc) {
	const positions = []
	let pos = 0
	doc.forEach((node) => {
		if (node.type.name === 'heading') {
			positions.push(pos)
		}
		pos += node.nodeSize
	})
	return positions
}

/**
 * Fold the section that starts at the given heading.
 *
 * @param {object} state the editor state
 * @param {number} pos the heading's position
 * @return {object} the state after the toggle
 */
function toggle(state, pos) {
	return state.apply(state.tr.setMeta(plugin, { toggle: pos }))
}

/**
 * The decorations the plugin is currently asking for, by role.
 *
 * @param {object} state the editor state
 * @param {string} role 'hidden', 'toggle' or 'badge'
 * @return {Array<object>} the matching decorations
 */
function decorations(state, role) {
	return plugin.getState(state).decorations
		.find()
		.filter((deco) => deco.spec.notesFold === role)
}

/**
 * The text of everything the plugin is hiding.
 *
 * @param {object} state the editor state
 * @return {Array<string>} one entry per hidden block
 */
function hiddenText(state) {
	return decorations(state, 'hidden')
		.map((deco) => state.doc.textBetween(deco.from, deco.to, ' ', ' ').trim())
}

describe('headingFoldPlugin', () => {
	it('leaves a note without headings alone', () => {
		const state = stateOf(['p:Just prose.', 'p:And more.'])

		expect(decorations(state, 'toggle')).toHaveLength(0)
		expect(hiddenText(state)).toEqual([])
	})

	it('gives every heading a control of its own', () => {
		const state = stateOf(['h1:Title', 'p:Intro', 'h2:Groceries', 'p:milk'])

		expect(decorations(state, 'toggle')).toHaveLength(2)
		// Nothing is folded until it is asked for.
		expect(hiddenText(state)).toEqual([])
	})

	it('hides what follows a heading, up to the next one of its level', () => {
		const state = stateOf(['h2:Groceries', 'ul:milk|bread', 'h2:Travel', 'p:Flight'])
		const [groceries] = headingPositions(state.doc)

		const folded = toggle(state, groceries)

		expect(hiddenText(folded)).toEqual(['milk bread'])
	})

	it('takes a subsection down with the section that holds it', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'h3:Dairy', 'p:Cheese', 'h2:Travel'])
		const [groceries] = headingPositions(state.doc)

		const folded = toggle(state, groceries)

		expect(hiddenText(folded)).toEqual(['milk', 'Dairy', 'Cheese'])
	})

	it('leaves the next section alone when only a subsection is folded', () => {
		const state = stateOf(['h2:Groceries', 'h3:Dairy', 'p:Cheese', 'h2:Travel', 'p:Flight'])
		const dairy = headingPositions(state.doc)[1]

		const folded = toggle(state, dairy)

		expect(hiddenText(folded)).toEqual(['Cheese'])
	})

	it('folds the last section to the end of the note', () => {
		const state = stateOf(['h2:Travel', 'p:Flight', 'p:Packing'])
		const [travel] = headingPositions(state.doc)

		const folded = toggle(state, travel)

		expect(hiddenText(folded)).toEqual(['Flight', 'Packing'])
	})

	it('says how much it is hiding', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'p:bread', 'h2:Travel'])
		const [groceries] = headingPositions(state.doc)

		const folded = toggle(state, groceries)
		const [badge] = decorations(folded, 'badge')

		expect(badge.spec.hidden).toBe(2)
	})

	it('never changes the document', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'h2:Travel'])
		const [groceries] = headingPositions(state.doc)

		const folded = toggle(state, groceries)

		expect(folded.doc.eq(state.doc)).toBe(true)
	})

	it('keeps the fold on its own section when text is added above', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'h2:Travel', 'p:Flight'])
		const [groceries] = headingPositions(state.doc)
		const folded = toggle(state, groceries)

		// Someone types a new opening line at the very top of the note.
		const after = folded.apply(folded.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('New intro'))))

		expect(hiddenText(after)).toEqual(['milk'])
	})

	it('keeps a section folded while its heading is renamed', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'h2:Travel'])
		const [groceries] = headingPositions(state.doc)
		const folded = toggle(state, groceries)

		const renamed = folded.apply(folded.tr.insertText(' list', groceries + 1 + 'Groceries'.length))

		expect(renamed.doc.textBetween(groceries + 1, groceries + 1 + 'Groceries list'.length)).toBe('Groceries list')
		expect(hiddenText(renamed)).toEqual(['milk'])
	})

	it('gives the content back when its heading is deleted', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'h2:Travel'])
		const [groceries] = headingPositions(state.doc)
		const folded = toggle(state, groceries)
		expect(hiddenText(folded)).toEqual(['milk'])

		const heading = folded.doc.child(0)
		const after = folded.apply(folded.tr.delete(groceries, groceries + heading.nodeSize))

		expect(after.doc.textContent).toContain('milk')
		expect(hiddenText(after)).toEqual([])
	})

	it('forgets a fold once its heading is no longer one', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'h2:Travel'])
		const [groceries] = headingPositions(state.doc)
		const folded = toggle(state, groceries)
		expect(hiddenText(folded)).toEqual(['milk'])

		// The heading is demoted to prose, so nothing marks a section there.
		const prose = folded.apply(folded.tr.setBlockType(groceries + 1, groceries + 1, schema.nodes.paragraph))
		expect(prose.doc.child(0).type.name).toBe('paragraph')
		expect(hiddenText(prose)).toEqual([])

		// Made a heading again it starts open: the section the reader folded
		// was taken apart, and a fold nobody asked for is a section that has
		// gone missing.
		const again = prose.apply(prose.tr.setBlockType(groceries + 1, groceries + 1, schema.nodes.heading, { level: 2 }))
		expect(again.doc.child(0).type.name).toBe('heading')
		expect(hiddenText(again)).toEqual([])
	})

	it('shows the section again when it is toggled twice', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'h2:Travel'])
		const [groceries] = headingPositions(state.doc)

		const reopened = toggle(toggle(state, groceries), groceries)

		expect(hiddenText(reopened)).toEqual([])
	})

	it('tells a screen reader what the control does', () => {
		const labels = { collapseLabel: 'Collapse section', expandLabel: 'Expand section' }

		const open = foldToggleButton(labels, { collapsed: false })
		expect(open.tagName).toBe('BUTTON')
		expect(open.getAttribute('aria-expanded')).toBe('true')
		expect(open.getAttribute('aria-label')).toBe('Collapse section')

		const shut = foldToggleButton(labels, { collapsed: true })
		expect(shut.getAttribute('aria-expanded')).toBe('false')
		expect(shut.getAttribute('aria-label')).toBe('Expand section')
	})

	it('says through the control whether its section is folded', () => {
		const state = stateOf(['h2:Groceries', 'p:milk'])
		const [groceries] = headingPositions(state.doc)

		expect(decorations(state, 'toggle')[0].spec.collapsed).toBe(false)
		expect(decorations(toggle(state, groceries), 'toggle')[0].spec.collapsed).toBe(true)
	})

	it('folds on the click, so a key press reaches it too', () => {
		let toggles = 0
		const onToggle = () => {
			toggles++
		}
		const button = foldToggleButton({}, { collapsed: false, onToggle })

		// Enter and Space on a button raise a click and no mousedown at all.
		button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
		expect(toggles).toBe(1)

		// The pointer landing on the control must not move the caret, and must
		// not fold anything a second time on its way to the click.
		const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
		button.dispatchEvent(down)
		expect(down.defaultPrevented).toBe(true)
		expect(toggles).toBe(1)
	})

	it('knows whether there is anything here to fold', () => {
		// The cheap question, asked on every keystroke of a note that has no
		// headings yet, so that the expensive one is asked only once.
		expect(hasTopLevelHeading(docOf(['h2:Groceries', 'p:milk']))).toBe(true)
		expect(hasTopLevelHeading(docOf(['p:Just prose.', 'ul:milk|bread']))).toBe(false)
		expect(hasTopLevelHeading(undefined)).toBe(false)
	})

	it('borrows ProseMirror from an editor that is already running', () => {
		// An editor whose own plugin decorates something, the way Text puts an
		// anchor on every heading.
		const lender = new Plugin({
			props: {
				decorations(state) {
					return DecorationSet.create(state.doc, [Decoration.node(0, state.doc.child(0).nodeSize, { class: 'x' })])
				},
			},
		})
		const editor = { state: EditorState.create({ doc: docOf(['h2:Groceries', 'p:milk']), plugins: [lender] }) }

		const borrowed = borrowProseMirror(editor)

		expect(borrowed.Plugin).toBe(Plugin)
		expect(borrowed.Decoration).toBe(Decoration)
		expect(borrowed.DecorationSet).toBe(DecorationSet)
	})

	it('says no when the editor lends nothing to build with', () => {
		const editor = { state: EditorState.create({ doc: docOf(['h2:Groceries', 'p:milk']) }) }

		expect(borrowProseMirror(editor)).toBeNull()
		expect(borrowProseMirror(undefined)).toBeNull()
	})

	it('folds with the very classes it was handed', () => {
		const state = stateOf(['h2:Groceries', 'p:milk', 'h2:Travel'])
		const [groceries] = headingPositions(state.doc)

		const folded = toggle(state, groceries)

		expect(plugin.getState(folded).decorations).toBeInstanceOf(DecorationSet)
		expect(decorations(folded, 'hidden')[0]).toBeInstanceOf(Decoration)
	})
})
