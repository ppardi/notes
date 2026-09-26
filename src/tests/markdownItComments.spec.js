/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import MarkdownIt from 'markdown-it'
import markdownItFootnote from 'markdown-it-footnote'
import { describe, expect, it } from 'vitest'
import markdownItComments from '../markdownItComments.js'

/**
 * A renderer shaped like the one the preview builds, with a predictable
 * timestamp so a test does not depend on the locale it runs in.
 *
 * @param {object} options overrides for the plugin
 * @return {object} a MarkdownIt instance
 */
function renderer(options = {}) {
	return new MarkdownIt({ linkify: true, breaks: true })
		.use(markdownItFootnote)
		.use(markdownItComments, {
			heading: 'Comments',
			formatTimestamp: (raw) => `at ${raw}`,
			...options,
		})
}

/**
 * The markdown Text writes for one comment on a phrase.
 *
 * @param {string} body what the comment says
 * @return {string} a note with one comment
 */
function noteWithComment(body = 'Comment by Jane') {
	return 'The quick[^comment-1] brown fox.\n\n'
		+ '[^comment-1]:\n'
		+ '    - @[jane](mention://user/jane) *(2026-07-15T13:12Z)*\n'
		+ `      ${body}\n`
}

describe('markdownItComments', () => {
	it('gives comments a section of their own', () => {
		const html = renderer().render(noteWithComment())

		expect(html).toContain('<section class="note-comments">')
		expect(html).toContain('Comments</h2>')
		// The body and who wrote it, rather than the syntax that carried them.
		expect(html).toContain('>jane<')
		expect(html).toContain('at 2026-07-15T13:12Z')
		expect(html).toContain('Comment by Jane')
	})

	it('leaves no comment syntax in the prose', () => {
		const html = renderer().render(noteWithComment())

		expect(html).not.toContain('[^comment-1]')
		expect(html).not.toContain('mention://user/jane')
		// The prose keeps a marker that leads to the comment.
		expect(html).toContain('<p>The quick<sup class="comment-ref">')
		expect(html).toContain('href="#comment-1"')
	})

	it('names the section in the language it was given', () => {
		const html = renderer({ heading: 'Kommentare' }).render(noteWithComment())

		expect(html).toContain('Kommentare</h2>')
		expect(html).not.toContain('>Comments<')
	})

	it('renders the markdown inside a comment', () => {
		const html = renderer().render(noteWithComment('Needs a **citation**'))

		expect(html).toContain('<strong>citation</strong>')
	})

	it('keeps a real footnote a footnote', () => {
		const html = renderer().render('Fox[^1].\n\n[^1]: A genuine footnote.\n')

		expect(html).toContain('<section class="footnotes">')
		expect(html).toContain('A genuine footnote.')
		expect(html).not.toContain('note-comments')
	})

	it('numbers comments and footnotes apart', () => {
		const html = renderer().render('A[^comment-1] B[^1] C[^comment-2]\n\n'
			+ '[^comment-1]:\n'
			+ '    - @[jane](mention://user/jane) *(2026-07-15T13:12Z)*\n'
			+ '      First\n\n'
			+ '[^1]: A footnote\n\n'
			+ '[^comment-2]:\n'
			+ '    - @[bob](mention://user/bob) *(2026-07-15T15:11Z)*\n'
			+ '      Second\n')

		// The only footnote is [1], even though it is second in the file.
		expect(html).toContain('>[1]</a></sup>')
		expect(html).not.toContain('>[2]</a></sup>')
		expect(html).toContain('id="fn1"')
		// Comments count from one in their own section.
		expect(html).toContain('href="#comment-1"')
		expect(html).toContain('href="#comment-2"')
		expect(html).toContain('<li id="comment-1"')
		expect(html).toContain('<li id="comment-2"')
		// Both sections are present, comments first.
		expect(html.indexOf('note-comments')).toBeLessThan(html.indexOf('class="footnotes"'))
	})

	it('shows every reply in a thread, in order', () => {
		const html = renderer().render('The quick[^comment-1] brown fox.\n\n'
			+ '[^comment-1]:\n'
			+ '    - @[jane](mention://user/jane) *(2026-07-15T13:12Z)*\n'
			+ '      Comment by Jane\n'
			+ '    - @[bob](mention://user/bob) *(2026-07-15T15:11Z)*\n'
			+ '      Comment by Bob\n')

		expect(html.indexOf('Comment by Jane')).toBeLessThan(html.indexOf('Comment by Bob'))
		expect(html).toContain('>bob<')
		// One comment holding two replies, not two comments.
		expect(html.match(/<li id="comment-/g)).toHaveLength(1)
		expect(html.match(/class="note-comments__item"/g)).toHaveLength(2)
	})

	it('reads a guest author, who has no account to link to', () => {
		const html = renderer().render('The quick[^comment-1] brown fox.\n\n'
			+ '[^comment-1]:\n'
			+ '    - @guestname *(2026-07-15T13:12Z)*\n'
			+ '      Comment from guest\n')

		expect(html).toContain('>guestname<')
		expect(html).toContain('Comment from guest')
		expect(html).not.toContain('@guestname')
	})

	it('shows a comment that carries no author or timestamp', () => {
		const html = renderer().render('Foo[^comment-1] bar\n\n'
			+ '[^comment-1]:\n'
			+ '    - first reply\n'
			+ '    - second reply\n')

		expect(html).toContain('first reply')
		expect(html).toContain('second reply')
		// Nothing to say about who or when, so no empty line claiming to.
		expect(html).not.toContain('note-comments__meta')
	})

	it('shows a comment written without a list', () => {
		const html = renderer().render('The quick[^comment-1] brown fox.\n\n[^comment-1]: some comment\n')

		expect(html).toContain('<section class="note-comments">')
		expect(html).toContain('some comment')
	})

	it('keeps a timestamp it cannot read, rather than dropping it', () => {
		const html = new MarkdownIt()
			.use(markdownItFootnote)
			.use(markdownItComments, { heading: 'Comments' })
			.render('Foo[^comment-1]\n\n'
				+ '[^comment-1]:\n'
				+ '    - @[jane](mention://user/jane) *(not a date)*\n'
				+ '      Body\n')

		expect(html).toContain('not a date')
	})

	it('formats a timestamp it can read', () => {
		const html = new MarkdownIt()
			.use(markdownItFootnote)
			.use(markdownItComments, { heading: 'Comments' })
			.render(noteWithComment())

		expect(html).toContain('datetime="2026-07-15T13:12Z"')
		// Something a person reads, not the stored form.
		expect(html).toMatch(/>[^<]*2026[^<]*<\/time>/)
		expect(html).not.toContain('>2026-07-15T13:12Z</time>')
	})

	it('escapes what an author is called', () => {
		const html = renderer().render('Foo[^comment-1]\n\n'
			+ '[^comment-1]:\n'
			+ '    - @[<img src=x onerror=alert(1)>](mention://user/x) *(2026-07-15T13:12Z)*\n'
			+ '      Body\n')

		expect(html).not.toContain('<img src=x')
		expect(html).toContain('&lt;img')
	})

	it('adds nothing to a note that has neither', () => {
		const html = renderer().render('Just prose.\n')

		expect(html).toBe('<p>Just prose.</p>\n')
	})
})
