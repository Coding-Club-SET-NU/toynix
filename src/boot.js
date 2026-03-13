import { sleep } from "./utils.js";

export class BootSystem {
  constructor({ kernelLogs = [], systemdLogs = [], journal = null, kernel = null } = {}) {
    this.kernelLogs = kernelLogs;
    this.systemdLogs = systemdLogs;
    this.journal = journal;
    this.kernel = kernel;
  }

  setKernelLogs(lines) {
    this.kernelLogs = Array.isArray(lines) ? lines : [];
  }

  setSystemdLogs(lines) {
    this.systemdLogs = Array.isArray(lines) ? lines : [];
  }

  async run(terminal) {
    terminal.println("Toynix Boot", { dim: true });
    await sleep(250);

    terminal.println("Initializing kernel ...", { dim: true });
    await sleep(250);

    terminal.println("--- dmesg buffer ---", { dim: true });
    const kernelLines = await this.printLogs(terminal, this.kernelLogs, 28, () => this.browserKernelLogs());
    if (this.kernel) {
      this.kernel.setKernelLogs(kernelLines);
    }

    terminal.println("--- systemd journal ---", { dim: true });
    await this.printLogs(terminal, this.systemdLogs, 20, () => this.browserSystemdLogs());

    terminal.println("Boot complete.", { dim: true });
    await sleep(200);
  }

  async printLogs(terminal, logs, maxLines, fallbackFactory) {
    const lines = logs.length ? logs : fallbackFactory ? fallbackFactory() : this.sampleLogs(maxLines);
    for (const line of lines) {
      terminal.println(line, { dim: true });
      await sleep(35);
    }
    return lines;
  }

  browserKernelLogs() {
    const cpu = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 8;
    const platform = navigator.platform || "web";
    const userAgent = navigator.userAgent || "browser";
    const time = new Date().toISOString();
    const width = window.screen?.width || 0;
    const height = window.screen?.height || 0;

    return [
      `[    0.000000] Linux version 6.x (toynix@browser) #1 SMP PREEMPT_DYNAMIC ${time}`,
      `[    0.000000] Command line: BOOT_IMAGE=/vmlinuz-linux root=UUID=webfs rw quiet`,
      `[    0.000000] Web firmware detected: Browser/OPFS`,
      `[    0.000000] Detected ${cpu} CPU cores, ${memory} GB memory`,
      `[    0.000000] Platform: ${platform}`,
      `[    0.000000] User agent: ${userAgent}`,
      `[    0.000000] Framebuffer: ${width}x${height}`,
      `[    0.100000] clocksource: web_clocksource stable`,
      `[    0.150000] vfs: Mounted root (webfs) readonly`,
      `[    0.180000] random: crng init done`,
      `[    0.210000] systemd[1]: systemd 255 running in system mode`,
    ];
  }

  browserSystemdLogs() {
    return [
      "[  OK  ] Started Load Kernel Modules.",
      "[  OK  ] Started Journal Service.",
      "[  OK  ] Mounted /home.",
      "[  OK  ] Reached target Network (simulated).",
      "[  OK  ] Started Browser TTY on /dev/tty1.",
      "[  OK  ] Reached target Multi-User System.",
    ];
  }

  sampleLogs(count) {
    const defaults = [
      "[    0.000000] Linux version 6.x (toynix@build) #1 SMP PREEMPT_DYNAMIC",
      "[    0.120000] Command line: BOOT_IMAGE=/vmlinuz-linux root=UUID=... rw quiet",
      "[    0.451200] ACPI: Early table checksum verification disabled",
      "[    1.112340] rng: crng init done",
      "[    1.764321] systemd[1]: systemd 255 running in system mode",
      "[    2.102984] systemd[1]: Detected architecture x86-64",
      "[    2.895110] systemd[1]: Started Network Manager",
      "[    3.440221] systemd[1]: Reached target Graphical Interface",
    ];

    const lines = [];
    for (let i = 0; i < count; i += 1) {
      lines.push(defaults[i % defaults.length]);
    }
    return lines;
  }
}
