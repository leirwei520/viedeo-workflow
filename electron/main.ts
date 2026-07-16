import { app, BrowserWindow, ipcMain, Menu, shell, dialog, session } from 'electron';
import path from 'path';
import fs from 'fs';

process.on('uncaughtException', (err) => {
  fs.appendFileSync(
    path.join(app.getPath('userData'), 'crash.log'),
    `[${new Date().toISOString()}] Uncaught: ${err.stack || err}\n`
  );
  dialog.showErrorBox('Application Error', err.stack || String(err));
  app.quit();
});

// Simple JSON config store (replaces electron-store to avoid ESM issues)
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

interface AppConfig {
  serverUrl: string;
  windowBounds: { width: number; height: number };
}

function loadConfig(): AppConfig {
  const defaults: AppConfig = { serverUrl: '', windowBounds: { width: 1400, height: 900 } };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch { /* ignore */ }
  return defaults;
}

function saveConfig(config: AppConfig) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[Config] Failed to save:', e);
  }
}

let config = loadConfig();
let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;

function createWindow() {
  const { width, height } = config.windowBounds;

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 640,
    title: 'Chuhai Bang',
    icon: path.join(__dirname, '../public/logo.png'),
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#020a12',
      symbolColor: '#ffffff',
      height: 36,
    } : undefined,
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
    show: false,
    backgroundColor: '#020a12',
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[Main] Page failed to load: ${code} ${desc}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Main] Renderer crashed:', details.reason);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  }  else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    console.log('[Main] Loading:', indexPath, 'exists:', fs.existsSync(indexPath));
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('[Main] loadFile error:', err);
    });
  }

  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Fallback: show window after 3s even if ready-to-show didn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.warn('[Main] Forcing window visible (ready-to-show timeout)');
      mainWindow.show();
    }
  }, 3000);

  mainWindow.on('resized', () => {
    if (mainWindow) {
      const [w, h] = mainWindow.getSize();
      config.windowBounds = { width: w, height: h };
      saveConfig(config);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
  ];

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// IPC handlers
ipcMain.handle('store:getServerUrl', () => {
  return config.serverUrl;
});

ipcMain.handle('store:setServerUrl', (_event, url: string) => {
  config.serverUrl = url;
  saveConfig(config);
  return true;
});

ipcMain.handle('app:isElectron', () => true);

app.whenReady().then(() => {
  const CURRENT_SERVER = config.serverUrl || 'http://localhost:3001';
  const SERVER_PATH_PREFIXES = ['/api/', '/library/'];

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);

      // file:// requests containing /api/ or /library/ → redirect to backend
      if (url.protocol === 'file:') {
        const pathname = decodeURIComponent(url.pathname);
        for (const prefix of SERVER_PATH_PREFIXES) {
          const idx = pathname.indexOf(prefix);
          if (idx !== -1) {
            const relativePath = pathname.slice(idx) + (url.search || '');
            callback({ redirectURL: `${CURRENT_SERVER}${relativePath}` });
            return;
          }
        }
      }

      // http requests to a stale :3001 IP → redirect to current server
      if (url.protocol === 'http:' && url.port === '3001' && !details.url.startsWith(CURRENT_SERVER)) {
        const relativePath = url.pathname + (url.search || '');
        callback({ redirectURL: `${CURRENT_SERVER}${relativePath}` });
        return;
      }
    } catch { /* ignore */ }
    callback({});
  });

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
