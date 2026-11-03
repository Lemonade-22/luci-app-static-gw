#!/usr/bin/env python3
"""Rewrite the view to use a guaranteed Simplified Chinese fallback translator.

- injects the generated ZH_MAP + _t() helper after the APP_VERSION constant
- rewrites _(...) call sites to _t(...)

Idempotent: running it twice is harmless. Requires gen-zh-map.py output, which
is generated in-process from the .po file.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
view = root / "htdocs/luci-static/resources/view/network/static-gw.js"

# 1. build the map from the .po (single source of truth)
po_out = subprocess.run(
    [sys.executable, str(root / "Scripts/tests/gen-zh-map.py")],
    capture_output=True, text=True, check=True,
).stdout.strip()

helper = f"""// --- Built-in Simplified Chinese fallback -------------------------------
// Generated from po/zh_Hans/luci-app-static-gw.po by
// Scripts/tests/gen-zh-map.py. LuCI's per-app i18n domain is not guaranteed
// to be loaded for a standalone app, which showed up as a half translated UI,
// so translate locally when the browser asks for Chinese.
{po_out}

const WANT_ZH = (function() {{
	const cands = [
		(typeof document !== 'undefined' && document.documentElement)
			? document.documentElement.getAttribute('lang') : null,
		(typeof navigator !== 'undefined') ? navigator.language : null,
		(typeof navigator !== 'undefined') ? navigator.userLanguage : null,
		(typeof L !== 'undefined' && L.env) ? L.env.lang : null
	];
	return cands.some(l => l && String(l).toLowerCase().indexOf('zh') === 0);
}})();

function _t(msgid) {{
	if (WANT_ZH && Object.prototype.hasOwnProperty.call(ZH_MAP, msgid))
		return ZH_MAP[msgid];
	return (typeof _ === 'function') ? _(msgid) : msgid;
}}
// ------------------------------------------------------------------------
"""

src = view.read_text(encoding="utf-8")

if "const ZH_MAP" not in src:
    anchor = re.search(r"^const APP_VERSION = '[^']*';\n", src, re.M)
    if not anchor:
        sys.exit("could not find the APP_VERSION anchor")
    src = src[:anchor.end()] + "\n" + helper + src[anchor.end():]

# 2. rewrite call sites (only bare `_(`, never `_t(` or `foo_(`)
before = len(re.findall(r"(?<![A-Za-z0-9_$])_\(", src))
src = re.sub(r"(?<![A-Za-z0-9_$])_\((['\"])", r"_t(\1", src)
after = len(re.findall(r"(?<![A-Za-z0-9_$])_\(", src))

view.write_text(src, encoding="utf-8", newline="\n")
print(f"rewrote {before - after} call sites; remaining bare _( : {after}")
