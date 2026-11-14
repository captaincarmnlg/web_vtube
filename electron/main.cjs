const { app, BrowserWindow, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const headless = process.argv.includes('--headless');
const trayMode = process.argv.includes('--tray') || process.env.WEB_VTUBE_TRAY === '1';
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
  if (!v4l2 || !win || win.isDestroyed()) return;
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
      const img = await win.webContents.capturePage();
      if (!ff.stdin.destroyed) ff.stdin.write(img.toPNG());
    } catch (e) { console.error('virtual cam capture error:', e.message); }
    busy = false;
  }, 1000 / fps);
  vcamStop = () => { clearInterval(timer); try { ff.stdin.end(); } catch {} try { ff.kill(); } catch {} vcamStop = null; };
  console.log(`Virtual camera output -> ${v4l2} @ ${fps}fps`);
}
function stopVirtualCam() { if (vcamStop) vcamStop(); }

function ensureOutputWindow(show = true) {
  if (outputWin && !outputWin.isDestroyed()) { if (show) outputWin.show(); return outputWin; }
  outputWin = new BrowserWindow({
    width: 960, height: 720, show: false, autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false }
  });
  outputWin.on('closed', () => { outputWin = null; });
  loadApp(outputWin, '?output=1').then(() => {
    if (show) outputWin.show();
    // if vcam env/arg set, prefer output window
    if (process.env.V4L2_DEVICE || argVal('v4l2') || argVal('virtual-cam')) startVirtualCam(outputWin);
  });
  return outputWin;
}

function createControlWindow(show = true) {
  if (controlWin && !controlWin.isDestroyed()) { if (show) controlWin.show(); return controlWin; }
  controlWin = new BrowserWindow({
    width: 960, height: 720,
    show: show && !headless,
    frame: !headless,
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false }
  });
  controlWin.on('close', (e) => {
    if (trayMode && !quitting) { e.preventDefault(); controlWin.hide(); }
  });
  controlWin.on('closed', () => { controlWin = null; });
  loadApp(controlWin, '').then(() => {
    // default vcam target: output window in tray mode if present, else control window
    if (!trayMode && (process.env.V4L2_DEVICE || argVal('v4l2') || argVal('virtual-cam'))) startVirtualCam(controlWin);
  });
  return controlWin;
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAEklEQVQ4y2NgGAWjYBSMAggAAAgAAeKJfW4AAAAASUVORK5CYII=');
  tray = new Tray(icon);
  const menu = () => Menu.buildFromTemplate([
    { label: 'Show Controls', click: () => createControlWindow(true) },
    { label: 'Show Output Window', click: () => ensureOutputWindow(true) },
    { label: 'Hide Output Window', click: () => { if (outputWin && !outputWin.isDestroyed()) outputWin.hide(); } },
    { label: 'Start Virtual Cam (output)', click: () => { const w = ensureOutputWindow(true); w.webContents.once('did-finish-load', () => startVirtualCam(w)); if (!w.webContents.isLoading()) startVirtualCam(w); } },
    { label: 'Stop Virtual Cam', click: () => stopVirtualCam() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; stopVirtualCam(); app.quit(); } },
  ]);
  tray.setToolTip('web_vtube');
  tray.setContextMenu(menu());
  tray.on('click', () => createControlWindow(true));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  if (trayMode) {
    createTray();
    ensureOutputWindow(!headless); // output window for model/greenscreen + vcam
    // keep control window hidden by default in tray mode unless not desired
    if (!process.argv.includes('--no-control')) createControlWindow(false);
  } else {
    createControlWindow(true);
  }
});

app.on('before-quit', () => { quitting = true; stopVirtualCam(); });
app.on('window-all-closed', () => { if (!trayMode) app.quit(); });
