const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { detectProject, recommend, findRoot } = require('../electron/project-intelligence.cjs');
const { Store } = require('../electron/store.cjs');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-detect-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return { root, write: (name, text) => fs.writeFileSync(path.join(root, name), text) }; }
test('detects real package scripts and package manager without inventing tasks', t => {
  const { root, write } = fixture(t);
  write('package.json', JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { dev: 'vite', test: 'vitest', 'unsafe;name': 'echo bad' }, devDependencies: { react: '19', vite: '8', typescript: '7' } }));
  const result = detectProject(root);
  assert.deepEqual(result.stack, ['Node.js', 'TypeScript', 'React', 'Vite']);
  assert.deepEqual(result.commands.map(c => c.command), ['pnpm run dev', 'pnpm run test', 'pnpm install']);
  assert.equal(result.commands.some(c => c.command.includes('build')), false);
});
test('reads Python and Rust TOML using a parser, including multiline dependency arrays', t => {
  const { root, write } = fixture(t);
  write('pyproject.toml', '[project]\nname = "api"\ndependencies = [\n "pytest>=8",\n "ruff"\n]\n[tool.uv]\n');
  let result = detectProject(root); assert.ok(result.commands.some(c => c.command === 'uv run pytest')); assert.ok(result.commands.some(c => c.command === 'uv run ruff check .'));
  write('Cargo.toml', '[package]\nname = "cli"\nversion = "0.1.0"\n');
  result = detectProject(root); assert.ok(result.stack.includes('Rust')); assert.ok(result.commands.some(c => c.command === 'cargo check'));
});
test('custom TOML commands, invalid files, and control characters are handled safely', t => {
  const { root, write } = fixture(t);
  write('better-terminal.toml', '[project]\nname = "My project"\nstack = ["API"]\n[commands]\nserve = { run = "uv run api", description = "Start API" }\nbad = "echo a\\necho b"\n');
  write('package.json', '{bad');
  const result = detectProject(root);
  assert.equal(result.name, 'My project'); assert.deepEqual(result.commands.map(c => c.command), ['uv run api']); assert.equal(result.warnings.length, 1);
  write('better-terminal.toml', 'invalid=[['); assert.doesNotThrow(() => detectProject(root));
});
test('root discovery respects saved project boundaries and exact path segments', t => {
  const { root, write } = fixture(t); write('package.json', '{}');
  const child = path.join(root, 'src'); fs.mkdirSync(child);
  assert.equal(findRoot(child), root);
  assert.equal(findRoot(child, [{ saved: true, path: child }]), child);
  assert.equal(findRoot(child, [{ saved: true, path: root + '-other' }]), root);
});
test('recommendations rank prefixes and task aliases, dedupe history, and never use another root', t => {
  const { root, write } = fixture(t); write('package.json', '{"scripts":{"dev":"vite","build":"vite build"}}');
  const context = detectProject(root);
  const history = [{ command: 'npm run dev' }, { command: 'npm outdated' }, { command: 'echo unsafe\nnext' }];
  assert.deepEqual(recommend(context, history, 'npm r', root).map(c => c.command), ['npm run dev', 'npm run build']);
  assert.equal(recommend(context, history, 'dev', root)[0].command, 'npm run dev');
  assert.equal(recommend(context, history, 'npm o', root)[0].source, 'History');
  assert.deepEqual(recommend(context, history, '', root), []);
  assert.deepEqual(recommend(context, history, 'npm\r', root), []);
  assert.equal(recommend(context, [], 'dev', path.join(root, 'src')).length, 0);
});
test('saved projects dedupe and survive restart independently of recent folders', t => {
  const { root } = fixture(t); const store = new Store(path.join(root, 'data'));
  const project = store.addProject(root); store.addProject(root); store.record(root, 'npm test', 'powershell');
  let restored = new Store(path.join(root, 'data')); assert.equal(restored.projects().length, 1); assert.equal(restored.projects()[0].saved, true);
  restored.removeProject(project.id); restored = new Store(path.join(root, 'data'));
  assert.equal(restored.projects()[0].saved, false); assert.equal(restored.history(project.id).total, 1);
});
