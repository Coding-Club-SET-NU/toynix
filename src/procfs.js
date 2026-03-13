export class ProcFS {
  constructor(kernel) {
    this.kernel = kernel;
  }

  async list(path) {
    if (path !== "/") return null;
    return ["uptime", "meminfo", "cpuinfo", "version", "hostname", "loadavg", "self"].sort();
  }

  async readFile(path) {
    if (path === "/uptime") {
      const seconds = this.kernel.getUptimeSeconds();
      return `${seconds}.00 ${seconds}.00\n`;
    }

    if (path === "/meminfo") {
      const mem = (navigator.deviceMemory || 8) * 1024 * 1024;
      return `MemTotal:       ${mem} kB\nMemFree:        ${Math.floor(mem * 0.62)} kB\n`;
    }

    if (path === "/cpuinfo") {
      const cores = navigator.hardwareConcurrency || 4;
      let output = "";
      for (let i = 0; i < cores; i += 1) {
        output += `processor\t: ${i}\n`;
        output += `model name\t: ${navigator.platform || "Browser CPU"}\n\n`;
      }
      return output;
    }

    if (path === "/version") {
      return "Linux version 6.x (toynix@browser) #1 SMP PREEMPT_DYNAMIC\n";
    }

    if (path === "/hostname") {
      return "toynix\n";
    }

    if (path === "/loadavg") {
      return "0.10 0.05 0.01 1/120 1000\n";
    }

    if (path === "/self") {
      return `${this.kernel?.currentPid || 1}\n`;
    }

    return null;
  }

  async writeFile() {
    return false;
  }

  async mkdirp() {
    return false;
  }

  async isDir(path) {
    return path === "/";
  }

  async exists(path) {
    return path === "/" || ["/uptime", "/meminfo", "/cpuinfo", "/version", "/hostname", "/loadavg", "/self"].includes(path);
  }
}
