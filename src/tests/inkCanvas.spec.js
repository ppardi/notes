/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/* Stubbing in mount() is too late: the import of the real NcButton is what
   fails, because it pulls a .css file that Node cannot load. Replace the module. */
vi.mock('@nextcloud/vue/components/NcButton', () => ({
	default: { name: 'NcButton', template: '<button><slot /></button>' },
}))

const saveInk = vi.fn()
const loadInk = vi.fn()
vi.mock('../inkFile.js', () => ({ saveInk: (...a) => saveInk(...a), loadInk: (...a) => loadInk(...a) }))

const InkCanvas = (await import('../components/InkCanvas.vue')).default

beforeAll(() => {
	globalThis.t = (app, text) => text
	HTMLCanvasElement.prototype.getContext = () => ({
		clearRect: () => {},
		fill: () => {},
		beginPath: () => {},
		closePath: () => {},
		moveTo: () => {},
		lineTo: () => {},
		save: () => {},
		restore: () => {},
		scale: () => {},
	})
	HTMLCanvasElement.prototype.toBlob = function(cb) {
		cb(new Blob([new Uint8Array([1])]))
	}
	/* jsdom lays nothing out, so clientWidth is 0 and fit() would size the
	   canvas to nothing. The drawing is not what these tests are about. */
	Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { value: 800 })
	Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { value: 600 })
})

describe('InkCanvas', () => {
	it('keeps the strokes and stays open when the save fails', async () => {
		/* The worst thing this feature can do is lose a page of handwriting to
		   a network blip. Failing must never close the canvas. */
		loadInk.mockResolvedValue(null)
		saveInk.mockRejectedValue(new Error('network'))
		const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t } } })
		await wrapper.vm.$nextTick()
		wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }]

		await wrapper.vm.done()

		expect(wrapper.emitted('close')).toBeUndefined()
		expect(wrapper.emitted('saved')).toBeUndefined()
		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.error).toBeTruthy()
	})

	it('closes and reports the id when the save works', async () => {
		loadInk.mockResolvedValue(null)
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t } } })
		await wrapper.vm.$nextTick()
		wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }]

		await wrapper.vm.done()

		expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual({ id: 'abc' })
	})

	it('opens over a picture whose strokes cannot be read', async () => {
		/* An ink file from elsewhere, or one whose metadata was stripped. Open
		   empty rather than refusing to open at all. */
		loadInk.mockResolvedValue({ png: new Blob(), strokes: null })
		const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t } } })
		await wrapper.vm.$nextTick()
		expect(wrapper.vm.strokes).toEqual([])
		expect(wrapper.vm.error).toBeFalsy()
	})

	it('undoes the last stroke', async () => {
		loadInk.mockResolvedValue(null)
		const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t } } })
		await wrapper.vm.$nextTick()
		wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }, { points: [[2, 2, 0.5]] }]
		wrapper.vm.undo()
		expect(wrapper.vm.strokes).toHaveLength(1)
	})
})
