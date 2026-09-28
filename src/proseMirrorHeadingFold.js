/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const HIDDEN_CLASS = 'note-fold__hidden'

const DEFAULTS = {
	collapseLabel: 'Collapse section',
	expandLabel: 'Expand section',
	formatHidden: (count) => `${count} hidden`,
}

/**
 * The control that folds and unfolds one section.
 *
 * It is a real button rather than a decorated glyph. Text's own heading
 * anchors are `aria-hidden`, which suits an ornament, but this control is the
 * only way back to the content it hides, so it has to be reachable by
 * keyboard and to say which way it will move.
 *
 * @param {object} options the labels to use
 * @param {object} section what the control is pointing at
 * @param {boolean} section.collapsed whether that section is folded now
 * @param {() => void} [section.onToggle] called when the control is used
 * @return {HTMLButtonElement} the control
 */
export function foldToggleButton(options, { collapsed, onToggle }) {
	const settings = { ...DEFAULTS, ...options }
	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'note-fold__toggle'
	button.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
	button.setAttribute('aria-label', collapsed ? settings.expandLabel : settings.collapseLabel)
	// The label carries the meaning; the glyph is decoration.
	button.textContent = collapsed ? '▸' : '▾'

	if (typeof onToggle === 'function') {
		/* The pointer must not move the caret or take the selection away from
		   the text when it lands here, which is what the mousedown is for. The
		   fold itself hangs off the click, because a key press on a button
		   raises a click and no mousedown at all — hanging the fold on mousedown
		   would put the control out of the keyboard's reach. */
		button.addEventListener('mousedown', (event) => {
			event.preventDefault()
			event.stopPropagation()
		})
		button.addEventListener('click', (event) => {
			event.preventDefault()
			event.stopPropagation()
			onToggle()
		})
	}

	return button
}

/**
 * Take ProseMirror's own classes out of an editor that is already running.
 *
 * Notes cannot bring its own copy of ProseMirror to this. The editor belongs
 * to the Text app, and decorations built by a second copy of the library are
 * handed to the first one to combine with its own, which fails on the
 * internals the two copies do not share. Borrowing the classes the running
 * editor is already using is what makes them the same copy by construction,
 * whichever version of Text is installed.
 *
 * `Plugin` comes off any plugin the editor holds. `Decoration` and
 * `DecorationSet` have no such handle, so they are read back from a
 * decoration some other plugin has already made — Text decorates every
 * heading with an anchor, which is exactly the case where folding is wanted.
 *
 * @param {object} editor the running Text editor
 * @return {object|null} the classes, or null if this editor does not lend them
 */
export function borrowProseMirror(editor) {
	const plugins = editor?.state?.plugins
	if (!Array.isArray(plugins) || plugins.length === 0) {
		return null
	}

	for (const plugin of plugins) {
		let set
		try {
			set = plugin.props?.decorations?.call(plugin, editor.state)
		} catch {
			// A plugin that cannot answer for this state is simply not the one.
			continue
		}
		const [decoration] = typeof set?.find === 'function' ? set.find() : []
		if (decoration && typeof decoration.constructor?.widget === 'function') {
			return {
				Plugin: plugins[0].constructor,
				Decoration: decoration.constructor,
				DecorationSet: set.constructor,
			}
		}
	}
	return null
}

/**
 * Where each top-level heading sits, and how deep it is.
 *
 * Only the top level counts: a heading inside a quote or a list item does not
 * start a section of the note.
 *
 * @param {object} doc the document
 * @return {Array<object>} one `{ pos, node, level }` per heading, in order
 */
function headings(doc) {
	const found = []
	let pos = 0
	doc.forEach((node) => {
		if (node.type.name === 'heading') {
			found.push({ pos, node, level: node.attrs.level })
		}
		pos += node.nodeSize
	})
	return found
}

/**
 * Whether this note has a section to fold at all.
 *
 * Cheap on purpose. Borrowing ProseMirror asks every plugin the editor holds
 * for its decorations, which is far too much work to repeat while someone is
 * typing — so a caller waiting for a note to grow its first heading checks
 * this first, and only then reaches for the expensive answer.
 *
 * @param {object} doc the document
 * @return {boolean} true when at least one top-level heading is present
 */
export function hasTopLevelHeading(doc) {
	let found = false
	doc?.forEach?.((node) => {
		found = found || node.type.name === 'heading'
	})
	return found
}

/**
 * The section heading a document position falls inside, if any.
 *
 * A section is started by a top-level heading, so a heading tucked inside a
 * quote or a list item is not one: those are part of the section around them.
 *
 * @param {object} doc the document
 * @param {number} pos a position in it, which need not be a valid one
 * @return {object|null} `{ pos, node }` for the heading, or null
 */
export function headingAt(doc, pos) {
	const resolved = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
	if (resolved.depth < 1) {
		return null
	}
	const node = resolved.node(1)
	return node.type.name === 'heading' ? { pos: resolved.before(1), node } : null
}

/**
 * The top-level blocks a section covers, not counting its own heading.
 *
 * A section runs until the next heading at the same depth or shallower, so a
 * subsection folds away with the section that holds it.
 *
 * @param {object} doc the document
 * @param {number} pos the heading's position
 * @return {Array<object>} the blocks below that heading
 */
function sectionBody(doc, pos) {
	const body = []
	let seen = false
	let level = 0
	let at = 0
	doc.forEach((node) => {
		const start = at
		at += node.nodeSize
		if (!seen) {
			if (start === pos) {
				seen = true
				level = node.attrs.level
			}
			return
		}
		if (node.type.name === 'heading' && node.attrs.level <= level) {
			seen = 'done'
		}
		if (seen === true) {
			body.push({ start, end: start + node.nodeSize })
		}
	})
	return body
}

/**
 * Fold sections of a note under their headings, without touching the note.
 *
 * The fold is drawn with decorations rather than by changing the document.
 * Anything written into the editor's DOM by hand is parsed back into the text
 * and saved to the file, so a chevron added that way ends up inside the
 * heading it was meant to decorate, and on disk. Decorations are the view's
 * own layer and never reach the markdown.
 *
 * What is folded is deliberately not remembered. It lasts while the note is
 * open and starts again from nothing, which keeps one reader's convenience
 * out of everyone else's copy of the note.
 *
 * @param {object} pm ProseMirror's classes, from {@link borrowProseMirror}
 * @param {object} pm.Plugin the Plugin class
 * @param {object} pm.Decoration the Decoration class
 * @param {object} pm.DecorationSet the DecorationSet class
 * @param {object} [options] the labels to use
 * @param {string} [options.collapseLabel] what the control does when open
 * @param {string} [options.expandLabel] what the control does when folded
 * @param {(count: number) => string} [options.formatHidden] names a fold's size
 * @return {object} a ProseMirror plugin
 */
export function headingFoldPlugin({ Plugin, Decoration, DecorationSet }, options = {}) {
	const settings = { ...DEFAULTS, ...options }
	/* The plugin is its own key for metadata, which saves borrowing PluginKey
	   as well. It is assigned below, before anything can dispatch. */
	let self = null

	/**
	 * Everything the view should draw for the current fold.
	 *
	 * @param {object} doc the document
	 * @param {Set<number>} collapsed positions of the folded headings
	 * @return {object} a DecorationSet
	 */
	function build(doc, collapsed) {
		const decorations = []

		headings(doc).forEach(({ pos, node, level }) => {
			const isCollapsed = collapsed.has(pos)

			decorations.push(Decoration.widget(pos + 1, (view, getPos) => foldToggleButton(settings, {
				collapsed: isCollapsed,
				onToggle: () => {
					/* getPos answers where the widget is, which is one step
					   inside the heading it decorates. */
					const at = typeof getPos === 'function' ? getPos() - 1 : pos
					view.dispatch(view.state.tr.setMeta(self, { toggle: at }))
				},
			}), {
				side: -1,
				notesFold: 'toggle',
				collapsed: isCollapsed,
				level,
				ignoreSelection: true,
				stopEvent: () => true,
			}))

			if (!isCollapsed) {
				return
			}

			const body = sectionBody(doc, pos)
			body.forEach(({ start, end }) => {
				decorations.push(Decoration.node(start, end, { class: HIDDEN_CLASS }, { notesFold: 'hidden' }))
			})

			decorations.push(Decoration.widget(pos + node.nodeSize - 1, () => {
				const badge = document.createElement('span')
				badge.className = 'note-fold__badge'
				badge.textContent = settings.formatHidden(body.length)
				return badge
			}, {
				side: 1,
				notesFold: 'badge',
				hidden: body.length,
				ignoreSelection: true,
				stopEvent: () => true,
			}))
		})

		return DecorationSet.create(doc, decorations)
	}

	self = new Plugin({
		state: {
			init(_, state) {
				return { collapsed: new Set(), decorations: build(state.doc, new Set()) }
			},

			apply(tr, value, oldState, newState) {
				const meta = tr.getMeta(self)
				if (!tr.docChanged && !meta) {
					return value
				}

				let collapsed = value.collapsed
				if (tr.docChanged) {
					/* Follow each folded heading through the change. One that
					   was deleted takes its fold with it and gives the content
					   below it back, rather than leaving it hidden with nothing
					   left to unfold it. A position that survives but no longer
					   starts a heading is simply never drawn, since the fold is
					   built by walking the headings that are actually there. */
					collapsed = new Set([...collapsed]
						.map((pos) => {
							const result = tr.mapping.mapResult(pos, 1)
							return result.deleted ? null : result.pos
						})
						.filter((pos) => pos !== null))
				}

				if (meta?.toggle !== undefined) {
					collapsed = new Set(collapsed)
					if (collapsed.has(meta.toggle)) {
						collapsed.delete(meta.toggle)
					} else {
						collapsed.add(meta.toggle)
					}
				}

				return { collapsed, decorations: build(newState.doc, collapsed) }
			},
		},

		props: {
			decorations(state) {
				return this.getState(state).decorations
			},

			/**
			 * Fold the section whose heading was clicked.
			 *
			 * The heading is the control. There is no chevron beside it: the
			 * margin there already carries Text's own handles, and a third
			 * thing in that rail is one too many — while a control drawn in
			 * the line pushes every heading in from the prose, which reads as
			 * a mistake.
			 *
			 * False rather than true, so that the click still does what a
			 * click in an editor does and puts the caret where it landed. A
			 * heading that folded but could not be typed into would be a
			 * heading the mouse had taken away.
			 *
			 * @param {object} view the editor view
			 * @param {number} pos where the click landed
			 * @return {boolean} false, always: the click is not consumed
			 */
			handleClick(view, pos) {
				const heading = headingAt(view.state.doc, pos)
				if (heading) {
					view.dispatch(view.state.tr.setMeta(self, { toggle: heading.pos }))
				}
				return false
			},

			/**
			 * Put back what the first click of a double click folded.
			 *
			 * Double clicking a word is how a heading gets selected, and
			 * ProseMirror has already sent the opening click through
			 * handleClick by the time it knows a second one is coming. Undoing
			 * it here is what stops reaching for a word in a heading from
			 * taking its section away.
			 *
			 * @param {object} view the editor view
			 * @param {number} pos where the click landed
			 * @return {boolean} false, always: the click is not consumed
			 */
			handleDoubleClick(view, pos) {
				const heading = headingAt(view.state.doc, pos)
				if (heading) {
					view.dispatch(view.state.tr.setMeta(self, { toggle: heading.pos }))
				}
				return false
			},
		},
	})

	return self
}
