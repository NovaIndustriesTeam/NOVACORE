// Wait for the current HTTP server to release port 6300, then relaunch it in developer mode.
const { spawn } = require('node:child_process');
const path = require('node:path');
setTimeout(() => {
  const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NOVACORE_DEV_MODE: '1' },
    detached: true, stdio: 'ignore', windowsHide: true
  });
  server.unref();
  process.exit(0);
}, 1100);
