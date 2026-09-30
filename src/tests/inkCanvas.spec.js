/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

beforeEach(() => {
	saveInk.mockReset()
	loadInk.mockReset()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

/* The canvas teleports itself to <body>, which wrapper.find cannot see into;
   stubbing teleport renders it in place. Its position is for the e2e test. */
/* Mount and let the existing ink (none, unless a test says so) finish loading. */
async function open(existing = null) {
	loadInk.mockResolvedValue(existing)
	const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t }, stubs: { teleport: true } } })
	await flushPromises()
	return wrapper
}

/* Drives the real listeners on the canvas, as the browser does, rather than
   calling the handlers: the wiring is part of what is under test. jsdom's
   MouseEvent has read-only offsetX/offsetY and VTU's trigger cannot set them,
   so build a plain event and define the pointer fields on it. */
async function pointer(wrapper, type, init) {
	const event = new Event(type, { bubbles: true })
	const fields = { pointerType: 'pen', pointerId: 1, offsetX: 10, offsetY: 10, pressure: 0.5, ...init }
	for (const [key, value] of Object.entries(fields)) {
		Object.defineProperty(event, key, { value })
	}
	wrapper.find('canvas').element.dispatchEvent(event)
	await wrapper.vm.$nextTick()
}

describe('InkCanvas', () => {
	it('keeps the strokes and stays open when the save fails', async () => {
		/* The worst thing this feature can do is lose a page of handwriting to
		   a network blip. Failing must never close the canvas. */
		saveInk.mockRejectedValue(new Error('network'))
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }]

		await wrapper.vm.done()

		expect(wrapper.emitted('close')).toBeUndefined()
		expect(wrapper.emitted('saved')).toBeUndefined()
		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.error).toBeTruthy()
	})

	it('saves what was drawn, then closes and reports the id', async () => {
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }]

		await wrapper.vm.done()

		/* Without this a done() that emitted saved and never saved would pass. */
		expect(saveInk).toHaveBeenCalledTimes(1)
		expect(saveInk).toHaveBeenCalledWith(5, 'abc', expect.any(Blob), [{ points: [[1, 1, 0.5]] }])
		expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual({ id: 'abc' })
		expect(wrapper.emitted('close')).toHaveLength(1)
	})

	describe('when the picture is there but its strokes cannot be read', () => {
		/* An ink file whose metadata chunk was dropped, as Nextcloud's preview
		   generation can do. The file on disk is still the only copy of the
		   handwriting, and saving replaces it by name. */
		const unreadable = () => open({ png: new Blob([new Uint8Array([1, 2, 3])]), strokes: null })

		beforeEach(() => {
			URL.createObjectURL = vi.fn(() => 'blob:picture')
			URL.revokeObjectURL = vi.fn()
		})

		it('shows the picture that is there, and says the strokes could not be read', async () => {
			const wrapper = await unreadable()
			expect(loadInk).toHaveBeenCalledWith(5, 'abc')
			expect(wrapper.find('img.ink__backdrop').attributes('src')).toBe('blob:picture')
			expect(wrapper.find('.ink__error').text()).toMatch(/strokes.*could not be read/i)
		})

		it('cannot be saved over it', async () => {
			const wrapper = await unreadable()

			/* Drawing is refused, so nothing exists to save. */
			await pointer(wrapper, 'pointerdown')
			await pointer(wrapper, 'pointermove', { offsetX: 50 })
			await pointer(wrapper, 'pointerup')
			expect(wrapper.vm.current).toBeNull()
			expect(wrapper.vm.strokes).toEqual([])

			/* And Done is refused, even when asked directly. */
			const buttons = wrapper.findAll('button')
			expect(buttons[2].attributes('disabled')).toBeDefined()
			await wrapper.vm.done()
			expect(saveInk).not.toHaveBeenCalled()
			expect(wrapper.emitted('saved')).toBeUndefined()
		})

		it('still lets the person leave', async () => {
			const wrapper = await unreadable()
			const buttons = wrapper.findAll('button')
			expect(buttons[1].attributes('disabled')).toBeUndefined()
			await buttons[1].trigger('click')
			expect(wrapper.emitted('close')).toHaveLength(1)
		})

		it('lets go of the picture when it closes', async () => {
			const wrapper = await unreadable()
			wrapper.unmount()
			expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:picture')
		})

		it('shows no picture over ink whose strokes were read', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [] })
			expect(wrapper.find('img.ink__backdrop').exists()).toBe(false)
			expect(wrapper.vm.ready).toBe(true)
		})
	})

	it('opens over the strokes that were saved before', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [{ points: [[3, 3, 0.5]] }] })
		expect(wrapper.vm.strokes).toEqual([{ points: [[3, 3, 0.5]] }])
	})

	it('undoes the last stroke', async () => {
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }, { points: [[2, 2, 0.5]] }]
		wrapper.vm.undo()
		expect(wrapper.vm.strokes).toHaveLength(1)
	})

	describe('when the existing ink cannot be loaded', () => {
		it('says so and refuses to be saved over it', async () => {
			/* loadInk rethrows anything but a 404. Opening blank would let the
			   person write a new page and replace the one that is there. */
			loadInk.mockRejectedValue(new Error('500'))
			const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t }, stubs: { teleport: true } } })
			await flushPromises()

			expect(wrapper.vm.error).toBeTruthy()
			await pointer(wrapper, 'pointerdown')
			await pointer(wrapper, 'pointerup')
			expect(wrapper.vm.strokes).toEqual([])
			expect(wrapper.vm.current).toBeNull()

			await wrapper.vm.done()
			expect(saveInk).not.toHaveBeenCalled()
			expect(wrapper.emitted('saved')).toBeUndefined()
		})

		it('still lets the person leave', async () => {
			loadInk.mockRejectedValue(new Error('500'))
			const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t }, stubs: { teleport: true } } })
			await flushPromises()
			const buttons = wrapper.findAll('button')
			expect(buttons[0].attributes('disabled')).toBeDefined()
			expect(buttons[1].attributes('disabled')).toBeUndefined()
			expect(buttons[2].attributes('disabled')).toBeDefined()
		})
	})

	describe('palm rejection', () => {
		it('ignores a palm moving while a pen stroke is under way', async () => {
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerId: 1 })
			await pointer(wrapper, 'pointermove', { pointerId: 1, offsetX: 20 })
			await pointer(wrapper, 'pointermove', { pointerType: 'touch', pointerId: 2, offsetX: 99 })

			expect(wrapper.vm.current.points).toHaveLength(2)
			expect(wrapper.vm.current.points.every(([x]) => x !== 99)).toBe(true)
		})

		it('does not let the palm lifting end the pen stroke', async () => {
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerId: 1 })
			await pointer(wrapper, 'pointerup', { pointerType: 'touch', pointerId: 2 })
			expect(wrapper.vm.strokes).toHaveLength(0)
			expect(wrapper.vm.current).not.toBeNull()

			await pointer(wrapper, 'pointermove', { pointerId: 1, offsetX: 30 })
			await pointer(wrapper, 'pointerup', { pointerId: 1 })
			expect(wrapper.vm.strokes).toHaveLength(1)
			expect(wrapper.vm.strokes[0].points).toHaveLength(2)
		})

		it('does not let a second pen replace the stroke under way', async () => {
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerId: 1 })
			await pointer(wrapper, 'pointerdown', { pointerId: 2 })
			expect(wrapper.vm.pointerId).toBe(1)
		})

		it('ignores a touch that lands while the pen is writing', async () => {
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerId: 1, offsetX: 10 })
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 2, offsetX: 99 })
			await pointer(wrapper, 'pointermove', { pointerId: 1, offsetX: 20 })
			await pointer(wrapper, 'pointerup', { pointerId: 1 })

			expect(wrapper.vm.strokes).toHaveLength(1)
			expect(wrapper.vm.strokes[0].points.map(([x]) => x)).toEqual([10, 20])
		})

		it('lets the pen take over from a palm that started a stroke first', async () => {
			/* An iPad whose Pencil does not hover: no pen has been seen, so the
			   resting hand is let through and starts a stroke. The pen must not
			   be locked out, and the palm's stroke is not something drawn. */
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 2, offsetX: 99 })
			await pointer(wrapper, 'pointermove', { pointerType: 'touch', pointerId: 2, offsetX: 98 })
			expect(wrapper.vm.current).not.toBeNull()

			await pointer(wrapper, 'pointerdown', { pointerId: 1, offsetX: 10 })
			expect(wrapper.vm.pointerId).toBe(1)
			await pointer(wrapper, 'pointermove', { pointerType: 'touch', pointerId: 2, offsetX: 97 })
			await pointer(wrapper, 'pointermove', { pointerId: 1, offsetX: 20 })
			await pointer(wrapper, 'pointerup', { pointerType: 'touch', pointerId: 2 })
			await pointer(wrapper, 'pointerup', { pointerId: 1 })

			expect(wrapper.vm.strokes).toHaveLength(1)
			expect(wrapper.vm.strokes[0].points.map(([x]) => x)).toEqual([10, 20])
		})

		it('ignores a second touch while a touch stroke is under way', async () => {
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 2 })
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 3 })
			expect(wrapper.vm.pointerId).toBe(2)
		})

		it('rejects a touch that lands after the pen hovered, with no stroke under way', async () => {
			const wrapper = await open()
			/* A hovering Pencil reports pointermove, pressure 0, nothing drawn. */
			await pointer(wrapper, 'pointermove', { pointerId: 1, pressure: 0 })
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 2 })
			expect(wrapper.vm.current).toBeNull()
		})

		it('draws with a finger when no pen has been seen', async () => {
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 2 })
			expect(wrapper.vm.current).not.toBeNull()
		})
	})

	describe('while saving', () => {
		it('ignores pointer input', async () => {
			let strokesWhenSaved
			let finish
			saveInk.mockImplementation((noteId, id, png, strokes) => {
				strokesWhenSaved = strokes.length
				return new Promise((resolve) => {
					finish = resolve
				})
			})
			const wrapper = await open()
			wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }]

			const saving = wrapper.vm.done()
			await flushPromises()
			await pointer(wrapper, 'pointerdown')
			await pointer(wrapper, 'pointermove', { offsetX: 50 })
			await pointer(wrapper, 'pointerup')
			expect(wrapper.vm.current).toBeNull()
			expect(wrapper.vm.strokes).toHaveLength(1)

			finish('.attachments.5/ink-abc.png')
			await saving
			expect(strokesWhenSaved).toBe(1)
			expect(wrapper.vm.strokes).toHaveLength(1)
		})

		it('keeps Cancel enabled so a stuck save cannot trap the strokes', async () => {
			/* toBlob that never calls back: the save never settles. */
			const toBlob = HTMLCanvasElement.prototype.toBlob
			HTMLCanvasElement.prototype.toBlob = () => {}
			try {
				const wrapper = await open()
				wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }]
				wrapper.vm.done()
				await flushPromises()

				const buttons = wrapper.findAll('button')
				expect(buttons[2].attributes('disabled')).toBeDefined()
				expect(buttons[1].attributes('disabled')).toBeUndefined()
				await buttons[1].trigger('click')
				expect(wrapper.emitted('close')).toHaveLength(1)
			} finally {
				HTMLCanvasElement.prototype.toBlob = toBlob
			}
		})

		it('saves a stroke still under the pen rather than dropping it', async () => {
			saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown')
			await wrapper.vm.done()
			expect(saveInk.mock.calls[0][3]).toHaveLength(1)
		})
	})

	describe('sizing', () => {
		it('re-fits when the canvas box changes, and stops watching on unmount', async () => {
			/* The error message changes the layout under the canvas without the
			   window changing size. */
			let notify
			const disconnect = vi.fn()
			vi.stubGlobal('ResizeObserver', class {
				constructor(callback) {
					notify = callback
				}

				observe() {}
				disconnect() {
					disconnect()
				}
			})
			const wrapper = await open()
			const canvas = wrapper.find('canvas').element
			canvas.width = 1
			notify()
			expect(canvas.width).toBe(800)

			wrapper.unmount()
			expect(disconnect).toHaveBeenCalled()
		})
	})
})
