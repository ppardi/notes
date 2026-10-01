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

/* Counting what is traced is how these tests see the cost of drawing: the
   canvas must not retrace the page to show one more stroke. */
const traceStroke = vi.fn()
vi.mock('../inkRender.js', async (original) => ({
	...(await original()),
	traceStroke: (...a) => traceStroke(...a),
}))

const saveInk = vi.fn()
const loadInk = vi.fn()
vi.mock('../inkFile.js', () => ({ saveInk: (...a) => saveInk(...a), loadInk: (...a) => loadInk(...a) }))

const InkCanvas = (await import('../components/InkCanvas.vue')).default
const { CROP_MARGIN, INK_COLOR } = await import('../inkRender.js')

/* Runs whatever is waiting for the next frame. Set up in beforeAll, where the
   queue it drains lives. */
let runFrame

beforeAll(() => {
	globalThis.t = (app, text) => text
	/* One context per canvas, so a test can count what was asked of it. */
	const contexts = new WeakMap()
	HTMLCanvasElement.prototype.getContext = function(type, options) {
		if (!contexts.has(this)) {
			contexts.set(this, {
				calls: [],
				rects: [],
				options,
				fillStyle: null,
				clearRect(...rect) {
					this.calls.push('clearRect')
					this.rects.push(rect)
				},
				drawImage() { this.calls.push('drawImage') },
				arcs: [],
				arc(...a) {
					this.calls.push('arc')
					this.arcs.push(a)
				},
				stroke() { this.calls.push('stroke') },
				fill() {},
				beginPath() {},
				closePath() {},
				moveTo() {},
				lineTo() {},
				quadraticCurveTo() {},
				save() {},
				restore() {},
				scale() {},
				translate() {},
			})
		}
		return contexts.get(this)
	}
	/* Frames run when a test says so, so "one paint per frame" is observable
	   rather than a race with jsdom's own clock. */
	let pending = []
	globalThis.requestAnimationFrame = (cb) => pending.push(cb)
	globalThis.cancelAnimationFrame = () => {
		pending = []
	}
	runFrame = () => {
		const due = pending
		pending = []
		due.forEach((cb) => cb())
	}
	HTMLCanvasElement.prototype.toBlob = function(cb) {
		cb(new Blob([new Uint8Array([1])]))
	}
	/* jsdom lays nothing out, so clientWidth is 0 and fit() would size the
	   canvas to nothing. The drawing is not what these tests are about. */
	Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { value: 800 })
	Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { value: 600 })
})

beforeEach(() => {
	traceStroke.mockReset()
	saveInk.mockReset()
	loadInk.mockReset()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

/* The canvas teleports itself to <body>, which wrapper.find cannot see into;
   stubbing teleport renders it in place. Its position is for the e2e test. */
/* Mount and let the existing ink (none, unless a test says so) finish loading. */
async function open(existing = null, options = {}) {
	loadInk.mockResolvedValue(existing)
	const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t }, stubs: { teleport: true } }, ...options })
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
	wrapper.find('.ink__canvas--live').element.dispatchEvent(event)
	await wrapper.vm.$nextTick()
}

/* A button by its label, which is how a reader finds one - and, unlike its
   place in the bar, does not change when a tool is added beside it. */
function button(wrapper, label) {
	return wrapper.findAll('button').find((candidate) => candidate.text() === label)
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

		/* And the page can still be written on. The message says the ink is
		   still here to try again with, so adding to it has to work. */
		await pointer(wrapper, 'pointerdown', { offsetX: 50, offsetY: 50 })
		await pointer(wrapper, 'pointerup')
		expect(wrapper.vm.strokes).toHaveLength(2)
	})

	it('saves what was drawn, then closes and reports the id', async () => {
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[1, 1, 0.5]] }]

		await wrapper.vm.done()

		/* Without this a done() that emitted saved and never saved would pass. */
		expect(saveInk).toHaveBeenCalledTimes(1)
		/* The sample was drawn at [1, 1] and the picture is cropped to the
		   writing, so what is saved is the stroke in the picture's own
		   coordinates - at the margin, not where the screen had it. */
		expect(saveInk).toHaveBeenCalledWith(5, 'abc', expect.any(Blob), [{ points: [[CROP_MARGIN, CROP_MARGIN, 0.5]] }])
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
			expect(button(wrapper, 'Done').attributes('disabled')).toBeDefined()
			await wrapper.vm.done()
			expect(saveInk).not.toHaveBeenCalled()
			expect(wrapper.emitted('saved')).toBeUndefined()
		})

		it('still lets the person leave', async () => {
			const wrapper = await unreadable()
			expect(button(wrapper, 'Cancel').attributes('disabled')).toBeUndefined()
			await button(wrapper, 'Cancel').trigger('click')
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
		await pointer(wrapper, 'pointerdown', { offsetX: 1, offsetY: 1 })
		await pointer(wrapper, 'pointerup')
		await pointer(wrapper, 'pointerdown', { offsetX: 2, offsetY: 2 })
		await pointer(wrapper, 'pointerup')

		wrapper.vm.undo()

		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.strokes[0].points[0]).toEqual([1, 1, 0.5])
	})

	it('has nothing to undo on a page it has only opened', async () => {
		/* Undo reverses what was done here. The ink that was already in the
		   file is not something this canvas did, and the eraser is the way to
		   take out a mark that was there before. */
		const wrapper = await open({ png: new Blob(), strokes: [{ points: [[3, 3, 0.5]] }] })
		expect(button(wrapper, 'Undo').attributes('disabled')).toBeDefined()
	})

	describe('the eraser', () => {
		/* A line across the page, as the pen draws one. */
		const line = (y) => ({ points: Array.from({ length: 8 }, (_, i) => [i * 20, y, 0.5]) })

		/* Rub out along a row, the way a hand moves: down, across, up. */
		async function rubAcross(wrapper, y) {
			await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: y })
			for (let x = 20; x <= 140; x += 20) {
				await pointer(wrapper, 'pointermove', { offsetX: x, offsetY: y })
			}
			await pointer(wrapper, 'pointerup')
		}

		it('takes out the stroke it is dragged across, and leaves the rest', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [line(0), line(200), line(400)] })
			await button(wrapper, 'Erase').trigger('click')
			expect(wrapper.vm.erasing).toBe(true)

			await rubAcross(wrapper, 200)

			expect(wrapper.vm.strokes).toHaveLength(2)
			expect(wrapper.vm.strokes.map((stroke) => stroke.points[0][1])).toEqual([0, 400])
		})

		it('draws nothing while it rubs out', async () => {
			/* The eraser is not a mark. Nothing of its path is kept and nothing
			   of it is left on the page. */
			const wrapper = await open({ png: new Blob(), strokes: [line(200)] })
			wrapper.vm.erasing = true

			await rubAcross(wrapper, 900)

			expect(wrapper.vm.strokes).toHaveLength(1)
			expect(wrapper.vm.current).toBeNull()
		})

		it('puts back what it rubbed out, when undone', async () => {
			/* Erasing is the one thing here that destroys work, so it has to be
			   reversible by the same button as everything else. */
			const wrapper = await open({ png: new Blob(), strokes: [line(0), line(200), line(400)] })
			wrapper.vm.erasing = true
			await rubAcross(wrapper, 200)
			/* Without this the test passes on a canvas that erases nothing. */
			expect(wrapper.vm.strokes).toHaveLength(2)

			wrapper.vm.undo()

			expect(wrapper.vm.strokes.map((stroke) => stroke.points[0][1])).toEqual([0, 200, 400])
		})

		it('puts back everything one pass took, in the places they were in', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [line(0), line(4), line(400)] })
			wrapper.vm.erasing = true
			await rubAcross(wrapper, 2)
			expect(wrapper.vm.strokes).toHaveLength(1)

			wrapper.vm.undo()

			expect(wrapper.vm.strokes.map((stroke) => stroke.points[0][1])).toEqual([0, 4, 400])
		})

		it('counts one pass as one thing to undo, however much it crossed', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [line(0), line(200)] })
			wrapper.vm.erasing = true
			await rubAcross(wrapper, 0)
			await rubAcross(wrapper, 200)

			wrapper.vm.undo()
			expect(wrapper.vm.strokes).toHaveLength(1)
			wrapper.vm.undo()
			expect(wrapper.vm.strokes).toHaveLength(2)
		})

		it('nothing to undo for a pass that touched nothing', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [line(200)] })
			wrapper.vm.erasing = true
			await rubAcross(wrapper, 900)
			expect(button(wrapper, 'Undo').attributes('disabled')).toBeDefined()
		})

		it('rubs out a line crossed between one report and the next', async () => {
			/* The browser does not report the pen continuously, and a report
			   can be tens of pixels from the one before it. A line crossed in
			   that gap is a line the reader watched the eraser go through -
			   going over it repeatedly until it went was the symptom. */
			const upright = { points: [[300, 0, 0.5], [300, 400, 0.5]] }
			const wrapper = await open({ png: new Blob(), strokes: [upright] })
			wrapper.vm.erasing = true

			await pointer(wrapper, 'pointerdown', { offsetX: 240, offsetY: 200 })
			await pointer(wrapper, 'pointermove', { offsetX: 360, offsetY: 200 })

			expect(wrapper.vm.strokes).toHaveLength(0)
		})

		it('does not join one pass to the one before it', async () => {
			/* The path is continuous within a pass, not across a lift: the
			   straight line from where the eraser was last put down would rub
			   out everything it happened to cross. */
			const wrapper = await open({ png: new Blob(), strokes: [{ points: [[300, 0, 0.5], [300, 400, 0.5]] }] })
			wrapper.vm.erasing = true

			await pointer(wrapper, 'pointerdown', { offsetX: 240, offsetY: 200 })
			await pointer(wrapper, 'pointerup')
			await pointer(wrapper, 'pointerdown', { offsetX: 360, offsetY: 200 })

			expect(wrapper.vm.strokes).toHaveLength(1)
		})

		it('shows where the eraser is, so it can be aimed', async () => {
			/* Rubbing out with nothing under the pen to show for it is aiming
			   blind: the reader cannot tell whether they are on the mark. */
			const wrapper = await open({ png: new Blob(), strokes: [] })
			wrapper.vm.erasing = true

			await pointer(wrapper, 'pointerdown', { offsetX: 40, offsetY: 50 })
			runFrame()

			const live = wrapper.find('.ink__canvas--live').element.getContext('2d')
			expect(live.arcs.at(-1)?.slice(0, 2)).toEqual([40, 50])

			/* And it is gone when the pen comes off the page: its box was
			   cleared, and nothing was drawn in it afterwards. */
			await pointer(wrapper, 'pointerup')
			expect(live.calls.lastIndexOf('clearRect')).toBeGreaterThan(live.calls.lastIndexOf('arc'))
		})

		it('never rubs out for a finger', async () => {
			/* The same rule as drawing: a palm resting on the page would
			   otherwise wipe it. */
			const wrapper = await open({ png: new Blob(), strokes: [line(200)] })
			wrapper.vm.erasing = true

			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', offsetX: 10, offsetY: 200 })
			await pointer(wrapper, 'pointermove', { pointerType: 'touch', offsetX: 60, offsetY: 200 })

			expect(wrapper.vm.strokes).toHaveLength(1)
		})

		it('saves the page it rubbed out, not the page it opened', async () => {
			saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
			const wrapper = await open({ png: new Blob(), strokes: [line(0), line(200)] })
			wrapper.vm.erasing = true
			await rubAcross(wrapper, 200)

			await wrapper.vm.done()

			expect(saveInk.mock.calls[0][3]).toHaveLength(1)
		})
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
			expect(button(wrapper, 'Undo').attributes('disabled')).toBeDefined()
			expect(button(wrapper, 'Cancel').attributes('disabled')).toBeUndefined()
			expect(button(wrapper, 'Done').attributes('disabled')).toBeDefined()
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

		it('refuses the default on touch, so Scribble cannot swallow the pen', async () => {
			/* iPadOS Scribble claims pen input over a canvas and the page is
			   handed nothing at all - no pointerdown, no pointermove - until
			   the pen is lifted and put down again. A WebKit regression since
			   iPadOS 14, and refusing the default on touch is what stops the
			   recogniser taking it. Proven on the device, Scribble switched on. */
			const wrapper = await open()
			for (const type of ['touchstart', 'touchmove']) {
				const event = new Event(type, { bubbles: true, cancelable: true })
				wrapper.find('.ink__canvas--live').element.dispatchEvent(event)
				expect(event.defaultPrevented, `${type} was left to the browser`).toBe(true)
			}
		})

		it('never draws for a finger, on a page nothing has been written on', async () => {
			/* The case that used to get through: no pen has been seen yet, so
			   the resting hand was let through and drew the first stroke. */
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 2 })
			await pointer(wrapper, 'pointermove', { pointerType: 'touch', pointerId: 2, offsetX: 50 })
			await pointer(wrapper, 'pointerup', { pointerType: 'touch', pointerId: 2 })

			expect(wrapper.vm.current).toBeNull()
			expect(wrapper.vm.strokes).toEqual([])
		})

		it('lets the pen write while a hand is resting on the page', async () => {
			/* The hand is already down and reporting when the pen lands. It
			   never took the stroke, so the pen has nothing to take back. */
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 2, offsetX: 99 })
			await pointer(wrapper, 'pointerdown', { pointerId: 1, offsetX: 10 })
			await pointer(wrapper, 'pointermove', { pointerType: 'touch', pointerId: 2, offsetX: 98 })
			await pointer(wrapper, 'pointermove', { pointerId: 1, offsetX: 20 })
			await pointer(wrapper, 'pointerup', { pointerType: 'touch', pointerId: 2 })
			await pointer(wrapper, 'pointerup', { pointerId: 1 })

			expect(wrapper.vm.strokes).toHaveLength(1)
			expect(wrapper.vm.strokes[0].points.map(([x]) => x)).toEqual([10, 20])
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

				expect(button(wrapper, 'Done').attributes('disabled')).toBeDefined()
				expect(button(wrapper, 'Cancel').attributes('disabled')).toBeUndefined()
				await button(wrapper, 'Cancel').trigger('click')
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

	describe('before the existing ink has arrived', () => {
		/* Mount without letting the load finish, and hand back the resolver.
		   On the device the reader taps Ink and is already writing by the time
		   the file has been fetched. */
		function opening() {
			let arrive
			loadInk.mockReturnValue(new Promise((resolve) => {
				arrive = resolve
			}))
			const wrapper = mount(InkCanvas, { props: { noteId: 5, inkId: 'abc' }, global: { mocks: { t }, stubs: { teleport: true } } })
			return { wrapper, arrive: async (existing) => {
				arrive(existing)
				await flushPromises()
			} }
		}

		it('takes the pen, and keeps what was written when the ink arrives', async () => {
			/* The stroke drawn in this window used to be dropped in silence,
			   which on the device is "I have to tap twice before it draws". */
			const { wrapper, arrive } = opening()
			await pointer(wrapper, 'pointerdown', { offsetX: 40, offsetY: 40 })
			await pointer(wrapper, 'pointermove', { offsetX: 60, offsetY: 60 })
			await pointer(wrapper, 'pointerup')
			expect(wrapper.vm.strokes).toHaveLength(1)

			await arrive({ png: new Blob(), strokes: [{ points: [[1, 1, 0.5]] }] })

			/* The ink that was already in the file is underneath it, not
			   instead of it. */
			expect(wrapper.vm.strokes).toHaveLength(2)
			expect(wrapper.vm.strokes[0].points).toEqual([[1, 1, 0.5]])
			expect(wrapper.vm.strokes[1].points[0]).toEqual([40, 40, 0.5])
		})

		it('refuses the default on touch straight away', async () => {
			/* The guards cannot wait for the load either: Scribble claims the
			   pen on the touch it is not refused on. */
			const { wrapper } = opening()
			const event = new Event('touchstart', { bubbles: true, cancelable: true })
			wrapper.find('.ink__canvas--live').element.dispatchEvent(event)
			expect(event.defaultPrevented).toBe(true)
		})

		it('cannot be saved until the ink has arrived', async () => {
			/* Saving writes the file by name. Doing it before the load has
			   answered would replace ink nobody has read yet. */
			const { wrapper, arrive } = opening()
			expect(button(wrapper, 'Done').attributes('disabled')).toBeDefined()
			await arrive(null)
			expect(button(wrapper, 'Done').attributes('disabled')).toBeUndefined()
		})
	})

	describe('more page than one screen', () => {
		/* A finger, which never draws, moves the paper instead. */
		async function dragFinger(wrapper, from, to, id = 9) {
			await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: id, offsetX: 100, offsetY: from })
			await pointer(wrapper, 'pointermove', { pointerType: 'touch', pointerId: id, offsetX: 100, offsetY: to })
		}

		/* Ink down to a given depth, so the page has somewhere to pan to. */
		const deep = (y) => [{ points: [[10, 0, 0.5], [10, y, 0.5]] }]

		it('moves the page under the pen when a finger is dragged', async () => {
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			await dragFinger(wrapper, 400, 300)
			expect(wrapper.vm.panY).toBe(100)
		})

		it('stays still for a finger that has barely moved', async () => {
			/* A tap, or a hand settling, is not a request to move the page. */
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			await dragFinger(wrapper, 400, 396)
			expect(wrapper.vm.panY).toBe(0)
		})

		it('keeps the top of the page at the top', async () => {
			/* Above the first line there is nothing, and a reader who panned
			   into it would be looking at a blank sheet with no way to tell
			   which way was back. */
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			await dragFinger(wrapper, 300, 500)
			expect(wrapper.vm.panY).toBe(0)
		})

		it('gives one fresh screen below the lowest ink, and no more', async () => {
			/* Panning until the last of the writing is at the top always leaves
			   a whole empty screen to carry on in. Further than that is blank
			   paper with nothing to say where you are. */
			const wrapper = await open({ png: new Blob(), strokes: deep(500) })
			await dragFinger(wrapper, 900, -4000)
			expect(wrapper.vm.panY).toBeCloseTo(505, 0)
		})

		it('has nowhere to go on a page that fits', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [] })
			await dragFinger(wrapper, 400, 100)
			expect(wrapper.vm.panY).toBe(0)
		})

		it('does not move the page for a hand resting while the pen writes', async () => {
			/* The palm again, in a new place: it arrives as a touch, and a
			   touch now moves the paper. */
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: 10 })
			await dragFinger(wrapper, 400, 200)
			expect(wrapper.vm.panY).toBe(0)
			expect(wrapper.vm.current).not.toBeNull()
		})

		it('lets the pen take over from a finger that was moving the page', async () => {
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			await dragFinger(wrapper, 400, 300)
			await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: 10 })
			await pointer(wrapper, 'pointermove', { pointerType: 'touch', pointerId: 9, offsetX: 100, offsetY: 100 })

			/* The pen is writing and the page has stopped moving under it. */
			expect(wrapper.vm.current).not.toBeNull()
			expect(wrapper.vm.panY).toBe(100)
		})

		it('keeps a stroke where the page has it, not where the screen did', async () => {
			/* The strokes are the page's, so what is saved does not depend on
			   how far down the reader had scrolled when they wrote it. */
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			await dragFinger(wrapper, 400, 100)
			expect(wrapper.vm.panY).toBe(300)

			await pointer(wrapper, 'pointerdown', { offsetX: 50, offsetY: 50 })
			await pointer(wrapper, 'pointerup')

			expect(wrapper.vm.strokes.at(-1).points[0]).toEqual([50, 350, 0.5])
		})

		it('rubs out what is under the eraser on a page that has been moved', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [{ points: [[10, 700, 0.5], [200, 700, 0.5]] }] })
			await dragFinger(wrapper, 500, 0)
			expect(wrapper.vm.panY).toBe(500)
			wrapper.vm.erasing = true

			/* 700 on the page is 195 on the screen once the page has moved. */
			await pointer(wrapper, 'pointerdown', { offsetX: 100, offsetY: 700 - wrapper.vm.panY })

			expect(wrapper.vm.strokes).toHaveLength(0)
		})

		it('says when the page carries on past the screen', async () => {
			/* Writing that has moved off the top is writing the reader has no
			   other way of knowing is there. */
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			const stage = () => wrapper.find('.ink__stage').classes()
			expect(stage()).toContain('ink__stage--below')
			expect(stage()).not.toContain('ink__stage--above')

			await dragFinger(wrapper, 400, 300)
			await wrapper.vm.$nextTick()

			expect(stage()).toContain('ink__stage--above')
			expect(stage()).toContain('ink__stage--below')
		})

		it('says nothing about more page on a page that fits', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [] })
			expect(wrapper.find('.ink__stage').classes()).not.toContain('ink__stage--below')
		})

		it('moves the page for a wheel, where there is no finger', async () => {
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			const wheel = new Event('wheel', { bubbles: true, cancelable: true })
			Object.defineProperty(wheel, 'deltaY', { value: 120 })
			wrapper.find('.ink__canvas--live').element.dispatchEvent(wheel)
			await wrapper.vm.$nextTick()

			expect(wrapper.vm.panY).toBe(120)
			expect(wheel.defaultPrevented, 'the page behind the dialog would scroll').toBe(true)
		})

		it('comes back inside the page when the ink below is rubbed out', async () => {
			/* The limit follows the writing, so rubbing out the last of it
			   shortens the page - and must not leave the reader looking at
			   somewhere below its bottom. */
			const wrapper = await open({ png: new Blob(), strokes: deep(2000) })
			await dragFinger(wrapper, 1400, 0)
			expect(wrapper.vm.panY).toBe(1400)

			/* Rub out the one stroke, which is the whole page. */
			wrapper.vm.erasing = true
			await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: 1500 - wrapper.vm.panY })
			await pointer(wrapper, 'pointerup')

			expect(wrapper.vm.strokes).toHaveLength(0)
			expect(wrapper.vm.panY).toBe(0)
		})
	})

	describe('what iPadOS Scribble can reach', () => {
		it('takes focus off the note, which Scribble writes into', async () => {
			/* The dialog covers the note, but the note's editor keeps the
			   focus, and Scribble puts what the pen writes into the focused
			   text field. Writing over the dialog put handwritten text into
			   the note behind it. Nothing in this dialog is a text field, so
			   holding the focus here means there is nothing to write into. */
			const editor = document.createElement('div')
			editor.contentEditable = 'true'
			editor.tabIndex = 0
			document.body.append(editor)
			editor.focus()
			expect(document.activeElement).toBe(editor)

			const wrapper = await open(null, { attachTo: document.body })
			expect(document.activeElement).toBe(wrapper.find('.ink').element)

			/* And the note has it back when the dialog goes, which is where
			   the ink is about to be written. */
			wrapper.unmount()
			expect(document.activeElement).toBe(editor)
			editor.remove()
		})

		it('refuses a written-on gesture over the buttons, and keeps their taps', async () => {
			/* Writing off to the side of the sheet, over the bar, became
			   Scribble text in the note behind. The whole dialog refuses
			   movement; refusing the touch outright would stop the buttons
			   ever being tapped. */
			const wrapper = await open()
			const bar = wrapper.find('.ink__bar').element

			const move = new Event('touchmove', { bubbles: true, cancelable: true })
			bar.dispatchEvent(move)
			expect(move.defaultPrevented, 'a gesture over the bar was left to the browser').toBe(true)

			const tap = new Event('touchstart', { bubbles: true, cancelable: true })
			bar.dispatchEvent(tap)
			expect(tap.defaultPrevented, 'a tap on the bar was refused').toBe(false)
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
			const canvas = wrapper.find('.ink__canvas--live').element
			canvas.width = 1
			notify()
			expect(canvas.width).toBe(800)

			wrapper.unmount()
			expect(disconnect).toHaveBeenCalled()
		})
	})
})

describe('InkCanvas drawing', () => {
	const manyStrokes = (n) => Array.from({ length: n }, (_, i) => ({ points: [[i, i, 0.5]] }))
	/* The sheet the stroke under the pen is drawn on, and the page beneath it. */
	const live = (wrapper) => wrapper.find('.ink__canvas--live').element.getContext('2d')
	const page = (wrapper) => wrapper.find('.ink__canvas--page').element.getContext('2d')

	/* One stroke, written the way a pen writes it: many samples, then a lift. */
	async function write(wrapper) {
		await pointer(wrapper, 'pointerdown')
		for (let i = 1; i <= 6; i++) {
			await pointer(wrapper, 'pointermove', { offsetX: 10 + i * 3 })
			runFrame()
		}
		await pointer(wrapper, 'pointerup')
	}

	it('marks the page the moment the pen touches it', async () => {
		/* Nothing was drawn until the first pointermove arrived, so the nib
		   sat on a blank page until the pen had moved far enough for the
		   browser to say so. The first sample is already in hand at
		   pointerdown; there is nothing to wait for. */
		const wrapper = await open({ png: new Blob(), strokes: [] })
		traceStroke.mockClear()

		await pointer(wrapper, 'pointerdown', { offsetX: 40, offsetY: 40 })

		/* Without waiting for a frame, and without a move having arrived. */
		expect(traceStroke).toHaveBeenCalledTimes(1)
		expect(traceStroke.mock.calls[0][0]).toBe(live(wrapper))
		expect(traceStroke.mock.calls[0][1]).toEqual([[40, 40, 0.5]])
	})

	it('never touches the page while a stroke is being written', async () => {
		/* The whole point of the two sheets. What has been written already is
		   composited by the browser; it is not redrawn to show one more mark. */
		const wrapper = await open({ png: new Blob(), strokes: manyStrokes(20) })
		const beneath = page(wrapper)
		await pointer(wrapper, 'pointerdown')
		/* After the mark made on contact, so what is counted is the writing. */
		traceStroke.mockClear()
		beneath.calls.length = 0

		await pointer(wrapper, 'pointermove', { offsetX: 20 })
		runFrame()

		expect(beneath.calls).toEqual([])
		expect(traceStroke).toHaveBeenCalledTimes(1)
	})

	it('costs the same to write on a full page as on an empty one', async () => {
		const traced = async (n) => {
			const wrapper = await open({ png: new Blob(), strokes: manyStrokes(n) })
			traceStroke.mockClear()
			await write(wrapper)
			return traceStroke.mock.calls.length
		}

		const empty = await traced(2)
		/* Without this the test passes on a canvas that traces nothing. */
		expect(empty).toBeGreaterThan(0)
		expect(await traced(50)).toBe(empty)
	})

	it('paints once a frame, however many samples arrive in it', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [] })
		const sheet = live(wrapper)
		await pointer(wrapper, 'pointerdown')
		/* One painted frame first, so there is something to clear: the very
		   first paint of a stroke has drawn nothing yet. */
		await pointer(wrapper, 'pointermove', { offsetX: 15 })
		runFrame()
		sheet.calls.length = 0

		await pointer(wrapper, 'pointermove', { offsetX: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 30 })
		await pointer(wrapper, 'pointermove', { offsetX: 40 })
		expect(sheet.calls).toEqual([])

		runFrame()
		expect(sheet.calls.filter((c) => c === 'clearRect')).toHaveLength(1)
	})

	it('clears only where it drew, not the whole sheet', async () => {
		/* The sheet is millions of pixels and a word covers a few thousand. */
		const wrapper = await open({ png: new Blob(), strokes: [] })
		const sheet = live(wrapper)
		await pointer(wrapper, 'pointerdown', { offsetX: 100, offsetY: 100 })
		await pointer(wrapper, 'pointermove', { offsetX: 130, offsetY: 120 })
		runFrame()
		sheet.rects.length = 0

		await pointer(wrapper, 'pointermove', { offsetX: 140, offsetY: 130 })
		runFrame()

		const [x, y, width, height] = sheet.rects.at(-1)
		expect(width).toBeLessThan(200)
		expect(height).toBeLessThan(200)
		expect(x).toBeLessThan(100)
		expect(y).toBeLessThan(100)
	})

	it('moves a finished stroke down onto the page and leaves the sheet empty', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [] })
		await pointer(wrapper, 'pointerdown')
		await pointer(wrapper, 'pointermove', { offsetX: 40 })
		runFrame()
		const beneath = page(wrapper)
		traceStroke.mockClear()
		beneath.calls.length = 0

		await pointer(wrapper, 'pointerup')

		/* Traced once, onto the page. */
		expect(traceStroke).toHaveBeenCalledTimes(1)
		expect(traceStroke.mock.calls[0][0]).toBe(beneath)
		expect(wrapper.vm.painted).toBeNull()
	})

	it('retraces the page when a stroke is taken off it', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [] })
		for (let i = 1; i <= 3; i++) {
			await pointer(wrapper, 'pointerdown', { offsetX: i * 10, offsetY: i * 10 })
			await pointer(wrapper, 'pointerup')
		}
		traceStroke.mockClear()

		wrapper.vm.undo()

		expect(traceStroke).toHaveBeenCalledTimes(2)
	})

	it('saves a picture of the writing, not of the screen', async () => {
		/* Both sheets are the size of the device's screen, and a page of
		   handwriting is a few words somewhere on it. Saved whole, the note
		   is mostly white space - which is what the reader sees. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({ png: new Blob(), strokes: [] })
		const pictures = []
		HTMLCanvasElement.prototype.toBlob = function(cb) {
			pictures.push({ className: this.className, width: this.width, height: this.height })
			cb(new Blob([new Uint8Array([1])]))
		}
		await pointer(wrapper, 'pointerdown', { offsetX: 400, offsetY: 300 })
		await pointer(wrapper, 'pointermove', { offsetX: 420, offsetY: 330 })

		await wrapper.vm.done()

		expect(pictures).toHaveLength(1)
		/* Neither sheet: a picture of its own, the size of what was written. */
		expect(pictures[0].className).toBe('')
		expect(pictures[0].width).toBe(Math.ceil(20 + CROP_MARGIN * 2))
		expect(pictures[0].height).toBe(Math.ceil(30 + CROP_MARGIN * 2))
		/* The stroke still under the pen was committed before it was drawn. */
		expect(saveInk).toHaveBeenCalledTimes(1)
		expect(saveInk.mock.calls[0][3]).toHaveLength(1)
	})

	it('writes the strokes in the saved picture\'s own coordinates', async () => {
		/* The picture is cropped to the writing, so the strokes that drew it
		   have to be moved with it: reopening draws them from the corner of
		   the picture, which is where the picture has them. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({ png: new Blob(), strokes: [] })
		await pointer(wrapper, 'pointerdown', { offsetX: 400, offsetY: 300 })
		await pointer(wrapper, 'pointermove', { offsetX: 420, offsetY: 330 })

		await wrapper.vm.done()

		const saved = saveInk.mock.calls[0][3]
		expect(saved[0].points).toEqual([[CROP_MARGIN, CROP_MARGIN, 0.5], [20 + CROP_MARGIN, 30 + CROP_MARGIN, 0.5]])
		/* And what is on screen is left where the pen drew it. */
		expect(wrapper.vm.strokes[0].points[0]).toEqual([400, 300, 0.5])
	})

	it('saves a picture with a size even when nothing was written', async () => {
		/* A canvas of no width cannot be turned into a PNG at all, and the
		   save would fail on a page the reader simply left blank. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({ png: new Blob(), strokes: [] })
		const pictures = []
		HTMLCanvasElement.prototype.toBlob = function(cb) {
			pictures.push({ width: this.width, height: this.height })
			cb(new Blob([new Uint8Array([1])]))
		}

		await wrapper.vm.done()

		expect(pictures[0].width).toBeGreaterThan(0)
		expect(pictures[0].height).toBeGreaterThan(0)
		expect(saveInk).toHaveBeenCalledTimes(1)
	})

	it('draws where the browser thinks the pen is going, and never saves it', async () => {
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const ahead = [{ offsetX: 80, offsetY: 80, pressure: 0.5 }]
		const wrapper = await open({ png: new Blob(), strokes: [] })
		await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: 10 })
		traceStroke.mockClear()
		await pointer(wrapper, 'pointermove', { offsetX: 20, offsetY: 20, getPredictedEvents: () => ahead })
		runFrame()

		/* The guess is drawn... */
		expect(traceStroke.mock.calls[0][1]).toContainEqual([80, 80, 0.5])

		await pointer(wrapper, 'pointerup')
		await wrapper.vm.done()

		/* ...and is no part of what was written. */
		const saved = saveInk.mock.calls[0][3]
		expect(saved[0].points).not.toContainEqual([80, 80, 0.5])
	})

	it('asks for a low-latency sheet to write on, and an ordinary page beneath', async () => {
		/* The hint exists for drawing on the web and iOS grants it. Only the
		   sheet under the pen asks for it: the page beneath is written to a
		   frame at a time, where skipping compositing buys nothing. */
		const wrapper = await open({ png: new Blob(), strokes: [] })
		wrapper.vm.paintLive()
		expect(live(wrapper).options).toEqual({ desynchronized: true })
		expect(page(wrapper).options).toBeUndefined()
	})

	it('draws in the one colour the theme is applied to', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [] })
		wrapper.vm.paintLive()
		expect(live(wrapper).fillStyle).toBe(INK_COLOR)
		expect(page(wrapper).fillStyle).toBe(INK_COLOR)
	})

	it('draws on the canvas that is on screen, not the one it first held', async () => {
		/* Vue replaces the dialog's elements on a re-render - the same thing
		   that moves the focus and the touch guards - and the context was kept
		   under the name of the sheet rather than against the element. Picking
		   the eraser up and putting it down is such a re-render: afterwards
		   every stroke was traced onto a canvas that had been taken off the
		   screen, so writing did nothing at all, in silence. */
		const wrapper = await open({ png: new Blob(), strokes: [] })
		wrapper.vm.erasing = true
		await wrapper.vm.$nextTick()
		wrapper.vm.erasing = false
		await wrapper.vm.$nextTick()

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })

		const onScreen = wrapper.find('.ink__canvas--live').element.getContext('2d')
		expect(traceStroke).toHaveBeenCalled()
		expect(traceStroke.mock.calls.at(-1)[0]).toBe(onScreen)
	})

	it('fits a canvas it was given after the dialog was laid out', async () => {
		const wrapper = await open({ png: new Blob(), strokes: manyStrokes(3) })
		const canvas = wrapper.find('.ink__canvas--live').element
		canvas.width = 1
		canvas.height = 1
		traceStroke.mockClear()

		wrapper.vm.paintLive()

		expect(canvas.width).toBe(800 * (window.devicePixelRatio || 1))
		/* The page went with it, so it is put back. */
		expect(traceStroke).toHaveBeenCalledTimes(3)
	})
})
