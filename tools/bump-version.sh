#!/bin/sh
# PWA-UPDATE-SYSTEM v2 release tool.
# Usage: tools/bump-version.sh <display-version> "<notes>"
# Generates the next release ID <display>-<YYYYMMDD>-<seq> (seq starts
# at 1 for a new display+date, and increments when the current release
# already has the same display version and date), writes it into
# public/index.html, public/sw.js and public/version.json, and
# validates that all three agree. No sed: the update is done by
# Python with exact replacements and proper JSON handling. Pushing
# the result to main is a release: installed apps see it on their
# next check and offer the update. (Battleship's PWA files live in
# public/ because GitHub Pages deploys that directory as the site
# root; the tool lives at the repo root so it is not deployed.)
set -e
cd "$(dirname "$0")/.."
exec python3 - "$@" <<'PYEOF'
import json, re, sys
from datetime import date

def fail(msg):
    print("bump-version: " + msg, file=sys.stderr)
    sys.exit(1)

if len(sys.argv) < 2 or not sys.argv[1]:
    fail("usage: tools/bump-version.sh <display-version> [notes]")
display = sys.argv[1]
notes = sys.argv[2] if len(sys.argv) > 2 else ""
if not re.fullmatch(r"\d+\.\d+\.\d+", display):
    fail("display version must look like 1.0.1, got %r" % display)
today = date.today()
datestr = today.strftime("%Y%m%d")
isodate = today.isoformat()

try:
    with open("public/version.json", encoding="utf-8") as f:
        current_meta = json.load(f)
except (OSError, ValueError) as e:
    fail("cannot read current public/version.json: %s" % e)
current_release = current_meta.get("release")
if not isinstance(current_release, str) or not current_release:
    fail("public/version.json has no release field; refusing to guess")

m = re.fullmatch(r"(\d+\.\d+\.\d+)-(\d{8})-(\d+)", current_release)
if m and m.group(1) == display and m.group(2) == datestr:
    seq = int(m.group(3)) + 1
else:
    seq = 1
release = "%s-%s-%d" % (display, datestr, seq)

def replace_once(path, pattern, replacement):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    new, n = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if n != 1:
        fail("%s: expected exactly one match for %s, found %d" % (path, pattern, n))
    with open(path, "w", encoding="utf-8") as f:
        f.write(new)

replace_once("public/index.html", r"^const APP_RELEASE='[^']*';",
             "const APP_RELEASE='%s';" % release)
replace_once("public/index.html", r"^const APP_VERSION='[^']*';",
             "const APP_VERSION='%s';" % display)
replace_once("public/sw.js", r"^const RELEASE = '[^']*';",
             "const RELEASE = '%s';" % release)
replace_once("public/sw.js", r"^const DISPLAY_VERSION = '[^']*';",
             "const DISPLAY_VERSION = '%s';" % display)
with open("public/version.json", "w", encoding="utf-8") as f:
    json.dump({"release": release, "version": display,
               "date": isodate, "notes": notes}, f)
    f.write("\n")

# Validate: all three files must agree on the new release.
with open("public/index.html", encoding="utf-8") as f:
    html = f.read()
with open("public/sw.js", encoding="utf-8") as f:
    sw = f.read()
with open("public/version.json", encoding="utf-8") as f:
    meta = json.load(f)
checks = [
    ("public/index.html APP_RELEASE", "const APP_RELEASE='%s';" % release in html),
    ("public/index.html APP_VERSION", "const APP_VERSION='%s';" % display in html),
    ("public/sw.js RELEASE", "const RELEASE = '%s';" % release in sw),
    ("public/sw.js DISPLAY_VERSION", "const DISPLAY_VERSION = '%s';" % display in sw),
    ("public/version.json release", meta.get("release") == release),
    ("public/version.json version", meta.get("version") == display),
    ("public/version.json date", meta.get("date") == isodate),
]
bad = [name for name, ok in checks if not ok]
if bad:
    fail("validation failed after update: %s" % ", ".join(bad))
print("release: %s" % release)
print("display version: %s" % display)
print("date: %s" % isodate)
PYEOF
