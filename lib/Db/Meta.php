<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2017 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Notes\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Class Meta
 * @method string getUserId()
 * @method void setUserId(string $value)
 * @method integer getFileId()
 * @method void setFileId(integer $value)
 * @method integer getLastUpdate()
 * @method void setLastUpdate(integer $value)
 * @method string getEtag()
 * @method void setEtag(string $value)
 * @method string getContentEtag()
 * @method void setContentEtag(string $value)
 * @method string getFileEtag()
 * @method void setFileEtag(string $value)
 * @method ?list<string> getTags()
 * @method void setTags(?array $value)
 * @package OCA\Notes\Db
 */
class Meta extends Entity {
	protected $userId;
	protected $fileId;
	protected $lastUpdate;
	protected $etag;
	protected $contentEtag;

	/**
	 * The tags parsed out of the note's content, or null when the note has not
	 * been parsed yet. That distinction matters: null means "unknown, read the
	 * file", while an empty list means "read, and it has no tags".
	 */
	protected $tags;
	protected $fileEtag;

	public function __construct() {
		// Decoded on read and encoded on write by the mapper, so the rest of
		// the app sees a plain list of strings.
		$this->addType('tags', 'json');
	}
}
