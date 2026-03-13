export class ServiceManager {
  constructor({ vfs, journal, kernel }) {
    this.vfs = vfs;
    this.journal = journal;
    this.kernel = kernel;
    this.units = new Map();
    this.states = new Map();
    this.bootLogs = [];
  }

  async loadUnits() {
    const entries = await this.vfs.list("/etc/systemd/system");
    if (!entries) return;
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const path = `/etc/systemd/system/${name}`;
      const content = await this.vfs.readFile(path);
      if (!content) continue;
      try {
        const unit = JSON.parse(content);
        if (!unit || !unit.name) continue;
        this.units.set(unit.name, unit);
        if (!this.states.has(unit.name)) {
          this.states.set(unit.name, { active: false, sub: "dead", pid: null });
        }
      } catch {
        // ignore invalid units
      }
    }
  }

  listUnits() {
    return Array.from(this.units.values()).map((unit) => {
      const state = this.states.get(unit.name) || { active: false, sub: "dead" };
      return {
        name: unit.name,
        description: unit.description || "",
        active: state.active ? "active" : "inactive",
        sub: state.sub || "dead",
      };
    });
  }

  getStatus(name) {
    const unit = this.resolveUnit(name);
    if (!unit) return null;
    const state = this.states.get(unit.name) || { active: false, sub: "dead" };
    return {
      name: unit.name,
      description: unit.description || "",
      active: state.active ? "active" : "inactive",
      sub: state.sub || "dead",
      pid: state.pid,
    };
  }

  async boot(target = "multi-user.target") {
    this.bootLogs = [];
    const units = Array.from(this.units.values()).filter((unit) => {
      const wantedBy = unit.wantedBy || [];
      return wantedBy.includes(target);
    });
    for (const unit of units) {
      await this.startUnit(unit.name);
    }
    return this.bootLogs.slice();
  }

  async startUnit(name, stack = new Set()) {
    const unit = this.resolveUnit(name);
    if (!unit) return false;
    if (stack.has(unit.name)) return false;
    stack.add(unit.name);

    const dependencies = [
      ...(unit.after || []),
      ...(unit.wants || []),
    ];
    for (const dep of dependencies) {
      await this.startUnit(dep, stack);
    }

    const state = this.states.get(unit.name) || { active: false, sub: "dead", pid: null };
    if (state.active) return true;

    const pid = this.kernel ? this.kernel.addProcess({ name: unit.name, type: "service" }) : null;
    this.states.set(unit.name, { active: true, sub: "running", pid });
    const msg = `Started ${unit.description || unit.name}.`;
    await this.logService("systemd", msg);
    this.bootLogs.push(`[  OK  ] ${msg}`);
    return true;
  }

  async stopUnit(name) {
    const unit = this.resolveUnit(name);
    if (!unit) return false;
    const state = this.states.get(unit.name);
    if (!state || !state.active) return true;
    if (state.pid && this.kernel) {
      this.kernel.endProcess(state.pid, 0);
    }
    this.states.set(unit.name, { active: false, sub: "dead", pid: null });
    const msg = `Stopped ${unit.description || unit.name}.`;
    await this.logService("systemd", msg);
    return true;
  }

  resolveUnit(name) {
    if (this.units.has(name)) return this.units.get(name);
    if (!name.endsWith(".service") && this.units.has(`${name}.service`)) {
      return this.units.get(`${name}.service`);
    }
    if (!name.endsWith(".target") && this.units.has(`${name}.target`)) {
      return this.units.get(`${name}.target`);
    }
    return null;
  }

  async logService(source, message) {
    if (!this.journal) return;
    await this.journal.log({ source, message, level: "info" });
  }
}
