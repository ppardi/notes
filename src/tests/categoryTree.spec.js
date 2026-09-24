/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildCategoryTree, categoryAncestors, categoryDropTarget, categoryNames, categorySiblingTarget, joinCategory, landingCategory, pruneCollapsed, withCategoriesExpanded, withCategoryCollapsed, withSmartCategories } from '../categoryTree.js'
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

describe('withCategoryCollapsed', () => {
	it('records a category as collapsed', () => {
		expect(withCategoryCollapsed([], 'Work', true)).toEqual(['Work'])
	})

	it('does not record the same category twice', () => {
		expect(withCategoryCollapsed(['Work'], 'Work', true)).toEqual(['Work'])
	})

	it('forgets a category that is opened again', () => {
		expect(withCategoryCollapsed(['Work', 'Personal'], 'Work', false)).toEqual(['Personal'])
	})

	it('leaves the list alone when opening one that was never collapsed', () => {
		expect(withCategoryCollapsed(['Work'], 'Personal', false)).toEqual(['Work'])
	})

	it('does not modify the list it was given', () => {
		const collapsed = ['Work']
		withCategoryCollapsed(collapsed, 'Personal', true)
		expect(collapsed).toEqual(['Work'])
	})
})

describe('withCategoriesExpanded', () => {
	it('opens every category given', () => {
		expect(withCategoriesExpanded(['Work', 'Work/Projects', 'Personal'], ['Work', 'Work/Projects']))
			.toEqual(['Personal'])
	})

	it('leaves the list alone when none of them were collapsed', () => {
		expect(withCategoriesExpanded(['Personal'], ['Work'])).toEqual(['Personal'])
	})

	it('copes with nothing to open', () => {
		expect(withCategoriesExpanded(['Personal'], [])).toEqual(['Personal'])
	})
})

describe('categoryNames', () => {
	it('lists every node of the tree, not just the declared categories', () => {
		const tree = buildCategoryTree([{ name: 'Work/Projects/2026', count: 1 }])

		// Work and Work/Projects exist only in the tree; no note declares them.
		expect(categoryNames(tree).sort())
			.toEqual(['Work', 'Work/Projects', 'Work/Projects/2026'])
	})

	it('lists nothing for an empty tree', () => {
		expect(categoryNames([])).toEqual([])
	})
})

describe('pruneCollapsed', () => {
	it('forgets categories that no longer exist', () => {
		expect(pruneCollapsed(['Work', 'Gone'], ['Work', 'Personal'])).toEqual(['Work'])
	})

	it('keeps a synthesized parent that only exists in the tree', () => {
		const tree = buildCategoryTree([{ name: 'PROJECTS/Apps/SAGE', count: 1 }])

		expect(pruneCollapsed(['PROJECTS/Apps'], categoryNames(tree)))
			.toEqual(['PROJECTS/Apps'])
	})

	it('empties the list when nothing exists any more', () => {
		expect(pruneCollapsed(['Work'], [])).toEqual([])
	})
})

describe('categoryDropTarget', () => {
	it('files a category under the one it is dropped on', () => {
		expect(categoryDropTarget('Work', 'Personal')).toBe('Personal/Work')
	})

	it('keeps only the category\'s own name, not its old path', () => {
		expect(categoryDropTarget('Work/Projects', 'Personal')).toBe('Personal/Projects')
	})

	it('moves a nested category to the top when dropped on all notes', () => {
		expect(categoryDropTarget('Personal/Work', null)).toBe('Work')
	})

	it('refuses a category dropped on itself', () => {
		expect(categoryDropTarget('Work', 'Work')).toBe(null)
	})

	it('refuses a category dropped inside itself', () => {
		expect(categoryDropTarget('Work', 'Work/Projects')).toBe(null)
		expect(categoryDropTarget('Work', 'Work/Projects/2026')).toBe(null)
	})

	it('refuses a move that would change nothing', () => {
		expect(categoryDropTarget('Personal/Work', 'Personal')).toBe(null)
		expect(categoryDropTarget('Work', null)).toBe(null)
	})

	it('refuses to move the uncategorized category', () => {
		expect(categoryDropTarget('', 'Work')).toBe(null)
		expect(categoryDropTarget('', null)).toBe(null)
	})

	it('refuses a drop onto the uncategorized category', () => {
		expect(categoryDropTarget('Work', '')).toBe(null)
	})
})

describe('categorySiblingTarget', () => {
	it('puts a nested category beside a top-level one', () => {
		expect(categorySiblingTarget('Writing/Substack', 'Work')).toBe('Substack')
	})

	it('puts a category beside a nested one, under the same parent', () => {
		expect(categorySiblingTarget('Substack', 'Work/SkillUp')).toBe('Work/Substack')
	})

	it('refuses a row inside the category being dragged', () => {
		expect(categorySiblingTarget('Work', 'Work/SkillUp')).toBeNull()
	})

	it('refuses a move that changes nothing', () => {
		expect(categorySiblingTarget('Work/SkillUp', 'Work/Other')).toBeNull()
	})

	it('refuses the unfiled row, which is not a folder', () => {
		expect(categorySiblingTarget('Work', '')).toBeNull()
	})
})

describe('landingCategory', () => {
	it('starts in the unfiled notes when something is waiting there', () => {
		expect(landingCategory([
			{ name: '', count: 2 },
			{ name: 'Work', count: 5 },
		])).toBe('')
	})

	it('starts in the first category when nothing is unfiled', () => {
		expect(landingCategory([
			{ name: '', count: 0 },
			{ name: 'Work', count: 5 },
			{ name: 'Archive', count: 1 },
		])).toBe('Archive')
	})

	it('passes over a parent that holds no notes of its own', () => {
		// Landing on Work would open an empty list, since its notes are deeper.
		expect(landingCategory([
			{ name: '', count: 0 },
			{ name: 'Work/Projects', count: 3 },
			{ name: 'Work', count: 0 },
		])).toBe('Work/Projects')
	})

	it('prefers a top-level category when several hold notes', () => {
		expect(landingCategory([
			{ name: '', count: 0 },
			{ name: 'Work/Projects', count: 3 },
			{ name: 'Personal', count: 1 },
		])).toBe('Personal')
	})

	it('falls back to the first category when none hold notes', () => {
		expect(landingCategory([
			{ name: '', count: 0 },
			{ name: 'Work', count: 0 },
			{ name: 'Archive', count: 0 },
		])).toBe('Archive')
	})

	it('has nowhere to start when there are no categories at all', () => {
		expect(landingCategory([{ name: '', count: 0 }])).toBeNull()
	})
})

describe('joinCategory', () => {
	it('returns the name alone at the top level', () => {
		expect(joinCategory(null, 'Work')).toBe('Work')
		expect(joinCategory('', 'Work')).toBe('Work')
	})

	it('nests the name under its parent', () => {
		expect(joinCategory('PROJECTS', 'Apps')).toBe('PROJECTS/Apps')
		expect(joinCategory('PROJECTS/Apps', 'Notes')).toBe('PROJECTS/Apps/Notes')
	})

	it('is empty when the name is empty, whatever the parent', () => {
		expect(joinCategory('PROJECTS', '')).toBe('')
		expect(joinCategory('PROJECTS', '   ')).toBe('')
		expect(joinCategory(null, '')).toBe('')
	})

	it('trims the segments so a stray space does not become part of a folder name', () => {
		expect(joinCategory('PROJECTS', '  Apps  ')).toBe('PROJECTS/Apps')
		expect(joinCategory('  PROJECTS ', 'Apps')).toBe('PROJECTS/Apps')
	})

	it('swallows stray slashes rather than making an empty path segment', () => {
		expect(joinCategory('PROJECTS', '/Apps')).toBe('PROJECTS/Apps')
		expect(joinCategory('PROJECTS/', 'Apps')).toBe('PROJECTS/Apps')
		expect(joinCategory('PROJECTS', 'Apps/')).toBe('PROJECTS/Apps')
		expect(joinCategory('PROJECTS', 'Apps//Notes')).toBe('PROJECTS/Apps/Notes')
	})

	it('still allows a deliberate path typed into the name', () => {
		expect(joinCategory(null, 'PROJECTS/Apps')).toBe('PROJECTS/Apps')
	})
})

describe('withSmartCategories', () => {
	const countFor = (smart) => smart.tags.length

	it('builds the same tree when there are none', () => {
		const categories = [{ name: 'Work', count: 1 }]
		expect(outline(withSmartCategories(categories, [], countFor)))
			.toEqual(outline(buildCategoryTree(categories)))
	})

	it('builds a fresh tree every time', () => {
		/* It places the nodes by mutating, so it has to own the tree it is
		   mutating: called twice, a caller must not end up with the same smart
		   category in the list twice. */
		const categories = [{ name: 'Work', count: 1 }]
		const smart = [{ id: 'a', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' }]
		withSmartCategories(categories, smart, countFor)
		expect(withSmartCategories(categories, smart, countFor)).toHaveLength(2)
	})

	it('puts a parentless category at the top level', () => {
		const tree = withSmartCategories(
			[{ name: 'Work', count: 1 }],
			[{ id: 'a', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' }],
			countFor,
		)
		expect(tree.map((node) => node.name)).toEqual(['Reading', 'Work'])
		expect(tree[0]).toMatchObject({ smart: true, id: 'a', label: 'Reading', count: 1, children: [] })
	})

	it('nests one under its parent, sorted among the real categories', () => {
		const tree = withSmartCategories(
			[
				{ name: 'Work', count: 1 },
				{ name: 'Work/Zebra', count: 1 },
				{ name: 'Work/Alpha', count: 1 },
			],
			[{ id: 'a', name: 'Marmot', tags: ['philosophy'], mode: 'any', parent: 'Work' }],
			countFor,
		)
		expect(tree[0].children.map((node) => node.label)).toEqual(['Alpha', 'Marmot', 'Zebra'])
	})

	it('brings one whose parent has gone back to the top level', () => {
		/* The parent is a stored path, so renaming or deleting a category
		   leaves records pointing at somewhere that is no longer there. It
		   must stay visible, or a category vanishes with no way to get it
		   back. */
		const tree = withSmartCategories(
			[{ name: 'Work', count: 1 }],
			[{ id: 'a', name: 'Orphan', tags: ['philosophy'], mode: 'any', parent: 'Gone' }],
			countFor,
		)
		expect(tree.map((node) => node.name)).toEqual(['Orphan', 'Work'])
	})

	it('never nests one under the unfiled category', () => {
		const tree = withSmartCategories(
			[{ name: '', count: 1 }],
			[{ id: 'a', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' }],
			countFor,
		)
		const unfiled = tree.find((node) => node.name === '')
		expect(unfiled.children).toEqual([])
		expect(tree.some((node) => node.id === 'a')).toBe(true)
	})

	it('keeps its notes out of the parent total', () => {
		/* Its notes are already counted wherever they are really filed, so
		   rolling them up would count them twice. */
		const tree = withSmartCategories(
			[{ name: 'Work', count: 3 }],
			[{ id: 'a', name: 'Reading', tags: ['philosophy', 'kripke'], mode: 'any', parent: 'Work' }],
			countFor,
		)
		expect(tree[0].totalCount).toBe(3)
		expect(tree[0].children[0].totalCount).toBe(2)
	})

	it('leaves smart categories out of the names of categories', () => {
		/* Their names are not category paths, and the collapsed-category list
		   is pruned against this answer. */
		const tree = withSmartCategories(
			[{ name: 'Work', count: 1 }],
			[{ id: 'a', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: 'Work' }],
			countFor,
		)
		expect(categoryNames(tree)).toEqual(['Work'])
	})
})
