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

vi.mock('@nextcloud/vue/components/NcActions', () => ({
	default: { name: 'NcActions', template: '<div><slot name="icon" /><slot /></div>' },
}))
vi.mock('@nextcloud/vue/components/NcActionButton', () => ({
	default: { name: 'NcActionButton', template: '<button><slot /></button>' },
}))

const InkCanvas = (await import('../components/InkCanvas.vue')).default
const { CROP_MARGIN, INK_DENSITY } = await import('../inkRender.js')
const { DEFAULT_INK_COLOR } = await import('../inkPalette.js')
const { DEFAULT_TOOL } = await import('../inkShape.js')

/* Runs whatever is waiting for the next frame. Set up in beforeAll, where the
   queue it drains lives. */
let runFrame

beforeAll(() => {
	/* Interpolating, because a label with a placeholder left in it is not the
	   label a reader sees, and a test asserting one would pass on a string
	   nobody will ever read. */
	globalThis.t = (app, text, vars) => text.replace(/\{(\w+)\}/g, (whole, name) => vars?.[name] ?? whole)
	/* One context per canvas, so a test can count what was asked of it. */
	const contexts = new WeakMap()
	HTMLCanvasElement.prototype.getContext = function(type, options) {
		if (!contexts.has(this)) {
			contexts.set(this, {
				calls: [],
				rects: [],
				options,
				/* Every value it was set to, in order. A stroke's color is on
				   the context only while that stroke is being traced, so the
				   last value alone says nothing about the ones before it. */
				fillStyles: [],
				_fillStyle: null,
				get fillStyle() { return this._fillStyle },
				set fillStyle(value) {
					this._fillStyle = value
					this.fillStyles.push(value)
				},
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
	/* The color a canvas opens in is remembered in storage, which outlives a
	   test: without this, a test that chose red hands red to the next. */
	window.localStorage.clear()
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

/* A button by its name, which is how a reader finds one - and, unlike its
   place in the bar, does not change when a tool is added beside it. The tools
   carry an icon and no text, so the name is the one a screen reader would
   read out. */
/* Drives a real event on a control, as the browser does.
 *
 * Built by hand rather than through trigger(): jsdom's Event has a read-only
 * timeStamp, and these assertions are about how close two events are in time.
 */
async function tap(wrapper, target, type, fields = {}) {
	const event = new Event(type, { bubbles: true })
	for (const [key, value] of Object.entries(fields)) {
		Object.defineProperty(event, key, { value })
	}
	target.element.dispatchEvent(event)
	await wrapper.vm.$nextTick()
}

function button(wrapper, label) {
	return wrapper.findAll('button').find((candidate) => {
		return candidate.attributes('aria-label') === label || candidate.text() === label
	})
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
		/* And the corner it was cropped from, which puts it back here when it
		   is opened again - clamped onto the page then, since this one was
		   drawn inside the margin of the edge. */
		expect(saveInk).toHaveBeenCalledWith(
			5,
			'abc',
			expect.any(Blob),
			[{ points: [[CROP_MARGIN, CROP_MARGIN, 0.5]] }],
			[1 - CROP_MARGIN, 1 - CROP_MARGIN],
		)
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
		/* Each comes in with the color it will be drawn and saved in; this one
		   was written before strokes had any. */
		expect(wrapper.vm.strokes).toEqual([{ points: [[3, 3, 0.5]], color: DEFAULT_INK_COLOR }])
	})

	it('opens the drawing where it was left', async () => {
		/* The file holds the writing cropped to itself, so without the corner
		   it was cropped from, a reader who drew in the middle of the page saw
		   it there the first time and in the top left every time after. */
		const wrapper = await open({
			png: new Blob(),
			strokes: [{ points: [[CROP_MARGIN, CROP_MARGIN, 0.5], [45, 35, 0.5]] }],
			origin: [400, 300],
		})
		expect(wrapper.vm.strokes[0].points[0]).toEqual([400 + CROP_MARGIN, 300 + CROP_MARGIN, 0.5])
	})

	it('saves where the drawing is, so it opens there next time', async () => {
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({ png: new Blob(), strokes: [] })
		await pointer(wrapper, 'pointerdown', { offsetX: 400, offsetY: 300 })
		await pointer(wrapper, 'pointermove', { offsetX: 420, offsetY: 330 })

		await wrapper.vm.done()

		expect(saveInk.mock.calls[0][4]).toEqual([400 - CROP_MARGIN, 300 - CROP_MARGIN])
	})

	it('keeps the drawing still across a save and an open', async () => {
		/* The round trip, which is the whole point: what is handed to saveInk
		   put back through the load has to come out where it started. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const first = await open({ png: new Blob(), strokes: [] })
		await pointer(first, 'pointerdown', { offsetX: 400, offsetY: 300 })
		await pointer(first, 'pointermove', { offsetX: 420, offsetY: 330 })
		await first.vm.done()
		const [, , , strokes, origin] = saveInk.mock.calls[0]

		const again = await open({ png: new Blob(), strokes, origin })

		expect(again.vm.strokes[0].points).toEqual([[400, 300, 0.5], [420, 330, 0.5]])
	})

	it('keeps only the samples that went somewhere', async () => {
		/* The Pencil reports each position twice, and a stroke built from the
		   pairs is a staircase: the curves came out faceted. Measured on the
		   device - 513 of 1038 gaps were exactly zero. */
		const wrapper = await open()
		await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: 10 })
		await pointer(wrapper, 'pointermove', { offsetX: 10, offsetY: 10 })
		await pointer(wrapper, 'pointermove', { offsetX: 12, offsetY: 11 })
		await pointer(wrapper, 'pointermove', { offsetX: 12, offsetY: 11 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].points).toEqual([[10, 10, 0.5], [12, 11, 0.5]])
	})

	it('keeps a stroke that never moved, which is a dot', async () => {
		const wrapper = await open()
		await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: 10 })
		await pointer(wrapper, 'pointermove', { offsetX: 10, offsetY: 10 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].points).toEqual([[10, 10, 0.5]])
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
			   recognizer taking it. Proven on the device, Scribble switched on. */
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

	it('names the tools it shows as icons', async () => {
		/* An icon with no name is a button nobody can describe: not to a screen
		   reader, not in a bug report, and not to themselves. */
		const wrapper = await open()
		/* Not the color or tool pickers' choices: the real menus are popovers
		   outside the bar, and the stub that stands in for them here renders
		   them in place. They are named by their text, and tested above. */
		const buttons = wrapper.find('.ink__bar').findAll('button')
			.filter((b) => !b.element.closest('.ink__color, .ink__tool-picker'))
		expect(buttons.map((b) => b.attributes('aria-label') || b.text()))
			.toEqual(['Erase', 'Undo', 'Cancel', 'Done'])
		/* The three tools are icons, so the name has to be written down; Done
		   says what it does in words and needs no second copy of it. */
		for (const [at, name] of [[0, 'Erase'], [1, 'Undo'], [2, 'Cancel']]) {
			expect(buttons[at].attributes('aria-label'), `${name} has no name of its own`).toBe(name)
			expect(buttons[at].text(), `${name} still carries text`).toBe('')
		}
		expect(buttons[3].text()).toBe('Done')
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

	/* A Pencil tap on a control in this dialog never arrives as a click: the
	   dialog refuses touchmove so a stroke dragged over the bar is not handed
	   to Scribble, and refusing it is enough for WebKit to call the tap a drag
	   and synthesize nothing. Reported from the device, and located by the one
	   control that did work - the colors in the menu, which is a popover and so
	   teleported out from under the guard. */
	it('runs a tool from a pen tap, which arrives as no click at all', async () => {
		const wrapper = await open()
		const erase = button(wrapper, 'Erase')

		await tap(wrapper, erase, 'pointerup', { pointerType: 'pen', timeStamp: 1000 })

		expect(wrapper.vm.erasing).toBe(true)
	})

	it('leaves a finger and a mouse to the click they already send', async () => {
		/* Those still click, so acting on their pointerup too would run the
		   tool twice and undo it. */
		const wrapper = await open()
		const erase = button(wrapper, 'Erase')

		await tap(wrapper, erase, 'pointerup', { pointerType: 'touch', timeStamp: 1000 })
		expect(wrapper.vm.erasing).toBe(false)

		await tap(wrapper, erase, 'pointerup', { pointerType: 'mouse', timeStamp: 1000 })
		expect(wrapper.vm.erasing).toBe(false)

		await tap(wrapper, erase, 'click', { timeStamp: 1000 })
		expect(wrapper.vm.erasing).toBe(true)
	})

	it('drops the click a pen tap may still send, so the tool runs once', async () => {
		const wrapper = await open()
		const erase = button(wrapper, 'Erase')

		await tap(wrapper, erase, 'pointerup', { pointerType: 'pen', timeStamp: 1000 })
		await tap(wrapper, erase, 'click', { timeStamp: 1050 })

		/* Not toggled back off. */
		expect(wrapper.vm.erasing).toBe(true)
	})

	it('takes a later click normally, so one pen tap cannot eat the next one', async () => {
		const wrapper = await open()
		const erase = button(wrapper, 'Erase')

		await tap(wrapper, erase, 'pointerup', { pointerType: 'pen', timeStamp: 1000 })
		expect(wrapper.vm.erasing).toBe(true)

		/* Well past the window: a separate tap, from a finger this time. */
		await tap(wrapper, erase, 'click', { timeStamp: 5000 })

		expect(wrapper.vm.erasing).toBe(false)
	})

	it('opens the color picker from a pen tap', async () => {
		const wrapper = await open()

		await tap(wrapper, wrapper.find('.ink__color'), 'pointerup', { pointerType: 'pen' })

		expect(wrapper.vm.picking).toBe(true)
	})

	it('closes the picker when a pen taps the trigger again', async () => {
		/* No click reaches the trigger from a Pencil, so without this the menu
		   can only be left by choosing a color or reaching for a finger. */
		const wrapper = await open()
		wrapper.vm.picking = true

		await tap(wrapper, wrapper.find('.ink__color'), 'pointerup', { pointerType: 'pen' })

		expect(wrapper.vm.picking).toBe(false)
	})

	it('refuses a pen tap on a tool the canvas is refusing', async () => {
		/* A disabled button is not reliably excused from pointer events, so the
		   tool repeats the condition its button is disabled on. */
		const wrapper = await open()
		wrapper.vm.refusing = true
		await wrapper.vm.$nextTick()

		await tap(wrapper, button(wrapper, 'Erase'), 'pointerup', { pointerType: 'pen', timeStamp: 1000 })

		expect(wrapper.vm.erasing).toBe(false)
	})

	it('closes the picker when a color is chosen', async () => {
		/* A radio choice does not dismiss an NcActions menu on its own, and a
		   menu left open over the canvas is in the way of the next stroke. */
		const wrapper = await open()
		wrapper.vm.picking = true

		wrapper.vm.chooseColor('#cc0000')

		expect(wrapper.vm.picking).toBe(false)
	})

	it('turns the eraser off when a color is chosen', async () => {
		/* Choosing a color says the next thing is a stroke. Staying in erase
		   mode means the reader draws expecting ink and takes away work
		   instead - which is the one thing on this canvas that destroys
		   something. */
		const wrapper = await open()
		wrapper.vm.erasing = true

		wrapper.vm.chooseColor('#0044cc')

		expect(wrapper.vm.erasing).toBe(false)
		expect(wrapper.vm.color).toBe('#0044cc')
	})

	it('closes the picker when the color already in use is chosen again', async () => {
		/* A radio reports a change, so re-choosing the current color emits
		   nothing at all - and the menu stayed open on a choice that had been
		   made. */
		const wrapper = await open()
		wrapper.vm.chooseColor('#cc0000')
		wrapper.vm.picking = true
		await wrapper.vm.$nextTick()

		await button(wrapper, 'Red').trigger('click')

		expect(wrapper.vm.picking).toBe(false)
		expect(wrapper.vm.color).toBe('#cc0000')
	})

	it('names every color, so the picker is not six unlabeled squares', async () => {
		const wrapper = await open()

		/* "Ink" rather than "Black" for the default: it is the one the theme is
		   applied to, and it draws white on a dark theme. */
		expect(wrapper.vm.colorChoices.map((choice) => choice.label))
			.toEqual(['Ink', 'Red', 'Orange', 'Green', 'Blue', 'Purple'])
	})

	it('marks which color is in use', async () => {
		const wrapper = await open()

		wrapper.vm.chooseColor('#0044cc')

		const chosen = wrapper.vm.colorChoices.filter((choice) => choice.chosen)
		expect(chosen).toHaveLength(1)
		expect(chosen[0].value).toBe('#0044cc')
	})

	it('opens in the color last used', async () => {
		window.localStorage.setItem('notes-ink-color', '#008800')

		const wrapper = await open()

		expect(wrapper.vm.color).toBe('#008800')
		window.localStorage.clear()
	})

	it('remembers a color when it is chosen', async () => {
		const wrapper = await open()

		wrapper.vm.chooseColor('#7733cc')

		expect(window.localStorage.getItem('notes-ink-color')).toBe('#7733cc')
		window.localStorage.clear()
	})

	it('leaves the strokes already drawn alone when the color changes', async () => {
		/* The picker sets what the next stroke will be. Changing it is not an
		   edit to the page. */
		const wrapper = await open()
		await pointer(wrapper, 'pointerdown', { offsetX: 30, offsetY: 30 })
		await pointer(wrapper, 'pointerup')

		wrapper.vm.chooseColor('#cc0000')

		expect(wrapper.vm.strokes[0].color).toBe(DEFAULT_INK_COLOR)
	})

	it('names every tool, so the picker is not four unlabeled icons', async () => {
		const wrapper = await open()

		expect(wrapper.vm.toolChoices.map((choice) => choice.label))
			.toEqual(['Pen', 'Line', 'Rectangle', 'Ellipse'])
	})

	it('marks which tool is in use', async () => {
		const wrapper = await open()

		wrapper.vm.chooseTool('rectangle')

		const chosen = wrapper.vm.toolChoices.filter((choice) => choice.chosen)
		expect(chosen).toHaveLength(1)
		expect(chosen[0].key).toBe('rectangle')
	})

	it('opens on the pen, however the last drawing ended', async () => {
		/* Deliberately unlike the color, which is remembered: a tool is a
		   momentary intent, and a reader coming back means to write. */
		const wrapper = await open()

		expect(wrapper.vm.tool).toBe('pen')
	})

	it('closes the tool menu when a tool is chosen', async () => {
		const wrapper = await open()
		wrapper.vm.choosingTool = true

		wrapper.vm.chooseTool('line')

		expect(wrapper.vm.choosingTool).toBe(false)
	})

	it('turns the eraser off when a tool is chosen', async () => {
		/* Choosing a tool says the next thing is a stroke, which is the rule
		   choosing a color already follows. The eraser is the one thing on this
		   canvas that destroys work. */
		const wrapper = await open()
		wrapper.vm.erasing = true

		wrapper.vm.chooseTool('ellipse')

		expect(wrapper.vm.erasing).toBe(false)
		expect(wrapper.vm.tool).toBe('ellipse')
	})

	it('refuses a tool it does not know', async () => {
		const wrapper = await open()

		wrapper.vm.chooseTool('triangle')

		expect(wrapper.vm.tool).toBe('pen')
	})

	it('leaves the tool alone when a color is chosen', async () => {
		/* They are orthogonal: a color says what the ink looks like, a tool
		   says what shape it takes. */
		const wrapper = await open()
		wrapper.vm.chooseTool('rectangle')

		wrapper.vm.chooseColor('#cc0000')

		expect(wrapper.vm.tool).toBe('rectangle')
	})

	it('opens the tool menu from a pen tap', async () => {
		const wrapper = await open()

		await tap(wrapper, wrapper.find('.ink__tool-picker'), 'pointerup', { pointerType: 'pen' })

		expect(wrapper.vm.choosingTool).toBe(true)
	})

	it('closes the tool menu when a pen taps the trigger again', async () => {
		const wrapper = await open()
		wrapper.vm.choosingTool = true

		await tap(wrapper, wrapper.find('.ink__tool-picker'), 'pointerup', { pointerType: 'pen' })

		expect(wrapper.vm.choosingTool).toBe(false)
	})

	it('marks a committed shape ruled, and a handwritten stroke not', async () => {
		/* The flag is what tells the renderer the points are a construction
		   and are not to be smoothed, which is what keeps a corner square. It
		   has to survive the file, so it lives on the stroke. */
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'
		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 120, offsetY: 90 })
		await pointer(wrapper, 'pointerup')

		wrapper.vm.tool = 'pen'
		await pointer(wrapper, 'pointerdown', { offsetX: 200, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 220, offsetY: 40 })
		await pointer(wrapper, 'pointerup')

		const [shape, hand] = wrapper.vm.strokes
		expect(shape.ruled).toBe(true)
		expect(hand.ruled).toBeFalsy()
	})

	it('trusts nothing but true for ruled in a file', async () => {
		/* Strokes arrive from a file anything could have written. A stroke
		   carrying something else must draw as a hand, not throw. */
		const wrapper = await open({
			png: new Blob(),
			origin: [0, 0],
			strokes: [
				{ points: [[1, 1, 0.5], [9, 9, 0.5]], color: '#000000', ruled: 'yes' },
				{ points: [[2, 2, 0.5], [8, 8, 0.5]], color: '#000000', ruled: true },
				{ points: [[3, 3, 0.5], [7, 7, 0.5]], color: '#000000' },
			],
		})

		expect(wrapper.vm.strokes.map((stroke) => stroke.ruled)).toEqual([undefined, true, undefined])
	})

	it('shuts the tool menu when the color picker opens', async () => {
		/* Two popovers over one small bar. Whichever way a menu is opened -
		   the component's own click, or the pen's toggle - the other one goes,
		   so a reader is never choosing between two open lists. */
		const wrapper = await open()
		wrapper.vm.choosingTool = true
		/* Settled before the other is touched: one menu is already open when
		   the reader reaches for the other. */
		await wrapper.vm.$nextTick()

		wrapper.vm.picking = true
		await wrapper.vm.$nextTick()

		expect(wrapper.vm.choosingTool).toBe(false)
		expect(wrapper.vm.picking).toBe(true)
	})

	it('shuts the color picker when the tool menu opens', async () => {
		const wrapper = await open()
		wrapper.vm.picking = true
		/* Settled before the other is touched: one menu is already open when
		   the reader reaches for the other. */
		await wrapper.vm.$nextTick()

		wrapper.vm.choosingTool = true
		await wrapper.vm.$nextTick()

		expect(wrapper.vm.picking).toBe(false)
		expect(wrapper.vm.choosingTool).toBe(true)
	})

	it('leaves the focus alone while the tool menu is open', async () => {
		/* The tool menu is a popover too, teleported out of the dialog, so
		   claimFocus() would take the focus back from it and shut it mid-choice
		   - on a rotation, which is where the color picker's twin was found. */
		const wrapper = await open(null, { attachTo: document.body })
		wrapper.vm.choosingTool = true
		const elsewhere = document.createElement('button')
		document.body.appendChild(elsewhere)
		elsewhere.focus()

		wrapper.vm.claimFocus()

		expect(document.activeElement).toBe(elsewhere)
		elsewhere.remove()
		wrapper.unmount()
	})

	it('takes the focus back when it lands outside the dialog', async () => {
		/* The dialog's whole defence against Scribble is holding the focus:
		   nothing inside it is a text field, so there is nothing for a
		   recognizer to write into. Claiming it once at mount is not enough.
		   Moving the pen into the browser's own address bar takes the focus
		   out of the page entirely, and on the way back it lands wherever
		   WebKit puts it - which leaves the note's editor as the nearest text
		   field, and handwriting arrived there as text. */
		const wrapper = await open(null, { attachTo: document.body })
		const elsewhere = document.createElement('input')
		document.body.appendChild(elsewhere)

		elsewhere.focus()
		document.dispatchEvent(new Event('focusin', { bubbles: true }))

		expect(wrapper.find('.ink').element.contains(document.activeElement)).toBe(true)
		elsewhere.remove()
		wrapper.unmount()
	})

	it('takes the focus back when the page itself regains it', async () => {
		/* Coming back from the browser's chrome fires this on the window and
		   may fire nothing on the document. */
		const wrapper = await open(null, { attachTo: document.body })
		const elsewhere = document.createElement('input')
		document.body.appendChild(elsewhere)
		elsewhere.focus()

		window.dispatchEvent(new Event('focus'))

		expect(wrapper.find('.ink').element.contains(document.activeElement)).toBe(true)
		elsewhere.remove()
		wrapper.unmount()
	})

	it('does not take the focus from a picker that is open', async () => {
		/* The menus are popovers, teleported out of the dialog, so `contains`
		   says no. Taking the focus back would shut one mid-choice. */
		const wrapper = await open(null, { attachTo: document.body })
		wrapper.vm.picking = true
		await wrapper.vm.$nextTick()
		const choice = document.createElement('button')
		document.body.appendChild(choice)
		choice.focus()

		document.dispatchEvent(new Event('focusin', { bubbles: true }))

		expect(document.activeElement).toBe(choice)
		choice.remove()
		wrapper.unmount()
	})

	it('holds the editor behind it out of reach while it is open', async () => {
		/* Holding the focus is a race the dialog can lose; this removes what
		   the recognizer would write into. An inert editor is not focusable
		   and not editable, so there is no text field behind the canvas. */
		const behind = document.createElement('div')
		behind.setAttribute('contenteditable', 'true')
		document.body.appendChild(behind)
		const wrapper = await open(null, { attachTo: document.body, props: { noteId: 5, inkId: 'abc', behind } })

		expect(behind.hasAttribute('inert')).toBe(true)

		wrapper.unmount()
		expect(behind.hasAttribute('inert')).toBe(false)
		behind.remove()
	})

	it('lets the note have the focus back as it closes', async () => {
		/* The editor is made reachable again before the focus is handed to
		   it: focusing an inert element does nothing, which would leave the
		   note with no caret. */
		const behind = document.createElement('div')
		behind.tabIndex = -1
		document.body.appendChild(behind)
		behind.focus()
		const wrapper = await open(null, { attachTo: document.body, props: { noteId: 5, inkId: 'abc', behind } })

		wrapper.unmount()

		expect(behind.hasAttribute('inert')).toBe(false)
		expect(document.activeElement).toBe(behind)
		behind.remove()
	})

	it('leaves the focus alone while the picker is open', async () => {
		/* The dialog holds the focus on purpose: iPadOS Scribble writes into
		   whatever text field has it, and the note's editor is right behind
		   this. The picker's popover teleports to <body>, so it is NOT inside
		   the dialog - and claimFocus() returns early only when the dialog
		   contains the active element. Called while the menu is open it would
		   take the focus back and shut the menu.
		 *
		 * fit() is the only caller and ensureFitted() only calls it when the
		 * backing size changed - a rotation, or the error message appearing.
		 * Both of those happen on the device, which is the one place this
		 * would be found. */
		const wrapper = await open(null, { attachTo: document.body })
		wrapper.vm.picking = true
		const elsewhere = document.createElement('button')
		document.body.appendChild(elsewhere)
		elsewhere.focus()

		wrapper.vm.claimFocus()

		expect(document.activeElement).toBe(elsewhere)
		elsewhere.remove()
		wrapper.unmount()
	})

	it('takes the focus back once the picker closes', async () => {
		/* The guard above must not become a way to leave the focus outside the
		   dialog for good - that is the state Scribble writes into the note
		   from. */
		const wrapper = await open(null, { attachTo: document.body })
		wrapper.vm.picking = false
		const elsewhere = document.createElement('button')
		document.body.appendChild(elsewhere)
		elsewhere.focus()

		wrapper.vm.claimFocus()

		/* On the dialog itself, not merely off the button: focus that fell to
		   the body would also be "not elsewhere", and is the state this test
		   exists to rule out. */
		expect(document.activeElement).toBe(wrapper.find('[role="dialog"]').element)
		elsewhere.remove()
		wrapper.unmount()
	})

	it('undoes a stroke with the color it was drawn in, not the one now chosen', async () => {
		const wrapper = await open()
		wrapper.vm.chooseColor('#cc0000')
		await pointer(wrapper, 'pointerdown', { offsetX: 30, offsetY: 30 })
		await pointer(wrapper, 'pointerup')
		wrapper.vm.chooseColor('#0044cc')
		await pointer(wrapper, 'pointerdown', { offsetX: 60, offsetY: 60 })
		await pointer(wrapper, 'pointerup')

		wrapper.vm.undo()

		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.strokes[0].color).toBe('#cc0000')
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
		expect(pictures[0].width).toBe(Math.ceil((20 + CROP_MARGIN * 2) * INK_DENSITY))
		expect(pictures[0].height).toBe(Math.ceil((30 + CROP_MARGIN * 2) * INK_DENSITY))
		/* The stroke still under the pen was committed before it was drawn. */
		expect(saveInk).toHaveBeenCalledTimes(1)
		expect(saveInk.mock.calls[0][3]).toHaveLength(1)
	})

	it('saves the same picture whatever the screen it was drawn on', async () => {
		/* The pixels in the file used to be the drawing device's own: the same
		   handwriting came out twice the size in the note if it had been
		   written on the iPad rather than the Mac. And the note shows ink at a
		   size fixed against this density, so a device-dependent one would show
		   it at a device-dependent size too. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		vi.stubGlobal('devicePixelRatio', 3)
		const wrapper = await open({ png: new Blob(), strokes: [] })
		const pictures = []
		HTMLCanvasElement.prototype.toBlob = function(cb) {
			pictures.push({ width: this.width, height: this.height })
			cb(new Blob([new Uint8Array([1])]))
		}
		await pointer(wrapper, 'pointerdown', { offsetX: 400, offsetY: 300 })
		await pointer(wrapper, 'pointermove', { offsetX: 420, offsetY: 330 })

		await wrapper.vm.done()

		expect(pictures[0].width).toBe(Math.ceil((20 + CROP_MARGIN * 2) * INK_DENSITY))
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

	it('draws each stroke in its own color', async () => {
		const wrapper = await open()
		wrapper.vm.strokes = [
			{ points: [[10, 10, 0.5]], color: '#cc0000' },
			{ points: [[20, 20, 0.5]], color: '#0044cc' },
		]

		wrapper.vm.renderPage()

		/* The context carries one color at a time, so what is asserted is the
		   sequence it was set to - the last stroke's color is all that would
		   survive on the context itself. */
		expect(page(wrapper).fillStyles).toEqual(['#cc0000', '#0044cc'])
	})

	it('paints the stroke under the pen in its own color', async () => {
		/* The sheet under the pen is where a stroke is seen while it is being
		   written. Without its own fill the stroke would take whatever color
		   the context last carried, and snap to the right one only when the
		   pen lifted and the page redrew it. */
		const wrapper = await open({ png: new Blob(), strokes: [] })
		wrapper.vm.current = { points: [[10, 10, 0.5], [20, 20, 0.5]], color: '#cc0000' }

		wrapper.vm.paintLive()

		expect(live(wrapper).fillStyles).toEqual(['#cc0000'])
	})

	it('commits a finished stroke to the page in the color it was drawn in', async () => {
		/* Lifting the pen moves the stroke from the live sheet down onto the
		   page, traced there once and never redrawn. If that trace carried no
		   color of its own, the stroke would change color the moment it was
		   finished. */
		const wrapper = await open()
		wrapper.vm.chooseColor('#cc0000')
		await wrapper.vm.$nextTick()
		const beneath = page(wrapper)

		await pointer(wrapper, 'pointerdown', { offsetX: 30, offsetY: 30 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(beneath.fillStyles).toEqual(['#cc0000'])
	})

	it('draws a stroke with no color of its own in the default', async () => {
		/* Every file written before strokes carried a color. */
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[10, 10, 0.5]] }]

		wrapper.vm.renderPage()

		expect(page(wrapper).fillStyles).toEqual([DEFAULT_INK_COLOR])
	})

	it('refuses a color from a file that is not in the palette', async () => {
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[10, 10, 0.5]], color: '#ff00ff' }]

		wrapper.vm.renderPage()

		expect(page(wrapper).fillStyles).toEqual([DEFAULT_INK_COLOR])
	})

	it('saves a picture whose strokes are the colors they were drawn in', async () => {
		/* The picture is a canvas of its own, built when Done is pressed, and
		   nothing else reaches it. If it filled every stroke in one color the
		   page would show red and blue while the saved file said black - the
		   picture disagreeing with its own strokes. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open()
		wrapper.vm.strokes = [
			{ points: [[10, 10, 0.5]], color: '#cc0000' },
			{ points: [[20, 20, 0.5]], color: '#0044cc' },
		]
		/* The picture's canvas is never held by the component or in the
		   document, so the only place to meet it is where it is made. */
		const made = []
		const create = document.createElement.bind(document)
		const spy = vi.spyOn(document, 'createElement').mockImplementation((...args) => {
			const element = create(...args)
			if (args[0] === 'canvas') {
				made.push(element)
			}
			return element
		})

		/* Restored in a finally: a done() that rejected would otherwise leave a
		   patched document.createElement behind for every later test. */
		try {
			await wrapper.vm.done()
		} finally {
			spy.mockRestore()
		}

		/* Vue also remakes the dialog's own two sheets while saving; the
		   picture is the one canvas that is none of them. */
		const pictures = made.filter((canvas) => !canvas.classList.contains('ink__canvas'))
		expect(pictures).toHaveLength(1)
		expect(pictures[0].getContext('2d').fillStyles).toEqual(['#cc0000', '#0044cc'])
	})

	it('saves a refused color as the one it was drawn in, not the one it came in with', async () => {
		/* Validating only on the way to the canvas would leave the picture
		   black and the metadata beside it still claiming magenta - a file
		   that disagrees with itself for good. The strokes a canvas holds are
		   the ones it draws. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({
			png: new Blob(),
			strokes: [{ points: [[10, 10, 0.5]], color: '#ff00ff' }],
			origin: null,
		})

		await wrapper.vm.done()

		expect(saveInk.mock.calls[0][3][0].color).toBe(DEFAULT_INK_COLOR)
	})

	it('gives a stroke loaded without a color one of its own', async () => {
		/* Every file written before this change. Opening and saving it makes
		   it say what it has always drawn. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open({
			png: new Blob(),
			strokes: [{ points: [[10, 10, 0.5]] }],
			origin: null,
		})

		await wrapper.vm.done()

		expect(saveInk.mock.calls[0][3][0].color).toBe(DEFAULT_INK_COLOR)
	})

	it('stamps the color in force onto the stroke being drawn', async () => {
		const wrapper = await open()
		wrapper.vm.color = '#008800'

		await pointer(wrapper, 'pointerdown', { offsetX: 30, offsetY: 30 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].color).toBe('#008800')
	})

	it('saves the strokes with their colors', async () => {
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open()
		wrapper.vm.strokes = [{ points: [[10, 10, 0.5]], color: '#7733cc' }]

		await wrapper.vm.done()

		const saved = saveInk.mock.calls[0][3]
		expect(saved[0].color).toBe('#7733cc')
	})

	it('leaves the color off the context, since a stroke carries its own', async () => {
		const wrapper = await open({ png: new Blob(), strokes: [] })
		wrapper.vm.paintLive()
		/* fit() no longer sets a color: it belongs to the stroke now, and a
		   resize has none to lose. */
		expect(live(wrapper).fillStyles).toEqual([])
		expect(page(wrapper).fillStyles).toEqual([])
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

	it('commits a rectangle as an ordinary stroke', async () => {
		/* The whole design in one assertion: what a shape leaves behind is a
		   stroke like any other, so everything downstream keeps working. */
		const wrapper = await open()
		/* A canvas opens on the pen. */
		expect(wrapper.vm.tool).toBe(DEFAULT_TOOL)
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.strokes[0].color).toBe(DEFAULT_INK_COLOR)
		expect(wrapper.vm.strokes[0].points.length).toBeGreaterThan(50)
		/* One shape is one thing to undo. */
		expect(wrapper.vm.history).toHaveLength(1)
	})

	it('draws the shape in the color in force', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'line'
		wrapper.vm.chooseColor('#0044cc')

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 200, offsetY: 20 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].color).toBe('#0044cc')
	})

	it('builds a shape from page coordinates, so a panned page draws under the pen', async () => {
		/* Strokes are kept in the page's coordinates and the sheets are the
		   screen's. A shape built from screen coordinates would land panY
		   pixels from the pen. */
		const wrapper = await open()
		wrapper.vm.tool = 'line'
		wrapper.vm.panY = 100

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 200, offsetY: 20 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].points[0][1]).toBe(120)
	})

	it('clamps a shape dragged off the side of the canvas', async () => {
		/* Ink off the sides can be neither seen nor rubbed out. There is no
		   bottom to clamp to: the page grows with what is drawn on it. */
		const wrapper = await open()
		wrapper.vm.tool = 'line'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 40 })
		await pointer(wrapper, 'pointermove', { offsetX: 5000, offsetY: -200 })
		await pointer(wrapper, 'pointerup')

		const xs = wrapper.vm.strokes[0].points.map(([x]) => x)
		expect(Math.max(...xs)).toBeLessThanOrEqual(800)
	})

	it('clamps a rectangle dragged off the top and the side, where a line would only be snapped', async () => {
		/* A line this far off level is snapped flat, which would put every y
		   on the anchor whether or not the clamp did anything. A rectangle
		   is not snapped, so its extent is the clamp's alone. */
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 400, offsetY: 200 })
		await pointer(wrapper, 'pointermove', { offsetX: 420, offsetY: -300 })
		await pointer(wrapper, 'pointerup')

		const ys = wrapper.vm.strokes[0].points.map(([, y]) => y)
		expect(Math.min(...ys)).toBe(0)
		expect(Math.max(...ys)).toBe(200)

		await pointer(wrapper, 'pointerdown', { offsetX: 100, offsetY: 200 })
		await pointer(wrapper, 'pointermove', { offsetX: -500, offsetY: 300 })
		await pointer(wrapper, 'pointerup')

		const xs = wrapper.vm.strokes[1].points.map(([x]) => x)
		expect(Math.min(...xs)).toBe(0)
		expect(Math.max(...xs)).toBe(100)
	})

	it('commits nothing for a drag that never grew', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 50, offsetY: 50 })
		await pointer(wrapper, 'pointermove', { offsetX: 53, offsetY: 51 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(0)
		expect(wrapper.vm.history).toHaveLength(0)
	})

	it('abandons a shape when the pointer is cancelled', async () => {
		/* A half-drawn freehand stroke is real ink that was really laid down,
		   so it commits. A shape is only itself once the reader has said where
		   it ends. */
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await pointer(wrapper, 'pointercancel')

		expect(wrapper.vm.strokes).toHaveLength(0)
		expect(wrapper.vm.shaping).toBeNull()
	})

	it('still commits a freehand stroke when the pointer is cancelled', async () => {
		/* The other half of the rule above: a stroke is ink that was laid
		   down, and cancelling keeps it as lifting the pen would. */
		const wrapper = await open()

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await pointer(wrapper, 'pointercancel')

		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.strokes[0].points.length).toBeGreaterThan(1)
		expect(wrapper.vm.current).toBeNull()
	})

	it('ignores a second pointer during a shape, as a palm beside the pen', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await pointer(wrapper, 'pointermove', { offsetX: 400, offsetY: 400, pointerId: 2 })
		await pointer(wrapper, 'pointerup')

		const xs = wrapper.vm.strokes[0].points.map(([x]) => x)
		expect(Math.max(...xs)).toBe(160)
	})

	it('does not let a finger pan the page while a shape is being dragged', async () => {
		/* A palm landing mid-drag would pan the page, and the anchor was taken
		   in the coordinates the old pan gave it - the shape would reanchor
		   under the pen. Freehand and the eraser are already refused here. */
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await pointer(wrapper, 'pointerdown', { pointerType: 'touch', pointerId: 2, offsetX: 400, offsetY: 400 })

		expect(wrapper.vm.panning).toBeNull()
	})

	describe('the page cannot move under a shape being dragged', () => {
		/* A shape's anchor is converted to page coordinates once, in the
		   panY of the moment the pen landed. Anything that changes panY
		   after that puts its two corners in different frames. */
		const stroke = { points: [[10, 0, 0.5], [10, 2000, 0.5]] }

		async function dragged(wrapper, move) {
			await pointer(wrapper, 'pointermove', move)
			await pointer(wrapper, 'pointerup')
			const ys = wrapper.vm.strokes.at(-1).points.map(([, y]) => y)
			return Math.max(...ys) - Math.min(...ys)
		}

		it('holds still for the wheel', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [stroke] })
			wrapper.vm.tool = 'rectangle'
			await wrapper.vm.$nextTick()
			/* A stubbed Teleport hands back a new canvas after a re-render, and
			   the wheel listener belongs to the one that was there. The app
			   does this itself whenever the sheet is refitted. */
			wrapper.vm.refuseTouchDefaults()

			await pointer(wrapper, 'pointerdown', { offsetX: 100, offsetY: 20 })
			const wheel = new Event('wheel', { bubbles: true, cancelable: true })
			Object.defineProperty(wheel, 'deltaY', { value: 200 })
			wrapper.find('.ink__canvas--live').element.dispatchEvent(wheel)
			await wrapper.vm.$nextTick()

			/* Without this the test passes on a listener that is not there. */
			expect(wheel.defaultPrevented).toBe(true)
			expect(wrapper.vm.panY).toBe(0)
			expect(await dragged(wrapper, { offsetX: 200, offsetY: 120 })).toBe(100)
		})

		it('holds still for anything that asks the page to move', async () => {
			/* The chokepoint, so a caller added later is covered too. */
			const wrapper = await open({ png: new Blob(), strokes: [stroke] })
			wrapper.vm.tool = 'rectangle'
			wrapper.vm.panY = 300

			await pointer(wrapper, 'pointerdown', { offsetX: 100, offsetY: 20 })
			wrapper.vm.panTo(0)

			expect(wrapper.vm.panY).toBe(300)
			expect(await dragged(wrapper, { offsetX: 200, offsetY: 120 })).toBe(100)
		})

		it('moves again once the shape has landed', async () => {
			const wrapper = await open({ png: new Blob(), strokes: [stroke] })
			wrapper.vm.tool = 'rectangle'

			await pointer(wrapper, 'pointerdown', { offsetX: 100, offsetY: 20 })
			await pointer(wrapper, 'pointermove', { offsetX: 200, offsetY: 120 })
			await pointer(wrapper, 'pointerup')
			wrapper.vm.panTo(150)

			expect(wrapper.vm.panY).toBe(150)
		})
	})

	describe('undo while a shape is being dragged', () => {
		it('takes back the shape in progress and leaves the earlier stroke alone', async () => {
			const wrapper = await open()
			await pointer(wrapper, 'pointerdown', { offsetX: 5, offsetY: 5 })
			await pointer(wrapper, 'pointermove', { offsetX: 50, offsetY: 5 })
			await pointer(wrapper, 'pointerup')
			wrapper.vm.tool = 'rectangle'

			await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
			await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
			wrapper.vm.undo()

			expect(wrapper.vm.shaping).toBeNull()
			expect(wrapper.vm.strokes).toHaveLength(1)
			expect(wrapper.vm.history).toHaveLength(1)

			/* And lifting the pen afterwards does not bring it back. */
			await pointer(wrapper, 'pointerup')
			expect(wrapper.vm.strokes).toHaveLength(1)
		})

		it('does not move the page, so the box is the size that was dragged', async () => {
			/* Undo used to take the page's only stroke and with it the page's
			   length, dropping panY under the anchor. */
			const wrapper = await open()
			wrapper.vm.panY = 300
			await pointer(wrapper, 'pointerdown', { offsetX: 5, offsetY: 20 })
			await pointer(wrapper, 'pointermove', { offsetX: 50, offsetY: 20 })
			await pointer(wrapper, 'pointerup')
			expect(wrapper.vm.history).toHaveLength(1)
			wrapper.vm.tool = 'rectangle'

			await pointer(wrapper, 'pointerdown', { offsetX: 100, offsetY: 20 })
			wrapper.vm.undo()
			await pointer(wrapper, 'pointermove', { offsetX: 200, offsetY: 120 })
			await pointer(wrapper, 'pointerup')

			expect(wrapper.vm.panY).toBe(300)
			expect(wrapper.vm.strokes).toHaveLength(1)
		})
	})

	it('drops a shape in progress when another tool is chosen', async () => {
		/* Otherwise whether it commits depends on a pointermove arriving
		   after the choice: with one it vanishes, without one it lands. */
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		wrapper.vm.chooseTool('pen')
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.shaping).toBeNull()
		expect(wrapper.vm.strokes).toHaveLength(0)
		expect(wrapper.vm.history).toHaveLength(0)
	})

	it('takes a coalesced batch once, even when two moves report the same one', async () => {
		/* getCoalescedEvents reports the samples gathered since the last
		   animation frame. On a quiet page Safari dispatches one pointermove
		   per frame and the batches never overlap; on a busy one it dispatches
		   more than one, and each reports the same batch. Appending both made
		   the stroke run forward, jump back and retrace itself.
		 *
		 * Measured in a drawing made on a real server: 49% of the samples in
		 * one stroke were repeats, and the path jumped backwards up to 28.9 px,
		 * 64 times. The same iPad on an empty page produced 0.6%. */
		const wrapper = await open()
		const batch = (points, at) => ({
			getCoalescedEvents: () => points.map(([x, y], i) => ({ offsetX: x, offsetY: y, pressure: 0.5, timeStamp: at + i })),
			timeStamp: at + points.length,
		})
		const samples = [[20, 20], [24, 24], [28, 28], [32, 32]]

		await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: 10 })
		await pointer(wrapper, 'pointermove', batch(samples, 100))
		/* The same frame's batch, reported again by a second move. */
		await pointer(wrapper, 'pointermove', batch(samples, 100))
		await pointer(wrapper, 'pointerup')

		/* The one sample the pen landed on, and the four it moved through. */
		expect(wrapper.vm.strokes[0].points).toHaveLength(5)
	})

	it('still takes a later batch that carries on from the one before', async () => {
		const wrapper = await open()
		const batch = (points, at) => ({
			getCoalescedEvents: () => points.map(([x, y], i) => ({ offsetX: x, offsetY: y, pressure: 0.5, timeStamp: at + i })),
			timeStamp: at + points.length,
		})

		await pointer(wrapper, 'pointerdown', { offsetX: 10, offsetY: 10 })
		await pointer(wrapper, 'pointermove', batch([[20, 20], [24, 24]], 100))
		await pointer(wrapper, 'pointermove', batch([[28, 28], [32, 32]], 110))
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes[0].points).toHaveLength(5)
	})

	it('draws freehand when the tool is one it does not know', async () => {
		/* Refusing to draw at all would be the worst outcome available. */
		const wrapper = await open()
		wrapper.vm.tool = 'triangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 60, offsetY: 60 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(1)
		/* Two samples, not a rectangle's hundred. */
		expect(wrapper.vm.strokes[0].points.length).toBeLessThan(10)
	})

	it('previews the shape on the live sheet while it is being dragged', async () => {
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'
		traceStroke.mockClear()

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		runFrame()

		expect(traceStroke).toHaveBeenCalled()
		/* And nothing is on the page yet. */
		expect(wrapper.vm.strokes).toHaveLength(0)
	})

	it('erases rather than drawing a shape while the eraser is on', async () => {
		/* A stroke under the pen, so there is something for an eraser to take:
		   without it this holds on a canvas whose pointerdown does nothing. */
		const wrapper = await open({ png: new Blob(), strokes: [{ points: [[10, 20, 0.5], [60, 20, 0.5]] }] })
		wrapper.vm.tool = 'rectangle'
		wrapper.vm.erasing = true
		expect(wrapper.vm.strokes).toHaveLength(1)

		await pointer(wrapper, 'pointerdown', { offsetX: 30, offsetY: 20 })
		await pointer(wrapper, 'pointerup')

		expect(wrapper.vm.strokes).toHaveLength(0)
		expect(wrapper.vm.shaping).toBeNull()
	})

	it('keeps a shape that was being dragged when Done was pressed', async () => {
		/* The reader is looking at it on the live sheet. The one control that
		   means "keep this" must not be the one that throws it away. */
		saveInk.mockResolvedValue('.attachments.5/ink-abc.png')
		const wrapper = await open()
		wrapper.vm.tool = 'rectangle'

		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })
		await pointer(wrapper, 'pointermove', { offsetX: 160, offsetY: 120 })
		await wrapper.vm.done()

		expect(wrapper.vm.strokes).toHaveLength(1)
		expect(wrapper.vm.shaping).toBeNull()
	})
	it('leaves an eraser pass alone when there is no shape to finish', async () => {
		/* Done finishes whatever is in progress. Finishing a shape that does
		   not exist must not take the pointer from a rub that does. */
		const wrapper = await open()
		wrapper.vm.erasing = true
		await pointer(wrapper, 'pointerdown', { offsetX: 20, offsetY: 20 })

		wrapper.vm.finishShape()

		expect(wrapper.vm.rubbing).not.toBeNull()
		expect(wrapper.vm.pointerId).toBe(1)
	})
})
