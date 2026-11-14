const { app, BrowserWindow, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Reduce noisy Wayland presentation-feedback warnings on some compositors.
app.commandLine.appendSwitch('disable-features', 'WaylandWpColorManagerV1,CalculateNativeWinOcclusion');
// Keep hidden engine/output window rendering & tracking active for vcam.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const headless = process.argv.includes('--headless');
const showOutput = process.argv.includes('--show-output');
const devUrl = process.env.WEB_VTUBE_URL;
let controlWin = null, outputWin = null, tray = null, vcamStop = null, quitting = false;

function argVal(name) {
  const i = process.argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return;
  const a = process.argv[i];
  return a.includes('=') ? a.split('=').slice(1).join('=') : process.argv[i + 1];
}

function appUrl(query = '') {
  if (devUrl) return devUrl.replace(/\/?$/, '') + '/' + query;
  return null;
}

async function loadApp(win, query = '') {
  if (devUrl) await win.loadURL(appUrl(query));
  else await win.loadFile(path.join(__dirname, '..', 'index.html'), { search: query.replace(/^\?/, '') });
}

function startVirtualCam(win) {
  stopVirtualCam();
  const v4l2 = process.env.V4L2_DEVICE || argVal('v4l2') || argVal('virtual-cam');
  if (!v4l2) return;
  if (!win || win.isDestroyed()) win = ensureOutputWindow(false);
  if (!win || win.isDestroyed()) return;
  const fps = Math.max(1, Number(process.env.VCAM_FPS || argVal('vcam-fps') || 30));
  const sizeArg = process.env.VCAM_SIZE || argVal('vcam-size');
  const vf = sizeArg ? `scale=${sizeArg},format=yuv420p` : 'format=yuv420p';
  const ff = spawn('ffmpeg', [
    '-loglevel', 'error', '-f', 'image2pipe', '-vcodec', 'png', '-r', String(fps), '-i', '-',
    '-vf', vf, '-pix_fmt', 'yuv420p', '-f', 'v4l2', v4l2
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
  ff.on('error', (e) => console.error('ffmpeg virtual cam error:', e.message));
  ff.stdin.on('error', () => {});
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || win.isDestroyed()) return;
    busy = true;
    try {
      if (!win.isVisible()) { try { win.webContents.invalidate(); } catch {} }
      const img = await win.webContents.capturePage();
      if (!ff.stdin.destroyed) ff.stdin.write(img.toPNG());
    } catch (e) { console.error('virtual cam capture error:', e.message); }
    busy = false;
  }, 1000 / fps);
  vcamStop = () => { clearInterval(timer); try { ff.stdin.end(); } catch {} try { ff.kill(); } catch {} vcamStop = null; };
  console.log(`Virtual camera output -> ${v4l2} @ ${fps}fps`);
}
function stopVirtualCam() { if (vcamStop) vcamStop(); }

function ensureOutputWindow(show = false) {
  if (outputWin && !outputWin.isDestroyed()) {
    if (show) { try { outputWin.setSkipTaskbar(false); } catch {} outputWin.show(); }
    return outputWin;
  }
  const wantShow = show || showOutput;
  outputWin = new BrowserWindow({
    width: 960, height: 720,
    show: !!wantShow, frame: wantShow, transparent: false, skipTaskbar: !wantShow,
    autoHideMenuBar: true, paintWhenInitiallyHidden: true,
    webPreferences: { backgroundThrottling: false, offscreen: false }
  });
  outputWin.webContents.setBackgroundThrottling(false);
  try { outputWin.webContents.setFrameRate(30); } catch {}
  outputWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); try { outputWin.setSkipTaskbar(true); } catch {} outputWin.hide(); }
  });
  outputWin.on('closed', () => { outputWin = null; });
  loadApp(outputWin, '?output=1').then(() => {
    if (wantShow) outputWin.show();
    // virtual cam captures output window; keep engine alive/painted even when hidden
    if (!wantShow) { try { outputWin.webContents.invalidate(); } catch {} }
    if (process.env.V4L2_DEVICE || argVal('v4l2') || argVal('virtual-cam')) startVirtualCam(outputWin);
  });
  return outputWin;
}

function createControlWindow(show = true) {
  if (controlWin && !controlWin.isDestroyed()) { if (show) controlWin.show(); return controlWin; }
  controlWin = new BrowserWindow({
    width: 960, height: 720,
    show: show && !headless,
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false }
  });
  controlWin.webContents.setBackgroundThrottling(false);
  controlWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); controlWin.hide(); }
  });
  controlWin.on('closed', () => { controlWin = null; });
  loadApp(controlWin, '');
  return controlWin;
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAEklEQVQ4y2NgGAWjYBSMAggAAAgAAeKJfW4AAAAASUVORK5CYII=');
  tray = new Tray(icon);
  const rebuild = () => Menu.buildFromTemplate([
    { label: 'Show Controls', click: () => createControlWindow(true) },
    { label: 'Hide Controls', click: () => { if (controlWin && !controlWin.isDestroyed()) controlWin.hide(); } },
    { type: 'separator' },
    { label: 'Show Output Preview', click: () => ensureOutputWindow(true) },
    { label: 'Hide Output Preview', click: () => { if (outputWin && !outputWin.isDestroyed()) { try { outputWin.setSkipTaskbar(true); } catch {} outputWin.hide(); } } },
    { type: 'separator' },
    { label: 'Start Virtual Cam', click: () => { const w = ensureOutputWindow(false); if (!w.webContents.isLoading()) startVirtualCam(w); else w.webContents.once('did-finish-load', () => startVirtualCam(w)); } },
    { label: 'Stop Virtual Cam', click: () => stopVirtualCam() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; stopVirtualCam(); app.quit(); } },
  ]);
  tray.setToolTip('web_vtube');
  tray.setContextMenu(rebuild());
  tray.on('click', () => createControlWindow(true));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  createTray();
  ensureOutputWindow(false); // hidden output window for vcam (model+background), no UI
  createControlWindow(!headless && !process.argv.includes('--no-control'));
});

app.on('before-quit', () => { quitting = true; stopVirtualCam(); });
app.on('window-all-closed', () => { /* tray app keeps running */ });
