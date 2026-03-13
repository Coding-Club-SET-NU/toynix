export class TerminalIO {
  constructor({ terminal, pty }) {
    this.terminal = terminal;
    this.pty = pty;
  }

  println(text = "") {
    this.pty.write(`${text}\n`);
  }

  clear() {
    this.terminal.clear();
  }
}
