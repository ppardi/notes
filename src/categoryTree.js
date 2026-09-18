/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * @typedef {object} CategoryNode
 * @property {string} name the full category path, which is what selects it
 * @property {string} label the last path segment, which is what to show
 * @property {number} count notes filed directly in this category
 * @property {number} totalCount notes in this category and everything below it
 * @property {CategoryNode[]} children the categories nested below this one
 */

/**
 * Arrange flat category paths into a tree.
 *
 * Categories are slash-delimited paths and only exist where notes put them, so
 * a note filed in "Work/Projects/2026" leaves "Work" and "Work/Projects"
 * undeclared. Those are created as empty nodes, since the tree needs something
 * to hang the deeper categories from.
 *
 * The uncategorized category is the empty string. It has no separator, so it
 * becomes a root that nothing can nest below.
 *
 * @param {Array<{name: string, count: number}>} categories the categories to arrange
 * @return {CategoryNode[]} the roots of the tree, each sorted by label
 */
export function buildCategoryTree(categories) {
	const roots = []
	const nodes = new Map()

	/**
	 * The node for a path, creating it and its ancestors if needed.
	 *
	 * @param {string} path the full category path
	 * @return {CategoryNode} the node for that path
	 */
	function nodeFor(path) {
		const existing = nodes.get(path)
		if (existing) {
			return existing
		}

		const separator = path.lastIndexOf('/')
		const node = {
			name: path,
			label: separator === -1 ? path : path.slice(separator + 1),
			count: 0,
			totalCount: 0,
			children: [],
		}
		nodes.set(path, node)

		if (separator === -1) {
			roots.push(node)
		} else {
			nodeFor(path.slice(0, separator)).children.push(node)
		}
		return node
	}

	for (const category of categories) {
		nodeFor(category.name).count = category.count ?? 0
	}

	/**
	 * Total a node and everything below it.
	 *
	 * @param {CategoryNode} node the node to total
	 * @return {number} that node's total
	 */
	function total(node) {
		node.totalCount = node.count + node.children.reduce((sum, child) => sum + total(child), 0)
		return node.totalCount
	}

	/**
	 * Sort a level and every level below it.
	 *
	 * @param {CategoryNode[]} level the nodes to sort
	 */
	function sort(level) {
		level.sort((a, b) => a.label.localeCompare(b.label))
		level.forEach((node) => sort(node.children))
	}

	roots.forEach(total)
	sort(roots)
	return roots
}

/**
 * The categories a category is nested below, outermost first.
 *
 * These are the nodes the navigation has to open for a category to be visible.
 *
 * @param {string|null} category the full category path
 * @return {string[]} the ancestor paths, outermost first
 */
export function categoryAncestors(category) {
	if (!category) {
		return []
	}

	const ancestors = []
	let index = category.indexOf('/')
	while (index !== -1) {
		ancestors.push(category.slice(0, index))
		index = category.indexOf('/', index + 1)
	}
	return ancestors
}

/**
 * The collapsed categories, with one category collapsed or opened.
 *
 * Only the collapsed ones are tracked: categories are open by default, so a
 * category nobody has closed - including one that has just appeared - needs no
 * entry.
 *
 * @param {string[]} collapsed the categories currently collapsed
 * @param {string} category the category to change
 * @param {boolean} isCollapsed whether it should be collapsed
 * @return {string[]} the new list
 */
export function withCategoryCollapsed(collapsed, category, isCollapsed) {
	if (!isCollapsed) {
		return collapsed.filter((name) => name !== category)
	}
	return collapsed.includes(category) ? [...collapsed] : [...collapsed, category]
}

/**
 * The collapsed categories, with several categories opened.
 *
 * @param {string[]} collapsed the categories currently collapsed
 * @param {string[]} categories the categories to open
 * @return {string[]} the new list
 */
export function withCategoriesExpanded(collapsed, categories) {
	return collapsed.filter((name) => !categories.includes(name))
}

/**
 * Every category in a tree, including the ones it had to invent.
 *
 * The flat list only holds categories a note is filed in, so the parents
 * buildCategoryTree() created are not in it - and those are exactly the ones
 * that get collapsed.
 *
 * @param {CategoryNode[]} tree the roots of the tree
 * @return {string[]} every node's category path
 */
export function categoryNames(tree) {
	return tree.flatMap((node) => [node.name, ...categoryNames(node.children)])
}

/**
 * The collapsed categories that still exist.
 *
 * Renaming and deleting would otherwise leave entries behind for categories
 * nobody can see any more.
 *
 * @param {string[]} collapsed the categories currently collapsed
 * @param {string[]} names the categories that exist, from categoryNames()
 * @return {string[]} the new list
 */
export function pruneCollapsed(collapsed, names) {
	const existing = new Set(names)
	return collapsed.filter((name) => existing.has(name))
}
