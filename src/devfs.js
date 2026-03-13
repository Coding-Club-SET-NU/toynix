export class DevFS {
  async list(path) {
    if (path !== "/") return null;
    return ["null", "tty1"].sort();
  }

  async readFile(path) {
    if (path === "/null") return "";
    if (path === "/tty1") return "";
    return null;
  }

  async writeFile() {
    return true;
  }

  async mkdirp() {
    return false;
  }

  async isDir(path) {
    return path === "/";
  }

  async exists(path) {
    return path === "/" || path === "/null" || path === "/tty1";
  }
}
