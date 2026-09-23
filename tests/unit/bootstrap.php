<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Unit tests cover only classes that stand alone, so there is no Nextcloud
 * server to bootstrap and no container to build. A PSR-4 autoloader over lib/
 * is the whole of it.
 */
spl_autoload_register(static function (string $class) : void {
	$prefix = 'OCA\\Notes\\';
	if (!str_starts_with($class, $prefix)) {
		return;
	}
	$relative = str_replace('\\', '/', substr($class, strlen($prefix)));
	$file = __DIR__ . '/../../lib/' . $relative . '.php';
	if (is_file($file)) {
		require_once $file;
	}
});
