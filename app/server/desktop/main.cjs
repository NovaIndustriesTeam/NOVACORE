'use strict';
// NovaCore — lanceur de bureau (Electron).
// Il démarre le serveur NovaCore avec le runtime Node.js embarqué (node:sqlite exige
// Node >= 22.5 ; le Node interne d'Electron ne le fournit pas), attend que l'API soit
// prête, affiche l'application, puis arrête proprement tout l'arbre de processus.
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const IS_PACKAGED = app.isPackaged;
const APP_ROOT = IS_PACKAGED ? app.getAppPath() : path.join(__dirname, '..');
const PREFERRED_PORT = Number(process.env.NOVACORE_PORT || process.env.PORT || 6300);
const APP_NAME = 'NovaCore';

let activePort = PREFERRED_PORT;
let serverProcess = null;
let serverExited = false;
let win = null;
let splash = null;
let quitting = false;
let externalServer = false;
let logFile = null;

const baseUrl = () => `http://127.0.0.1:${activePort}`;

// Données locales de l'app (journal, scènes du Workbench) : LocalAppData sous Windows,
// pour ne pas gonfler le profil itinérant avec les rendus.
function localRoot() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_NAME);
  }
  return app.getPath('userData');
}

function logPath() {
  const dir = path.join(localRoot(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'novacore.log');
}

function tailLog(bytes = 3000) {
  try {
    const text = fs.readFileSync(logFile, 'utf8');
    return text.slice(-bytes);
  } catch {
    return '';
  }
}

// Répare les raccourcis Bureau et Menu Démarrer si l'installateur n'a pas pu les
// créer (constaté sur certaines configurations). Une seule tentative par profil :
// un raccourci supprimé volontairement n'est pas recréé à chaque démarrage.
function ensureShortcuts() {
  if (process.platform !== 'win32' || !IS_PACKAGED) return;
  const marker = path.join(localRoot(), '.shortcuts-created');
  try {
    if (fs.existsSync(marker)) return;
    const target = process.execPath;
    const links = [
      path.join(app.getPath('desktop'), `${APP_NAME}.lnk`),
      path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`)
    ];
    let created = 0;
    for (const link of links) {
      try {
        if (!fs.existsSync(link)) {
          shell.writeShortcutLink(link, 'create', {
            target,
            cwd: path.dirname(target),
            description: APP_NAME,
            icon: target,
            iconIndex: 0,
            appUserModelId: 'com.novacore.desktop'
          });
        }
        if (fs.existsSync(link)) created += 1;
      } catch (error) {
        console.warn(`[NovaCore] Raccourci non créé (${link}) : ${error.message}`);
      }
    }
    if (created === links.length) {
      fs.writeFileSync(marker, new Date().toISOString());
    }
  } catch (error) {
    console.warn('[NovaCore] Vérification des raccourcis impossible :', error.message);
  }
}

// Résout le binaire Node : runtime embarqué en production, node du PATH en développement.
function nodeBinary() {
  if (process.env.NOVACORE_NODE) return process.env.NOVACORE_NODE;
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  const bundled = IS_PACKAGED
    ? path.join(process.resourcesPath, 'runtime', name)
    : path.join(APP_ROOT, 'runtime', name);
  return fs.existsSync(bundled) ? bundled : 'node';
}

function probe(url, timeout = 1200) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function isNovaCore(response) {
  if (!response || response.status !== 200) return false;
  try {
    const parsed = JSON.parse(response.body);
    return parsed && parsed.name === APP_NAME;
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverExited) return false;
    const version = await probe(`${baseUrl()}/api/version`, 1000);
    if (isNovaCore(version)) {
      const response = await probe(`${baseUrl()}/api/ready`, 1000);
      if (response && /"ready"\s*:\s*true/.test(response.body)) return true;
    }
    await sleep(300);
  }
  return false;
}

function killServerTree() {
  if (!serverProcess) return;
  const pid = serverProcess.pid;
  serverProcess = null;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* déjà terminé */ }
  }
}

function attachWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 920,
    minHeight: 650,
    show: false,
    backgroundColor: '#080a12',
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) splash.close();
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(baseUrl())) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl())) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.on('render-process-gone', () => {
    if (!quitting && win) win.reload();
  });

  if (!IS_PACKAGED) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  win.on('closed', () => { win = null; });
  win.loadURL(baseUrl());
}

function showSplash() {
  splash = new BrowserWindow({
    width: 460,
    height: 320,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: '#080a12',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => { splash = null; });
}

async function startServer() {
  logFile = logPath();

  // Un serveur NovaCore déjà présent (instance de développement ou autre lancement) est réutilisé.
  const existing = await probe(`${baseUrl()}/api/version`, 900);
  if (isNovaCore(existing)) {
    externalServer = true;
    return true;
  }
  if (existing) {
    // Le port est occupé par une autre application : on choisit un port libre.
    activePort = await freePort();
  }

  const node = nodeBinary();
  if (node !== 'node' && !fs.existsSync(node)) {
    throw new Error(`Runtime Node.js introuvable : ${node}`);
  }

  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(activePort),
    NOVACORE_DESKTOP: '1'
  };
  // Scènes et rendus du Workbench hors du dossier d'installation : ils survivent aux mises à jour.
  if (!env.NOVA_WORKBENCH_DATA_DIR) {
    env.NOVA_WORKBENCH_DATA_DIR = path.join(localRoot(), 'workbench');
  }

  const out = fs.openSync(logFile, 'a');
  try {
    serverProcess = spawn(node, [path.join(APP_ROOT, 'server', 'index.js')], {
      cwd: APP_ROOT,
      env,
      windowsHide: true,
      stdio: ['ignore', out, out]
    });
  } finally {
    fs.closeSync(out);
  }

  serverProcess.on('exit', code => {
    serverExited = true;
    if (!quitting && !externalServer) {
      console.warn(`[NovaCore] Serveur arrêté (code ${code}). Journal : ${logFile}`);
    }
  });
  serverProcess.on('error', error => {
    serverExited = true;
    console.error('[NovaCore] Impossible de démarrer le serveur :', error.message);
  });

  return waitForReady();
}

async function boot() {
  try {
    ensureShortcuts();
    showSplash();
    const ready = await startServer();
    if (!ready) {
      const detail = [
        'NovaCore n’a pas pu démarrer ses services locaux.',
        '',
        `Journal : ${logFile || logPath()}`,
        '',
        tailLog(1800) || 'Aucun journal disponible.'
      ].join('\n');
      if (splash && !splash.isDestroyed()) splash.close();
      dialog.showErrorBox('NovaCore — démarrage impossible', detail);
      quitting = true;
      killServerTree();
      app.exit(1);
      return;
    }
    attachWindow();
  } catch (error) {
    if (splash && !splash.isDestroyed()) splash.close();
    dialog.showErrorBox('NovaCore — erreur de démarrage', String(error && error.message ? error.message : error));
    quitting = true;
    killServerTree();
    app.exit(1);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(boot);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) attachWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', event => {
    if (quitting) return;
    quitting = true;
    if (serverProcess) {
      event.preventDefault();
      killServerTree();
      app.exit(0);
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      quitting = true;
      killServerTree();
      app.exit(0);
    });
  }
}
