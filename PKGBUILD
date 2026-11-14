# Maintainer: local
pkgname=web-vtube
pkgver=0.1.0
pkgrel=1
pkgdesc="Web/Electron VRM VTuber app (local distribution)"
arch=('any')
url="http://localhost"
license=('custom')
depends=('electron' 'ffmpeg' 'python')
source=()
sha256sums=()

package() {
  install -d "$pkgdir/opt/web_vtube" "$pkgdir/usr/bin" "$pkgdir/usr/share/applications"
  cp -r "$startdir"/* "$pkgdir/opt/web_vtube/" 2>/dev/null || true
  rm -rf "$pkgdir/opt/web_vtube/node_modules" "$pkgdir/opt/web_vtube/.git" "$pkgdir/opt/web_vtube/pkg" "$pkgdir/opt/web_vtube/src-tauri"
  cat > "$pkgdir/usr/bin/web-vtube" <<'EOF'
#!/usr/bin/env bash
cd /opt/web_vtube && exec electron . "$@"
EOF
  chmod +x "$pkgdir/usr/bin/web-vtube"
  cat > "$pkgdir/usr/share/applications/web-vtube.desktop" <<'EOF'
[Desktop Entry]
Name=web_vtube
Exec=web-vtube
Type=Application
Categories=AudioVideo;
EOF
}
