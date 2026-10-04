const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
const { detectProject } = require('../electron/project-intelligence.cjs');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'better-terminal-preview-'));
const data = new Store(fixture);
data.settings({ confirmClose: false, fontSize: 13 });
const project = data.addProject(root); project.stack = detectProject(root).stack; data.pin(project.id);
data.state.sessions = [{ name: 'better-terminal', direction: 'horizontal', ratio: .53, panes: [{ cwd: root, profile: 'powershell' }, { cwd: root, profile: 'powershell' }] }]; data.save();
const env = { ...process.env, BETTER_TERMINAL_DATA_DIR: fixture }; delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const wait = async (fn, message) => { for (let n = 0; n < 200; n++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(message); };
async function run(index, command) {
  const pane = page.locator('.terminal-pane').nth(index);
  await pane.locator('.xterm-helper-textarea').focus(); await page.keyboard.insertText(command); await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 300));
}
(async () => {
  app = await electron.launch({ executablePath: path.join(root, 'release/win-unpacked/Better Terminal.exe'), args: [], cwd: root, env }); page = await app.firstWindow();
  await page.waitForSelector('.terminal-pane');
  await wait(async () => await page.locator('.terminal-pane').count() === 2 && (await page.locator('.terminal-pane').nth(1).innerText()).includes('PS '), 'Packaged terminal startup failed');
  await run(0, 'Set-Location src'); await run(0, 'Set-Location ..');
  await run(1, 'Set-Location electron'); await run(1, 'Set-Location ..');
  await run(0, 'Clear-Host'); await run(0, 'npm test');
  await wait(async () => (await page.locator('.terminal-pane').nth(0).innerText()).includes('pass 21'), 'Tests did not complete in preview');
  await run(1, 'Clear-Host'); await run(1, 'node --version'); await run(1, 'Get-ChildItem src -Name');
  await run(1, 'Get-Content package.json | ConvertFrom-Json | Select-Object name, version');
  await wait(async () => (await page.locator('.history-entry').count()) > 5, 'History did not load in packaged preview');
  await page.locator('.terminal-pane').nth(1).locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText('npm r');
  await page.getByRole('listbox', { name: 'Command suggestions' }).waitFor();
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.resolve(root, '../Better-Terminal-preview.png') });
  console.log('Packaged application screenshot saved.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
