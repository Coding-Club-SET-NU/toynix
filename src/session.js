export class ShellSession {
  constructor({ shell, io, journal }) {
    this.shell = shell;
    this.io = io;
    this.journal = journal;
  }

  async runLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (this.journal) {
      await this.journal.log({ source: "shell", message: `$ ${trimmed}` });
    }
    await this.shell.runLine(trimmed, this.io);
  }
}
