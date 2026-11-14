.PHONY: help serve start start-headless start-tray start-vcam vcam-setup restart clean vendor install uninstall update package

PREFIX ?= /opt/web_vtube
VCAM_DEV ?= /dev/video10
VCAM_NR ?= 10
VCAM_FPS ?= 30

help:
	@echo "serve          - run browser dev server (http://localhost:5173)"
	@echo "start          - launch Electron app"
	@echo "start-headless - launch Electron headless (V4L2_DEVICE=... for virtual cam)"
	@echo "start-tray     - launch tray app with separate output window"
	@echo "vcam-setup     - create v4l2loopback device ($(VCAM_DEV), needs sudo/modprobe)"
	@echo "start-vcam     - setup virtual cam and launch Electron with V4L2_DEVICE=$(VCAM_DEV)"
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

start-tray:
	npx electron . --tray

vcam-setup:
	@if [ ! -e $(VCAM_DEV) ]; then \
		echo "Setting up v4l2loopback at $(VCAM_DEV)..."; \
		sudo modprobe v4l2loopback video_nr=$(VCAM_NR) card_label="web_vtube" exclusive_caps=1 || true; \
	fi
	@ls -l $(VCAM_DEV) 2>/dev/null || echo "Device $(VCAM_DEV) not found (install/load v4l2loopback)."

start-vcam: vcam-setup
	V4L2_DEVICE=$(VCAM_DEV) VCAM_FPS=$(VCAM_FPS) npm start

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
