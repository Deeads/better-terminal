const fs = require('node:fs');
const { safeCommand } = require('./project-intelligence.cjs');
const QUERY_KEY = '\x1b[24;5~';
const FILL_KEY = '\x1b[24;6~';
// Query the actual line editor. Never guess its buffer from rendered output or replay keys.
class CompletionSession {
  constructor({ write, publish, file, token }) {
    Object.assign(this, { write, publish, file, token });
    this.editing = false; this.supported = false; this.line = ''; this.cursor = 0; this.revision = 0; this.pending = null;
  }
  state() { return { editing: this.editing && this.supported, line: this.line, cursor: this.cursor, revision: this.revision }; }
  emit() { this.publish(this.state()); }
  reset() { clearTimeout(this.timer); clearTimeout(this.timeout); this.pending = null; this.revision++; this.line = ''; this.cursor = 0; this.editing = false; this.emit(); }
  prompt(supported) { this.reset(); this.supported = supported; this.editing = true; this.emit(); }
  input(data) {
    // xterm sends terminal replies through onData too. They are not user edits.
    if (/^\x1b\[(?:\??\d+;\d+R|[?>][\d;]*c|[IO])$/.test(data) || /^\x1b\](?:10|11|12);rgb:/.test(data)) return;
    this.revision++;
    if (!this.editing || !this.supported) return;
    // Unknown control modes (reverse history search, multiline input, etc.) opt out until the next prompt.
    const isEdit = /^[^\x00-\x1f\x7f]+$/u.test(data) || ['\x7f', '\b', '\t', '\x01', '\x05', '\x0b', '\x15', '\x17', '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D', '\x1b[H', '\x1b[F', '\x1b[1~', '\x1b[4~', '\x1b[3~'].includes(data);
    if (!isEdit) { this.reset(); return; }
    // Hide stale choices until the shell reports the buffer produced by this input.
    this.publish({ ...this.state(), editing: false });
    this.schedule();
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.editing || !this.supported || this.pending !== null) return;
      this.pending = this.revision; this.write(QUERY_KEY);
      this.timeout = setTimeout(() => { this.reset(); }, 1500);
    }, 35);
  }
  snapshot(line, cursor) {
    clearTimeout(this.timeout);
    const requested = this.pending; this.pending = null;
    if (!this.editing || !this.supported || typeof line !== 'string' || !Number.isInteger(cursor)) return;
    if (requested !== null && requested !== this.revision) { this.schedule(); return; }
    this.line = line; this.cursor = cursor; this.emit();
    try { fs.unlinkSync(this.file); } catch {}
  }
  fill({ command, expected, revision }) {
    if (!this.editing || !this.supported || this.pending !== null || !safeCommand(command) || this.line !== expected || this.cursor !== this.line.length || revision !== this.revision) return false;
    clearTimeout(this.timer);
    const encode = text => Buffer.from(text, 'utf8').toString('base64');
    fs.writeFileSync(this.file, `${this.token}\n${encode(expected)}\n${encode(command)}\n`, { mode: 0o600 });
    this.pending = this.revision; this.write(FILL_KEY);
    this.timeout = setTimeout(() => { this.reset(); }, 1500);
    this.publish({ ...this.state(), editing: false });
    return true;
  }
  dispose() { clearTimeout(this.timer); clearTimeout(this.timeout); this.editing = false; try { fs.unlinkSync(this.file); } catch {} }
}
module.exports = { CompletionSession, QUERY_KEY, FILL_KEY };
