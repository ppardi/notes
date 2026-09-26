/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Draws the comments Text 35 stores in a note as comments, rather than as the
 * footnotes they are written as.
 *
 * Text anchors an annotation with a footnote reference whose label is prefixed
 * `comment-`, and defines it as an indented list, one item per reply:
 *
 *     The quick[^comment-1] brown fox.
 *
 *     [^comment-1]:
 *         - @[jane](mention://user/jane) *(2026-07-15T13:12Z)*
 *           Comment by Jane
 *
 * Left to the footnote plugin that is a numbered footnote holding a bullet list
 * and a link to `mention://user/jane`, sharing its numbering with any real
 * footnote in the note. This splits the two apart the way Text's own
 * `src/markdownit/comments.ts` does, so each is numbered and drawn as itself.
 *
 * Requires markdown-it-footnote to have been registered first.
 */

const COMMENT_PREFIX = 'comment-'
const MENTION_PREFIX = 'mention://user/'

/**
 * The account a mention link points at.
 *
 * @param {string} href the link target
 * @return {string} the user id, or an empty string if it is not a mention
 */
function mentionTarget(href) {
	if (typeof href !== 'string' || !href.startsWith(MENTION_PREFIX)) {
		return ''
	}
	const id = href.slice(MENTION_PREFIX.length)
	try {
		return decodeURIComponent(id)
	} catch {
		/* A half-written escape is still better read literally than dropped. */
		return id
	}
}

/**
 * Whether a definition is one of Text's comments.
 *
 * @param {object} entry an entry of env.footnotes.list
 * @return {boolean} true when its label marks it a comment
 */
function isComment(entry) {
	return typeof entry?.label === 'string' && entry.label.startsWith(COMMENT_PREFIX)
}

/**
 * Number comments and footnotes as two separate runs, so pulling the comments
 * out does not leave the footnotes counting 1, 3, 4.
 *
 * @param {Array} list env.footnotes.list
 * @return {Map} definition index to its kind and displayed number
 */
function numberSeparately(list) {
	const numbers = new Map()
	let comments = 0
	let footnotes = 0
	list.forEach((entry, id) => {
		const comment = isComment(entry)
		numbers.set(id, { comment, n: comment ? ++comments : ++footnotes })
	})
	return numbers
}

/**
 * What a reference, definition or backlink is numbered.
 *
 * @param {object} env the render environment
 * @param {object} token a token carrying footnote meta
 * @return {number} the number to show
 */
function displayNumber(env, token) {
	const id = token.meta?.id
	return env.notesComments?.get(id)?.n ?? (Number(id) + 1)
}

/**
 * Skip text tokens that hold nothing but space.
 *
 * @param {Array} children an inline token's children, shortened in place
 */
function dropLeadingSpace(children) {
	while (children.length > 0 && children[0].type === 'text' && /^\s*$/.test(children[0].content)) {
		children.shift()
	}
}

/**
 * Read `@[label](mention://user/id) *(timestamp)*` off the front of a reply and
 * take it out of the body, so the metadata is drawn as metadata and the reply
 * reads as prose. A guest has no account, and is written as plain `@name`.
 *
 * @param {object} inline the reply's first inline token, shortened in place
 * @return {object} author, authorLabel and timestamp, each possibly empty
 */
function takeMetadata(inline) {
	const children = inline?.children
	const meta = { author: '', authorLabel: '', timestamp: '' }
	if (!children) {
		return meta
	}

	dropLeadingSpace(children)

	const first = children[0]
	if (first?.type === 'text' && first.content === '@' && children[1]?.type === 'link_open') {
		const target = mentionTarget(children[1].attrGet('href'))
		if (target) {
			meta.author = target
			/* The label is the link's text, which is the only place the name a
			   person is shown under survives. */
			meta.authorLabel = children[2]?.type === 'text' ? children[2].content : target
			const close = children.findIndex((child) => child.type === 'link_close')
			children.splice(0, close < 0 ? 3 : close + 1)
		}
	} else if (first?.type === 'text') {
		const match = first.content.match(/^@([^\s*]+)/)
		if (match) {
			meta.authorLabel = match[1]
			first.content = first.content.slice(match[0].length)
			if (!first.content) {
				children.shift()
			}
		}
	}

	dropLeadingSpace(children)

	if (children[0]?.type === 'em_open' && children[1]?.type === 'text' && children[2]?.type === 'em_close') {
		const stamp = children[1].content.match(/^\(([^)]+)\)$/)
		if (stamp) {
			meta.timestamp = stamp[1]
			children.splice(0, 3)
		}
	}

	/* Whatever separated the metadata from the reply is now a leading blank. */
	while (children.length > 0) {
		const child = children[0]
		if (child.type === 'softbreak' || child.type === 'hardbreak') {
			children.shift()
		} else if (child.type === 'text' && /^\s*$/.test(child.content)) {
			children.shift()
		} else {
			if (child.type === 'text') {
				child.content = child.content.replace(/^\s+/, '')
			}
			break
		}
	}

	return meta
}

/**
 * The first inline token of a reply, which is where its metadata is.
 *
 * @param {Array} tokens the reply's tokens
 * @return {object|null} that token, or null if the reply has no text
 */
function firstInline(tokens) {
	for (const token of tokens) {
		if (token.type === 'inline') {
			return token
		}
	}
	return null
}

/**
 * Turn the definition's bullet list into replies: the list itself is not drawn,
 * each item becomes a comment item, and each item's metadata moves onto it.
 *
 * A comment written by hand may be neither a list nor carry metadata, so a body
 * that holds no list items is shown as a single reply.
 *
 * @param {Array} body the tokens between the definition's open and close
 * @param {object} state the core state, which makes the tokens
 * @return {Array} the tokens to draw in the comment's place
 */
function replies(body, state) {
	const items = []
	let depth = 0
	let found = false

	for (const token of body) {
		if (token.type === 'bullet_list_open') {
			depth += 1
			/* The outer list is the comment itself; a nested one is content. */
			if (depth === 1) {
				continue
			}
		} else if (token.type === 'bullet_list_close') {
			depth -= 1
			if (depth === 0) {
				continue
			}
		}

		if (depth === 1) {
			if (token.type === 'list_item_open') {
				token.type = 'comment_item_open'
				found = true
			} else if (token.type === 'list_item_close') {
				token.type = 'comment_item_close'
			} else if (token.type === 'paragraph_open' || token.type === 'paragraph_close') {
				/* Items of a tight list hide their paragraphs; a reply needs
				   them, since it is drawn as prose rather than as a list row. */
				token.hidden = false
			}
		}

		items.push(token)
	}

	if (!found) {
		const open = new state.Token('comment_item_open', '', 1)
		open.block = true
		const close = new state.Token('comment_item_close', '', -1)
		close.block = true
		return [open, ...items, close]
	}

	/* Each item's metadata is read once the items are the only nesting left. */
	for (let i = 0; i < items.length; i++) {
		if (items[i].type !== 'comment_item_open') {
			continue
		}
		const end = items.findIndex((token, at) => at > i && token.type === 'comment_item_close')
		const meta = takeMetadata(firstInline(items.slice(i + 1, end < 0 ? items.length : end)))
		items[i].meta = { ...items[i].meta, ...meta }
	}

	return items
}

/**
 * Rewrite one footnote definition as a comment.
 *
 * @param {Array} unit the definition's tokens, open and close included
 * @param {object} state the core state, which makes the tokens
 * @return {Array} the comment's tokens
 */
function asComment(unit, state) {
	const open = unit[0]
	const close = unit[unit.length - 1]
	open.type = 'comment_open'
	close.type = 'comment_close'

	/* The footnote plugin puts one backlink per reference inside the last
	   paragraph. A comment gets a single one, of its own, after the replies. */
	const body = unit.slice(1, -1).filter((token) => token.type !== 'footnote_anchor')
	const backlink = new state.Token('comment_anchor', '', 0)
	backlink.meta = open.meta

	return [open, ...replies(body, state), backlink, close]
}

/**
 * Split the footnote block into a comment block and a footnote block, keeping
 * only the ones that have something in them.
 *
 * @param {object} state the core state
 */
function splitBlock(state) {
	const openIdx = state.tokens.findIndex((token) => token.type === 'footnote_block_open')
	if (openIdx < 0) {
		return
	}
	const closeIdx = state.tokens.findIndex((token, at) => at > openIdx && token.type === 'footnote_block_close')
	if (closeIdx < 0) {
		return
	}

	const inner = state.tokens.slice(openIdx + 1, closeIdx)
	const comments = []
	const footnotes = []
	let start = -1

	for (let i = 0; i < inner.length; i++) {
		if (inner[i].type === 'footnote_open') {
			start = i
		} else if (inner[i].type === 'footnote_close' && start >= 0) {
			const unit = inner.slice(start, i + 1)
			if (state.env.notesComments?.get(unit[0].meta?.id)?.comment) {
				comments.push(...asComment(unit, state))
			} else {
				footnotes.push(...unit)
			}
			start = -1
		}
	}

	const replacement = []
	if (comments.length > 0) {
		const open = new state.Token('comment_block_open', '', 1)
		open.block = true
		const close = new state.Token('comment_block_close', '', -1)
		close.block = true
		replacement.push(open, ...comments, close)
	}
	if (footnotes.length > 0) {
		replacement.push(state.tokens[openIdx], ...footnotes, state.tokens[closeIdx])
	}

	state.tokens.splice(openIdx, closeIdx - openIdx + 1, ...replacement)
}

/**
 * How a timestamp is shown when the caller has no opinion: in the reader's own
 * locale, to the minute, falling back to what was stored if it is unreadable.
 *
 * @param {string} raw the timestamp as Text wrote it
 * @return {string} something a person reads
 */
function localTimestamp(raw) {
	const date = new Date(raw)
	if (Number.isNaN(date.getTime())) {
		return raw
	}
	return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Register the plugin.
 *
 * @param {object} md the MarkdownIt instance
 * @param {object} options heading: what to call the section; formatTimestamp:
 *   how to write a timestamp out
 */
export default function markdownItComments(md, options = {}) {
	const heading = options.heading ?? 'Comments'
	const formatTimestamp = options.formatTimestamp ?? localTimestamp
	const escape = md.utils.escapeHtml

	md.core.ruler.after('footnote_tail', 'notes_comments', (state) => {
		const list = state.env.footnotes?.list
		if (!list?.length) {
			return
		}
		state.env.notesComments = numberSeparately(list)

		for (const token of state.tokens) {
			if (token.type !== 'inline' || !token.children) {
				continue
			}
			for (const child of token.children) {
				if (child.type === 'footnote_ref' && state.env.notesComments.get(child.meta?.id)?.comment) {
					child.type = 'comment_ref'
				}
			}
		}

		splitBlock(state)
	})

	/* Both kinds are numbered from the same map, so a note holding one of each
	   shows a comment 1 and a footnote [1] rather than two things called 2. */
	md.renderer.rules.footnote_anchor_name = (tokens, idx, opts, env) => String(displayNumber(env, tokens[idx]))
	md.renderer.rules.footnote_caption = (tokens, idx, opts, env) => {
		const n = displayNumber(env, tokens[idx])
		return tokens[idx].meta?.subId > 0 ? `[${n}:${tokens[idx].meta.subId}]` : `[${n}]`
	}

	md.renderer.rules.comment_ref = (tokens, idx, opts, env) => {
		const n = displayNumber(env, tokens[idx])
		return `<sup class="comment-ref"><a href="#comment-${n}" id="commentref-${n}">${n}</a></sup>`
	}

	md.renderer.rules.comment_block_open = () => '<section class="note-comments">\n'
		+ `<h2 class="note-comments__heading">${escape(heading)}</h2>\n`
		+ '<ol class="note-comments__list">\n'
	md.renderer.rules.comment_block_close = () => '</ol>\n</section>\n'

	md.renderer.rules.comment_open = (tokens, idx, opts, env) => `<li id="comment-${displayNumber(env, tokens[idx])}" class="note-comments__comment">\n`
	md.renderer.rules.comment_close = () => '</li>\n'

	md.renderer.rules.comment_item_open = (tokens, idx) => {
		const { authorLabel = '', timestamp = '' } = tokens[idx].meta ?? {}
		const parts = []
		if (authorLabel) {
			parts.push(`<span class="note-comments__author">${escape(authorLabel)}</span>`)
		}
		if (timestamp) {
			parts.push(`<time class="note-comments__time" datetime="${escape(timestamp)}">`
				+ `${escape(formatTimestamp(timestamp))}</time>`)
		}
		/* A comment written by hand may say neither who nor when, and an empty
		   line claiming to is worse than no line. */
		const meta = parts.length > 0 ? `<p class="note-comments__meta">${parts.join(' ')}</p>\n` : ''
		return `<div class="note-comments__item">\n${meta}`
	}
	md.renderer.rules.comment_item_close = () => '</div>\n'

	md.renderer.rules.comment_anchor = (tokens, idx, opts, env) => `<a href="#commentref-${displayNumber(env, tokens[idx])}" class="note-comments__backref">↩︎</a>\n`
}
