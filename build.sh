#!/usr/bin/env bash
# Makes the zip to upload to the Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")"
version=$(python3 -c "import json; print(json.load(open('app/manifest.json'))['version'])")
out="dist/markdown-folder-viewer-$version.zip"
mkdir -p dist
rm -f "$out"
(cd app && zip -qr "../$out" . -x 'icons/icon.svg' -x '*.DS_Store')
echo "Built $out ($(du -h "$out" | cut -f1))"
