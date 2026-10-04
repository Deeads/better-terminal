const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, projectId } = require('../electron/store.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'better-terminal-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new Store(directory) };
}
test('project visits, pins, and settings survive a restart', t => {
  const { directory, store } = fixture(t);
  const folder = path.resolve('project-one');
  const project = store.visit(folder); store.pin(project.id); store.settings({ fontSize: 18, theme: 'light' });
  const reopened = new Store(directory);
  assert.equal(reopened.projects()[0].pinned, true); assert.equal(reopened.state.settings.fontSize, 18); assert.equal(reopened.state.settings.theme, 'light');
  if (process.platform === 'win32') { reopened.visit(folder.toUpperCase()); assert.equal(reopened.projects().length, 1); }
});
test('history is folder-specific, durable, searchable, and retained beyond one page', t => {
  const { directory, store } = fixture(t);
  const a = path.resolve('project-a'), b = path.resolve('project-b');
  for (let i = 0; i < 125; i++) store.record(a, `echo item-${i}`, 'powershell');
  store.record(b, 'echo other', 'powershell');
  const reopened = new Store(directory);
  assert.equal(reopened.history(projectId(a)).total, 125);
  assert.equal(reopened.history(projectId(a)).entries.length, 100);
  assert.equal(reopened.history(projectId(a), '', 100).entries.length, 25);
  assert.equal(reopened.history(projectId(a), 'ITEM-124').entries[0].command, 'echo item-124');
  assert.equal(reopened.history(projectId(b)).total, 1);
});
test('forgetting a folder does not erase history, deletion affects only the chosen scope', t => {
  const { store } = fixture(t);
  const a = path.resolve('a'), b = path.resolve('b');
  const project = store.visit(a); const first = store.record(a, 'first', 'pwsh'); store.record(a, 'second', 'pwsh'); store.record(b, 'third', 'pwsh');
  store.forget(project.id); assert.equal(store.history(project.id).total, 2);
  store.deleteHistory(project.id, first.record.id); assert.equal(store.history(project.id).entries[0].command, 'second');
  store.deleteHistory(project.id); assert.equal(store.history(project.id).total, 0); assert.equal(store.history(projectId(b)).total, 1);
});
test('validates history identifiers and clamps settings', t => {
  const { store } = fixture(t);
  assert.throws(() => store.history('../../unrelated'));
  const settings = store.settings({ fontSize: 999, scrollback: -10, theme: 'evil', confirmClose: 'false', injected: 'bad' });
  assert.equal(settings.fontSize, 24); assert.equal(settings.scrollback, 1000); assert.equal(settings.theme, 'graphite'); assert.equal(settings.confirmClose, true); assert.equal(settings.injected, undefined);
});
test('multiline and unicode commands roundtrip without loss', t => {
  const { store } = fixture(t), folder = path.resolve('project');
  const command = 'Write-Output "世界 🛠️"\nWrite-Output "done"';
  store.record(folder, command, 'powershell'); assert.equal(store.history(projectId(folder)).entries[0].command, command);
});
