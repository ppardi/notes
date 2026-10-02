<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<Teleport to="body">
		<div ref="dialog"
			class="ink"
			role="dialog"
			tabindex="-1"
			:aria-label="t('notes', 'Ink')"
		>
			<div class="ink__stage"
				:class="{ 'ink__stage--above': morePageAbove, 'ink__stage--below': morePageBelow }"
			>
				<img v-if="backdrop"
					class="ink__backdrop"
					:src="backdrop"
					:alt="t('notes', 'The ink as it is saved')"
				>
				<!-- What has been written already. Not touched while writing,
				     so the cost of a stroke does not grow with the page. -->
				<canvas ref="page" class="ink__canvas ink__canvas--page" aria-hidden="true" />
				<!-- The stroke under the pen, alone on a transparent sheet
				     above it. The two are composited by the browser, which is
				     what a compositor is for. -->
				<canvas
					ref="canvas"
					class="ink__canvas ink__canvas--live"
					:class="{ 'ink__canvas--erasing': erasing }"
					@pointerdown="onDown"
					@pointermove="onMove"
					@pointerup="onUp"
					@pointercancel="onCancel"
				/>
			</div>
			<!-- The tools are icons and Done is words: the three that change
			     what is on the page are reached with a glance, and the one
			     that ends the session says so. Each icon carries its own
			     name, which is what a screen reader reads and what a tooltip
			     shows. -->
			<div class="ink__bar">
				<!-- The color in use is the button: a reader can see what the
				     pen will draw without opening anything. Six swatches in
				     the bar itself would be faster by one tap and leave no
				     room for the tools. -->
				<NcActions v-model:open="picking"
					class="ink__color"
					:aria-label="t('notes', 'Color: {color}', { color: colorLabel })"
					:title="t('notes', 'Color: {color}', { color: colorLabel })"
					:disabled="!accepting()"
					@pointerup="togglePicker"
				>
					<template #icon>
						<span class="ink__swatch" :style="{ background: color }" />
					</template>
					<!-- Radio rather than six toggles. These are one choice
					     among six, and NcActionButton's default behavior with
					     a boolean model-value is a toggle button - which a
					     reader listening would hear as six separate pressed
					     and unpressed buttons rather than as a single pen.

					     Bound to the click as well as the model, because a
					     radio reports only a change: choosing the color
					     already in use emits nothing, and the menu sat open
					     on a choice that had been made. Both can fire for one
					     tap, which is harmless - chooseColor says the same
					     thing twice. -->
					<NcActionButton v-for="choice in colorChoices"
						:key="choice.key"
						type="radio"
						:modelValue="color"
						:value="choice.value"
						@update:modelValue="chooseColor(choice.value)"
						@click="chooseColor(choice.value)"
					>
						<template #icon>
							<span class="ink__swatch ink__swatch--choice" :style="{ background: choice.value }" />
						</template>
						{{ choice.label }}
					</NcActionButton>
				</NcActions>
				<NcButton class="ink__tool"
					:aria-label="t('notes', 'Erase')"
					:title="t('notes', 'Erase')"
					:pressed="erasing"
					:disabled="!accepting()"
					@pointerup="onTool($event, toggleErasing)"
					@click="onTool($event, toggleErasing)"
				>
					<template #icon>
						<EraserIcon :size="20" />
					</template>
				</NcButton>
				<NcButton :aria-label="t('notes', 'Undo')"
					:title="t('notes', 'Undo')"
					:disabled="!history.length || saving"
					@pointerup="onTool($event, undo)"
					@click="onTool($event, undo)"
				>
					<template #icon>
						<UndoIcon :size="20" />
					</template>
				</NcButton>
				<NcButton :aria-label="t('notes', 'Cancel')"
					:title="t('notes', 'Cancel')"
					@pointerup="onTool($event, cancel)"
					@click="onTool($event, cancel)"
				>
					<template #icon>
						<CloseIcon :size="20" />
					</template>
				</NcButton>
				<NcButton variant="primary"
					:disabled="!ready || saving"
					@pointerup="onTool($event, done)"
					@click="onTool($event, done)"
				>
					{{ t('notes', 'Done') }}
				</NcButton>
			</div>
			<p v-if="error" class="ink__error" role="alert">
				{{ error }}
			</p>
		</div>
	</Teleport>
</template>

<script>
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import CloseIcon from 'vue-material-design-icons/Close.vue'
import EraserIcon from 'vue-material-design-icons/Eraser.vue'
import UndoIcon from 'vue-material-design-icons/UndoVariant.vue'
import { erasedBy, ERASER_SIZE, traceEraser } from '../inkErase.js'
import { loadInk, saveInk } from '../inkFile.js'
import { predictedFrom, samplesFrom, shouldDraw, withoutRepeats } from '../inkInput.js'
import { INK_COLORS, knownColor, rememberColor, rememberedColor } from '../inkPalette.js'
import { INK_DENSITY, inkBounds, placeInk, shiftStrokes, STROKE_SIZE, traceStroke } from '../inkRender.js'
import { DEFAULT_TOOL, knownTool, shapePoints } from '../inkShape.js'

/* How far a finger travels before it is moving the page rather than resting on
   it. A tap, and a hand settling, both report a little movement. */
const PAN_THRESHOLD = 8

/* How long after a pen's tap a click is the same tap arriving twice, in ms.
   Generous: the cost of being wrong is one ignored click, and the cost of
   being too strict is a tool that fires twice and undoes itself. */
const PEN_TAP_CLICK = 700

export default {
	name: 'InkCanvas',

	components: {
		CloseIcon,
		EraserIcon,
		NcActionButton,
		NcActions,
		NcButton,
		UndoIcon,
	},

	props: {
		noteId: {
			type: Number,
			required: true,
		},

		inkId: {
			type: String,
			required: true,
		},
	},

	emits: ['saved', 'close'],

	data() {
		return {
			strokes: [],
			/* What was done here, so it can be taken back: one entry for each
			   stroke drawn and each pass of the eraser. Not what was loaded -
			   Undo reverses what happened on this canvas, and the eraser is
			   how a mark that was there before is taken out. */
			history: [],
			erasing: false,
			/* When a pen last activated a tool, so the click that may follow
			   the same tap can be told from a new one. */
			penTapAt: -Infinity,
			/* What the next stroke will be drawn in, starting where the last
			   canvas left it. A stroke keeps the color it was drawn with, so
			   changing this never alters the page. */
			color: rememberedColor(),
			/* What the pen draws: the pen itself, or one of the shapes. Not
			   remembered between drawings - a color is a preference, a tool is
			   a momentary intent. */
			tool: DEFAULT_TOOL,
			/* The shape being dragged out, before it is a stroke:
			   { from: [x, y], points: [...] }. Null the rest of the time. */
			shaping: null,
			/* Whether the picker's menu is open. NcActions manages this
			   itself; the component has to know because the menu lives
			   outside the dialog and the dialog takes the focus back from
			   anything outside it. */
			picking: false,
			/* How far down the page the top of the screen is. The two sheets
			   stay the size of the screen and the page is as long as it needs
			   to be: this is the one number that turns the one into a window
			   onto the other. Page coordinates are screen coordinates plus
			   this, and the strokes are kept in the page's. */
			panY: 0,
			current: null,
			pointerId: null,
			pointerType: null,
			ready: false,
			saving: false,
			error: '',
			/* Set when the canvas must change nothing at all: the existing ink
			   could not be read, so anything drawn here would be saved over
			   it. A save that failed is not this - that ink is still here to
			   try again with, and adding to it has to keep working. */
			refusing: false,
			backdrop: '',
		}
	},

	computed: {
		/* Whether the page carries on past the top and the bottom of the
		   screen. The ink moving under the finger says the page is moving;
		   these are what say there is more of it to move to. */
		morePageAbove() {
			return this.panY > 0
		},

		morePageBelow() {
			return this.panY < this.panLimit()
		},

		/* The palette, named and with the one in use marked.
		 *
		 * The names are here rather than in the palette module because they
		 * are translated, and a module of six hex values should not need the
		 * translation globals to be testable. A color is a poor label on its
		 * own in any case: it is no label at all to a reader who cannot tell
		 * two of them apart, or who is listening rather than looking.
		 */
		colorChoices() {
			const named = {
				/* Not "Black": this one is the ink the theme is applied to, and
				   on a dark theme it draws white. A swatch labelled black
				   beside a white dot is wrong in the one place the label is
				   all a reader has. */
				ink: t('notes', 'Ink'),
				red: t('notes', 'Red'),
				orange: t('notes', 'Orange'),
				green: t('notes', 'Green'),
				blue: t('notes', 'Blue'),
				purple: t('notes', 'Purple'),
			}
			return INK_COLORS.map((color) => ({
				...color,
				label: named[color.key],
				chosen: color.value === this.color,
			}))
		},

		/* What the picker's own button says it will draw in. */
		colorLabel() {
			return this.colorChoices.find((choice) => choice.chosen)?.label ?? ''
		},
	},

	async mounted() {
		/* Both before the load: the pen can land before it finishes, and
		   Scribble claims it on the touch it is not refused on. */
		this.refuseTouchDefaults()
		this.claimFocus()
		/* Rotating an iPad changes the canvas size. Without this the backing
		   store keeps the old dimensions and every stroke drawn afterwards
		   lands offset from the pen - on the one device this is built for. */
		window.addEventListener('resize', this.onResize)
		/* The window is not the only thing that resizes the canvas: showing the
		   error message changes the layout beneath it. Watch the element itself. */
		if (typeof ResizeObserver !== 'undefined') {
			this.observer = new ResizeObserver(() => this.onResize())
			this.observer.observe(this.$refs.canvas)
		}
		try {
			const existing = await loadInk(this.noteId, this.inkId)
			if (existing && existing.strokes === null) {
				/* The picture is there but what drew it is not: a preview or a
				   copy that lost its metadata. Saving would replace the file
				   by name with whatever is drawn on this blank page, so show
				   the picture, say so, and stay unready - no input, no save -
				   exactly as when the load fails. */
				this.backdrop = URL.createObjectURL(existing.png)
				this.refusing = true
				this.error = t('notes', 'The strokes of this ink could not be read, so it cannot be edited. The picture is shown as it is saved; nothing has been changed.')
				return
			}
			/* Where it was drawn, as far as this screen allows. The file holds
			   the writing cropped to itself, so without this a reader who drew
			   in the middle of the page saw it there the first time they opened
			   it and in the top left corner every time after.
			 *
			 * Underneath anything drawn while the file was on its way, rather
			 * than instead of it: the canvas takes the pen from the moment it
			 * is open, and on the device the reader is already writing by the
			 * time this returns. */
			const canvas = this.$refs.canvas
			/* Every stroke gets a color this palette offers, here at the one
			   place strokes enter the canvas. A file can be copied in from
			   anywhere and edited by anything; what it says would otherwise be
			   drawn as the default and saved back as whatever it claimed, and
			   a picture that disagrees with the strokes beside it is the one
			   thing this format must never produce. A stroke from before color
			   existed gets the default, which is what it has always drawn in. */
			const placed = placeInk(
				(existing?.strokes ?? []).map((stroke) => ({ ...stroke, color: knownColor(stroke.color) })),
				existing?.origin,
				canvas?.clientWidth ?? 0,
				canvas?.clientHeight ?? 0,
			)
			this.strokes = [...placed, ...this.strokes]
			this.ready = true
			/* After the render that shows it, so the sheets being fitted are
			   the ones that end up on screen, at the size the dialog gives
			   them. */
			await this.$nextTick()
			this.fit()
			this.renderPage()
		} catch {
			/* We could not tell whether there is ink here already. Saving now
			   would replace it by name with whatever is drawn on a blank page,
			   so stay open to say so, but take no input and save nothing. */
			this.refusing = true
			this.error = t('notes', 'The existing ink could not be loaded. Close this and try again; nothing has been changed.')
		}
	},

	beforeUnmount() {
		/* The note gets the focus back, which is where the ink is written. */
		this.returnFocusTo?.focus?.()
		window.removeEventListener('resize', this.onResize)
		this.observer?.disconnect()
		this.releaseTouchGuards()
		if (this.backdrop) {
			URL.revokeObjectURL(this.backdrop)
		}
	},

	methods: {
		/* Keep iPadOS Scribble from taking the pen.
		 *
		 * Scribble is handwriting-to-text, and its recognizer claims pen input
		 * over a canvas: the page is handed nothing at all - no pointerdown,
		 * no pointermove - and stays that way while the pen is moved, until it
		 * is lifted and put down again. A WebKit regression since iPadOS 14,
		 * reported for years against drawing on the web.
		 *
		 * Refusing the default on touch is what stops the recognizer claiming
		 * it. The listener has to be non-passive to be allowed to refuse,
		 * which Vue's own binding does not guarantee, so it is attached here.
		 *
		 * The sheet refuses touch outright. The rest of the dialog refuses
		 * only movement: writing off to the side, over the buttons, became
		 * Scribble text in the note behind, and a tap still has to reach the
		 * button it lands on - refusing its touchstart would stop the click.
		 *
		 * Reproduced and fixed on the device, with Scribble switched on. */
		releaseTouchGuards() {
			for (const [element, type, handler] of this.touchGuards ?? []) {
				element.removeEventListener(type, handler)
			}
			this.touchGuards = null
			this.guarded = null
		},

		refuseTouchDefaults() {
			const canvas = this.$refs.canvas
			if (!canvas || this.guarded === canvas) {
				return
			}
			this.releaseTouchGuards()
			const refuse = (event) => event.preventDefault()
			const dialog = this.$refs.dialog
			this.touchGuards = [
				[canvas, 'touchstart', refuse],
				[canvas, 'touchmove', refuse],
				...(dialog ? [[dialog, 'touchmove', refuse]] : []),
				/* Not a guard but the same kind of listener: it has to be
				   non-passive to refuse the scroll it would otherwise give the
				   page behind this dialog. */
				[canvas, 'wheel', this.onWheel],
			]
			this.guarded = canvas
			for (const [element, type, handler] of this.touchGuards) {
				element.addEventListener(type, handler, { passive: false })
			}
		},

		/* Hold the focus inside the dialog.
		 *
		 * iPadOS Scribble writes what the pen writes into the focused text
		 * field, and the editor behind this dialog keeps the focus: writing
		 * anywhere the sheet does not cover - off to the side, over the
		 * buttons - arrived as handwritten text in the note underneath.
		 * Nothing in here is a text field, so while the focus is in here
		 * there is nothing for it to write into.
		 *
		 * Called again wherever the dialog may have been replaced rather than
		 * once at mount, for the same reason the touch guards are: the
		 * element Vue hands back at mount is not the one that ends up on
		 * screen, and when it is swapped out the focus it was holding falls
		 * to the body - which leaves the editor as the next text field a
		 * recognizer would find.
		 *
		 * Focus the reader moved themselves, onto a button in the bar, is
		 * left where they put it.
		 *
		 * The color picker's menu is the one thing outside this dialog that
		 * belongs to it: it is a popover, so it is teleported to the body and
		 * `contains` says no. Taking the focus back from it would shut it
		 * mid-choice, which a resize - a rotation, or the error message
		 * appearing - is enough to cause. */
		claimFocus() {
			const dialog = this.$refs.dialog
			if (!dialog || this.picking || dialog.contains(document.activeElement)) {
				return
			}
			/* Once: by the second call the focus is the body's, and handing
			   that back on close would leave the note with no caret. */
			if (this.returnFocusTo === undefined) {
				this.returnFocusTo = document.activeElement
			}
			dialog.focus?.()
		},

		/* A readout of what this canvas is really doing, for diagnosing a
		   device that is not in the room. It costs nothing unless it was asked
		   for, and is meant to be screenshotted and read, not kept. */
		/* Painting notices the new size and refits for it, which redraws the
		   page as part of doing so. */
		onResize() {
			this.paintNow()
		},

		/* The backing store a canvas should have: its box in device pixels,
		   which is what keeps a stroke crisp on a high-density screen. */
		backingSize() {
			const canvas = this.$refs.canvas
			const ratio = window.devicePixelRatio || 1
			return [Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio)]
		},

		/* A context, made once and kept.
		 *
		 * The sheet under the pen asks to be desynchronized: the hint exists
		 * for drawing on the web, and lets the browser skip as much
		 * compositing as it can rather than keeping the canvas in step with
		 * the rest of the page. iOS grants it. The page beneath does not ask,
		 * because it is the one read back for the PNG and a canvas that has
		 * bypassed compositing is not the place to read pixels from.
		 *
		 * @param {string} which 'page' or 'canvas'
		 * @return {CanvasRenderingContext2D | null} its context
		 */
		contextFor(which) {
			const surface = this.$refs[which]
			if (!surface) {
				return null
			}
			this.contexts = this.contexts ?? {}
			/* Kept against the element, not merely under the name. Vue replaces
			   the dialog's elements on a re-render - the same thing that moves
			   the focus and the touch guards - and a context held by name alone
			   went on drawing onto a canvas that was no longer on screen.
			   Everything painted afterwards went nowhere, in silence. */
			if (this.contexts[which]?.surface !== surface) {
				this.contexts[which] = {
					surface,
					context: surface.getContext('2d', which === 'canvas' ? { desynchronized: true } : undefined) ?? null,
				}
			}
			return this.contexts[which].context
		},

		/* Size both sheets to the box, and set what a context loses whenever
		   its size is written to: the device-pixel scale, so every coordinate
		   from here on is a CSS pixel. The color is not set here - it belongs
		   to the stroke, and each one is filled in its own. */
		fit() {
			const canvas = this.$refs.canvas
			if (!canvas) {
				return
			}
			/* Follows the canvas rather than being set once at mount: the
			   element Vue hands back then is not always the one that ends up
			   on screen. */
			this.refuseTouchDefaults()
			this.claimFocus()
			const ratio = window.devicePixelRatio || 1
			const [width, height] = this.backingSize()
			for (const which of ['page', 'canvas']) {
				const surface = this.$refs[which]
				if (!surface) {
					continue
				}
				surface.width = width
				surface.height = height
				const context = this.contextFor(which)
				if (context) {
					context.scale(ratio, ratio)
				}
			}
			this.painted = null
		},

		/* Fit where the drawing happens rather than only where the canvas is
		   mounted. At mount the dialog has not been laid out, so the box can
		   still be nothing; and a canvas that is resized loses its backing
		   store, taking the scale and the page with it. */
		ensureFitted() {
			const canvas = this.$refs.canvas
			if (!canvas) {
				return false
			}
			const [width, height] = this.backingSize()
			if (canvas.width === width && canvas.height === height) {
				return true
			}
			this.fit()
			this.renderPage()
			return true
		},

		/* Whether input may change the drawing at all.
		 *
		 * Not while saving: a stroke added then is in one of the PNG and the
		 * strokes but not the other. And not once the canvas has refused the
		 * ink it was opened on - that message says nothing has been changed,
		 * so nothing may be.
		 *
		 * Waiting for the existing ink to load, as this used to, meant the
		 * canvas was on screen and took nothing: the reader taps Ink, writes,
		 * and the stroke is dropped in silence. On the device that is "I have
		 * to tap twice before the nib registers". Saving still waits - that is
		 * what would replace ink nobody has read yet - and the strokes that
		 * arrive are put underneath what was drawn meanwhile. */
		accepting() {
			return !this.refusing && !this.saving
		},

		/* The event's samples, in the page's coordinates rather than the
		   screen's.
		 *
		 * @param {Array<Array<number>>} samples screen samples
		 * @return {Array<Array<number>>} the same, on the page
		 */
		onPage(samples) {
			if (!this.panY) {
				return samples
			}
			return samples.map(([x, y, ...rest]) => [x, y + this.panY, ...rest])
		},

		/* A box on the page, as a box on the screen.
		 *
		 * @param {Array<number> | null} box [x, y, width, height] on the page
		 * @return {Array<number> | null} the same on the screen
		 */
		onScreen(box) {
			return box ? [box[0], box[1] - this.panY, box[2], box[3]] : null
		},

		/* How far down the page the screen may look.
		 *
		 * Far enough to put the last of the writing at the top, which always
		 * leaves a whole empty screen to carry on in - and no further, because
		 * beyond that is blank paper with nothing in it to say where you are
		 * or which way is back. The limit follows the writing, so it grows as
		 * the page is written on. */
		panLimit() {
			const bounds = inkBounds(this.strokes)
			return bounds ? Math.max(0, bounds[1] + bounds[3]) : 0
		},

		/* Look at the page from here, within what there is to look at. */
		panTo(y) {
			const next = Math.max(0, Math.min(y, this.panLimit()))
			if (next === this.panY) {
				return
			}
			this.panY = next
			/* The whole of both sheets is somewhere else now. */
			this.painted = null
			const live = this.contextFor('canvas')
			const canvas = this.$refs.canvas
			if (live && canvas) {
				live.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
			}
			this.renderPage()
		},

		/* A finger moves the paper.
		 *
		 * A finger is the one thing on this canvas that never draws, which is
		 * what makes it free to mean something else. A pen in the hand and a
		 * finger on the page is how paper is moved on a desk.
		 *
		 * Never while the pen is writing: a hand resting on the screen arrives
		 * as a touch like any other, and the page lurching under a stroke is
		 * the palm problem in a new place. */
		startPan(event) {
			if (this.current || this.rubbing || this.shaping) {
				return
			}
			this.panning = { pointerId: event.pointerId, from: event.offsetY, at: this.panY, moved: false }
		},

		/* @param {PointerEvent} event the finger's move */
		continuePan(event) {
			const panning = this.panning
			const traveled = event.offsetY - panning.from
			/* A tap, or a hand settling, is not a request to move the page. */
			if (!panning.moved && Math.abs(traveled) < PAN_THRESHOLD) {
				return
			}
			panning.moved = true
			this.panTo(panning.at - traveled)
		},

		/* The wheel does the same, where there is no finger to do it with. */
		onWheel(event) {
			event.preventDefault()
			this.panTo(this.panY + event.deltaY)
		},

		onDown(event) {
			if (!this.accepting()) {
				return
			}
			if (!shouldDraw(event)) {
				this.startPan(event)
				return
			}
			/* The pen takes the page off the finger: whoever is holding it
			   means to write, and the paper holding still is the point. */
			this.panning = null
			/* One gesture at a time. Nothing preempts one in progress now that
			   a finger cannot start one: what used to arrive first and have to
			   be undone was the palm. */
			if (this.current || this.rubbing || this.shaping) {
				return
			}
			this.$refs.canvas?.setPointerCapture?.(event.pointerId)
			this.pointerId = event.pointerId
			this.pointerType = event.pointerType
			if (this.erasing) {
				this.rubbing = []
				/* A pass starts where the pen lands, joined to nothing: the
				   line back to where it was last lifted would rub out whatever
				   it happened to cross. */
				this.rubbedFrom = null
				this.rubOut(this.onPage(samplesFrom(event)))
				return
			}
			if (knownTool(this.tool) !== 'pen') {
				this.startShape(event)
				return
			}
			this.predicted = []
			this.current = {
				points: withoutRepeats(this.onPage(samplesFrom(event)), null),
				color: this.color,
			}
			/* Draw it now. The first sample is already in hand, so waiting for
			   a pointermove to show anything leaves the nib on a blank page
			   for however long the browser takes to report the first one. */
			this.paintNow()
		},

		onMove(event) {
			if (!this.accepting()) {
				return
			}
			if (this.panning?.pointerId === event.pointerId) {
				this.continuePan(event)
				return
			}
			/* Only the pointer that started the gesture continues it. A hand
			   resting beside the pen keeps reporting moves, and those are
			   neither ink nor erasing. */
			if (event.pointerId !== this.pointerId) {
				return
			}
			if (this.rubbing) {
				this.rubOut(this.onPage(samplesFrom(event)))
				return
			}
			if (this.shaping) {
				this.stretchShape(event)
				return
			}
			if (!this.current) {
				return
			}
			/* Only what moved. The Pencil reports each position twice, and the
			   pairs make the stroke a staircase for the smoothing to follow. */
			const samples = withoutRepeats(this.onPage(samplesFrom(event)), this.current.points.at(-1))
			this.current.points.push(...samples)
			/* Drawn, never kept: the file holds what the pen did, not what it
			   was expected to do. */
			this.predicted = this.onPage(predictedFrom(event))
			this.requestPaint()
		},

		onUp(event) {
			if (this.panning?.pointerId === event.pointerId) {
				this.panning = null
				return
			}
			/* A hand lifting must not end the pen's gesture. */
			if (event.pointerId !== this.pointerId || !this.accepting()) {
				return
			}
			if (this.rubbing) {
				this.finishRub()
				return
			}
			if (this.shaping) {
				this.finishShape()
				return
			}
			if (this.current) {
				this.finishStroke()
			}
		},

		/* The system took the pointer away.
		 *
		 * A half-drawn stroke is ink that was really laid down, so it is kept,
		 * exactly as lifting the pen would keep it. A shape is not: it is only
		 * itself once the reader has said where it ends, and committing one the
		 * reader never finished would put a box on the page they did not draw.
		 *
		 * @param {PointerEvent} event the pointer that was cancelled
		 */
		onCancel(event) {
			if (this.shaping && event.pointerId === this.pointerId) {
				this.dropShape()
				return
			}
			this.onUp(event)
		},

		/* Rub out every stroke the eraser has just passed over.
		 *
		 * Whole strokes, which is what keeps a stroke the only unit there is:
		 * the picture and the strokes that drew it cannot come to disagree,
		 * and both Undo and saving go on working unchanged. The cost is that a
		 * long mark goes all at once - crossing an underline takes the line.
		 *
		 * The page is retraced only when something was actually taken off it.
		 * Most of an eraser's travel is over blank paper.
		 *
		 * @param {Array<Array<number>>} samples where the eraser has been
		 */
		rubOut(samples) {
			/* Carried across reports, so the path is the one the eraser took
			   rather than a string of places it was seen in. The browser can
			   leave tens of pixels between one report and the next, and a line
			   crossed in that gap is a line the reader watched it go through. */
			const path = this.rubbedFrom ? [this.rubbedFrom, ...samples] : samples
			this.rubbedFrom = samples[samples.length - 1] ?? this.rubbedFrom
			let took = false
			/* Highest place first, so taking one out does not move the next. */
			for (const at of erasedBy(this.strokes, path)) {
				/* Where it was, so undoing puts it back there rather than on
				   top. Reversed on the way back, which undoes the splices
				   exactly however many places have moved since. */
				this.rubbing.push({ at, stroke: this.strokes[at] })
				this.strokes.splice(at, 1)
				took = true
			}
			if (took) {
				/* Rubbing out the last of the writing shortens the page, and
				   the screen must not be left below its bottom. panTo redraws
				   when it has to move; when it does not, the page still has to
				   be retraced without what has gone. */
				const was = this.panY
				this.panTo(this.panY)
				if (this.panY === was) {
					this.renderPage()
				}
			}
			/* Whether or not anything went: the eraser's own outline follows
			   the pen, which is what makes it something that can be aimed. */
			this.requestPaint()
		},

		/* One pass of the eraser is one thing to undo, however much it
		   crossed - a pass that found nothing is not a thing at all. */
		finishRub() {
			if (this.rubbing?.length) {
				this.history.push({ erased: this.rubbing })
			}
			this.rubbing = null
			this.rubbedFrom = null
			this.pointerId = null
			this.pointerType = null
			/* Takes the outline off the page with it. */
			this.paintNow()
		},

		/* Start a shape where the pen landed.
		 *
		 * Nothing is drawn yet: a shape with no size is not a shape, and
		 * shapePoints says so by returning no points at all.
		 *
		 * @param {PointerEvent} event the pointer that landed
		 */
		startShape(event) {
			const [at] = this.onPage(samplesFrom(event))
			this.shaping = { from: [at[0], at[1]], points: [] }
		},

		/* Follow the far corner.
		 *
		 * The whole shape is recomputed from its two corners rather than being
		 * extended, which is what lets a rectangle become an ellipse become a
		 * line without any of them keeping a trace of the others.
		 *
		 * @param {PointerEvent} event the pointer that moved
		 */
		stretchShape(event) {
			const [at] = this.onPage(samplesFrom(event))
			this.shaping.points = shapePoints(knownTool(this.tool), this.shaping.from, this.onCanvas(at))
			this.requestPaint()
		},

		/* The far corner, brought onto the page.
		 *
		 * Ink off the sides can be neither seen nor rubbed out. There is no
		 * bottom to bring it back from: the page is as long as what is drawn on
		 * it, which is what panLimit computes.
		 *
		 * @param {Array<number>} at where the pointer is, in page coordinates
		 * @return {Array<number>} where the shape may reach
		 */
		onCanvas(at) {
			const width = this.$refs.canvas?.clientWidth ?? 0
			return [Math.max(0, Math.min(at[0], width)), Math.max(0, at[1])]
		},

		/* Commit the shape, if the drag made one.
		 *
		 * One stroke and one thing to undo, however many points it took. Does
		 * nothing when no shape is being dragged: letting go of the shape
		 * would otherwise take the pointer from a rub that is in progress. */
		finishShape() {
			if (!this.shaping) {
				return
			}
			const drawn = this.shaping.points
			if (drawn.length) {
				const stroke = { points: drawn, color: this.color }
				this.strokes.push(stroke)
				this.history.push({ drew: stroke })
				const context = this.contextFor('page')
				if (context) {
					context.save()
					context.translate(0, -this.panY)
					context.fillStyle = this.colorOf(stroke)
					traceStroke(context, stroke.points)
					context.restore()
				}
			}
			this.dropShape()
		},

		/* Let go of the shape without committing it. */
		dropShape() {
			this.shaping = null
			this.pointerId = null
			this.pointerType = null
			this.paintNow()
		},

		/* The finished stroke moves down onto the page as it is committed, so
		   the page is never traced twice and the sheet above goes empty. */
		finishStroke() {
			if (this.current) {
				this.strokes.push(this.current)
				this.history.push({ drew: this.current })
				const context = this.contextFor('page')
				if (context) {
					context.save()
					context.translate(0, -this.panY)
					context.fillStyle = this.colorOf(this.current)
					traceStroke(context, this.current.points)
					context.restore()
				}
				this.current = null
				this.predicted = []
				this.pointerId = null
				this.pointerType = null
				this.paintNow()
			}
		},

		/* Take back the last thing done here, whichever it was.
		 *
		 * Erasing is the one thing this canvas does that destroys work, so it
		 * has to come back through the same button as everything else - and a
		 * pass that took three strokes brings all three back, because that is
		 * the one thing the reader did. */
		undo() {
			/* The same condition its button is disabled on: a tool reached by
			   pointerup cannot rely on the button having refused the event. An
			   empty history is already a no-op below. */
			if (this.saving) {
				return
			}
			const last = this.history.pop()
			if (!last) {
				return
			}
			if (last.drew) {
				const at = this.strokes.lastIndexOf(last.drew)
				if (at > -1) {
					this.strokes.splice(at, 1)
				}
			} else {
				/* Back to front: each place was recorded as it stood when that
				   stroke was taken out, and putting them back in the reverse
				   order is what undoes the splices. */
				for (const { at, stroke } of [...last.erased].reverse()) {
					this.strokes.splice(at, 0, stroke)
				}
			}
			this.panTo(this.panY)
			this.renderPage()
		},

		/* The rectangle a set of points puts ink in, in CSS pixels, widened by
		   the nib so the edges of the stroke are inside it. */
		boundsOf(points) {
			if (!points.length) {
				return null
			}
			let minX = Infinity
			let minY = Infinity
			let maxX = -Infinity
			let maxY = -Infinity
			for (const [x, y] of points) {
				minX = Math.min(minX, x)
				minY = Math.min(minY, y)
				maxX = Math.max(maxX, x)
				maxY = Math.max(maxY, y)
			}
			const pad = STROKE_SIZE + 2
			return [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2]
		},

		/* Set what the next stroke will be drawn in.
		 *
		 * Nothing already on the page moves: a stroke keeps the color it was
		 * drawn with, which is what makes Undo put back what was taken rather
		 * than a recolored copy of it.
		 *
		 * @param {string} value the chosen color
		 */
		chooseColor(value) {
			this.color = knownColor(value)
			rememberColor(this.color)
			/* Picking a color is saying what to draw in, so the eraser stands
			   down. Leaving it on is worse than inconvenient: the reader means
			   to write, and what they get instead takes away strokes they
			   meant to keep. */
			this.erasing = false
			/* And the menu has done what it was opened for. A radio choice does
			   not dismiss it on its own - the component keeps a menu of them
			   open so several can be toggled - but there is only one pen, so
			   the choice is the end of the exchange. It is also the pen's way
			   out of the menu, which a tap on the trigger is not. */
			this.picking = false
		},

		/* Run what a tap on a tool should run, from whichever event carries it.
		 *
		 * A Pencil tap on a control in this dialog never arrives as a click.
		 * The dialog refuses touchmove so that a stroke dragged over the bar is
		 * not handed to Scribble as handwriting, and refusing it is enough for
		 * WebKit to call the tap a drag and synthesize nothing from it. A
		 * finger stays inside the movement the browser ignores and still
		 * clicks; a Pencil reports finely enough that it does not.
		 *
		 * The colors in the menu were always reachable with a pen, which is
		 * what located this: the menu is a popover, teleported out of the
		 * dialog and so out from under the guard.
		 *
		 * Pointer events are untouched by that preventDefault - the canvas
		 * draws from them with both touch events refused - so the pen is served
		 * from pointerup. A click within a moment of one is the same tap
		 * arriving twice and is dropped; every other click, from a finger, a
		 * mouse, or Enter on a focused button, is the only event that tap
		 * produces and runs as it always did.
		 *
		 * @param {PointerEvent | MouseEvent} event the event that arrived
		 * @param {Function} run what the tool does
		 */
		onTool(event, run) {
			if (event.type === 'pointerup') {
				if (event.pointerType !== 'pen') {
					return
				}
				this.penTapAt = event.timeStamp
				run()
				return
			}
			if (event.timeStamp - this.penTapAt < PEN_TAP_CLICK) {
				return
			}
			run()
		},

		/* The tools, named so one function serves both of a tap's events.
		 *
		 * Each repeats the condition its button is disabled on: a disabled
		 * button is not reliably excused from pointer events, and a tool that
		 * fires while the canvas is saving would act on strokes already on
		 * their way to the file. */
		toggleErasing() {
			if (this.accepting()) {
				this.erasing = !this.erasing
			}
		},

		cancel() {
			this.$emit('close')
		},

		/* The picker opens and closes itself for a finger and a mouse; this is
		 * only the pen's way in and out, since no click reaches the trigger
		 * from a Pencil. It toggles rather than opens so that a reader who
		 * opened the menu by mistake can shut it without choosing a color. */
		togglePicker(event) {
			if (event.pointerType === 'pen' && this.accepting()) {
				this.picking = !this.picking
			}
		},

		/* The color to fill a stroke with.
		 *
		 * Validated on the way out rather than on the way in: strokes arrive
		 * from a file that anything could have written, and this is the last
		 * place before the value reaches the canvas.
		 *
		 * @param {object} stroke the stroke about to be traced
		 * @return {string} a color the palette offers
		 */
		colorOf(stroke) {
			return knownColor(stroke.color)
		},

		/* Trace every finished stroke onto the page. Only when what is on it
		   has stopped being true: a resize, an undo, or ink loaded from the
		   file. Writing does not come through here, which is the point. */
		renderPage() {
			const context = this.contextFor('page')
			const canvas = this.$refs.canvas

			if (!context || !canvas) {
				return
			}
			context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
			/* The strokes are the page's and the sheet is the screen's, so the
			   one is drawn through the other. Nothing outside the screen is
			   clipped by hand: the canvas does that, and a page of handwriting
			   off the top costs a few outlines nobody sees. */
			context.save()
			context.translate(0, -this.panY)
			for (const stroke of this.strokes) {
				context.fillStyle = this.colorOf(stroke)
				traceStroke(context, stroke.points)
			}
			context.restore()
		},

		/* The stroke under the pen, and the browser's guess at where it is
		   going, alone on the sheet above the page.
		 *
		 * Only the rectangle last painted is cleared, not the whole sheet -
		 * on this iPad the whole sheet is two and a half million pixels, and
		 * a word occupies a few thousand of them. */
		paintLive() {
			if (!this.ensureFitted()) {
				return
			}
			const context = this.contextFor('canvas')
			if (!context) {
				return
			}
			if (this.painted) {
				context.clearRect(...this.painted)
			}
			if (!this.current && !this.shaping?.points.length && !(this.rubbing && this.rubbedFrom)) {
				this.painted = null
				return
			}
			/* Drawn through the pan, as the page is; the rectangle to clear
			   next time is kept in the screen's own coordinates, which is what
			   clearRect wants. */
			context.save()
			context.translate(0, -this.panY)
			if (this.current) {
				const points = this.predicted?.length
					? [...this.current.points, ...this.predicted]
					: this.current.points
				context.fillStyle = this.colorOf(this.current)
				traceStroke(context, points)
				this.painted = this.onScreen(this.boundsOf(points))
			} else if (this.shaping?.points.length) {
				context.fillStyle = this.colorOf({ color: this.color })
				traceStroke(context, this.shaping.points)
				this.painted = this.onScreen(this.boundsOf(this.shaping.points))
			} else {
				const [x, y] = this.rubbedFrom
				traceEraser(context, x, y)
				/* A box around the ring with room for its own line, cleared
				   the same way a stroke's box is. */
				this.painted = this.onScreen([x - ERASER_SIZE, y - ERASER_SIZE, ERASER_SIZE * 2, ERASER_SIZE * 2])
			}
			context.restore()
		},

		/* One paint per frame, however many samples arrived in it. A pen
		   reports far more often than the screen refreshes, and painting on
		   each report is work thrown away. */
		requestPaint() {
			if (this.frame) {
				return
			}
			this.frame = requestAnimationFrame(() => {
				this.frame = null
				this.paintLive()
			})
		},

		/* Paint now, canceling a frame that would repeat it. */
		paintNow() {
			if (this.frame) {
				cancelAnimationFrame(this.frame)
				this.frame = null
			}
			this.paintLive()
		},

		/* The strokes drawn onto a picture of their own size.
		 *
		 * A canvas of its own rather than the page on screen: the page is as
		 * large as the device, and this is as large as what was written. The
		 * strokes arrive already moved into the picture's corner, so they are
		 * traced as they are.
		 *
		 * @param {Array<object>} strokes the strokes, in the picture's coordinates
		 * @param {Array<number> | null} bounds the box they fill, or null for none
		 * @return {Promise<Blob>} the PNG
		 */
		pictureOf(strokes, bounds) {
			/* Not this device's pixel ratio: a drawing has to be the same file
			   wherever it was made, and the note shows it at a size fixed
			   against this. */
			const ratio = INK_DENSITY
			const [, , width, height] = bounds ?? [0, 0, 0, 0]
			const picture = document.createElement('canvas')
			/* At least a pixel each way: a canvas of no width cannot be turned
			   into a PNG at all, and a page the reader left blank would fail
			   to save rather than saving nothing. */
			picture.width = Math.max(1, Math.ceil(width * ratio))
			picture.height = Math.max(1, Math.ceil(height * ratio))
			const context = picture.getContext('2d')
			if (context) {
				context.scale(ratio, ratio)
				for (const stroke of strokes) {
					context.fillStyle = this.colorOf(stroke)
					traceStroke(context, stroke.points)
				}
			}
			return new Promise((resolve) => picture.toBlob(resolve, 'image/png'))
		},

		async done() {
			if (!this.ready || this.saving) {
				return
			}
			/* A stroke or a shape still under the pen is on the canvas but not
			   yet in the strokes, so it would be missing from the PNG. Commit
			   whichever is in progress; each is a no-op when it is not. */
			this.finishStroke()
			this.finishShape()
			this.error = ''
			this.saving = true
			try {
				/* Not read back from either sheet. Both are the size of the
				   device's screen and a page of handwriting is a few words
				   somewhere on it, so a note full of ink saved that way is
				   mostly white space. The picture is the writing, cropped to
				   it, and the strokes move with it. */
				const bounds = inkBounds(this.strokes)
				const strokes = bounds
					? shiftStrokes(this.strokes, -bounds[0], -bounds[1])
					: this.strokes
				const png = await this.pictureOf(strokes, bounds)
				/* The corner the picture was cropped from, so opening it again
				   puts the drawing back where it is now rather than in the top
				   left of whatever screen opens it. */
				const origin = bounds ? [bounds[0], bounds[1]] : null
				await saveInk(this.noteId, this.inkId, png, strokes, origin)
				this.$emit('saved', { id: this.inkId })
				this.$emit('close')
			} catch {
				/* Stay open, holding the strokes. Closing here would lose a page
				   of handwriting to a moment's bad network. */
				this.error = t('notes', 'The ink could not be saved. It is still here — try again.')
			} finally {
				this.saving = false
			}
		},
	},
}
</script>

<style scoped>
.ink {
	position: fixed;
	inset: 0;
	/* A page of handwriting is not text to select. Without this, iOS treats a
	   press on the canvas as the start of a selection: it shows the blue
	   handles and the Copy/Look Up callout, and - worse than the mess - its
	   gesture recognizer arbitrates every touch before the page sees it,
	   which is felt as the ink lagging behind the pen. touch-action alone
	   does not stop this; it only governs scrolling and zooming. */
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	z-index: 10000;
	display: flex;
	flex-direction: column;
	background: var(--color-main-background);
}

.ink__stage {
	position: relative;
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
}

/* Ink is drawn and saved as one color on transparency, and the theme is
   applied where it is shown - here and on the note - so a page written on a
   light screen reads on a dark one. Nextcloud sets this to `no` on a light
   theme, which is not a filter, so the picture is left alone; where the
   variable is not set at all the declaration is dropped and the ink stays as
   it was drawn. */
.ink__canvas,
.ink__backdrop {
	/* Lightness flipped, hue kept - see NoteRich.vue, which does the same to
	   the picture once it is in the note. */
	filter: var(--background-invert-if-dark) hue-rotate(180deg);
}

/* A swatch shows the ink itself, so it sits under the same themed filter the
   canvas and the picture do: what the picker offers is what lands on the page. */
.ink__swatch {
	display: block;
	inline-size: 16px;
	block-size: 16px;
	border-radius: 50%;
	border: 1px solid var(--color-border-dark);
	filter: var(--background-invert-if-dark) hue-rotate(180deg);
	/* Both the buttons this sits in are flex rows, and a dot shorter than the
	   row would otherwise be stretched or shrunk to fit one. The trigger is
	   only as wide as its own icon, and without this the dot came out 12px
	   there instead of 16. */
	flex: none;
	align-self: center;
}

/* NcActionButton lays an icon out in a 34px box and lets the glyph centre
   inside it - that box is where the gap between an icon and its label comes
   from, since the component adds no margin of its own. A 16px dot dropped into
   that slot is 18px narrower than the icon it stands in for, so the label sat
   hard against it. These margins make the dot occupy the width the component
   expects, which is also what lines these up with every other icon in a menu.

   The trigger's swatch is deliberately left out: its button is exactly one
   icon wide, and the same margins there squeeze the dot rather than space it. */
.ink__swatch--choice {
	margin-inline: 9px;
}

/* The saved picture, behind a canvas that is blank and takes no input. Laid
   from the corner the page was drawn from, whole rather than cropped. */
.ink__backdrop {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: contain;
	object-position: top left;
	pointer-events: none;
}

/* The two sheets lie on top of one another, filling the stage. Absolute
   rather than flexed, because a canvas is sized by its bitmap - larger than
   its box on a high-density screen - and would otherwise refuse to shrink to
   make room for the message below. */
.ink__canvas {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	/* The canvas owns the surface while it is open, so a drag never reaches the
	   note behind it and "scroll" versus "draw" never has to be decided. */
	touch-action: none;
}

/* Which tool is in hand, where there is a pointer to show it to. */
.ink__canvas--erasing {
	cursor: cell;
}

/* Only the top sheet takes input; the page beneath is never pointed at. */
.ink__canvas--page {
	pointer-events: none;
}

/* Where the page carries on past the screen. Along the edge it continues
   past, so it reads as the page going on rather than as a line drawn on it. */
.ink__stage::before,
.ink__stage::after {
	position: absolute;
	z-index: 1;
	height: 10px;
	content: '';
	opacity: 0;
	transition: opacity 120ms ease;
	pointer-events: none;
	inset-inline: 0;
}

.ink__stage::before {
	top: 0;
	background: linear-gradient(to bottom, var(--color-text-maxcontrast), transparent);
}

.ink__stage::after {
	bottom: 0;
	background: linear-gradient(to top, var(--color-text-maxcontrast), transparent);
}

.ink__stage--above::before,
.ink__stage--below::after {
	opacity: 0.3;
}

.ink__bar {
	display: flex;
	gap: var(--default-grid-baseline);
	justify-content: flex-end;
	padding: var(--default-grid-baseline);
	border-top: 1px solid var(--color-border);
}

/* The tool sits apart from the three buttons that end the session. */
.ink__tool {
	margin-inline-end: auto;
}

.ink__error {
	padding: var(--default-grid-baseline);
	color: var(--color-error);
	text-align: center;
}

</style>
