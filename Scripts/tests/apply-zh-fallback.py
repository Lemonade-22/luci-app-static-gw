#!/usr/bin/env python3
"""Regenerate the in-view ZH_MAP from the .po file.

LuCI normally translates `_()` strings through the installed luci-i18n-*
package, but that domain is not reliably loaded for a standalone app, which
left the UI half translated. The view therefore carries a generated map.

po/zh_Hans/luci-app-static-gw.po stays the single source of truth. Re-run this
after editing the .po:

    python3 Scripts/tests/apply-zh-fallback.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
view = root / "htdocs/luci-static/resources/view/network/static-gw.js"

map_src = subprocess.run(
    [sys.executable, str(root / "Scripts/tests/gen-zh-map.py")],
    capture_output=True, text=True, check=True,
).stdout.strip()

src = view.read_text(encoding="utf-8")

if "const ZH_MAP = {" in src:
    start = src.index("const ZH_MAP = {")
    end = src.index("\n};", start) + len("\n};")
    src = src[:start] + map_src + src[end:]
    print("regenerated the existing ZH_MAP block")
else:
    helper = f"""// --- Built-in Simplified Chinese fallback -------------------------------
// Generated from po/zh_Hans/luci-app-static-gw.po by
// Scripts/tests/apply-zh-fallback.py; po stays the single source of truth.
{map_src}

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
    anchor = re.search(r"^const APP_VERSION = '[^']*';\n", src, re.M)
    if not anchor:
        sys.exit("could not find the APP_VERSION anchor")
    src = src[:anchor.end()] + "\n" + helper + src[anchor.end():]
    print("inserted a new ZH_MAP block")

# rewrite remaining bare _( call sites (idempotent)
before = len(re.findall(r"(?<![A-Za-z0-9_$])_\(", src))
src = re.sub(r"(?<![A-Za-z0-9_$])_\((['\"])", r"_t(\1", src)
after = len(re.findall(r"(?<![A-Za-z0-9_$])_\(", src))

view.write_text(src, encoding="utf-8", newline="\n")
print(f"rewrote {before - after} call sites; bare _( left: {after} (helper itself)")
