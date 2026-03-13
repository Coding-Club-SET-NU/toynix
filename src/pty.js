export class PTY {
  constructor() {
    this.buffer = "";
    this.lineListeners = [];
  }

  onLine(handler) {
    this.lineListeners.push(handler);
  }

  write(data) {
    if (data == null) return;
    this.buffer += String(data);
    let idx = this.buffer.indexOf("\n");
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.lineListeners.forEach((handler) => handler(line));
      idx = this.buffer.indexOf("\n");
    }
  }
}
