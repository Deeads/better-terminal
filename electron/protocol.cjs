// Only consume our session-authenticated OSCs. Other terminal sequences pass through unchanged.
class ShellProtocol {
  constructor(token, onEvent, bash = false) { this.prefix = `\x1b]${bash ? 778 : 777};BT;${token};`; this.pending = ''; this.onEvent = onEvent; this.bash = bash; }
  feed(chunk) {
    this.pending += chunk;
    let output = '';
    while (this.pending) {
      const start = this.pending.indexOf(this.prefix);
      if (start < 0) {
        let keep = Math.min(this.prefix.length - 1, this.pending.length);
        while (keep > 0 && !this.prefix.startsWith(this.pending.slice(-keep))) keep--;
        output += this.pending.slice(0, this.pending.length - keep);
        this.pending = keep ? this.pending.slice(-keep) : '';
        break;
      }
      output += this.pending.slice(0, start);
      this.pending = this.pending.slice(start);
      const end = this.pending.indexOf('\x07', this.prefix.length);
      if (end < 0) {
        if (this.pending.length > 2000000) { output += this.pending; this.pending = ''; }
        break;
      }
      const raw = this.pending.slice(this.prefix.length, end);
      this.pending = this.pending.slice(end + 1);
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        const [type, cwd, command, cursor] = this.bash ? decoded.split('\0') : [];
        const event = this.bash ? { type, cwd, command } : JSON.parse(decoded);
        if (this.bash && type === 'input') event.cursor = Buffer.from(command, 'utf8').subarray(0, Number(cursor)).toString('utf8').length;
        if (event && ['cwd', 'command', 'prompt', 'input'].includes(event.type) && typeof event.cwd === 'string') this.onEvent(event);
      } catch { /* Malformed shell metadata never interrupts the PTY stream. */ }
    }
    return output;
  }
  flush() { const output = this.pending; this.pending = ''; return output; }
}
module.exports = { ShellProtocol };
