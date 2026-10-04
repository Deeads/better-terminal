const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'better-terminal-startup-benchmark-'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const wait = async (fn, message, timeout = 120000) => { const started = performance.now(); while (performance.now() - started < timeout) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(message); };
async function measure(name, executable) {
  const data = path.join(fixture, name); fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ settings: { confirmClose: false }, sessions: [{ name: '', direction: 'horizontal', ratio: .5, panes: [{ cwd: fixture, profile: 'powershell' }] }] }));
  const env = { ...process.env, BETTER_TERMINAL_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  let browser, page, exited = false;
  const started = performance.now();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  child.on('exit', () => { exited = true; });
  const seconds = () => Number(((performance.now() - started) / 1000).toFixed(2));
  try {
    await wait(async () => { if (exited) throw new Error(`${name} exited before startup`); try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, `${name}: no runtime connection`);
    const runtimeSeconds = seconds(); console.log(`${name}: Electron runtime available after ${runtimeSeconds}s`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await wait(async () => { page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('index.html')); return !!page; }, 'Window missing');
    await page.waitForSelector('.app', { timeout: 30000 });
    const interfaceSeconds = seconds();
    await wait(async () => (await page.locator('.terminal-pane .xterm-rows').innerText().catch(() => '')).includes('PS '), 'PowerShell prompt missing', 30000);
    const result = { name, runtimeSeconds, interfaceSeconds, shellReadySeconds: seconds() };
    console.log(JSON.stringify(result));
    await page.evaluate(() => window.betterTerminal.windowAction('close'));
    await wait(async () => exited, 'App did not close', 15000);
    return result;
  } finally {
    if (page && !page.isClosed()) await page.evaluate(() => window.betterTerminal.windowAction('close')).catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
(async () => {
  const direct = path.join(root, 'release/win-unpacked/Better Terminal.exe');
  const portable = path.join(root, `release/Better-Terminal-${version}.exe`);
  const results = [];
  results.push(await measure('direct-first', direct));
  results.push(await measure('portable', portable));
  results.push(await measure('direct-repeat', direct));
  fs.writeFileSync(path.resolve(root, '../Better-Terminal-startup-benchmark.json'), JSON.stringify({ measuredAt: new Date().toISOString(), note: 'Single local machine, isolated one-pane workspace, instrumentation via localhost CDP; not a cold-boot benchmark.', results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
