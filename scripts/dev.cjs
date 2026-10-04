const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js')], { cwd: root, stdio: 'inherit' });
let desktop;
const stop = () => { desktop?.kill(); vite.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
(async () => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:5173')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  const env = { ...process.env, BETTER_TERMINAL_DEV_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = spawn(require('electron'), ['.'], { cwd: root, stdio: 'inherit', env });
  desktop.on('exit', () => { vite.kill(); process.exit(); });
})().catch(error => { console.error(error); stop(); process.exit(1); });
