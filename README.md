# web_vtube

Minimal VRM VTuber app (three.js / `@pixiv/three-vrm`) for browser and Electron.

## Run

- **Browser (online):** `npm run serve` then open http://localhost:5173 (use `localhost`/HTTPS for webcam).
- **Browser (offline):** `make vendor` then serve and open `index.offline.html`.
- **Electron:** `npm install` then `npm start`.
- **Electron + Linux virtual cam:** `V4L2_DEVICE=/dev/videoN npm start` (works windowed or headless; pipes captured frames to v4l2loopback via `ffmpeg`).
- **Electron tray mode:** `npx electron . --tray` (or `make start-tray`) creates a tray app with a separate output window (`?output=1`) showing only model + background for capture/vcam; control window can be hidden.
- **Electron headless:** `V4L2_DEVICE=/dev/videoN VCAM_FPS=30 npm run start:headless`.
- **Electron dev URL:** `WEB_VTUBE_URL=http://localhost:5173 npm start`.

## Features

- VRM load/save in IndexedDB with original filename.
- OrbitControls camera panning, clean view (`Clean view` button, `Esc` or `Done` to exit).
- Settings: GPU power preference + antialias (saved in localStorage; reload applies).
- Performance overlay: FPS, frame ms, draw calls.
- Tracking (MediaPipe Tasks Vision): face blendshapes/head rotation + pose-based arm/torso motion (head/arm/torso scope; no full body).
- Calibration: staged flow — 1) neutral face with head/arms locked (click canvas to sample), 2) head turn/move, 3) hands/arms/torso tuning baseline.
- Output background options for output view/virtual cam: greenscreen, color, image, or transparent.
- Browser virtual cam: opens a capture window from `canvas.captureStream()` for OBS/browser capture.
- Separate Electron output window in tray mode for clean model/greenscreen video output.
- Drag-and-drop `.vrm` loading.

## Virtual camera / capture

- **Browser:** use OBS Browser Source on the app (clean view), window/display capture, or the virtual-cam popup window.
- **Electron/Linux v4l2:** set `V4L2_DEVICE=/dev/videoN` (or pass `--v4l2=/dev/videoN`) to output video to a virtual camera device via `ffmpeg` + `v4l2loopback`. In `--tray` mode, vcam targets the separate output window (model + background). Optional: `VCAM_FPS=30`, `VCAM_SIZE=1280x720`. Spout/Syphon not implemented.

## Distribution / updates (server/local)

- `make vendor` downloads CDN scripts/models for offline use.
- `make install` / `make update` / `make uninstall` installs to `/opt/web_vtube` and `/usr/local/bin/web-vtube` (sudo; uses source on server).
- `make package` builds Arch package via `makepkg` when available (`PKGBUILD` included).

## Notes

- Webcam tracking requires secure context and camera permission.
- "3d.js" in request interpreted as **three.js**. Tracking/calibration are minimal approximations intended for tuning.
