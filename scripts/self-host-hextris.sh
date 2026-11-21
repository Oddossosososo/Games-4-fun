#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --depth 1 --branch gh-pages https://github.com/Hextris/hextris.git "$TMP/upstream"
rm -rf games/hextris
mkdir -p games/hextris
rsync -a "$TMP/upstream/" games/hextris/ \
  --exclude='.git/' --exclude='.github/' --exclude='.gitignore' \
  --exclude='CNAME' --exclude='README.md' --exclude='a.js' \
  --exclude='style/rrssb.css' --exclude='vendor/rrssb.min.js' \
  --exclude='images/appstore.svg' --exclude='images/btn_facebook.svg' \
  --exclude='images/btn_twitter.svg' --exclude='images/facebook-opengraph.png' \
  --exclude='images/twitter-opengraph.png'

# Preserve the upstream GPL-3.0 text under the conventional LICENSE filename.
cp "$TMP/upstream/LICENSE.md" games/hextris/LICENSE

python3 - <<'PY'
from pathlib import Path
import re

root = Path("games/hextris")
page = root / "index.html"
html = page.read_text(encoding="utf-8")

# Remove remote metadata, external font loads, advertising and analytics.
html = re.sub(r'(?is)\s*<meta\s+property=["\'](?:og:|twitter:)[^>]*>', '', html)
html = re.sub(r'(?is)\s*<link[^>]+href=["\']https?://fonts\.googleapis\.com[^>]*>', '', html)
html = re.sub(r'(?is)\s*<script[^>]*(?:googlesyndication|data-ad-client)[^>]*>.*?</script>', '', html)
html = re.sub(r'(?is)\s*<script[^>]*>\s*\(function\(i,s,o,g,r,a,m\).*?google-analytics\.com/analytics\.js.*?</script>', '', html)
html = re.sub(r'(?is)\s*<link[^>]+href=["\']style/rrssb\.css["\'][^>]*>', '', html)
html = re.sub(r'(?is)\s*<script[^>]+src=["\']vendor/rrssb\.min\.js["\'][^>]*>\s*</script>', '', html)

# Remove the social-share container without disturbing its surrounding game UI.
def remove_div_with_id(source, target_id):
    match = re.search(r'<div\b[^>]*\bid\s*=\s*["\']' + re.escape(target_id) + r'["\'][^>]*>', source, re.I)
    if not match:
        return source
    token_re = re.compile(r'</?div\b[^>]*>', re.I)
    depth = 0
    for token in token_re.finditer(source, match.start()):
        if token.group(0).lower().startswith('</'):
            depth -= 1
            if depth == 0:
                return source[:match.start()] + source[token.end():]
        else:
            depth += 1
    return source

html = remove_div_with_id(html, "socialShare")
# Drop the inline language-specific social sharing injector.
html = re.sub(r'(?is)\s*<script[^>]*>\s*\(function addRussianSocialShare\(\).*?</script>', '', html)
page.write_text(html, encoding="utf-8")

# Remove remote score/analytics code and replace linked instructions with local text.
main = root / "js/main.js"
lines = main.read_text(encoding="utf-8").splitlines()
clean = []
for line in lines:
    if "$.get('http://54.183.184.126/'" in line:
        continue
    if "script.src = 'http://hextris.io/a.js'" in line:
        continue
    if '$("#inst_main_body").html(' in line:
        clean.append('    $("#inst_main_body").html("<div id=\'instructions_head\'>HOW TO PLAY</div><p>Stop blocks from leaving the outer hexagon.</p><p>Use the left and right arrow keys, or tap the left and right sides of the screen, to rotate. Use the down arrow to speed up falling blocks.</p><p>Clear blocks by making three or more blocks of the same colour touch.</p><hr><p>Hextris by Logan Engstrom, Garrett Finucane, Noah Moroze and Michael Yang.</p>");')
    else:
        clean.append(line)
main.write_text("\n".join(clean) + "\n", encoding="utf-8")


# Remove outbound ad-purchase links from pause screens.
view = root / "js/view.js"
view_lines = view.read_text(encoding="utf-8").splitlines()
view_clean = []
for line in view_lines:
    if "'pausedAndroid':" in line or "'pausediOS':" in line or "'pausedOther':" in line:
        key = line.split(":", 1)[0]
        view_clean.append(key + ': "<div class=\\'centeredHeader unselectable\\'>Game Paused</div>",')
    else:
        view_clean.append(line)
view.write_text("\n".join(view_clean) + "\n", encoding="utf-8")

# Add an explicit third-party notice for bundled font families.
(root / "THIRD-PARTY-NOTICES.md").write_text(
    "# Third-party notices\n\n"
    "- **Hextris** — Copyright (C) 2018 Logan Engstrom; contributors Logan Engstrom, "
    "Garrett Finucane, Noah Moroze and Michael Yang. Licensed under GNU GPL v3 or later; "
    "see [LICENSE](./LICENSE).\n"
    "- **Exo 2** font files — SIL Open Font License 1.1. The font is bundled locally; "
    "see https://openfontlicense.org/ for the licence text and terms.\n"
    "- **Font Awesome 4.1.0** — CSS under MIT and font files under SIL Open Font License 1.1; "
    "see https://fontawesome.com/v4/license/ for the upstream notices.\n",
    encoding="utf-8"
)

# Verify that active HTML/CSS resource references and known runtime requests are local.
scan_files = [page] + list(root.rglob("*.css"))
bad = []
for file in scan_files:
    text = file.read_text(encoding="utf-8", errors="ignore")
    if re.search(r"""(?:src|href)\s*=\s*["']https?://|url\(\s*["']?https?://""", text, re.I):
        bad.append(str(file))
for file in [p for p in root.rglob("*.js") if p.name != "jquery.js"]:
    text = file.read_text(encoding="utf-8", errors="ignore")
    if any(term in text for term in ("googlesyndication", "google-analytics", "http://54.183.184.126/", "http://hextris.io/a.js", "$.get('http", '$.get("http', "fetch('http", 'fetch("http', "script.src = 'http", 'script.src = "http')):
        bad.append(str(file))
if bad:
    raise SystemExit("Remote runtime references remain in: " + ", ".join(bad))
PY

python3 - <<'PY'
import json
from pathlib import Path

manifest_path = Path("games.json")
data = json.loads(manifest_path.read_text(encoding="utf-8"))
game = next((g for g in data["games"] if g.get("id") == "hextris"), None)
if game is None:
    game = {"id": "hextris"}
    data["games"].append(game)
game.update({
    "title": "Hextris",
    "category": "Puzzle",
    "creator": "Logan Engstrom, Garrett Finucane, Noah Moroze and Michael Yang",
    "license": "GPL-3.0-or-later",
    "source": "https://github.com/Hextris/hextris",
    "entrypoint": "games/hextris/index.html",
    "mode": "bundled",
    "hosting": "self-hosted",
    "verified": True,
    "embeddable": True,
    "emoji": "⬡",
    "glow": "#50b7b0",
    "shade": "#16424b",
    "desc": "Fast-paced hexagonal colour-matching puzzle.",
    "officialUrl": "https://hextris.github.io/hextris/",
    "auditNote": "Self-hosted GPL-3.0-or-later build. Advertising, analytics, remote score requests, social-share scripts and external font loads removed. Game files and fonts are served locally; online high scores are disabled."
})
manifest_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

page = Path("index.html")
html = page.read_text(encoding="utf-8")
marker = '<p class="modal-copy">See <a href="./SOURCES.md"'
if marker in html and "Hextris — GPL-3.0-or-later" not in html:
    html = html.replace(
        marker,
        '<p class="modal-copy"><strong>Hextris</strong> — by Logan Engstrom, Garrett Finucane, Noah Moroze and Michael Yang. GPL-3.0-or-later. The self-hosted copy is in <code>games/hextris/</code>; see its <a href="./games/hextris/LICENSE" target="_blank" rel="noopener">licence</a> and <a href="./games/hextris/THIRD-PARTY-NOTICES.md" target="_blank" rel="noopener">third-party notices</a>.</p>' + marker
    )
page.write_text(html, encoding="utf-8")

sources = Path("SOURCES.md")
existing = sources.read_text(encoding="utf-8") if sources.exists() else "# Sources and licences\n\n"
if "## Hextris" not in existing:
    existing += (
        "\n## Hextris\n"
        "- Creator: Logan Engstrom, Garrett Finucane, Noah Moroze and Michael Yang.\n"
        "- Source: https://github.com/Hextris/hextris (gh-pages branch).\n"
        "- Licence: GNU GPL version 3 or later; see [games/hextris/LICENSE](./games/hextris/LICENSE).\n"
        "- Bundled assets: Exo 2 (SIL OFL 1.1) and Font Awesome 4.1.0 (MIT CSS / SIL OFL fonts); "
        "see [third-party notices](./games/hextris/THIRD-PARTY-NOTICES.md).\n"
        "- Local build: advertising, analytics, external score requests, and social-share scripts removed.\n"
    )
sources.write_text(existing, encoding="utf-8")
PY

# Enforce GitHub's per-file size limit and show the final payload summary.
python3 - <<'PY'
from pathlib import Path
files = [p for p in Path("games/hextris").rglob("*") if p.is_file()]
oversized = [str(p) for p in files if p.stat().st_size >= 100 * 1024 * 1024]
if oversized:
    raise SystemExit("Files exceed GitHub's 100 MB limit: " + ", ".join(oversized))
print(f"Prepared {len(files)} Hextris files ({sum(p.stat().st_size for p in files):,} bytes).")
PY

git add games/hextris games.json index.html SOURCES.md
if ! git diff --cached --quiet; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git commit -m "Self-host Hextris with local assets and attribution"
  git push
fi
