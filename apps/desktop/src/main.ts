import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from 'electron';
import { spawn } from 'child_process';
import * as path from 'path';
import * as http from 'http';

app.setAppUserModelId('com.pfs.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const DAEMON_URL = process.env['PORTSWITCH_DAEMON_URL'] ?? 'http://127.0.0.1:65432';
const UI_URL = `${DAEMON_URL}/ui`;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function isDaemonUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${DAEMON_URL}/api/v1/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

function spawnDaemon(): void {
  const bin = path.join(app.getAppPath(), '..', 'cli', 'main.js');
  const child = spawn(process.execPath, [bin, 'serve'], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function ensureDaemon(): Promise<void> {
  if (await isDaemonUp()) return;
  spawnDaemon();
  // Poll up to 10 s
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isDaemonUp()) return;
  }
  // Open URL anyway — the page itself will show the connection error state
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 600,
    minHeight: 400,
    title: 'pfs',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(UI_URL).catch(() => undefined);
  win.once('ready-to-show', () => win.show());

  // Open external links in the system browser, not in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });

  return win;
}

function createTray(win: BrowserWindow): Tray {
  const icon = nativeImage.createEmpty();
  const t = new Tray(icon);

  const updateMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: win.isVisible() ? 'Hide pfs' : 'Show pfs',
        click: () => {
          if (win.isVisible()) { win.hide(); } else { win.show(); win.focus(); }
          updateMenu();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    t.setContextMenu(menu);
  };

  updateMenu();
  t.setToolTip('pfs — port-forwarding manager');
  t.on('click', () => {
    if (win.isVisible()) { win.hide(); } else { win.show(); win.focus(); }
    updateMenu();
  });

  return t;
}

app.whenReady().then(async () => {
  await ensureDaemon();
  mainWindow = createWindow();
  tray = createTray(mainWindow);

  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  });
});

app.on('window-all-closed', () => { /* quit via tray only */ });

app.on('before-quit', () => {
  if (mainWindow) mainWindow.removeAllListeners('close');
  tray?.destroy();
  tray = null;
});
