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

/* Whether the readout was asked for is decided at app load, by inkStats.js,
   which has its own tests. Here it is simply told. */
const statsWanted = vi.fn(() => false)
vi.mock('../inkStats.js', () => ({ statsWanted: () => statsWanted() }))

const saveInk = vi.fn()
const loadInk = vi.fn()
vi.mock('../inkFile.js', () => ({ saveInk: (...a) => saveInk(...a), loadInk: (...a) => loadInk(...a) }))

const InkCanvas = (await import('../components/InkCanvas.vue')).default
const { INK_COLOR } = await import('../inkRender.js')

/* Runs whatever is waiting for the next frame. Set up in beforeAll, where the
   queue it drains lives. */
let runFrame

beforeAll(() => {
	globalThis.t = (app, text) => text
	/* One context per canvas, so a test can count what was asked of it. */
	const contexts = new WeakMap()
	HTMLCanvasElement.prototype.getContext = function() {
		if (!contexts.has(this)) {
			contexts.set(this, {
				calls: [],
				fillStyle: null,
				clearRect() { this.calls.push('clearRect') },
				drawImage() { this.calls.push('drawImage') },
				fill() {},
				beginPath() {},
				closePath() {},
				moveTo() {},
				lineTo() {},
				quadraticCurveTo() {},
				save() {},
				restore() {},
				scale() {},
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
	statsWanted.mockReturnValue(false)
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

describe('InkCanvas drawing', () => {
	const page = (n) => Array.from({ length: n }, (_, i) => ({ points: [[i, i, 0.5]] }))
	const visible = (wrapper) => wrapper.find('canvas').element.getContext('2d')

	/* One stroke, written the way a pen writes it: many samples, then a lift. */
	async function write(wrapper) {
		await pointer(wrapper, 'pointerdown')
		for (let i = 1; i <= 6; i++) {
			await pointer(wrapper, 'pointermove', { offsetX: 10 + i * 3 })
			runFrame()
		}
		await pointer(wrapper, 'pointerup')
	}

	it('paints once a frame, however many samples arrive in it', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [] })
		const context = visible(wrapper)
		await pointer(wrapper, 'pointerdown')
		context.calls.length = 0

		await pointer(wrapper, 'pointermove', { offsetX: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 30 })
		await pointer(wrapper, 'pointermove', { offsetX: 40 })
		expect(context.calls).toEqual([])

		runFrame()
		expect(context.calls.filter((c) => c === 'clearRect')).toHaveLength(1)
	})

	it('costs the same to write on a full page as on an empty one', async () => {
		/* The lag: a canvas that retraces every stroke on every sample gets
		   slower the more has been written on it. Whatever this costs, it must
		   not grow with the page. */
		const traced = async (n) => {
			const wrapper = await open({ png: new Blob(), strokes: page(n) })
			traceStroke.mockClear()
			await write(wrapper)
			return traceStroke.mock.calls.length
		}

		const empty = await traced(2)
		/* Without this the test passes on a canvas that traces nothing. */
		expect(empty).toBeGreaterThan(0)
		expect(await traced(50)).toBe(empty)
	})

	it('shows the strokes already there without tracing them again', async () => {
		const wrapper = await open({ png: new Blob(), strokes: page(20) })
		const context = visible(wrapper)
		traceStroke.mockClear()
		context.calls.length = 0

		await pointer(wrapper, 'pointerdown')
		await pointer(wrapper, 'pointermove', { offsetX: 20 })
		runFrame()

		/* The page comes from the layer it was already traced onto; only the
		   stroke under the pen is traced. */
		expect(context.calls).toContain('drawImage')
		expect(traceStroke).toHaveBeenCalledTimes(1)
	})

	it('retraces the page when a stroke is taken off it', async () => {
		const wrapper = await open({ png: new Blob(), strokes: page(3) })
		traceStroke.mockClear()

		wrapper.vm.undo()

		expect(traceStroke).toHaveBeenCalledTimes(2)
	})

	it('has everything on the canvas before it is saved', async () => {
		/* The PNG is whatever the canvas shows. A stroke still waiting for a
		   frame would be in the strokes and not in the picture. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({ png: new Blob(), strokes: [] })
		await pointer(wrapper, 'pointerdown')
		await pointer(wrapper, 'pointermove', { offsetX: 40 })
		const context = visible(wrapper)
		context.calls.length = 0

		await wrapper.vm.done()

		expect(context.calls).toContain('clearRect')
		expect(saveInk).toHaveBeenCalledTimes(1)
	})

	it('draws in the one colour the theme is applied to', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [] })
		wrapper.vm.paint()
		expect(visible(wrapper).fillStyle).toBe(INK_COLOR)
	})

	it('fits a canvas it was given after the dialog was laid out', async () => {
		/* At mount the dialog has no size yet, so the canvas fitted then can
		   be the wrong one or no size at all. Drawing must not go onto an
		   unprepared canvas. */
		const wrapper = await open({ png: new Blob(), strokes: page(3) })
		const canvas = wrapper.find('canvas').element
		canvas.width = 1
		canvas.height = 1
		traceStroke.mockClear()

		wrapper.vm.paint()

		expect(canvas.width).toBe(800 * (window.devicePixelRatio || 1))
		/* The layer went with it, so the page is put back. */
		expect(traceStroke).toHaveBeenCalledTimes(3)
	})
})

describe('the stats readout', () => {
	it('is not there, and costs nothing, unless it was asked for', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [] })
		expect(wrapper.find('.ink__stats').exists()).toBe(false)
		/* Nothing to tally means the timing calls are never reached. */
		expect(wrapper.vm.tally).toBeUndefined()
	})

	it('reports what the canvas is doing when it was asked for', async () => {
		statsWanted.mockReturnValue(true)
		vi.useFakeTimers()
		try {
			const wrapper = await open({ png: new Blob(), strokes: [] })
			await pointer(wrapper, 'pointerdown')
			await pointer(wrapper, 'pointermove', { offsetX: 40 })
			runFrame()

			vi.advanceTimersByTime(1000)
			await wrapper.vm.$nextTick()

			const shown = wrapper.find('.ink__stats').text()
			expect(shown).toMatch(/\d+\/s frames offered, worst gap \d+ms/)
			expect(shown).toMatch(/behind the pen \d+ms, worst \d+ms; batch spans \d+ms/)
			expect(shown).toMatch(/1\/s moves\s+1\/s samples\s+\d+\/s paints/)
			expect(shown).toMatch(/ms per move/)
			expect(shown).toMatch(/0 strokes, \d+ points under the pen/)
			expect(shown).toMatch(/canvas \d+x\d+ at \d+x, filter /)
		} finally {
			vi.useRealTimers()
		}
	})

	it('reports how far behind the pen it is, from the event itself', async () => {
		/* The one number that says whether the delay is before us or after us.
		   An event that happened 40ms ago was already late when it arrived. */
		statsWanted.mockReturnValue(true)
		vi.useFakeTimers()
		try {
			const wrapper = await open({ png: new Blob(), strokes: [] })
			await pointer(wrapper, 'pointerdown')
			const late = performance.now() - 40
			await pointer(wrapper, 'pointermove', { offsetX: 40, timeStamp: late })
			runFrame()
			vi.advanceTimersByTime(1000)
			await wrapper.vm.$nextTick()

			const shown = wrapper.find('.ink__stats').text()
			expect(shown).toMatch(/behind the pen (3[5-9]|4[0-9])ms/)
		} finally {
			vi.useRealTimers()
		}
	})

	it('holds the last second that had writing in it', async () => {
		/* The numbers are read after the pen lifts. Wiping them on the first
		   idle second would leave zeros on screen exactly when someone looks. */
		statsWanted.mockReturnValue(true)
		vi.useFakeTimers()
		try {
			const wrapper = await open({ png: new Blob(), strokes: [] })
			await pointer(wrapper, 'pointerdown')
			await pointer(wrapper, 'pointermove', { offsetX: 40 })
			runFrame()
			vi.advanceTimersByTime(1000)
			await wrapper.vm.$nextTick()
			const written = wrapper.find('.ink__stats').text()
			expect(written).toMatch(/1\/s moves/)

			await pointer(wrapper, 'pointerup')
			vi.advanceTimersByTime(3000)
			await wrapper.vm.$nextTick()

			expect(wrapper.find('.ink__stats').text()).toBe(written)
		} finally {
			vi.useRealTimers()
		}
	})
})
