// Layout check for the "last terminal line is clipped" bug. Runs off-screen and unfocused.
// For several window sizes: every xterm row must sit inside the visible terminal canvas.
const { _electron: electron } = require('@playwright/test');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-layout-'));
const env = { ...process.env, BETTER_TERMINAL_DATA_DIR: dataDir, BETTER_TERMINAL_BACKGROUND: '1' }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  const app = await electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForSelector('.xterm-screen', { timeout: 20000 });
  let failed = 0;
  for (const [w, h] of [[1440, 920], [1200, 760], [1000, 640], [1280, 1000], [1366, 705], [1600, 853]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setBounds({ x: -5000, y: 0, width: w, height: h }); }, [w, h]);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const canvas = document.querySelector('.terminal-canvas').getBoundingClientRect();
      const rows = [...document.querySelectorAll('.xterm-rows > div')];
      const last = rows[rows.length - 1].getBoundingClientRect();
      const tabsInTitle = !!document.querySelector('.titlebar .tabs');
      const paletteInToolbar = !!document.querySelector('.workspace-toolbar .palette-trigger');
      return { rows: rows.length, lastBottom: Math.round(last.bottom), canvasBottom: Math.round(canvas.bottom), tabsInTitle, paletteInToolbar, vh: innerHeight };
    });
    const ok = r.lastBottom <= r.canvasBottom && r.tabsInTitle && r.paletteInToolbar;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${w}x${h}  rows=${r.rows} lastRowBottom=${r.lastBottom} canvasBottom=${r.canvasBottom} tabsInTitle=${r.tabsInTitle} paletteInToolbar=${r.paletteInToolbar}`);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: -5000, y: 0, width: 1440, height: 920 }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(os.tmpdir(), 'bt-layout.png') });
  await app.close().catch(() => {});
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
  console.log(failed ? `${failed} size(s) failed` : 'all sizes pass');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
