export class ProgramRegistry {
  constructor() {
    this.programs = new Map();
    this.loader = null;
  }

  register(name, handler) {
    this.programs.set(name, handler);
  }

  get(name) {
    return this.programs.get(name);
  }

  setLoader(loader) {
    this.loader = loader;
  }

  list() {
    return Array.from(this.programs.keys()).sort();
  }

  async getOrLoad(name) {
    const existing = this.get(name);
    if (existing) return existing;
    if (!this.loader) return null;
    const loaded = await this.loader(name);
    if (loaded) {
      this.register(name, loaded);
      return loaded;
    }
    return null;
  }
}
