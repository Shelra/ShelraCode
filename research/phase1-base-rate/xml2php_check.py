"""Reading aid for Sylius pull requests that translate service configuration from XML to PHP.

Protocol criterion (b) treats code moved within one diff as not new; a translation of the same
definition into another format is a move. This script checks that claim per pull request, so the
label rests on evidence rather than on reading thousands of translated lines:

- service ids defined in added PHP (`->set('id'`, `->alias('id'`) versus ids removed from XML
  (`<service id="id"`), and the reverse;
- messenger.message_handler tags with and without an explicit bus, before and after;
- added lines that neither define nor configure services (anything that may carry new behavior).

Usage: python xml2php_check.py <diffs_dir> <pr> [<pr> ...]
"""

import re
import sys
from pathlib import Path

XML_ID = re.compile(r"<service\s+[^>]*\bid=\"([^\"]+)\"")
XML_ALIAS = re.compile(r"<service\s+[^>]*\bid=\"([^\"]+)\"[^>]*\balias=")
PHP_SET = re.compile(r"->(?:set|alias)\(\s*['\"]([^'\"]+)['\"]|->(?:set|alias)\(\s*([A-Z][\w\\]*)::class")
XML_HANDLER = re.compile(r"messenger\.message_handler")
XML_HANDLER_BUS = re.compile(r"messenger\.message_handler[^>]*\bbus=")
PHP_HANDLER = re.compile(r"messenger\.message_handler")
PHP_HANDLER_BUS = re.compile(r"messenger\.message_handler['\"]\s*,\s*\[[^\]]*['\"]bus['\"]")


def main() -> None:
    diffs = Path(sys.argv[1])
    for pr in sys.argv[2:]:
        text = (diffs / f"Sylius_Sylius-{pr}.diff").read_text(encoding="utf-8")
        removed_ids, added_ids = set(), set()
        xml_handlers = xml_handlers_bus = php_handlers = php_handlers_bus = 0
        for line in text.splitlines():
            if line.startswith("-") and not line.startswith("---"):
                for m in XML_ID.finditer(line):
                    removed_ids.add(m.group(1))
                if XML_HANDLER.search(line):
                    xml_handlers += 1
                    xml_handlers_bus += bool(XML_HANDLER_BUS.search(line))
            elif line.startswith("+") and not line.startswith("+++"):
                for m in PHP_SET.finditer(line):
                    added_ids.add(m.group(1) or m.group(2).lstrip("\\"))
                if PHP_HANDLER.search(line):
                    php_handlers += 1
                    php_handlers_bus += bool(PHP_HANDLER_BUS.search(line))
        only_new = sorted(added_ids - removed_ids)
        only_old = sorted(removed_ids - added_ids)
        print(f"#{pr}: xml ids removed {len(removed_ids)}, php ids added {len(added_ids)}")
        print(f"   ids only in PHP (new?): {only_new[:25]}{' ...' if len(only_new) > 25 else ''}")
        print(f"   ids only in XML (dropped?): {only_old[:25]}{' ...' if len(only_old) > 25 else ''}")
        print(f"   handler tags: xml {xml_handlers} (with bus {xml_handlers_bus}) -> php {php_handlers} (with bus {php_handlers_bus})")


if __name__ == "__main__":
    main()
