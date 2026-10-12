#!/bin/sh
# Incrémente la version de Jarvis (index.html, version.json, sw.js) avant un push
cd "$(dirname "$0")"
V=$(( $(sed -n 's/.*"v":"\([0-9]*\)".*/\1/p' version.json) + 1 ))
sed -i '' "s/const APP_VERSION = '[0-9]*'/const APP_VERSION = '$V'/" core/core.js
sed -i '' "s/jarvis-v[0-9]*/jarvis-v$V/" sw.js
echo "{\"v\":\"$V\"}" > version.json
echo "Version $V"
