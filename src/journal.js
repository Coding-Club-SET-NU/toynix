export class Journal {
  constructor({ vfs }) {
    this.vfs = vfs;
    this.entries = [];
  }

  async log({ source, message, level = "info" }) {
    const timestamp = new Date();
    const line = this.formatLine(timestamp, source, level, message);
    this.entries.push({ timestamp, source, level, message, line });
    await this.appendToFile("/var/log/journal/boot.journal", `${line}\n`);
  }

  async appendToFile(path, line) {
    const existing = await this.vfs.readFile(path);
    const next = existing ? `${existing}${line}` : line;
    await this.vfs.writeFile(path, next);
  }

  formatLine(timestamp, source, level, message) {
    const iso = timestamp.toISOString();
    return `${iso} ${source}[${level}]: ${message}`;
  }

  getLines() {
    return this.entries.map((entry) => entry.line);
  }
}
