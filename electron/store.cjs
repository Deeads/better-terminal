const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const defaults = { fontSize: 14, theme: 'graphite', cursorStyle: 'bar', cursorBlink: true, scrollback: 20000, defaultProfile: 'powershell', restoreTabs: true, confirmClose: true };
function pathKey(folder) {
  let resolved = path.resolve(folder);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function projectId(folder) { return createHash('sha256').update(pathKey(folder)).digest('hex').slice(0, 24); }
function atomicWrite(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, value, { mode: 0o600 });
  fs.renameSync(temp, file);
}
class Store {
  constructor(directory) {
    this.directory = directory;
    this.historyDir = path.join(directory, 'history');
    fs.mkdirSync(this.historyDir, { recursive: true });
    this.file = path.join(directory, 'state.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    this.state = { version: 1, projects: [], sessions: [], ...this.state, settings: { ...defaults, ...this.state.settings } };
  }
  save() { atomicWrite(this.file, JSON.stringify(this.state, null, 2)); }
  visit(folder) {
    const id = projectId(folder);
    let project = this.state.projects.find(p => p.id === id);
    if (!project) {
      project = { id, name: path.basename(folder) || folder, path: folder, pinned: false, lastVisited: Date.now() };
      this.state.projects.push(project);
    }
    project.lastVisited = Date.now();
    this.save();
    return project;
  }
  projects() { return [...this.state.projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastVisited - a.lastVisited); }
  pin(id) { const p = this.state.projects.find(p => p.id === id); if (p) { p.pinned = !p.pinned; this.save(); } }
  addProject(folder) { const project = this.visit(folder); project.saved = true; this.save(); return project; }
  removeProject(id) { const project = this.state.projects.find(p => p.id === id); if (project) { project.saved = false; this.save(); } }
  forget(id) { this.state.projects = this.state.projects.filter(p => p.id !== id); this.save(); }
  historyFile(id) {
    if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('Invalid project identifier');
    return path.join(this.historyDir, `${id}.jsonl`);
  }
  record(folder, command, profile) {
    if (typeof command !== 'string' || !command.trim() || command.length > 1000000) return;
    const id = projectId(folder);
    const record = { id: randomUUID(), command, profile, timestamp: Date.now(), cwd: folder };
    fs.appendFileSync(this.historyFile(id), JSON.stringify(record) + '\n', { mode: 0o600 });
    return { projectId: id, record };
  }
  readHistory(id) {
    const file = this.historyFile(id);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }
  history(id, query = '', offset = 0) {
    const all = this.readHistory(id);
    const match = query.toLowerCase();
    const rows = all.filter(r => r.command.toLowerCase().includes(match)).reverse();
    return { entries: rows.slice(offset, offset + 100), total: rows.length, allCount: all.length };
  }
  deleteHistory(id, entryId) {
    const file = this.historyFile(id);
    const remaining = entryId ? this.readHistory(id).filter(r => r.id !== entryId) : [];
    atomicWrite(file, remaining.map(r => JSON.stringify(r) + '\n').join(''));
  }
  settings(patch) {
    const clean = {};
    if (Number.isInteger(patch.fontSize)) clean.fontSize = Math.min(24, Math.max(10, patch.fontSize));
    if (['graphite', 'midnight', 'light'].includes(patch.theme)) clean.theme = patch.theme;
    if (['bar', 'block', 'underline'].includes(patch.cursorStyle)) clean.cursorStyle = patch.cursorStyle;
    if (Number.isInteger(patch.scrollback)) clean.scrollback = Math.min(100000, Math.max(1000, patch.scrollback));
    if (typeof patch.defaultProfile === 'string') clean.defaultProfile = patch.defaultProfile;
    for (const key of ['restoreTabs', 'confirmClose', 'cursorBlink']) if (typeof patch[key] === 'boolean') clean[key] = patch[key];
    this.state.settings = { ...this.state.settings, ...clean }; this.save();
    return this.state.settings;
  }
}
module.exports = { Store, projectId, defaults };
