export class Kernel {
  constructor({ vfs, journal }) {
    this.vfs = vfs;
    this.journal = journal;
    this.processes = new Map();
    this.pidCounter = 100;
    this.bootTime = Date.now();
    this.kernelLogs = [];
    this.currentPid = 1;
  }

  nextPid() {
    this.pidCounter += 1;
    return this.pidCounter;
  }

  async spawnWorker({ name, url, onMessage }) {
    const pid = this.nextPid();
    const worker = new Worker(url, { type: "module" });
    const process = {
      pid,
      name,
      worker,
      type: "worker",
      status: "running",
      startedAt: Date.now(),
    };

    this.processes.set(pid, process);

    worker.onmessage = async (event) => {
      const payload = event.data || {};
      if (payload.type === "log") {
        await this.journal.log({
          source: name,
          level: payload.level || "info",
          message: payload.message || "",
        });
        return;
      }
      if (onMessage) {
        await onMessage(payload, process);
      }
    };

    worker.onerror = async (error) => {
      await this.journal.log({
        source: name,
        level: "error",
        message: error.message || "Worker error",
      });
    };

    worker.postMessage({ type: "init", pid, name });

    await this.journal.log({
      source: "kernel",
      level: "info",
      message: `Spawned process ${name} (pid ${pid}).`,
    });

    return process;
  }

  addProcess({ name, type = "builtin" }) {
    const pid = this.nextPid();
    this.processes.set(pid, {
      pid,
      name,
      type,
      status: "running",
      startedAt: Date.now(),
    });
    return pid;
  }

  startProcess({ name, cmdline = "", user = "root" }) {
    const pid = this.nextPid();
    this.processes.set(pid, {
      pid,
      name,
      cmdline,
      user,
      type: "task",
      status: "running",
      startedAt: Date.now(),
    });
    this.currentPid = pid;
    return pid;
  }

  endProcess(pid, status = 0) {
    const process = this.processes.get(pid);
    if (!process) return false;
    process.status = "exited";
    process.exitCode = status;
    process.endedAt = Date.now();
    if (this.currentPid === pid) {
      this.currentPid = 1;
    }
    return true;
  }

  listProcesses() {
    return Array.from(this.processes.values()).map((proc) => ({
      pid: proc.pid,
      name: proc.name,
      type: proc.type || (proc.worker ? "worker" : "builtin"),
      status: proc.status || "running",
      cmdline: proc.cmdline || "",
      user: proc.user || "root",
    }));
  }

  async kill(pid) {
    const process = this.processes.get(pid);
    if (!process) return false;
    if (process.worker) {
      process.worker.terminate();
    }
    this.processes.delete(pid);
    await this.journal.log({
      source: "kernel",
      level: "warn",
      message: `Killed process ${process.name} (pid ${pid}).`,
    });
    return true;
  }

  setKernelLogs(lines) {
    this.kernelLogs = Array.isArray(lines) ? lines.slice() : [];
  }

  appendKernelLog(line) {
    this.kernelLogs.push(line);
  }

  getKernelLogs() {
    return this.kernelLogs.slice();
  }

  getUptimeSeconds() {
    return Math.floor((Date.now() - this.bootTime) / 1000);
  }
}
