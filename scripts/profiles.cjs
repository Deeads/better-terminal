const { _electron: electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'better-terminal-profiles-'));
const project = path.join(fixture, 'Shell project'); fs.mkdirSync(project);
const data = path.join(fixture, 'data'); fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ settings: { confirmClose: false }, sessions: [{ name: '', direction: 'horizontal', ratio: .5, panes: [{ cwd: project, profile: 'powershell' }] }] }));
const env = { ...process.env, BETTER_TERMINAL_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const wait = async (fn, message, timeout = 20000) => { for (const start = Date.now(); Date.now() - start < timeout;) { if (await fn()) return; await new Promise(r => setTimeout(r, 150)); } throw new Error(message); };
const text = () => page.locator('.pane-layout:not(.hidden) .terminal-pane.focused .xterm-rows').innerText();
const command = async line => { await page.locator('.pane-layout:not(.hidden) .terminal-pane.focused .xterm-helper-textarea').focus(); await page.keyboard.insertText(line); await page.keyboard.press('Enter'); };
const history = () => page.evaluate(async project => { const s = await window.betterTerminal.bootstrap(); const p = s.projects.find(p => p.path.toLowerCase() === project.toLowerCase()); return p ? window.betterTerminal.history(p.id, '') : { entries: [] }; }, project);
(async () => {
  app = await electron.launch({ args: [root], cwd: root, env }); page = await app.firstWindow();
  await page.waitForSelector('.terminal-pane .xterm-helper-textarea'); await wait(async () => (await text()).includes('PS '), 'PowerShell not ready');
  for (const cli of ['codex', 'claude', 'gemini']) {
    await command(`${cli} --version`);
    await wait(async () => (await history()).entries.some(e => e.command === `${cli} --version`), `${cli} command was not captured`);
    await new Promise(r => setTimeout(r, cli === 'gemini' ? 4000 : 2000));
    const output = await text();
    assert.doesNotMatch(output, /is not recognized|cannot be loaded|not found/i);
    console.log(`PASS: ${cli} --version launches in the native terminal`);
  }
  const bootstrap = await page.evaluate(() => window.betterTerminal.bootstrap());
  if (bootstrap.profiles.some(p => p.id === 'bash')) {
    await page.getByTitle('Choose shell', { exact: true }).click(); await page.getByRole('button', { name: 'Git Bash', exact: true }).click();
    await wait(async () => (await text()).includes('$'), 'Bash prompt not ready');
    await command("printf 'BASH_WORKS\\n'");
    await wait(async () => (await history()).entries.some(e => e.command.includes('BASH_WORKS')), 'Bash command history not captured');
    assert.match(await text(), /BASH_WORKS/);
    const first = (await history()).entries.find(e => e.command.includes('BASH_WORKS'));
    assert.equal(first.profile, 'bash'); assert.equal(first.command, "printf 'BASH_WORKS\\n'");
    console.log('PASS: Git Bash shell integration and project history');
  }
  await page.getByTitle('Choose shell', { exact: true }).click(); await page.getByRole('button', { name: 'Command Prompt', exact: true }).click();
  await wait(async () => (await text()).includes('>'), 'Command Prompt not ready');
  await command('echo CMD_WORKS'); await wait(async () => (await text()).includes('CMD_WORKS'), 'Command Prompt output missing');
  console.log('PASS: Command Prompt profile');
  await page.keyboard.press('Control+Shift+Tab');
  await wait(async () => (await page.locator('.statusbar').innerText()).includes(bootstrap.profiles.some(p => p.id === 'bash') ? 'Git Bash' : 'Windows PowerShell'), 'Previous tab shortcut failed');
  console.log('PASS: reverse tab navigation');
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/profiles.png') });
  console.log('Profile checks passed.');
})().catch(async error => { console.error(error); if (page) console.error(await page.locator('body').innerText()); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
