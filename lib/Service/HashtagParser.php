<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Notes\Service;

class HashtagParser {
	/**
	 * A tag is a hash followed by a letter or digit, then any run of letters,
	 * digits, hyphens and underscores.
	 *
	 * Requiring a letter or digit first is what keeps `#-` and `#_` from being
	 * tags. Requiring no whitespace after the hash is what keeps Markdown
	 * headings out: `# Heading` has a space, `#philosophy` does not.
	 *
	 * The hash must also start a line or follow whitespace or an opening
	 * bracket or quote. Without that, the fragment in
	 * `https://example.com/page#section` becomes a tag named "section", and a
	 * note full of links becomes a tag list full of nonsense.
	 */
	private const TAG_PATTERN = '/(?<![^\s([{"\'])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/u';

	/**
	 * Longer than this and it is not a tag at all, rather than a tag that has
	 * been cut short. A truncated tag would silently mean something else.
	 */
	private const MAX_LENGTH = 100;

	/**
	 * A line that opens or closes a fenced code block: three or more backticks
	 * or tildes, optionally indented, optionally followed by a language.
	 */
	private const FENCE_PATTERN = '/^\s{0,3}(`{3,}|~{3,})/u';

	/**
	 * A span of inline code. The opening run of backticks is closed by a run of
	 * the same length, which is how Markdown lets a span contain backticks.
	 */
	private const CODE_SPAN_PATTERN = '/(`+)(?:(?!\1).)*\1/us';

	/**
	 * @return list<string>
	 */
	public function parse(string $content) : array {
		preg_match_all(self::TAG_PATTERN, $this->withoutCode($content), $matches);

		$tags = [];
		foreach ($matches[1] as $tag) {
			if (mb_strlen($tag) > self::MAX_LENGTH) {
				continue;
			}
			// Folded so a tag does not depend on whether shift was held. mb_* so
			// that it folds non-ASCII letters too.
			$tag = mb_strtolower($tag);
			if (!in_array($tag, $tags, true)) {
				$tags[] = $tag;
			}
		}
		return $tags;
	}

	/**
	 * A code span or a tag, whichever comes first.
	 *
	 * Matching both in one pass is what lets a rewrite step over code: a match
	 * that turns out to be a code span is put back untouched.
	 */
	private const SPAN_OR_TAG_PATTERN = '/(`+)(?:(?!\1).)*\1|(?<![^\s([{"\'])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/us';

	/**
	 * Read a single search term as a tag, or null if it is not one.
	 *
	 * Deliberately goes through the same parse as note content, so a term can
	 * never mean something the content would not. `#Philosophy` typed into the
	 * search box and `#philosophy` written in a note have to meet.
	 */
	public function parseTerm(string $term) : ?string {
		if (!str_starts_with($term, '#')) {
			return null;
		}
		return $this->parse($term)[0] ?? null;
	}

	/**
	 * Read a whole value as a tag name, or null if it is not exactly one.
	 *
	 * Stricter than parseTerm, and the difference matters. parseTerm answers
	 * "does this search term mention a tag", so it happily finds one inside a
	 * longer string. This answers "is this value a tag", which is what naming
	 * one has to ask: coercing "two words" to "two" would rewrite notes to a tag
	 * the user never typed.
	 *
	 * A leading hash is optional, so both what the user sees and what they type
	 * are accepted.
	 *
	 * @param string $value the name to read
	 * @return string|null the tag, or null if the value is not exactly one
	 */
	public function parseExactTag(string $value) : ?string {
		$name = mb_strtolower(trim($value));
		if (str_starts_with($name, '#')) {
			$name = substr($name, 1);
		}
		return $name !== '' && $this->parseTerm('#' . $name) === $name ? $name : null;
	}

	/**
	 * Rewrite one tag as another throughout a note's content.
	 *
	 * Renaming and merging are the same operation: merging is a rename onto a
	 * name that is already in use, and the duplicate tags that produces collapse
	 * when the note is parsed again.
	 *
	 * Everything the parser refuses to read as a tag is left alone — code,
	 * headings, URL fragments — and a longer tag that merely starts with the old
	 * name is not touched, because the match ends where a tag ends.
	 *
	 * @param string $content the note's content
	 * @param string $from the tag to rewrite
	 * @param string $to the tag to rewrite it as
	 * @return string the content, with the tag rewritten
	 */
	public function rename(string $content, string $from, string $to) : string {
		$from = $this->parseExactTag($from);
		$to = $this->parseExactTag($to);
		// Nothing to do, and nothing that would survive being written.
		if ($from === null || $to === null || $from === $to) {
			return $content;
		}

		/* Split keeping the line endings, so a note written with CRLF is not
		   quietly converted on its way through. */
		$parts = preg_split('/(\R)/u', $content, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [];
		$fence = null;

		foreach ($parts as $index => $part) {
			// odd entries are the line endings themselves
			if ($index % 2 === 1) {
				continue;
			}
			if (preg_match(self::FENCE_PATTERN, $part, $match)) {
				$marker = $match[1][0];
				$length = strlen($match[1]);
				if ($fence === null) {
					$fence = ['marker' => $marker, 'length' => $length];
				} elseif ($marker === $fence['marker'] && $length >= $fence['length']) {
					$fence = null;
				}
				continue;
			}
			if ($fence !== null) {
				continue;
			}
			$parts[$index] = preg_replace_callback(
				self::SPAN_OR_TAG_PATTERN,
				static function (array $match) use ($from, $to) : string {
					// a code span, put back as it was
					if (!isset($match[2]) || $match[2] === '') {
						return $match[0];
					}
					return mb_strtolower($match[2]) === $from ? '#' . $to : $match[0];
				},
				$part,
			) ?? $part;
		}

		return implode('', $parts);
	}

	/**
	 * Blank out the parts of a note that are code.
	 *
	 * Notes about code are full of hashes that are not tags: `#include`,
	 * `#define`, `#!/bin/sh`, and the colour `#fff`. Left alone they would fill
	 * the tag list with junk, and the tag list is the whole read-side UI. This
	 * is the only Markdown structure the parser knows about; it needs no more.
	 */
	private function withoutCode(string $content) : string {
		$lines = preg_split('/\R/u', $content) ?: [];
		$fence = null;

		foreach ($lines as $index => $line) {
			if (preg_match(self::FENCE_PATTERN, $line, $match)) {
				$marker = $match[1][0];
				$length = strlen($match[1]);
				if ($fence === null) {
					$fence = ['marker' => $marker, 'length' => $length];
					$lines[$index] = '';
					continue;
				}
				// A fence closes only on the same character and a run at least
				// as long, so ``` inside a ```` block stays code.
				if ($marker === $fence['marker'] && $length >= $fence['length']) {
					$fence = null;
				}
				$lines[$index] = '';
				continue;
			}

			if ($fence !== null) {
				$lines[$index] = '';
				continue;
			}

			$lines[$index] = preg_replace(self::CODE_SPAN_PATTERN, ' ', $line) ?? $line;
		}

		return implode("\n", $lines);
	}
}
