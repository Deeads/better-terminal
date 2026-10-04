const { _electron: electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'better-terminal-intelligence-'));
const project = path.join(fixture, 'Web project'); const python = path.join(fixture, 'Python project');
fs.mkdirSync(project); fs.mkdirSync(python);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'sample-web', scripts: { dev: 'node -e "console.log(\'DEV_FROM_PROJECT\')"', build: 'node -e "console.log(\'BUILD_FROM_PROJECT\')"', test: 'node -e "console.log(\'TEST_FROM_PROJECT\')"' }, devDependencies: { vite: '8', react: '19', typescript: '7' } }));
fs.writeFileSync(path.join(project, 'better-terminal.toml'), '[project]\nname = "Web project"\nstack = ["Web"]\n[commands]\nversion = { run = "node --version", description = "Check Node version" }\n');
fs.writeFileSync(path.join(python, 'pyproject.toml'), '[project]\nname = "sample-python"\ndependencies = ["pytest", "ruff"]\n[tool.uv]\n');
const data = path.join(fixture, 'data'); fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ settings: { confirmClose: false }, sessions: [{ name: '', direction: 'horizontal', ratio: .5, panes: [{ cwd: project, profile: 'powershell' }] }] }));
const rawProgram = path.join(fixture, 'raw.cjs');
fs.writeFileSync(rawProgram, "process.stdin.setRawMode(true);process.stdin.resume();console.log('RAW_READY');process.stdin.on('data',b=>{if(b.toString()==='q')process.exit(0);console.log('RAW:'+b.toString('hex'))});");
const env = { ...process.env, BETTER_TERMINAL_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
let app, page; const errors = [];
const wait = async (fn, message, timeout = 20000) => { const start = Date.now(); while(Date.now() - start < timeout) { if(await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(message); };
const pane = () => page.locator('.pane-layout:not(.hidden) .terminal-pane.focused');
const type = async text => { await pane().locator('.xterm-helper-textarea').focus(); await page.keyboard.insertText(text); };
const run = async text => { await type(text); await page.keyboard.press('Enter'); };
const lastInput = () => page.evaluate(() => window.__inputEvents.at(-1));
const history = () => page.evaluate(async folder => { const state = await window.betterTerminal.bootstrap(); const p = state.projects.find(p => p.path === folder); return p ? window.betterTerminal.history(p.id, '') : { total: 0, entries: [] }; }, project);
async function launch() {
  app = await electron.launch({ executablePath: process.env.BT_PACKAGED_EXE || undefined, args: process.env.BT_PACKAGED_EXE ? [] : [root], cwd: root, env }); page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForSelector('.xterm-helper-textarea');
  await page.evaluate(() => { window.__inputEvents = []; window.betterTerminal.onInputState(value => window.__inputEvents.push(value)); });
  await wait(async () => (await pane().innerText()).includes('PS '), 'PowerShell prompt missing');
}
async function add(folder) {
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
  await page.getByRole('button', { name: 'Add project', exact: false }).click();
  await wait(async () => (await page.locator('.breadcrumb').innerText()).includes(path.basename(folder)), 'Project was not opened');
}
(async () => {
  await launch();
  await add(project);
  assert.equal(await page.getByRole('tab').count(), 1, 'Adding the current project should reuse its existing live terminal');
  await add(python); await wait(async () => (await pane().innerText()).includes('PS '), 'Python project terminal missing');
  await page.getByTitle('Detected stack and project commands', { exact: true }).click();
  await wait(async () => (await page.getByRole('region', { name: 'Project stack and commands' }).innerText()).includes('uv run pytest'), 'Python TOML commands not detected');
  await page.getByTitle('Close project commands', { exact: true }).click();
  await page.locator('.project-main').filter({ hasText: 'Web project' }).click();
  assert.equal(await page.getByRole('tab').count(), 2);
  console.log('PASS: add projects, detect TOML stack, and click to switch into existing sessions');
  await type('npm r');
  await page.getByRole('listbox', { name: 'Command suggestions' }).waitFor({ timeout: 10000 });
  assert.match(await page.getByRole('option').first().innerText(), /npm run dev/);
  await page.keyboard.press('ArrowDown');
  assert.match(await page.getByRole('option', { selected: true }).innerText(), /npm run build/);
  await page.keyboard.press('ArrowUp');
  assert.match(await page.getByRole('option', { selected: true }).innerText(), /npm run dev/);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
  await wait(async () => (await lastInput())?.line === 'npm run build', 'Tab did not replace the real PowerShell buffer');
  assert.equal((await history()).total, 0, 'Tab must not execute the command');
  await page.keyboard.press('Enter');
  await wait(async () => (await history()).entries.some(e => e.command === 'npm run build'), 'Completed command was not executed after Enter');
  await wait(async () => (await pane().innerText()).includes('BUILD_FROM_PROJECT') && (await lastInput())?.editing, 'Build command did not finish');
  console.log('PASS: typeahead, arrow selection, Tab fills without execution, Enter executes');
  await type('vers'); await page.getByRole('listbox').waitFor();
  assert.match(await page.getByRole('option', { selected: true }).innerText(), /node --version/);
  await page.keyboard.press('Tab'); await wait(async () => (await lastInput())?.line === 'node --version', 'Custom TOML completion failed');
  await page.keyboard.press('Control+c'); await wait(async () => (await lastInput())?.editing && (await lastInput())?.line === '', 'Cancel should return to an empty prompt');
  await type('npm'); await page.getByRole('listbox').waitFor(); await page.keyboard.press('Escape');
  await wait(async () => await page.getByRole('listbox').count() === 0, 'Escape did not dismiss suggestions');
  await page.keyboard.press('Control+c'); await wait(async () => (await lastInput())?.editing, 'Prompt missing after cancel');
  console.log('PASS: custom TOML commands and Escape dismissal');
  await run(`node '${rawProgram.replace(/'/g, "''")}'`);
  await wait(async () => (await pane().innerText()).includes('RAW_READY'), 'Raw input program failed');
  await type('npm'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
  await wait(async () => (await pane().innerText()).includes('RAW:09'), 'Tab was intercepted inside an interactive program');
  const rawOutput = await pane().innerText();
  assert.match(rawOutput, /RAW:6e706d/); assert.match(rawOutput, /RAW:1b5b41/); assert.match(rawOutput, /RAW:1b5b42/);
  assert.equal(await page.getByRole('listbox').count(), 0);
  assert.doesNotMatch(rawOutput, /RAW:1b5b32343b/);
  await page.keyboard.type('q'); await wait(async () => (await lastInput())?.editing, 'Prompt not restored after raw program');
  console.log('PASS: live agents receive typing, Tab, and arrows with no private query sequences');
  const state = await page.evaluate(() => window.betterTerminal.bootstrap());
  if (state.profiles.some(p => p.id === 'bash')) {
    await page.getByTitle('Choose shell', { exact: true }).click(); await page.getByRole('button', { name: 'Git Bash', exact: true }).click();
    await wait(async () => (await pane().innerText()).includes('$'), 'Bash prompt missing');
    await type('npm r'); await page.getByRole('listbox').waitFor({ timeout: 10000 });
    await page.keyboard.press('Tab'); await wait(async () => (await lastInput())?.line === 'npm run dev', 'Bash Tab did not fill the real Readline buffer');
    await page.keyboard.press('Enter'); await wait(async () => (await pane().innerText()).includes('DEV_FROM_PROJECT'), 'Bash completed command did not execute');
    console.log('PASS: Git Bash suggestions and Tab completion');
  }
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/intelligence.png') });
  await new Promise(r => setTimeout(r, 400)); await app.close(); app = null;
  await launch();
  const restored = await page.evaluate(() => window.betterTerminal.bootstrap());
  assert.equal(restored.projects.filter(p => p.saved).length, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: saved projects survive restart; no renderer errors');
})().catch(async error => {
  console.error(error); process.exitCode = 1;
  if (page) { console.error('Input events:', await page.evaluate(() => window.__inputEvents.slice(-12)).catch(() => [])); console.error(await page.locator('body').innerText().catch(() => '')); fs.mkdirSync(path.join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: path.join(root, 'test-results/intelligence-failure.png') }).catch(() => {}); }
}).finally(async () => { if (app) await app.close().catch(() => {}); });
