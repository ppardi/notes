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
				<!-- What has been written already. Not touched while writing,
				     so the cost of a stroke does not grow with the page. -->
				<canvas ref="page" class="ink__canvas ink__canvas--page" aria-hidden="true" />
				<!-- The stroke under the pen, alone on a transparent sheet
				     above it. The two are composited by the browser, which is
				     what a compositor is for. -->
				<canvas
					ref="canvas"
					class="ink__canvas ink__canvas--live"
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
import { eventAge, predictedFrom, samplesFrom, shouldDraw } from '../inkInput.js'
import { INK_COLOR, STROKE_SIZE, traceStroke } from '../inkRender.js'
import { statsWanted } from '../inkStats.js'

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
			this.error = t('notes', 'The existing ink could not be loaded. Close this and try again; nothing has been changed.')
		}
	},

	beforeUnmount() {
		window.removeEventListener('resize', this.onResize)
		this.observer?.disconnect()
		clearInterval(this.statsTimer)
		if (this.ticker) {
			cancelAnimationFrame(this.ticker)
		}
		if (this.backdrop) {
			URL.revokeObjectURL(this.backdrop)
		}
	},

	methods: {
		/* A readout of what this canvas is really doing, for diagnosing a
		   device that is not in the room. It costs nothing unless it was asked
		   for, and is meant to be screenshotted and read, not kept. */
		emptyTally() {
			return { moves: 0, samples: 0, paints: 0, moveMs: 0, paintMs: 0, ticks: 0, worstGap: 0, lagSum: 0, lagMax: 0, batchSum: 0 }
		},

		/* How far behind the pen we are, and how much of that was already
		   spent before the event reached us.
		 *
		 * Every pointer event carries the moment it happened, so the distance
		 * from that to now is the delay the hand actually feels - and none of
		 * it is ours until this line runs. The batch span is how old the
		 * oldest sample in the event is: the digitizer's samples arrive many
		 * at a time, and the first of them has been waiting that long.
		 *
		 * This is the number that says whether the delay is before us or
		 * after us, which nothing else here could tell apart.
		 *
		 * Takes the samples already read rather than asking for them again:
		 * getCoalescedEvents builds the whole batch afresh on every call, and
		 * asking twice a move doubled that - only while the readout was on,
		 * so measuring made what it measured worse.
		 *
		 * @param {PointerEvent} event the move
		 * @param {number} now the time its handling began
		 * @param {Array<Array<number>>} samples the batch it carried
		 */
		noteLag(event, now, samples) {
			const lag = eventAge(event.timeStamp, now)
			this.tally.lagSum += lag
			this.tally.lagMax = Math.max(this.tally.lagMax, lag)
			/* The oldest sample has been waiting the length of the batch; at
			   the rate they arrive, one frame each is the closest estimate
			   without asking for their stamps again. */
			this.tally.batchSum += lag + Math.max(samples.length - 1, 0) * (1000 / 60)
		},

		startStats() {
			if (!statsWanted()) {
				return
			}
			this.tally = this.emptyTally()
			/* The cadence the browser is actually giving us, measured apart
			   from our own painting. If this collapses while the time spent
			   in here stays near nothing, the cost is the platform's - the
			   compositor, the filter over a full-screen canvas - and not the
			   drawing. That is the one thing the numbers below cannot say on
			   their own. */
			let last = performance.now()
			this.worstEver = 0
			const tick = (now) => {
				this.tally.ticks += 1
				this.tally.worstGap = Math.max(this.tally.worstGap, now - last)
				this.worstEver = Math.max(this.worstEver, now - last)
				last = now
				this.ticker = requestAnimationFrame(tick)
			}
			this.ticker = requestAnimationFrame(tick)
			this.statsTimer = setInterval(() => {
				const t = this.tally
				this.tally = this.emptyTally()
				/* Hold the last second that had writing in it. Otherwise the
				   numbers are wiped the moment the pen lifts, which is exactly
				   when someone looks at them. */
				if (this.stats && !t.moves) {
					return
				}
				const canvas = this.$refs.canvas
				const filter = canvas ? window.getComputedStyle(canvas).filter : 'none'
				this.stats = [
					`${t.ticks}/s frames offered, worst gap ${t.worstGap.toFixed(0)}ms (${this.worstEver.toFixed(0)}ms worst yet)`,
					`${t.moves}/s moves  ${t.samples}/s samples  ${t.paints}/s paints`,
					`behind the pen ${(t.lagSum / Math.max(t.moves, 1)).toFixed(0)}ms, worst ${t.lagMax.toFixed(0)}ms; batch spans ${(t.batchSum / Math.max(t.moves, 1)).toFixed(0)}ms`,
					`${(t.moveMs / Math.max(t.moves, 1)).toFixed(3)}ms per move  ${(t.paintMs / Math.max(t.paints, 1)).toFixed(2)}ms per paint`,
					`${t.moveMs.toFixed(0)}ms + ${t.paintMs.toFixed(0)}ms of every 1000ms in here`,
					`${this.strokes.length} strokes, ${this.current?.points.length ?? 0} points under the pen`,
					`canvas ${canvas?.width ?? 0}x${canvas?.height ?? 0} at ${window.devicePixelRatio || 1}x, filter ${filter}`,
				].join('\n')
			}, 1000)
		},

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
			this.contexts = this.contexts ?? {}
			if (!this.contexts[which]) {
				const surface = this.$refs[which]
				this.contexts[which] = surface?.getContext('2d', which === 'canvas' ? { desynchronized: true } : undefined) ?? null
			}
			return this.contexts[which]
		},

		/* Size both sheets to the box, and set what a context loses whenever
		   its size is written to: the device-pixel scale, so every coordinate
		   from here on is a CSS pixel, and the colour strokes are filled in. */
		fit() {
			const canvas = this.$refs.canvas
			if (!canvas) {
				return
			}
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
					context.fillStyle = INK_COLOR
				}
			}
			this.painted = null
		},

		/* Fit where the drawing happens rather than only where the canvas is
		   mounted. At mount the dialog has not been laid out, so the box can
		   still be nothing; and a canvas that is resized loses its backing
		   store, taking the scale, the colour and the page with it. */
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

		/* Whether input may change the drawing at all: not before the existing
		   ink has loaded (it would be replaced), and not while saving (a stroke
		   added now is in one of the PNG and the strokes but not the other). */
		accepting() {
			return this.ready && !this.saving
		},

		onDown(event) {
			if (!this.accepting() || !shouldDraw(event)) {
				return
			}
			/* One stroke at a time. Nothing preempts a stroke in progress now
			   that a finger cannot start one: what used to arrive first and
			   have to be undone was the palm. */
			if (this.current) {
				return
			}
			this.$refs.canvas?.setPointerCapture?.(event.pointerId)
			this.pointerId = event.pointerId
			this.pointerType = event.pointerType
			this.predicted = []
			this.current = { points: samplesFrom(event) }
		},

		onMove(event) {
			/* Only the pointer that started the stroke extends it. A hand resting
			   beside the pen keeps reporting moves, and those are not ink. */
			if (!this.current || event.pointerId !== this.pointerId || !this.accepting()) {
				return
			}
			const started = this.tally ? performance.now() : 0
			const samples = samplesFrom(event)
			this.current.points.push(...samples)
			/* Drawn, never kept: the file holds what the pen did, not what it
			   was expected to do. */
			this.predicted = predictedFrom(event)
			this.requestPaint()
			if (this.tally) {
				this.tally.moves += 1
				this.tally.samples += samples.length
				this.tally.moveMs += performance.now() - started
				this.noteLag(event, started, samples)
			}
		},

		onUp(event) {
			/* A hand lifting must not end the pen's stroke. */
			if (!this.current || event.pointerId !== this.pointerId || !this.accepting()) {
				return
			}
			this.finishStroke()
		},

		/* The finished stroke moves down onto the page as it is committed, so
		   the page is never traced twice and the sheet above goes empty. */
		finishStroke() {
			if (this.current) {
				this.strokes.push(this.current)
				const context = this.contextFor('page')
				if (context) {
					traceStroke(context, this.current.points)
				}
				this.current = null
				this.predicted = []
				this.pointerId = null
				this.pointerType = null
				this.paintNow()
			}
		},

		undo() {
			this.strokes.pop()
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
			for (const stroke of this.strokes) {
				traceStroke(context, stroke.points)
			}
		},

		/* The stroke under the pen, and the browser's guess at where it is
		   going, alone on the sheet above the page.
		 *
		 * Only the rectangle last painted is cleared, not the whole sheet -
		 * on this iPad the whole sheet is two and a half million pixels, and
		 * a word occupies a few thousand of them. */
		paintLive() {
			const started = this.tally ? performance.now() : 0
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
			if (this.current) {
				const points = this.predicted?.length
					? [...this.current.points, ...this.predicted]
					: this.current.points
				traceStroke(context, points)
				this.painted = this.boundsOf(points)
			} else {
				this.painted = null
			}
			if (this.tally) {
				this.tally.paints += 1
				this.tally.paintMs += performance.now() - started
			}
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

		/* Paint now, cancelling a frame that would repeat it. */
		paintNow() {
			if (this.frame) {
				cancelAnimationFrame(this.frame)
				this.frame = null
			}
			this.paintLive()
		},

		async done() {
			if (!this.ready || this.saving) {
				return
			}
			/* A stroke still under the pen is drawn on the canvas, so it would be
			   in the PNG but not in the strokes. Commit it first. */
			this.finishStroke()
			this.error = ''
			this.saving = true
			try {
				/* Read from the page, not the sheet above it: every stroke has
				   been committed down to the page by now, and the sheet holds
				   nothing but a prediction that was never part of the ink. */
				const png = await new Promise((resolve) => this.$refs.page.toBlob(resolve, 'image/png'))
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
	/* A page of handwriting is not text to select. Without this, iOS treats a
	   press on the canvas as the start of a selection: it shows the blue
	   handles and the Copy/Look Up callout, and - worse than the mess - its
	   gesture recogniser arbitrates every touch before the page sees it,
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

/* Only the top sheet takes input; the page beneath is never pointed at. */
.ink__canvas--page {
	pointer-events: none;
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
