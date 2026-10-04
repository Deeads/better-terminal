const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const pty = require('node-pty');
const { Store, projectId } = require('./store.cjs');
const { ShellProtocol } = require('./protocol.cjs');
const { detectProject, recommend } = require('./project-intelligence.cjs');
const { CompletionSession } = require('./completion.cjs');
const contextCache = new Map();
// Focus reporting, mouse tracking (normal/button/any/SGR), and bracketed paste.
const RESET_INPUT_MODES = '\x1b[?1004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l';
function projectContext(cwd, refresh = false) {
  const cached = contextCache.get(cwd);
  if (!refresh && cached && Date.now() - cached.time < 2000) return cached.value;
  const value = detectProject(cwd, store.projects());
  contextCache.set(cwd, { value, time: Date.now() });
  if (contextCache.size > 128) contextCache.delete(contextCache.keys().next().value);
  return value;
}
if (process.env.BETTER_TERMINAL_DATA_DIR) app.setPath('userData', process.env.BETTER_TERMINAL_DATA_DIR);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let window, store, profiles;
let closeApproved = false, closeRequestPending = false;
const sessions = new Map();
const appUrl = process.env.BETTER_TERMINAL_DEV_URL;
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
const trustedUrl = () => appUrl ? appUrl + '/' : require('node:url').pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const send = (channel, value) => { if (window && !window.isDestroyed()) window.webContents.send(channel, value); };
const projectsChanged = () => send('projects:changed', store.projects());
function trusted(event) { return event.sender === window?.webContents && event.senderFrame?.url === trustedUrl(); }
function handle(channel, fn) { ipcMain.handle(channel, (event, ...args) => { if (!trusted(event)) throw new Error('Untrusted sender'); return fn(...args); }); }
function on(channel, fn) { ipcMain.on(channel, (event, ...args) => { if (!trusted(event)) return; try { fn(...args); } catch (error) { send('app:error', error.message); } }); }
function discoverProfiles() {
  const result = [];
  const pwsh = [path.join(process.env.ProgramFiles || 'C:/Program Files', 'PowerShell/7/pwsh.exe'), ...String(process.env.PATH).split(path.delimiter).map(p => path.join(p, 'pwsh.exe'))].find(p => fs.existsSync(p));
  if (pwsh) result.push({ id: 'pwsh', name: 'PowerShell 7', executable: pwsh, integration: 'powershell' });
  result.push({ id: 'powershell', name: 'Windows PowerShell', executable: path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), integration: 'powershell' });
  result.push({ id: 'cmd', name: 'Command Prompt', executable: process.env.ComSpec || 'C:/Windows/System32/cmd.exe', integration: null });
  const bash = ['C:/Program Files/Git/bin/bash.exe', path.join(os.homedir(), 'AppData/Local/Programs/Git/bin/bash.exe')].find(p => fs.existsSync(p));
  if (bash) result.push({ id: 'bash', name: 'Git Bash', executable: bash, integration: 'bash' });
  try {
    const wsl = spawnSync('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le', timeout: 2000, windowsHide: true });
    if (wsl.status === 0 && wsl.stdout.trim()) result.push({ id: 'wsl', name: 'WSL', executable: 'wsl.exe', integration: null });
  } catch {}
  return result;
}
function validFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || !fs.statSync(folder).isDirectory()) throw new Error('That folder is not available. Choose an existing folder.');
  return path.resolve(folder);
}
function createTerminal(options = {}) {
  if (sessions.size >= 32) throw new Error('Close a terminal before opening more than 32 panes.');
  const profile = profiles.find(p => p.id === (options.profile || store.state.settings.defaultProfile)) || profiles[0];
  const cwd = validFolder(options.cwd || os.homedir());
  const id = randomUUID(), token = randomUUID();
  const completionDirectory = path.join(store.directory, 'sessions');
  fs.mkdirSync(completionDirectory, { recursive: true });
  const completionFile = path.join(completionDirectory, `${id}.txt`);
  const integrationDirectory = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron') : __dirname;
  let args = [];
  if (profile.integration === 'powershell') {
    const script = path.join(integrationDirectory, 'shell-integration.ps1').replace(/'/g, "''");
    args = ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `. '${script}'`];
  } else if (profile.integration === 'bash') args = ['--rcfile', path.join(integrationDirectory, 'shell-integration.bash').replace(/\\/g, '/'), '-i'];
  else if (profile.id === 'wsl') args = ['--cd', cwd];
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'BetterTerminal', TERM_PROGRAM_VERSION: app.getVersion(), BETTER_TERMINAL_TOKEN: token, BETTER_TERMINAL_COMPLETION_FILE: completionFile };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'BETTER_TERMINAL_DATA_DIR', 'BETTER_TERMINAL_DEV_URL']) delete env[key];
  // cmd has no shell integration; an OSC 133;A prompt mark lets the renderer reset leaked input modes at each prompt.
  if (profile.id === 'cmd' && !/\$E\]133;A/i.test(env.PROMPT || '')) env.PROMPT = '$E]133;A$E\\' + (env.PROMPT || '$P$G');
  const processPty = pty.spawn(profile.executable, args, { name: 'xterm-256color', cols: 100, rows: 30, cwd, env, useConpty: true });
  const session = { id, pty: processPty, cwd, profile: profile.id, ready: false, buffer: '', exited: false, inFlight: 0, paused: false, submitted: 0 };
  session.completion = new CompletionSession({ file: completionFile, token, write: data => { if (!session.exited) processPty.write(data); }, publish: state => { if (session.ready) send('terminal:input-state', { id, ...state }); } });
  const protocol = new ShellProtocol(token, event => {
    let folder = event.cwd;
    if (profile.integration === 'bash') folder = folder.replace(/^\/([a-zA-Z])\//, (_, drive) => `${drive}:/`);
    if (!path.isAbsolute(folder)) return;
    folder = path.resolve(folder);
    if (event.type === 'cwd') {
      if (session.cwd !== folder) { session.cwd = folder; store.visit(folder); projectsChanged(); }
      send('terminal:cwd', { id, cwd: folder });
    } else if (event.type === 'command' && typeof event.command === 'string') {
      // PSReadLine replays its saved history file through the history handler at startup; only record lines the user submitted here.
      if (session.submitted < 1) return;
      session.submitted--;
      session.completion.reset();
      const recorded = store.record(folder, event.command, profile.id);
      if (recorded) send('history:changed', { projectId: recorded.projectId });
    } else if (event.type === 'prompt') {
      // A program that exits without disabling focus/mouse/paste reporting leaves xterm sending escape replies to the shell.
      session.buffer += RESET_INPUT_MODES;
      session.completion.prompt(event.command === '1');
    }
    else if (event.type === 'input') session.completion.snapshot(event.command, event.cursor);
  }, profile.integration === 'bash');
  session.protocol = protocol;
  sessions.set(id, session);
  session.flushTimer = null;
  const flush = () => {
    session.flushTimer = null;
    if (!session.ready || !session.buffer) return;
    const data = session.buffer; session.buffer = '';
    session.inFlight += data.length;
    send('terminal:data', { id, data });
    if (session.inFlight > 512000 && !session.paused && !session.exited) { processPty.pause(); session.paused = true; }
  };
  session.flush = flush;
  processPty.onData(data => {
    session.buffer += protocol.feed(data);
    if (session.ready && !session.flushTimer) session.flushTimer = setTimeout(flush, 8);
    if (!session.ready && session.buffer.length > 512000 && !session.paused) { processPty.pause(); session.paused = true; }
  });
  processPty.onExit(({ exitCode }) => {
    session.completion.dispose();
    session.buffer += protocol.flush(); session.exited = true; session.exitCode = exitCode;
    flush(); if (session.ready) send('terminal:exit', { id, exitCode });
  });
  store.visit(cwd); projectsChanged();
  return { id, cwd, profile: profile.id, integration: !!profile.integration };
}
function closeTerminal(id) {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.flushTimer);
  session.completion.dispose();
  if (!session.exited) { try { session.pty.kill(); } catch {} }
  sessions.delete(id);
}
function registerIPC() {
  handle('app:bootstrap', () => ({ projects: store.projects(), settings: store.state.settings, profiles: profiles.map(({ executable, ...profile }) => profile), home: os.homedir(), sessions: store.state.settings.restoreTabs ? store.state.sessions : [], version: app.getVersion() }));
  handle('project:choose', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open a project folder', properties: ['openDirectory'] });
    if (result.canceled) return null;
    const project = store.visit(validFolder(result.filePaths[0])); projectsChanged(); return project;
  });
  handle('project:add', async folder => {
    if (folder === undefined) {
      const selected = await dialog.showOpenDialog(window, { title: 'Add a project', properties: ['openDirectory'] });
      if (selected.canceled) return null;
      folder = selected.filePaths[0];
    }
    const project = store.addProject(validFolder(folder));
    contextCache.clear();
    const detected = projectContext(project.path, true);
    project.stack = detected.stack;
    if (path.relative(detected.root, project.path) === '') project.name = detected.name;
    store.save(); projectsChanged(); return project;
  });
  handle('project:remove', id => { store.removeProject(id); contextCache.clear(); projectsChanged(); });
  handle('project:context', (id, refresh = false) => { const s = sessions.get(id); if (!s) throw new Error('Terminal is no longer open'); return projectContext(s.cwd, !!refresh); });
  handle('terminal:suggest', (id, revision) => {
    const s = sessions.get(id); if (!s || !s.completion.state().editing || revision !== s.completion.revision || s.completion.cursor !== s.completion.line.length) return [];
    return recommend(projectContext(s.cwd), store.readHistory(projectId(s.cwd)), s.completion.line, s.cwd);
  });
  handle('terminal:complete', (id, request) => { const s = sessions.get(id); return s && !s.exited ? s.completion.fill(request || {}) : false; });
  handle('project:pin', id => { store.pin(id); projectsChanged(); });
  handle('project:forget', id => { store.forget(id); projectsChanged(); });
  handle('history:list', (id, query = '', offset = 0) => store.history(id, String(query).slice(0, 1000), Math.max(0, Number(offset) || 0)));
  handle('history:delete', (id, entryId) => { store.deleteHistory(id, entryId); send('history:changed', { projectId: id }); });
  handle('history:export', async id => {
    const result = await dialog.showSaveDialog(window, { defaultPath: 'command-history.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(store.readHistory(id), null, 2)); return true;
  });
  handle('settings:update', patch => store.settings(patch || {}));
  handle('layout:save', tabs => {
    if (!Array.isArray(tabs) || tabs.length > 32) return;
    store.state.sessions = tabs.map(tab => ({ name: String(tab.name || '').slice(0, 80), direction: tab.direction === 'vertical' ? 'vertical' : 'horizontal', ratio: Math.max(.2, Math.min(.8, Number(tab.ratio) || .5)), panes: Array.isArray(tab.panes) ? tab.panes.slice(0, 2).filter(p => typeof p.cwd === 'string' && typeof p.profile === 'string').map(p => ({ cwd: p.cwd, profile: p.profile })) : [] })).filter(tab => tab.panes.length);
    store.save();
  });
  handle('terminal:create', createTerminal);
  on('terminal:start', id => { const s = sessions.get(id); if (s) {
    // A (re)attaching renderer never acks bytes sent to a previous one; clear the debt so the PTY cannot stay paused forever.
    s.inFlight = 0; if (s.paused && !s.exited) { s.paused = false; s.pty.resume(); }
    s.ready = true; s.flush(); s.completion.emit(); if (s.exited) send('terminal:exit', { id, exitCode: s.exitCode }); } });
  on('terminal:write', (id, data) => { const s = sessions.get(id); if (s && !s.exited && typeof data === 'string' && data.length <= 1000000) { s.submitted = Math.min(64, s.submitted + data.split('\r').length - 1); s.completion.input(data); s.pty.write(data); } });
  on('terminal:resize', (id, cols, rows) => { const s = sessions.get(id); if (s && !s.exited && Number.isInteger(cols) && Number.isInteger(rows)) s.pty.resize(Math.max(2, Math.min(cols, 500)), Math.max(1, Math.min(rows, 300))); });
  on('terminal:ack', (id, size) => { const s = sessions.get(id); if (s && Number.isInteger(size) && size > 0) { s.inFlight = Math.max(0, s.inFlight - size); if (s.paused && s.inFlight < 64000 && !s.exited) { s.paused = false; s.pty.resume(); } } });
  handle('terminal:close', closeTerminal);
  handle('clipboard:write', text => { if (typeof text === 'string') clipboard.writeText(text); });
  handle('clipboard:read', () => clipboard.readText());
  handle('app:link', async url => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url); });
  on('window:confirm-close', approved => {
    if (!closeRequestPending || typeof approved !== 'boolean') return;
    closeRequestPending = false;
    if (approved) { closeApproved = true; window.close(); }
  });
  on('window:action', action => { if (action === 'minimize') window.minimize(); if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize(); if (action === 'close') window.close(); if (action === 'fullscreen') window.setFullScreen(!window.isFullScreen()); });
}
if (ownsInstance) app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  profiles = discoverProfiles(); registerIPC();
  app.setAppUserModelId('app.betterterminal.desktop');
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 900, minHeight: 580, title: 'Better Terminal', icon: path.join(__dirname, 'icon.png'), frame: false, backgroundColor: '#151719', show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  // BETTER_TERMINAL_BACKGROUND (tests only): show off-screen without taking focus, so checks don't interrupt whoever's at the desk.
  window.once('ready-to-show', () => { if (process.env.BETTER_TERMINAL_BACKGROUND) { window.setPosition(-5000, 0); window.showInactive(); } else window.show(); });
  window.on('close', event => {
    const running = [...sessions.values()].filter(s => !s.exited).length;
    if (!closeApproved && store.state.settings.confirmClose && running > 0) {
      event.preventDefault();
      if (!closeRequestPending) { closeRequestPending = true; send('window:close-requested', running); }
      if (window.isMinimized()) window.restore();
      window.focus();
      return;
    }
    for (const id of sessions.keys()) closeTerminal(id);
  });
  if (appUrl) window.loadURL(appUrl); else window.loadFile(path.join(__dirname, '../dist/index.html'));
}).catch(error => { dialog.showErrorBox('Better Terminal could not start', error.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
