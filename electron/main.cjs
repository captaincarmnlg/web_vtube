const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const headless = process.argv.includes('--headless');
const v4l2 = process.env.V4L2_DEVICE; // e.g. /dev/video10 (v4l2loopback)
const devUrl = process.env.WEB_VTUBE_URL;

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
  if (!headless) return;

  // Headless virtual-cam output: pipe frames to ffmpeg -> v4l2loopback when configured.
  if (v4l2) {
    const fps = Number(process.env.VCAM_FPS || 30);
    const ff = spawn('ffmpeg', ['-f','image2pipe','-vcodec','png','-r',String(fps),'-i','-',
      '-vf','format=yuv420p','-f','v4l2', v4l2], { stdio: ['pipe','ignore','inherit'] });
    setInterval(async () => {
      if (win.isDestroyed()) return;
      const img = await win.webContents.capturePage();
      ff.stdin.write(img.toPNG());
    }, 1000 / fps);
    win.on('closed', () => { try { ff.stdin.end(); } catch {} });
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
