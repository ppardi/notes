<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<Teleport to="body">
		<div class="ink" role="dialog" :aria-label="t('notes', 'Ink')">
			<div class="ink__stage">
				<img v-if="backdrop"
					class="ink__backdrop"
					:src="backdrop"
					:alt="t('notes', 'The ink as it is saved')"
				>
				<canvas
					ref="canvas"
					class="ink__canvas"
					@pointerdown="onDown"
					@pointermove="onMove"
					@pointerup="onUp"
					@pointercancel="onUp"
				/>
			</div>
			<div class="ink__bar">
				<NcButton :disabled="!ready || !strokes.length || saving" @click="undo">
					{{ t('notes', 'Undo') }}
				</NcButton>
				<NcButton @click="$emit('close')">
					{{ t('notes', 'Cancel') }}
				</NcButton>
				<NcButton variant="primary" :disabled="!ready || saving" @click="done">
					{{ t('notes', 'Done') }}
				</NcButton>
			</div>
			<p v-if="error" class="ink__error" role="alert">
				{{ error }}
			</p>
			<pre v-if="stats" class="ink__stats">{{ stats }}</pre>
		</div>
	</Teleport>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import { loadInk, saveInk } from '../inkFile.js'
import { PEN_SEEN_MS, samplesFrom, shouldDraw } from '../inkInput.js'
import { INK_COLOR, traceStroke } from '../inkRender.js'

export default {
	name: 'InkCanvas',

	components: {
		NcButton,
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
			current: null,
			pointerId: null,
			pointerType: null,
			penSeenAt: 0,
			ready: false,
			saving: false,
			error: '',
			backdrop: '',
			stats: '',
		}
	},

	async mounted() {
		this.startStats()
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
				this.error = t('notes', 'The strokes of this ink could not be read, so it cannot be edited. The picture is shown as it is saved; nothing has been changed.')
				return
			}
			this.strokes = existing?.strokes ?? []
			this.ready = true
			/* After the render that shows it, so the canvas being fitted is the
			   one that ends up on screen, at the size the dialog gives it. */
			await this.$nextTick()
			this.paint()
		} catch {
			/* We could not tell whether there is ink here already. Saving now
			   would replace it by name with whatever is drawn on a blank page,
			   so stay open to say so, but take no input and save nothing. */
			this.error = t('notes', 'The existing ink could not be loaded. Close this and try again; nothing has been changed.')
		}
	},

	beforeUnmount() {
		window.removeEventListener('resize', this.onResize)
		this.observer?.disconnect()
		clearInterval(this.statsTimer)
		if (this.backdrop) {
			URL.revokeObjectURL(this.backdrop)
		}
	},

	methods: {
		/* A readout of what this canvas is really doing, for diagnosing a
		   device that is not in the room. It costs nothing unless the note's
		   URL asks for it with ?inkstats=1, and is meant to be screenshotted
		   and read, not kept. */
		startStats() {
			let wanted
			try {
				wanted = new URLSearchParams(window.location.search).has('inkstats')
			} catch {
				wanted = false
			}
			if (!wanted) {
				return
			}
			this.tally = { moves: 0, samples: 0, paints: 0, moveMs: 0, paintMs: 0 }
			this.statsTimer = setInterval(() => {
				const t = this.tally
				const canvas = this.$refs.canvas
				this.stats = [
					`${t.moves}/s moves  ${t.samples}/s samples  ${t.paints}/s paints`,
					`${(t.moveMs / Math.max(t.moves, 1)).toFixed(3)}ms per move  ${(t.paintMs / Math.max(t.paints, 1)).toFixed(2)}ms per paint`,
					`${t.moveMs.toFixed(0)}ms + ${t.paintMs.toFixed(0)}ms of every 1000ms in here`,
					`${this.strokes.length} strokes, ${this.current?.points.length ?? 0} points under the pen`,
					`canvas ${canvas?.width ?? 0}x${canvas?.height ?? 0} at ${window.devicePixelRatio || 1}x`,
				].join('\n')
				this.tally = { moves: 0, samples: 0, paints: 0, moveMs: 0, paintMs: 0 }
			}, 1000)
		},

		/* Painting is what notices the new size and refits for it, so there is
		   one path into that and not two. */
		onResize() {
			this.paintNow()
		},

		/* The backing store this canvas should have: its box in device pixels,
		   which is what keeps a stroke crisp on a high-density screen. */
		backingSize() {
			const canvas = this.$refs.canvas
			const ratio = window.devicePixelRatio || 1
			return [Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio)]
		},

		/* Size the canvas and the layer behind it to the box, and set what a
		   context loses whenever its size is written to: the device-pixel
		   scale, so every coordinate from here on is a CSS pixel, and the
		   colour every stroke is filled in. */
		fit() {
			const canvas = this.$refs.canvas
			if (!canvas) {
				return
			}
			this.layer = this.layer ?? document.createElement('canvas')
			const ratio = window.devicePixelRatio || 1
			const [width, height] = this.backingSize()
			for (const surface of [canvas, this.layer]) {
				surface.width = width
				surface.height = height
				const context = surface.getContext('2d')
				if (context) {
					context.scale(ratio, ratio)
					context.fillStyle = INK_COLOR
				}
			}
		},

		/* Fit where the drawing happens rather than only where the canvas is
		   mounted. At mount the dialog has not been laid out, so the box can
		   still be nothing; and a canvas that is resized loses its backing
		   store, taking the scale, the colour and the page with it. Checking
		   here means a canvas is never drawn on unprepared, whatever put it
		   in that state. */
		ensureFitted() {
			const canvas = this.$refs.canvas
			if (!canvas) {
				return false
			}
			const [width, height] = this.backingSize()
			if (this.layer && canvas.width === width && canvas.height === height) {
				return true
			}
			this.fit()
			this.renderLayer()
			return true
		},

		penSeen() {
			return Date.now() - this.penSeenAt < PEN_SEEN_MS
		},

		/* Remember the pen on ANY pen event, hovering included: a Pencil near the
		   screen reports pointermove before it touches, and that is the signal
		   that a hand is about to land. */
		notePen(event) {
			if (event.pointerType === 'pen') {
				this.penSeenAt = Date.now()
			}
		},

		/* Whether input may change the drawing at all: not before the existing
		   ink has loaded (it would be replaced), and not while saving (a stroke
		   added now is in one of the PNG and the strokes but not the other). */
		accepting() {
			return this.ready && !this.saving
		},

		onDown(event) {
			this.notePen(event)
			if (!this.accepting()) {
				return
			}
			if (this.current) {
				/* One stroke at a time, except that the pen wins. Most iPads do
				   not report hover, so a resting palm can start a stroke before
				   any pen has been seen. When the pen then lands, that stroke was
				   the palm: drop it, uncommitted, and let the pen write. */
				if (event.pointerType !== 'pen' || this.pointerType === 'pen') {
					return
				}
				this.abandonStroke()
			}
			if (!shouldDraw(event, this.penSeen())) {
				return
			}
			this.$refs.canvas?.setPointerCapture?.(event.pointerId)
			this.pointerId = event.pointerId
			this.pointerType = event.pointerType
			this.current = { points: samplesFrom(event) }
		},

		onMove(event) {
			this.notePen(event)
			/* Only the pointer that started the stroke extends it. A palm resting
			   beside the pen keeps reporting moves, and those are not ink. */
			if (!this.current || event.pointerId !== this.pointerId || !this.accepting()) {
				return
			}
			const started = this.tally ? performance.now() : 0
			const samples = samplesFrom(event)
			this.current.points.push(...samples)
			this.requestPaint()
			if (this.tally) {
				this.tally.moves += 1
				this.tally.samples += samples.length
				this.tally.moveMs += performance.now() - started
			}
		},

		onUp(event) {
			this.notePen(event)
			/* The palm lifting must not end the pen's stroke. */
			if (!this.current || event.pointerId !== this.pointerId || !this.accepting()) {
				return
			}
			this.finishStroke()
		},

		abandonStroke() {
			this.current = null
			this.pointerId = null
			this.pointerType = null
			this.paintNow()
		},

		/* The finished stroke goes onto the layer as it is committed, so the
		   page is never traced twice. */
		finishStroke() {
			if (this.current) {
				this.strokes.push(this.current)
				const context = this.layer?.getContext('2d')
				if (context) {
					traceStroke(context, this.current.points)
				}
				this.current = null
				this.pointerId = null
				this.pointerType = null
				this.paintNow()
			}
		},

		undo() {
			this.strokes.pop()
			this.renderLayer()
			this.paintNow()
		},

		/* Cleared in CSS pixels, because the context is scaled by the device
		   pixel ratio and its coordinates are CSS pixels from then on. */
		clear(context) {
			context.clearRect(0, 0, this.$refs.canvas.clientWidth, this.$refs.canvas.clientHeight)
		},

		/* Trace every finished stroke onto the layer. Only when what is on the
		   layer has stopped being true: a resize, or an undo. Writing does not
		   come through here, which is the point of the layer. */
		renderLayer() {
			const context = this.layer?.getContext('2d')
			if (!context) {
				return
			}
			this.clear(context)
			for (const stroke of this.strokes) {
				traceStroke(context, stroke.points)
			}
		},

		/* The page, then the stroke under the pen. The page is one blit of the
		   layer rather than a retrace, so writing costs the same on a full
		   page as on an empty one. */
		paint() {
			const started = this.tally ? performance.now() : 0
			if (!this.ensureFitted()) {
				return
			}
			const canvas = this.$refs.canvas
			const context = canvas.getContext('2d')
			if (!context) {
				return
			}
			this.clear(context)
			if (this.layer) {
				context.drawImage(this.layer, 0, 0, canvas.clientWidth, canvas.clientHeight)
			}
			if (this.current) {
				traceStroke(context, this.current.points)
			}
			if (this.tally) {
				this.tally.paints += 1
				this.tally.paintMs += performance.now() - started
			}
		},

		/* One paint per frame, however many samples arrived in it. A pen
		   reports far more often than the screen refreshes, and painting on
		   each report is work thrown away - it is what puts the ink behind
		   the pen. */
		requestPaint() {
			if (this.frame) {
				return
			}
			this.frame = requestAnimationFrame(() => {
				this.frame = null
				this.paint()
			})
		},

		/* Paint now, cancelling a frame that would repeat it. For the moments
		   that read the canvas rather than show it. */
		paintNow() {
			if (this.frame) {
				cancelAnimationFrame(this.frame)
				this.frame = null
			}
			this.paint()
		},

		async done() {
			if (!this.ready || this.saving) {
				return
			}
			/* A stroke still under the pen is drawn on the canvas, so it would be
			   in the PNG but not in the strokes. Commit it first. */
			this.finishStroke()
			/* The PNG is whatever the canvas shows, so nothing may be waiting
			   for a frame when it is read. */
			this.paintNow()
			this.error = ''
			this.saving = true
			try {
				const png = await new Promise((resolve) => this.$refs.canvas.toBlob(resolve, 'image/png'))
				await saveInk(this.noteId, this.inkId, png, this.strokes)
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

/* Ink is drawn and saved as one colour on transparency, and the theme is
   applied where it is shown - here and on the note - so a page written on a
   light screen reads on a dark one. Nextcloud sets this to `no` on a light
   theme, which is not a filter, so the picture is left alone; where the
   variable is not set at all the declaration is dropped and the ink stays as
   it was drawn. */
.ink__canvas,
.ink__backdrop {
	filter: var(--background-invert-if-dark);
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

.ink__canvas {
	position: relative;
	flex: 1;
	/* A canvas is sized by its bitmap, which is larger than its box on a
	   high-density screen. Without this it can never shrink to make room for
	   the message below it. */
	min-height: 0;
	width: 100%;
	/* The canvas owns the surface while it is open, so a drag never reaches the
	   note behind it and "scroll" versus "draw" never has to be decided. */
	touch-action: none;
}

.ink__bar {
	display: flex;
	gap: var(--default-grid-baseline);
	justify-content: flex-end;
	padding: var(--default-grid-baseline);
	border-top: 1px solid var(--color-border);
}

.ink__error {
	padding: var(--default-grid-baseline);
	color: var(--color-error);
	text-align: center;
}

/* Over the top-left of the page, where writing rarely starts. Takes no
   pointer input, so it can never eat a stroke. */
.ink__stats {
	position: absolute;
	inset-block-start: 0;
	inset-inline-start: 0;
	margin: 0;
	padding: var(--default-grid-baseline);
	border-end-end-radius: var(--border-radius);
	background: var(--color-background-hover);
	color: var(--color-text-maxcontrast);
	font-size: 11px;
	line-height: 1.4;
	pointer-events: none;
}
</style>
