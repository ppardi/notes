#!/usr/bin/env python3
"""Helpers for the fork CI: read and edit appinfo/info.xml in place
(regex edits, so formatting and comments are preserved).

  fork_tools.py get FILE FIELD          FIELD: id | version | min | max
  fork_tools.py set FILE FIELD VALUE    (empty VALUE removes min/max)
  fork_tools.py bump VERSION            6.99.44 -> 6.99.45
  fork_tools.py newer A B               exit 0 if A > B numerically
  fork_tools.py has-php-deps FILE       exit 0 if composer.json requires real packages
"""
import json
import re
import sys

NC_TAG = re.compile(r"<nextcloud\b[^>]*?/?>")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def get(xml, field):
    if field in ("id", "version"):
        m = re.search(rf"<{field}>\s*([^<]+?)\s*</{field}>", xml)
        return m.group(1) if m else ""
    tag = NC_TAG.search(xml)
    if not tag:
        return ""
    m = re.search(rf'\b{field}-version="([^"]*)"', tag.group(0))
    return m.group(1) if m else ""


def set_field(xml, field, value):
    if field in ("id", "version"):
        new, n = re.subn(
            rf"(<{field}>)\s*[^<]+?\s*(</{field}>)",
            lambda m: f"{m.group(1)}{value}{m.group(2)}",
            xml,
            count=1,
        )
        if n != 1:
            sys.exit(f"no <{field}> element found")
        return new
    tag = NC_TAG.search(xml)
    if not tag:
        sys.exit("no <nextcloud> dependency element found")
    old = tag.group(0)
    attr = f"{field}-version"
    if value == "":
        new_tag = re.sub(rf'\s+{attr}="[^"]*"', "", old)
    elif re.search(rf'\b{attr}="', old):
        new_tag = re.sub(rf'\b{attr}="[^"]*"', f'{attr}="{value}"', old)
    else:
        new_tag = old.replace("<nextcloud", f'<nextcloud {attr}="{value}"', 1)
    return xml[: tag.start()] + new_tag + xml[tag.end():]


def parts(v):
    return tuple(int(p) for p in v.lstrip("v").split("."))


def main(argv):
    if len(argv) >= 3 and argv[0] == "get":
        print(get(read(argv[1]), argv[2]))
    elif len(argv) == 4 and argv[0] == "set":
        path, field, value = argv[1:]
        if field not in ("id", "version", "min", "max"):
            sys.exit(f"unknown field {field}")
        xml = set_field(read(path), field, value)
        with open(path, "w", encoding="utf-8") as f:
            f.write(xml)
    elif len(argv) == 2 and argv[0] == "bump":
        p = list(parts(argv[1]))
        p[-1] += 1
        print(".".join(map(str, p)))
    elif len(argv) == 2 and argv[0] == "has-php-deps":
        with open(argv[1], encoding="utf-8") as f:
            req = json.load(f).get("require") or {}
        real = [k for k in req if k != "php" and not k.startswith("ext-")]
        sys.exit(0 if real else 1)
    elif len(argv) == 3 and argv[0] == "newer":
        sys.exit(0 if parts(argv[1]) > parts(argv[2]) else 1)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
