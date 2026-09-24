/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { makeSmartCategoryId, reparentOnDelete, reparentOnRename } from '../smartCategories.js'

describe('makeSmartCategoryId', () => {
	it('makes an id the server will keep', () => {
		/* The server strips anything outside this set and caps the length, so
		   an id it has to rewrite is an id that no longer matches the one the
		   navigation is holding. */
		const id = makeSmartCategoryId()
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(id.length).toBeLessThanOrEqual(32)
	})

	it('is the same length every time', () => {
		/* A run of ids that vary in length is a sign the random part is being
		   sliced out of a float, which sometimes yields one character. */
		const lengths = new Set(Array.from({ length: 200 }, () => makeSmartCategoryId().length))
		expect(lengths.size).toBe(1)
	})

	it('does not repeat itself', () => {
		const ids = new Set(Array.from({ length: 500 }, () => makeSmartCategoryId()))
		expect(ids.size).toBe(500)
	})
})

describe('reparentOnRename', () => {
	const categories = [
		{ id: 'a', name: 'A', tags: ['x'], mode: 'any', parent: 'Work' },
		{ id: 'b', name: 'B', tags: ['x'], mode: 'any', parent: 'Work/Projects' },
		{ id: 'c', name: 'C', tags: ['x'], mode: 'any', parent: 'Personal' },
	]

	it('carries the ones below the renamed category', () => {
		const moved = reparentOnRename(categories, 'Work', 'Job')
		expect(moved.map((entry) => entry.parent)).toEqual(['Job', 'Job/Projects', 'Personal'])
	})

	it('leaves a category whose name merely starts the same', () => {
		expect(reparentOnRename(categories, 'Wor', 'Job')).toBe(null)
	})

	it('says nothing changed when nothing did', () => {
		expect(reparentOnRename(categories, 'Nowhere', 'Elsewhere')).toBe(null)
	})
})

describe('reparentOnDelete', () => {
	const categories = [
		{ id: 'a', name: 'A', tags: ['x'], mode: 'any', parent: 'Work/Projects' },
		{ id: 'b', name: 'B', tags: ['x'], mode: 'any', parent: 'Personal' },
	]

	it('moves one up a level rather than destroying it', () => {
		const moved = reparentOnDelete(categories, 'Work/Projects')
		expect(moved.map((entry) => entry.parent)).toEqual(['Work', 'Personal'])
	})

	it('brings one to the top when a top-level category goes', () => {
		const moved = reparentOnDelete(
			[{ id: 'a', name: 'A', tags: ['x'], mode: 'any', parent: 'Work' }],
			'Work',
		)
		expect(moved[0].parent).toBe('')
	})

	it('moves one out of a deleted category tree', () => {
		const moved = reparentOnDelete(categories, 'Work')
		expect(moved[0].parent).toBe('')
	})

	it('says nothing changed when nothing did', () => {
		expect(reparentOnDelete(categories, 'Nowhere')).toBe(null)
	})
})
