<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2020 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Notes\Service;

use OCP\IL10N;
use Psr\Log\LoggerInterface;

class Util {
	public function __construct(
		public IL10N $l10n,
		public LoggerInterface $logger,
	) {
	}

	public static function retryIfLocked(callable $f, int $maxRetries = 5, int $sleep = 1) {
		for ($try = 1; $try <= $maxRetries; $try++) {
			try {
				return $f();
			} catch (\OCP\Lock\ManuallyLockedException $e) {
				/* Not worth a retry. A transactional lock is held for the length
				   of one write and is gone a moment later, which is what the
				   loop below is for. This kind is held by an app or a person
				   until they give it up - Text keeps one for as long as an
				   editing session is open - so trying again just spends the
				   caller's time on the same answer. */
				throw $e;
			} catch (\OCP\Lock\LockedException $e) {
				if ($try >= $maxRetries) {
					throw $e;
				}
				sleep($sleep);
			}
		}
	}
}
