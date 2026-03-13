import { sleep } from "./utils.js";

export class BootLoader {
  constructor(terminal) {
    this.terminal = terminal;
    this.options = [
      "Toynix (web-native)",
      "Toynix (recovery mode)",
    ];
    this.selected = 0;
  }

  async run() {
    this.render();
    return new Promise((resolve) => {
      this.terminal.setRawKeyHandler(async (event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          this.selected = (this.selected - 1 + this.options.length) % this.options.length;
          this.render();
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          this.selected = (this.selected + 1) % this.options.length;
          this.render();
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          this.terminal.setRawKeyHandler(null);
          await sleep(150);
          resolve(this.options[this.selected]);
        }
      });
    });
  }

  render() {
    const checks = this.capabilities();
    this.terminal.clear();
    [
      "  ______                  _     ",
      " /_  __/___  __  ______  (_)  __",
      "  / / / __ \\/ / / / __ \\/ / |/_/",
      " / / / /_/ / /_/ / / / / />  <  ",
      "/_/  \\____/\\__, /_/ /_/_/_/|_|  ",
      "          /____/               ",
    ].forEach((line) => this.terminal.println(line, { dim: true }));
    this.terminal.println("");
    this.terminal.println("Toynix Web Bootloader", { dim: true });
    this.terminal.println("");

    for (let i = 0; i < this.options.length; i += 1) {
      const prefix = i === this.selected ? ">" : " ";
      this.terminal.println(`${prefix} ${this.options[i]}`);
    }

    this.terminal.println("");
    this.terminal.println("System checks:", { dim: true });
    checks.forEach((line) => this.terminal.println(`  ${line}`, { dim: true }));
    this.terminal.println("");
    this.terminal.println("Use arrow keys to select, Enter to boot.", { dim: true });
  }

  capabilities() {
    const results = [];
    results.push(`WebAssembly: ${typeof WebAssembly !== "undefined" ? "yes" : "no"}`);
    results.push(`Workers: ${typeof Worker !== "undefined" ? "yes" : "no"}`);
    results.push(`OPFS: ${navigator.storage && navigator.storage.getDirectory ? "yes" : "no"}`);
    results.push(`Memory (device): ${navigator.deviceMemory || "n/a"} GB`);
    results.push(`CPU cores: ${navigator.hardwareConcurrency || "n/a"}`);
    return results;
  }
}
