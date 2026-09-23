<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Notes\Tests\Unit\Service;

use OCA\Notes\Service\HashtagParser;
use PHPUnit\Framework\TestCase;

class HashtagParserTest extends TestCase {
	private HashtagParser $parser;

	protected function setUp() : void {
		parent::setUp();
		$this->parser = new HashtagParser();
	}

	public function testFindsATagInAParagraph() : void {
		$this->assertSame(
			['philosophy'],
			$this->parser->parse('Mill says names refer to their bearers. #philosophy'),
		);
	}

	public function testKeepsHyphensAndUnderscoresInsideATag() : void {
		$this->assertSame(
			['philosophy-of-language', 'proper_names'],
			$this->parser->parse('#philosophy-of-language and #proper_names'),
		);
	}

	public function testATagMustBeginWithALetterOrDigit() : void {
		$this->assertSame([], $this->parser->parse('#-dash and #_private'));
		$this->assertSame(['2026'], $this->parser->parse('reading list #2026'));
	}

	public function testStopsAtPunctuation() : void {
		$this->assertSame(
			['philosophy', 'mill'],
			$this->parser->parse('ends a sentence #philosophy. in parens (#mill)'),
		);
	}

	public function testKeepsUnicodeLettersInOneTag() : void {
		$this->assertSame(
			['phänomenologie'],
			$this->parser->parse('a German one: #phänomenologie'),
		);
	}

	public function testFoldsCaseSoOneTagIsOneTag() : void {
		$this->assertSame(
			['philosophy'],
			$this->parser->parse('#Philosophy and #philosophy and #PHILOSOPHY'),
		);
	}

	public function testFoldsCaseOfNonAsciiLetters() : void {
		$this->assertSame(['phänomenologie'], $this->parser->parse('#Phänomenologie'));
	}

	public function testReturnsEachTagOnceInFirstAppearanceOrder() : void {
		$this->assertSame(
			['mill', 'frege'],
			$this->parser->parse('#mill then #frege then #mill again'),
		);
	}

	public function testFindsNothingInTextWithoutTags() : void {
		$this->assertSame([], $this->parser->parse("no tags here\nnot even a # on its own"));
	}

	public function testRejectsARunLongerThanTheCap() : void {
		$this->assertSame([str_repeat('a', 100)], $this->parser->parse('#' . str_repeat('a', 100)));
		$this->assertSame([], $this->parser->parse('#' . str_repeat('a', 101)));
	}

	public function testIgnoresMarkdownHeadings() : void {
		$this->assertSame([], $this->parser->parse("# Heading\n## Another\n###### Six\n"));
	}

	public function testFindsATagAtTheStartOfALine() : void {
		$this->assertSame(['philosophy'], $this->parser->parse("#philosophy\nand some prose"));
	}

	public function testIgnoresHashesInsideAFencedCodeBlock() : void {
		$content = "before #kept\n\n```c\n#include <stdio.h>\n#define SIZE 1\n```\n\nafter #alsokept";
		$this->assertSame(['kept', 'alsokept'], $this->parser->parse($content));
	}

	public function testIgnoresHashesInsideATildeFencedBlock() : void {
		$content = "~~~sh\n#!/bin/sh\n#define SIZE 1\n~~~\nprose #shell";
		$this->assertSame(['shell'], $this->parser->parse($content));
	}

	public function testIgnoresHashesInsideAnInlineCodeSpan() : void {
		$this->assertSame(
			['css'],
			$this->parser->parse('white is `#fff` in hex #css'),
		);
	}

	public function testFindsTagsInACommentDefinitionBlock() : void {
		$content = "A quote.[^comment-1]\n\n[^comment-1]:\n    - @[Paul](mention://user/p)\n      follow this up #kripke\n";
		$this->assertSame(['kripke'], $this->parser->parse($content));
	}

	public function testDoesNotTreatAUrlFragmentAsATag() : void {
		$this->assertSame(
			['reading'],
			$this->parser->parse('see https://example.com/page#section for more #reading'),
		);
	}

	public function testDoesNotTreatAHashInsideAWordAsATag() : void {
		$this->assertSame([], $this->parser->parse('C# and F# are languages'));
	}

	public function testAnUnclosedFenceSwallowsTheRestOfTheNote() : void {
		$this->assertSame(
			['before'],
			$this->parser->parse("#before\n\n```\n#include <stdio.h>\n#define X 1"),
		);
	}

	public function testAShorterRunDoesNotCloseALongerFence() : void {
		$content = "````\n```\n#define X 1\n````\nafter #done";
		$this->assertSame(['done'], $this->parser->parse($content));
	}
}
