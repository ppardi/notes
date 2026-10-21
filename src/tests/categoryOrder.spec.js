/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { orderedLevel, orderKey, SMART_PREFIX } from '../categoryOrder.js'

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
