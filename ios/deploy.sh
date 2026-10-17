#!/bin/sh
# Installe (ou réinstalle) Jarvis sur l'iPhone branché au Mac.
# Compte Apple gratuit : le certificat expire au bout de 7 jours, relancer ce script une fois par semaine.
set -e
cd "$(dirname "$0")"
xcodegen generate >/dev/null
DEV=$(xcrun devicectl list devices 2>/dev/null | awk '/available/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F-]{36}$/) {print $i; exit}}')
[ -z "$DEV" ] && { echo "Aucun iPhone branché et déverrouillé."; exit 1; }
xcodebuild -project Jarvis.xcodeproj -scheme Jarvis -configuration Debug -destination "id=$DEV" -derivedDataPath build -allowProvisioningUpdates build | grep -E "error|BUILD" || true
xcrun devicectl device install app --device "$DEV" build/Build/Products/Debug-iphoneos/Jarvis.app
xcrun devicectl device process launch --device "$DEV" com.sebckyser.jarvis >/dev/null && echo "Jarvis installé et lancé."
