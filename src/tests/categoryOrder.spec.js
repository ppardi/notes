/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { orderedLevel, orderKey, orderWasTruncated, pruneOnDelete, rekeyOnRename, SMART_PREFIX, withKeyAt } from '../categoryOrder.js'

describe('orderKey', () => {
	it('is the path for a folder category', () => {
		expect(orderKey({ name: 'Clients/Client1' })).toBe('Clients/Client1')
	})

	it('is the prefixed id for a smart category', () => {
		expect(orderKey({ smart: true, id: 'abc', name: 'Urgent' })).toBe('smart:abc')
	})

	/* No real category can collide with a smart key. NoteUtil::sanitisePath
	   strips ':' from every path segment, so somebody who types "smart:abc" as
	   a category name gets the folder "smartabc". The half that lives here is
	   that a node without `smart: true` is keyed by its name, whatever the
	   name looks like. */
	it('keys a folder category by name even if it looks like a smart key', () => {
		expect(orderKey({ name: 'smartabc' })).toBe('smartabc')
		expect(orderKey({ name: 'smartabc' }).startsWith(SMART_PREFIX)).toBe(false)
	})

	it('keeps the unfiled category out of the order entirely', () => {
		expect(orderKey({ name: '', label: '' })).toBe('')
	})
})

describe('orderedLevel', () => {
	const node = (name, label = name) => ({ name, label, children: [] })

	it('puts placed nodes in the order given', () => {
		const level = [node('Beta'), node('Alpha'), node('Gamma')]
		const names = orderedLevel(level, ['Gamma', 'Alpha', 'Beta']).map((n) => n.name)
		expect(names).toEqual(['Gamma', 'Alpha', 'Beta'])
	})

	it('puts slotless nodes first, by label', () => {
		const level = [node('Placed'), node('Zulu'), node('Alpha')]
		const names = orderedLevel(level, ['Placed']).map((n) => n.name)
		expect(names).toEqual(['Alpha', 'Zulu', 'Placed'])
	})

	/* An order naming categories that are not here: the state after a folder
	   is deleted elsewhere, or mid-sync. */
	it('ignores keys for categories that are not in the level', () => {
		const level = [node('Beta'), node('Alpha')]
		const names = orderedLevel(level, ['Gone', 'Beta', 'AlsoGone', 'Alpha']).map((n) => n.name)
		expect(names).toEqual(['Beta', 'Alpha'])
	})

	it('leaves the given level untouched', () => {
		const level = [node('Beta'), node('Alpha')]
		orderedLevel(level, ['Alpha'])
		expect(level.map((n) => n.name)).toEqual(['Beta', 'Alpha'])
	})

	/* Unfiled is pinned to the top and never carries a slot. Its label is the
	   empty string, which sorts before every other label, so it stays first
	   among the slotless - but a level where everything else is placed must
	   not push it below them. */
	it('keeps the unfiled category first however the rest is arranged', () => {
		const level = [node('Alpha'), node('', ''), node('Zulu')]
		const names = orderedLevel(level, ['Alpha', 'Zulu']).map((n) => n.name)
		expect(names).toEqual(['', 'Alpha', 'Zulu'])
	})
})

describe('withKeyAt', () => {
	it('records a group that had no slots at all', () => {
		expect(withKeyAt([], ['A', 'B', 'C'], 'C', 0)).toEqual(['C', 'A', 'B'])
	})

	it('leaves keys from other groups where they were', () => {
		const order = ['Other/One', 'B', 'Other/Two', 'A']
		const result = withKeyAt(order, ['A', 'B'], 'A', 0)
		expect(result.filter((k) => k.startsWith('Other/'))).toEqual(['Other/One', 'Other/Two'])
		expect(result.filter((k) => !k.startsWith('Other/'))).toEqual(['A', 'B'])
	})

	it('moves a key that was already placed', () => {
		expect(withKeyAt(['A', 'B', 'C'], ['A', 'B', 'C'], 'A', 2)).toEqual(['B', 'C', 'A'])
	})

	it('puts a newly created category first in its group', () => {
		expect(withKeyAt(['A', 'B'], ['New', 'A', 'B'], 'New', 0)).toEqual(['New', 'A', 'B'])
	})

	/* A key can already sit in the order under another group's run - a
	   reparented category keeps its key and changes group. Emitting the group
	   and leaving the stale copy behind would list it twice, and the index map
	   in orderedLevel would then disagree with itself. */
	it('never lists a key twice', () => {
		const result = withKeyAt(['Moved', 'A', 'B'], ['A', 'Moved', 'B'], 'Moved', 1)
		expect(result).toEqual([...new Set(result)])
		expect(result.filter((k) => k === 'Moved')).toHaveLength(1)
	})
})

describe('rekeyOnRename', () => {
	it('rewrites the category and everything beneath it', () => {
		const order = ['Clients', 'Clients/A', 'Clients/A/Deep', 'Other']
		expect(rekeyOnRename(order, 'Clients', 'Archive/Clients'))
			.toEqual(['Archive/Clients', 'Archive/Clients/A', 'Archive/Clients/A/Deep', 'Other'])
	})

	it('does not rewrite a category that merely starts with the same letters', () => {
		expect(rekeyOnRename(['ClientsOld'], 'Clients', 'Archive')).toBeNull()
	})

	it('leaves smart keys alone', () => {
		expect(rekeyOnRename(['smart:abc'], 'Clients', 'Archive')).toBeNull()
	})
})

describe('pruneOnDelete', () => {
	it('removes the category and everything beneath it', () => {
		expect(pruneOnDelete(['A', 'A/B', 'A/B/C', 'Z'], 'A')).toEqual(['Z'])
	})

	it('answers null when the category had no slot', () => {
		expect(pruneOnDelete(['Z'], 'A')).toBeNull()
	})

	it('leaves smart keys alone', () => {
		expect(pruneOnDelete(['smart:abc'], 'smart')).toBeNull()
	})
})

describe('orderWasTruncated', () => {
	it('notices keys the server did not keep', () => {
		expect(orderWasTruncated(['A', 'B', 'C'], ['A', 'B'])).toBe(true)
	})

	it('is quiet when everything was kept', () => {
		expect(orderWasTruncated(['A', 'B'], ['A', 'B'])).toBe(false)
	})

	// a write that carried no arrangement has none to lose
	it('is quiet when no arrangement was sent', () => {
		expect(orderWasTruncated(undefined, ['A'])).toBe(false)
	})

	it('counts an arrangement that came back as nothing', () => {
		expect(orderWasTruncated(['A'], undefined)).toBe(true)
	})
})
