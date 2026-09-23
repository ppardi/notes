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
