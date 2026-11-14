.PHONY: help serve start start-headless restart clean vendor install uninstall update package

PREFIX ?= /opt/web_vtube

help:
	@echo "serve          - run browser dev server (http://localhost:5173)"
	@echo "start          - launch Electron app"
	@echo "start-headless - launch Electron headless (V4L2_DEVICE=... for virtual cam)"
	@echo "restart        - restart the web server"
	@echo "vendor         - download CDN assets for offline mode"
	@echo "install        - install app to $(PREFIX) (needs sudo)"
	@echo "update         - update installed copy from current source (needs sudo)"
	@echo "uninstall      - remove installed app (needs sudo)"
	@echo "package        - build Arch package via makepkg (if available)"

serve:
	npm run serve

start:
	npm start

start-headless:
	npm run start:headless

restart:
	@pkill -f 'python3 -m http.server 5173' || true
	@npm run serve > /tmp/opencode/http.log 2>&1 &

vendor:
	bash scripts/fetch-vendor.sh

install:
	sudo mkdir -p $(PREFIX)
	sudo rsync -a --exclude node_modules --exclude .git --exclude pkg ./ $(PREFIX)/
	sudo bash -lc 'printf "%s\n" "#!/usr/bin/env bash" "cd $(PREFIX) && exec electron . \"\$$@\"" > /usr/local/bin/web-vtube && chmod +x /usr/local/bin/web-vtube'

update: install

uninstall:
	sudo rm -rf $(PREFIX) /usr/local/bin/web-vtube

package:
	@command -v makepkg >/dev/null 2>&1 && makepkg -f || echo "makepkg not found; use make install/update/uninstall"

clean:
	rm -rf node_modules vendor pkg src-tauri *.pkg.tar.*
