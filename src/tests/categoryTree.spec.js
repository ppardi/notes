/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildCategoryTree, categoryAncestors } from '../categoryTree.js'
import { useNotesStore } from '../stores/notes.js'

/**
 * The shape of a tree, with just the fields a test cares about.
 *
 * @param {Array} nodes the nodes to describe
 * @return {Array} name, counts and children of each node
 */
function outline(nodes) {
	return nodes.map((node) => ({
		name: node.name,
		label: node.label,
		count: node.count,
		totalCount: node.totalCount,
		children: outline(node.children),
	}))
}

describe('buildCategoryTree', () => {
	it('returns nothing for no categories', () => {
		expect(buildCategoryTree([])).toEqual([])
	})

	it('keeps flat categories flat', () => {
		const tree = buildCategoryTree([
			{ name: 'Work', count: 2 },
			{ name: 'Personal', count: 1 },
		])
		expect(outline(tree)).toEqual([
			{ name: 'Personal', label: 'Personal', count: 1, totalCount: 1, children: [] },
			{ name: 'Work', label: 'Work', count: 2, totalCount: 2, children: [] },
		])
	})

	it('nests a child under its parent', () => {
		const tree = buildCategoryTree([
			{ name: 'Work', count: 2 },
			{ name: 'Work/Projects', count: 3 },
		])
		expect(outline(tree)).toEqual([
			{
				name: 'Work',
				label: 'Work',
				count: 2,
				totalCount: 5,
				children: [
					{ name: 'Work/Projects', label: 'Projects', count: 3, totalCount: 3, children: [] },
				],
			},
		])
	})

	it('invents the parents a deep category never declared', () => {
		const tree = buildCategoryTree([{ name: 'Work/Projects/2026', count: 4 }])
		expect(outline(tree)).toEqual([
			{
				name: 'Work',
				label: 'Work',
				count: 0,
				totalCount: 4,
				children: [
					{
						name: 'Work/Projects',
						label: 'Projects',
						count: 0,
						totalCount: 4,
						children: [
							{ name: 'Work/Projects/2026', label: '2026', count: 4, totalCount: 4, children: [] },
						],
					},
				],
			},
		])
	})

	it('adds up descendants into the total of every ancestor', () => {
		const tree = buildCategoryTree([
			{ name: 'Work', count: 1 },
			{ name: 'Work/A', count: 2 },
			{ name: 'Work/A/Deep', count: 4 },
			{ name: 'Work/B', count: 8 },
		])
		const work = tree[0]
		expect(work.count).toBe(1)
		expect(work.totalCount).toBe(15)
		expect(work.children.map((c) => c.name)).toEqual(['Work/A', 'Work/B'])
		expect(work.children[0].totalCount).toBe(6)
	})

	it('sorts siblings by their own label, not their full path', () => {
		const tree = buildCategoryTree([
			{ name: 'Work/zebra', count: 1 },
			{ name: 'Work/apple', count: 1 },
			{ name: 'Admin', count: 1 },
		])
		expect(tree.map((n) => n.name)).toEqual(['Admin', 'Work'])
		expect(tree[1].children.map((n) => n.label)).toEqual(['apple', 'zebra'])
	})

	it('keeps the uncategorized category as a childless root', () => {
		const tree = buildCategoryTree([
			{ name: '', count: 3 },
			{ name: 'Work', count: 1 },
		])
		const uncategorized = tree.find((n) => n.name === '')
		expect(uncategorized).toBeDefined()
		expect(uncategorized.label).toBe('')
		expect(uncategorized.count).toBe(3)
		expect(uncategorized.totalCount).toBe(3)
		expect(uncategorized.children).toEqual([])
	})

	it('nests as deep as the categories go', () => {
		const tree = buildCategoryTree([{ name: 'a/b/c/d/e', count: 1 }])
		let node = tree[0]
		const labels = []
		while (node) {
			labels.push(node.label)
			node = node.children[0]
		}
		expect(labels).toEqual(['a', 'b', 'c', 'd', 'e'])
	})
})

describe('categoryAncestors', () => {
	it('has none for a top-level category', () => {
		expect(categoryAncestors('Work')).toEqual([])
	})

	it('has none for the uncategorized category', () => {
		expect(categoryAncestors('')).toEqual([])
	})

	it('lists the parent of a nested category', () => {
		expect(categoryAncestors('Work/Projects')).toEqual(['Work'])
	})

	it('lists every ancestor outermost first', () => {
		expect(categoryAncestors('Work/Projects/2026'))
			.toEqual(['Work', 'Work/Projects'])
	})

	it('has none for no selection', () => {
		expect(categoryAncestors(null)).toEqual([])
	})
})

describe('buildCategoryTree over the notes store', () => {
	let store

	beforeEach(() => {
		setActivePinia(createPinia())
		store = useNotesStore()
		const notes = [
			{ id: 1, title: 'Loose', category: '' },
			{ id: 2, title: 'Deep', category: 'Work/Projects/2026' },
			{ id: 3, title: 'Other', category: 'Work/Projects/2026' },
			{ id: 4, title: 'Direct', category: 'Work' },
			{ id: 5, title: 'Personal', category: 'Personal' },
		]
		notes.forEach((note) => store.updateNote({ ...note, internalPath: '', readonly: false }))
	})

	it('builds a tree from the categories the store reports', () => {
		const tree = buildCategoryTree(store.getCategories(0, true))
		const names = tree.map((node) => node.name)

		expect(names).toContain('Work')
		expect(names).toContain('Personal')
		expect(names).toContain('')

		const work = tree.find((node) => node.name === 'Work')
		expect(work.count).toBe(1)
		expect(work.totalCount).toBe(3)
		expect(work.children.map((c) => c.name)).toEqual(['Work/Projects'])
		expect(work.children[0].count).toBe(0)
		expect(work.children[0].children[0].name).toBe('Work/Projects/2026')
		expect(work.children[0].children[0].count).toBe(2)
	})

	it('reveals a nested selection through its ancestors', () => {
		const tree = buildCategoryTree(store.getCategories(0, true))
		const ancestors = categoryAncestors('Work/Projects/2026')

		expect(ancestors).toEqual(['Work', 'Work/Projects'])
		let level = tree
		for (const path of ancestors) {
			const node = level.find((n) => n.name === path)
			expect(node, `ancestor ${path} is in the tree`).toBeDefined()
			level = node.children
		}
		expect(level.map((n) => n.name)).toContain('Work/Projects/2026')
	})
})
