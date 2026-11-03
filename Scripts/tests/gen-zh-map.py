#!/usr/bin/env python3
"""Generate the built-in Simplified Chinese fallback map from the .po file.

LuCI normally translates `_()` strings through the installed
luci-i18n-* package. Depending on how a firmware ships LuCI, that domain may
never be loaded for a standalone app, which leaves a half-translated UI.

This script keeps `po/zh_Hans/luci-app-static-gw.po` as the single source of
truth and emits a JS object literal that the view uses for a guaranteed
fallback. Run it whenever the .po changes:

    python3 Scripts/tests/gen-zh-map.py > /tmp/zh-map.js

The generated block is committed into the view, and check-i18n.py verifies it
stays in sync with the .po file.
"""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
po = (root / "po/zh_Hans/luci-app-static-gw.po").read_text(encoding="utf-8")

entries = re.findall(r'^msgid "(.+)"\nmsgstr "(.+)"$', po, re.M)
entries = [(k, v) for k, v in entries if v]

print("const ZH_MAP = {")
for k, v in sorted(entries):
    print(f"\t{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},")
print("};")
