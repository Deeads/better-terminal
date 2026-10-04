const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { CompletionSession, QUERY_KEY, FILL_KEY } = require('../electron/completion.cjs');
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-complete-')); const file = path.join(directory, 'request.txt');
  const writes = [], states = [];
  const session = new CompletionSession({ file, token: 'session-token', write: value => writes.push(value), publish: value => states.push(value) });
  t.after(() => { session.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { session, writes, states, file, tick: () => t.mock.timers.tick(40) };
}
test('completion queries only known shell editing sessions and never executing programs', t => {
  const { session, writes, tick } = fixture(t);
  session.input('npm'); tick(); assert.deepEqual(writes, []);
  session.prompt(true); session.input('npm'); tick(); assert.deepEqual(writes, [QUERY_KEY]);
  session.snapshot('npm', 3); session.input('\r'); session.input('raw program input'); tick();
  assert.deepEqual(writes, [QUERY_KEY]); assert.equal(session.state().editing, false);
  session.snapshot('late reply', 10); assert.equal(session.state().editing, false);
});
test('cursor reports and focus notifications are not mistaken for shell edits', t => {
  const { session, writes, tick } = fixture(t); session.prompt(true); const revision = session.revision;
  for (const reply of ['\x1b[1;12R', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[I', '\x1b[O']) session.input(reply);
  tick(); assert.equal(session.revision, revision); assert.equal(session.state().editing, true); assert.deepEqual(writes, []);
});
test('stale query responses cannot overwrite newer input', t => {
  const { session, writes, tick } = fixture(t); session.prompt(true); session.input('n'); tick(); session.input('pm');
  session.snapshot('n', 1); assert.equal(session.line, ''); tick(); assert.equal(writes.length, 2);
  session.snapshot('npm', 3); assert.equal(session.line, 'npm');
});
test('Tab completion validates the current buffer and sends no Enter', t => {
  const { session, writes, file, tick } = fixture(t); session.prompt(true); session.input('dev'); tick(); session.snapshot('dev', 3);
  assert.equal(session.fill({ command: 'npm run dev', expected: 'wrong', revision: session.revision }), false);
  assert.equal(session.fill({ command: 'npm run dev', expected: 'dev', revision: session.revision - 1 }), false);
  assert.equal(session.fill({ command: 'npm run dev\r', expected: 'dev', revision: session.revision }), false);
  assert.equal(session.fill({ command: 'npm run dev', expected: 'dev', revision: session.revision }), true);
  assert.equal(writes.at(-1), FILL_KEY); assert.equal(writes.some(value => value.includes('\r')), false);
  const request = fs.readFileSync(file, 'utf8').split('\n'); assert.equal(Buffer.from(request[2], 'base64').toString(), 'npm run dev');
  session.snapshot('npm run dev', 11); assert.equal(fs.existsSync(file), false);
});
test('reverse search, multiline input, unsupported shells, and expired queries opt out', t => {
  const { session, writes, tick } = fixture(t);
  for (const data of ['\x12', 'one\ntwo', '\x03']) { session.prompt(true); session.input(data); tick(); assert.equal(session.state().editing, false); }
  session.prompt(false); session.input('npm'); tick(); assert.deepEqual(writes, []);
  session.prompt(true); session.input('npm'); tick(); t.mock.timers.tick(1600); assert.equal(session.state().editing, false);
});
