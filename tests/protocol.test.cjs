const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShellProtocol } = require('../electron/protocol.cjs');
const token = 'unique-session-token';
const payload = { type: 'command', cwd: 'C:\\a folder\\project', command: 'echo 世界' };
const osc = `\x1b]777;BT;${token};${Buffer.from(JSON.stringify(payload)).toString('base64')}\x07`;
test('shell metadata is extracted across every possible chunk boundary without dropping output', () => {
  const input = 'before\x1b[32m' + osc + '\x1b[0mafter';
  for (let cut = 0; cut <= input.length; cut++) {
    const events = [], protocol = new ShellProtocol(token, event => events.push(event));
    assert.equal(protocol.feed(input.slice(0, cut)) + protocol.feed(input.slice(cut)) + protocol.flush(), 'before\x1b[32m\x1b[0mafter');
    assert.deepEqual(events, [payload]);
  }
});
test('preserves ANSI, alternate-screen, title, and unauthenticated OSC sequences', () => {
  const protocol = new ShellProtocol(token, () => assert.fail('Unexpected metadata'));
  const input = '\x1b[?1049h\x1b[?2004h\x1b]0;title\x07' + osc.replace(token, 'other-token') + '\x1b[?1049l';
  assert.equal(protocol.feed(input) + protocol.flush(), input);
});
test('handles byte-at-a-time input and multiple events', () => {
  const events = [], protocol = new ShellProtocol(token, event => events.push(event));
  let output = ''; for (const char of `one${osc}two${osc}three`) output += protocol.feed(char);
  assert.equal(output + protocol.flush(), 'onetwothree'); assert.equal(events.length, 2);
});
test('invalid metadata does not break terminal streaming', () => {
  const protocol = new ShellProtocol(token, () => assert.fail('Invalid JSON should not dispatch'));
  assert.equal(protocol.feed(`\x1b]777;BT;${token};bad-json\x07ok`), 'ok');
});
test('Bash protocol safely decodes literal paths and multiline commands', () => {
  const events = [], protocol = new ShellProtocol(token, event => events.push(event), true);
  const raw = Buffer.from('command\0/c/Project with spaces\0echo "hello"\necho world').toString('base64');
  assert.equal(protocol.feed(`\x1b]778;BT;${token};${raw}\x07`), '');
  assert.deepEqual(events[0], { type: 'command', cwd: '/c/Project with spaces', command: 'echo "hello"\necho world' });
});
