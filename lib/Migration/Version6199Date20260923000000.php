<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Notes\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Adds the cache of tags parsed out of each note, and forces one rescan.
 *
 * The version is deliberately out of the range upstream uses, so a future
 * upstream migration cannot collide with this fork's.
 */
class Version6199Date20260923000000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * @param IOutput $output
	 * @param Closure $schemaClosure The `\Closure` returns a `ISchemaWrapper`
	 * @param array $options
	 */
	public function preSchemaChange(IOutput $output, Closure $schemaClosure, array $options) {
	}

	/**
	 * @param IOutput $output
	 * @param Closure $schemaClosure The `\Closure` returns a `ISchemaWrapper`
	 * @param array $options
	 * @return null|ISchemaWrapper
	 */
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options) {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('notes_meta')) {
			return null;
		}

		$table = $schema->getTable('notes_meta');
		if ($table->hasColumn('tags')) {
			return null;
		}

		/* Text rather than a short string: the other columns here are fixed
		   length hashes, and following that shape would truncate a note that
		   carries more than a handful of tags. Nullable, because null means
		   "never parsed" and an empty list means "parsed, and it has none". */
		$table->addColumn('tags', 'text', [
			'notnull' => false,
			'default' => null,
		]);

		return $schema;
	}

	/**
	 * @param IOutput $output
	 * @param Closure $schemaClosure The `\Closure` returns a `ISchemaWrapper`
	 * @param array $options
	 */
	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options) {
		/* Existing notes are unchanged on disk, so nothing would ever re-read
		   them and they would have no tags until each was edited. Clearing the
		   content ETag is already the "must re-read" trigger, so the next sync
		   parses every note once through the ordinary path. */
		$qb = $this->db->getQueryBuilder();
		$updated = $qb->update('notes_meta')
			->set('content_etag', $qb->createNamedParameter(''))
			->executeStatement();

		$output->info('Notes: scheduled ' . $updated . ' note(s) for a tag rescan');
	}
}
