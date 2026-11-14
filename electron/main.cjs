const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const headless = process.argv.includes('--headless');
const devUrl = process.env.WEB_VTUBE_URL;

function argVal(name) {
  const i = process.argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return;
  const a = process.argv[i];
  return a.includes('=') ? a.split('=').slice(1).join('=') : process.argv[i + 1];
}

function startVirtualCam(win) {
  const v4l2 = process.env.V4L2_DEVICE || argVal('v4l2') || argVal('virtual-cam');
  if (!v4l2) return;
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
  const stop = () => { clearInterval(timer); try { ff.stdin.end(); } catch {} try { ff.kill(); } catch {} };
  win.on('closed', stop);
  app.on('before-quit', stop);
  console.log(`Virtual camera output -> ${v4l2} @ ${fps}fps`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960, height: 720,
    show: !headless,
    frame: !headless,
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  if (devUrl) win.loadURL(devUrl); else win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.webContents.once('did-finish-load', () => startVirtualCam(win));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
