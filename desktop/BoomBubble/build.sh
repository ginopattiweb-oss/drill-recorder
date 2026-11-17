#!/bin/bash
# Compila Boom Bubble.app y la instala en ~/Applications
set -euo pipefail
cd "$(dirname "$0")"
OUT="build/Boom Bubble.app"
rm -rf build && mkdir -p build && mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
# Workaround: algunas Command Line Tools traen un module.modulemap duplicado que rompe Swift.
# Un overlay VFS lo oculta solo para esta compilación (sin tocar archivos del sistema).
VFS="$(pwd)/build/vfs"; mkdir -p "$VFS"; : > "$VFS/empty.modulemap"
printf '{"version":0,"case-sensitive":"false","roots":[{"type":"file","name":"/Library/Developer/CommandLineTools/usr/include/swift/module.modulemap","external-contents":"%s/empty.modulemap"}]}' "$VFS" > "$VFS/overlay.yaml"
swiftc -O -swift-version 5 -target arm64-apple-macos13.0 -vfsoverlay "$VFS/overlay.yaml" -Xcc -ivfsoverlay -Xcc "$VFS/overlay.yaml" \
  main.swift -o "$OUT/Contents/MacOS/BoomBubble" \
  -framework AppKit -framework AVFoundation -framework Network -framework ServiceManagement
cp Info.plist "$OUT/Contents/Info.plist"
[ -f AppIcon.icns ] && cp AppIcon.icns "$OUT/Contents/Resources/AppIcon.icns"
# Firma con un certificado estable si hay uno (así macOS recuerda el permiso de cámara entre builds);
# si no, firma ad-hoc (hay que volver a dar el permiso después de cada build).
IDENTITY="$(security find-identity -p codesigning -v 2>/dev/null | grep -m1 -o '"Apple Development[^"]*"' | tr -d '"' || true)"
codesign --force --deep -s "${IDENTITY:--}" "$OUT"
DEST="$HOME/Applications/Boom Bubble.app"
mkdir -p "$HOME/Applications"
pkill -x BoomBubble 2>/dev/null || true
rm -rf "$DEST" && cp -R "$OUT" "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
echo "Instalada en $DEST"
