import { normalizePath, resolvePath } from "./utils.js";

class MemoryNode {
  constructor(type, name) {
    this.type = type;
    this.name = name;
    this.children = {};
    this.content = "";
  }
}

export class MemoryFS {
  constructor() {
    this.root = new MemoryNode("dir", "");
  }

  seed(tree) {
    const walk = (node, subtree) => {
      for (const [name, value] of Object.entries(subtree)) {
        if (typeof value === "string") {
          const file = new MemoryNode("file", name);
          file.content = value;
          node.children[name] = file;
        } else {
          const dir = new MemoryNode("dir", name);
          node.children[name] = dir;
          walk(dir, value);
        }
      }
    };

    walk(this.root, tree);
  }

  async list(path) {
    const node = this.getNode(path);
    if (!node || node.type !== "dir") return null;
    return Object.keys(node.children).sort();
  }

  async readFile(path) {
    const node = this.getNode(path);
    if (!node || node.type !== "file") return null;
    return node.content;
  }

  async writeFile(path, content) {
    const dirPath = path.split("/").slice(0, -1).join("/") || "/";
    const name = path.split("/").pop();
    const dir = this.getNode(dirPath, true);
    if (!dir || dir.type !== "dir") return false;
    const file = new MemoryNode("file", name);
    file.content = content;
    dir.children[name] = file;
    return true;
  }

  async mkdirp(path) {
    this.getNode(path, true);
    return true;
  }

  async isDir(path) {
    const node = this.getNode(path);
    return !!node && node.type === "dir";
  }

  async exists(path) {
    return !!this.getNode(path);
  }

  async delete(path, recursive = false) {
    if (path === "/") return false;
    const parts = normalizePath(path).split("/").filter(Boolean);
    const name = parts.pop();
    const parent = this.getNode(`/${parts.join("/")}`);
    if (!parent || parent.type !== "dir") return false;
    const node = parent.children[name];
    if (!node) return false;
    if (node.type === "dir" && !recursive && Object.keys(node.children).length) {
      return false;
    }
    delete parent.children[name];
    return true;
  }

  getNode(path, create = false) {
    if (path === "/") return this.root;
    const parts = normalizePath(path).split("/").filter(Boolean);
    let current = this.root;

    for (const part of parts) {
      let next = current.children[part];
      if (!next) {
        if (!create) return null;
        next = new MemoryNode("dir", part);
        current.children[part] = next;
      }
      current = next;
    }

    return current;
  }
}

export class OPFSAdapter {
  constructor(root) {
    this.root = root;
  }

  static async create() {
    if (!navigator.storage || !navigator.storage.getDirectory) {
      return null;
    }
    try {
      const root = await navigator.storage.getDirectory();
      return new OPFSAdapter(root);
    } catch (error) {
      return null;
    }
  }

  async list(path) {
    const dir = await this.getDirectory(path, false);
    if (!dir) return null;
    const names = [];
    for await (const [name] of dir.entries()) {
      names.push(name);
    }
    return names.sort();
  }

  async readFile(path) {
    try {
      const dirPath = path.split("/").slice(0, -1).join("/") || "/";
      const fileName = path.split("/").pop();
      const dir = await this.getDirectory(dirPath, false);
      if (!dir) return null;
      const handle = await dir.getFileHandle(fileName);
      const file = await handle.getFile();
      return await file.text();
    } catch (error) {
      return null;
    }
  }

  async writeFile(path, content) {
    const dirPath = path.split("/").slice(0, -1).join("/") || "/";
    const fileName = path.split("/").pop();
    const dir = await this.getDirectory(dirPath, true);
    if (!dir) return false;
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  }

  async mkdirp(path) {
    await this.getDirectory(path, true);
    return true;
  }

  async isDir(path) {
    const dir = await this.getDirectory(path, false);
    return !!dir;
  }

  async exists(path) {
    if (path === "/") return true;
    const parts = normalizePath(path).split("/").filter(Boolean);
    const fileName = parts.pop();
    const dir = await this.getDirectory(`/${parts.join("/")}`, false);
    if (!dir) return false;
    try {
      await dir.getFileHandle(fileName);
      return true;
    } catch (error) {
      try {
        await dir.getDirectoryHandle(fileName);
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  async getDirectory(path, create) {
    const parts = normalizePath(path).split("/").filter(Boolean);
    let current = this.root;

    for (const part of parts) {
      try {
        current = await current.getDirectoryHandle(part, { create });
      } catch (error) {
        if (!create) return null;
        throw error;
      }
    }

    return current;
  }

  async delete(path, recursive = false) {
    if (path === "/") return false;
    const parts = normalizePath(path).split("/").filter(Boolean);
    const name = parts.pop();
    const dir = await this.getDirectory(`/${parts.join("/")}`, false);
    if (!dir) return false;
    try {
      await dir.removeEntry(name, { recursive });
      return true;
    } catch (error) {
      return false;
    }
  }
}

export class VFS {
  constructor() {
    this.mounts = [];
    this.meta = new Map();
  }

  mount(path, fs) {
    const normalized = normalizePath(path);
    this.mounts.push({ path: normalized, fs });
    this.mounts.sort((a, b) => b.path.length - a.path.length);
  }

  resolve(path) {
    return normalizePath(path);
  }

  resolveWithCwd(cwd, inputPath) {
    return resolvePath(cwd, inputPath);
  }

  async list(path) {
    await this.ensureMeta(path, "dir");
    const { fs, relPath } = this.getMount(path);
    const entries = await fs.list(relPath);
    if (!entries) return null;
    for (const name of entries) {
      const childPath = normalizePath(`${path}/${name}`);
      const { fs: childFs, relPath: childRel } = this.getMount(childPath);
      const isDir = await childFs.isDir(childRel);
      await this.ensureMeta(childPath, isDir ? "dir" : "file");
    }
    return entries;
  }

  async readFile(path) {
    await this.ensureMeta(path, "file");
    const { fs, relPath } = this.getMount(path);
    const content = await fs.readFile(relPath);
    if (content !== null) {
      this.touchMeta(path, "atime");
    }
    return content;
  }

  async writeFile(path, content) {
    await this.ensureMeta(path, "file");
    const { fs, relPath } = this.getMount(path);
    const ok = await fs.writeFile(relPath, content);
    if (ok) {
      this.touchMeta(path, "mtime");
    }
    return ok;
  }

  async mkdirp(path) {
    await this.ensureMeta(path, "dir");
    const { fs, relPath } = this.getMount(path);
    const ok = await fs.mkdirp(relPath);
    if (ok) {
      this.touchMeta(path, "mtime");
    }
    return ok;
  }

  async remove(path, recursive = false) {
    const { fs, relPath } = this.getMount(path);
    if (typeof fs.delete === "function") {
      const ok = await fs.delete(relPath, recursive);
      if (ok) {
        this.meta.delete(normalizePath(path));
      }
      return ok;
    }
    const isDir = await this.isDir(path);
    if (isDir) {
      const entries = await this.list(path);
      if (entries && entries.length) {
        if (!recursive) return false;
        for (const name of entries) {
          await this.remove(`${path}/${name}`, true);
        }
      }
    }
    this.meta.delete(normalizePath(path));
    return true;
  }

  async copy(source, dest) {
    const isDir = await this.isDir(source);
    if (isDir) {
      await this.mkdirp(dest);
      const entries = await this.list(source);
      if (entries) {
        for (const name of entries) {
          await this.copy(`${source}/${name}`, `${dest}/${name}`);
        }
      }
      return true;
    }
    const content = await this.readFile(source);
    if (content === null) return false;
    return this.writeFile(dest, content);
  }

  async move(source, dest) {
    const ok = await this.copy(source, dest);
    if (!ok) return false;
    return this.remove(source, true);
  }

  async isDir(path) {
    const { fs, relPath } = this.getMount(path);
    return fs.isDir(relPath);
  }

  async exists(path) {
    const { fs, relPath } = this.getMount(path);
    return fs.exists(relPath);
  }

  async stat(path) {
    const exists = await this.exists(path);
    if (!exists) return null;
    const isDir = await this.isDir(path);
    await this.ensureMeta(path, isDir ? "dir" : "file");
    return this.meta.get(path) || null;
  }

  async chmod(path, mode) {
    const stat = await this.stat(path);
    if (!stat) return false;
    stat.mode = mode;
    this.meta.set(path, stat);
    return true;
  }

  async chown(path, uid, gid) {
    const stat = await this.stat(path);
    if (!stat) return false;
    stat.uid = uid;
    stat.gid = gid;
    this.meta.set(path, stat);
    return true;
  }

  async ensureMeta(path, type) {
    const normalized = normalizePath(path);
    if (this.meta.has(normalized)) return this.meta.get(normalized);
    const now = Date.now();
    const defaults = type === "dir" ? 0o40755 : 0o100644;
    const entry = {
      path: normalized,
      type,
      mode: defaults,
      uid: 0,
      gid: 0,
      atime: now,
      mtime: now,
      ctime: now,
    };
    this.meta.set(normalized, entry);
    return entry;
  }

  touchMeta(path, field) {
    const normalized = normalizePath(path);
    const entry = this.meta.get(normalized);
    if (!entry) return;
    entry[field] = Date.now();
  }

  getMount(path) {
    const normalized = normalizePath(path);
    let best = null;
    for (const entry of this.mounts) {
      if (entry.path === "/") {
        best = best || entry;
        continue;
      }
      if (normalized === entry.path || normalized.startsWith(`${entry.path}/`)) {
        if (!best || entry.path.length > best.path.length) {
          best = entry;
        }
      }
    }
    if (!best) {
      return { fs: this.mounts[0].fs, relPath: normalized };
    }
    const relPath = normalized === best.path
      ? "/"
      : `/${normalized.slice(best.path.length).replace(/^\//, "")}`;
    return { fs: best.fs, relPath };
  }
}

export async function createDefaultVfs() {
  const vfs = new VFS();
  const mem = new MemoryFS();
  mem.seed({
    etc: {
      "hostname": "toynix\n",
      "passwd": "root:x:0:0:root:/root:/bin/sh\nuser:x:1000:1000:user:/home/user:/bin/sh\n",
      "group": "root:x:0:\nuser:x:1000:user\n",
      "hosts": "127.0.0.1 localhost\n127.0.1.1 toynix\n",
      "resolv.conf": "nameserver 1.1.1.1\nnameserver 8.8.8.8\n",
      "os-release": "NAME=Toynix\nPRETTY_NAME=Toynix\n",
      "systemd": {
        "system": {
          "systemd-journald.service.json": JSON.stringify({
            name: "systemd-journald.service",
            description: "Journal Service",
            wants: [],
            after: [],
            wantedBy: ["multi-user.target"],
          }, null, 2),
          "getty@tty1.service.json": JSON.stringify({
            name: "getty@tty1.service",
            description: "Getty on tty1",
            wants: [],
            after: ["systemd-journald.service"],
            wantedBy: ["multi-user.target"],
          }, null, 2),
          "network.service.json": JSON.stringify({
            name: "network.service",
            description: "Network (simulated)",
            wants: [],
            after: ["systemd-journald.service"],
            wantedBy: ["multi-user.target"],
          }, null, 2),
          "multi-user.target.json": JSON.stringify({
            name: "multi-user.target",
            description: "Multi-User System",
            wants: ["systemd-journald.service", "getty@tty1.service", "network.service"],
            after: [],
            wantedBy: [],
          }, null, 2),
        },
      },
    },
    usr: {
      bin: {
        sysinfo: "#!/usr/bin/env sysinfo\n",
        neofetch: "#!/usr/bin/env neofetch\n",
        cowsay: "#!/usr/bin/env cowsay\n",
        rev: "#!/usr/bin/env rev\n",
        cmatrix: "#!/usr/bin/env cmatrix\n",
        pipes: "#!/usr/bin/env pipes\n",
        rig: "#!/usr/bin/env rig\n",
        oneko: "#!/usr/bin/env oneko\n",
        top: "#!/usr/bin/env top\n",
        fortune: "#!/usr/bin/env fortune\n",
        toilet: "#!/usr/bin/env toilet\n",
        figlet: "#!/usr/bin/env figlet\n",
        nano: "#!/usr/bin/env nano\n",
        tour: "#!/usr/bin/env tour\n",
      },
      share: {
        man: {
          "ls.txt": "NAME\n  ls - list directory contents\n\nSYNOPSIS\n  ls [-a] [-l] [path]\n\nDESCRIPTION\n  List files in a directory. Use -a for dotfiles, -l for long format.\n",
          "cd.txt": "NAME\n  cd - change directory\n\nSYNOPSIS\n  cd [dir]\n\nDESCRIPTION\n  Change the current working directory. Use '-' to return to previous.\n",
          "pwd.txt": "NAME\n  pwd - print working directory\n\nSYNOPSIS\n  pwd\n",
          "cat.txt": "NAME\n  cat - concatenate files\n\nSYNOPSIS\n  cat [file...]\n\nDESCRIPTION\n  Print files to stdout. If no file, echoes stdin.\n",
          "echo.txt": "NAME\n  echo - display a line of text\n\nSYNOPSIS\n  echo [text...]\n",
          "clear.txt": "NAME\n  clear - clear the screen\n\nSYNOPSIS\n  clear\n",
          "help.txt": "NAME\n  help - list available commands\n\nSYNOPSIS\n  help\n",
          "whoami.txt": "NAME\n  whoami - print effective user\n\nSYNOPSIS\n  whoami\n",
          "uname.txt": "NAME\n  uname - print system information\n\nSYNOPSIS\n  uname [-a]\n",
          "date.txt": "NAME\n  date - print date and time\n\nSYNOPSIS\n  date [-u]\n",
          "uptime.txt": "NAME\n  uptime - show uptime\n\nSYNOPSIS\n  uptime [-p]\n",
          "ps.txt": "NAME\n  ps - list processes\n\nSYNOPSIS\n  ps\n",
          "journalctl.txt": "NAME\n  journalctl - show journal\n\nSYNOPSIS\n  journalctl [-n N]\n",
          "dmesg.txt": "NAME\n  dmesg - show kernel ring buffer\n\nSYNOPSIS\n  dmesg\n",
          "mkdir.txt": "NAME\n  mkdir - make directories\n\nSYNOPSIS\n  mkdir [-p] dir...\n",
          "touch.txt": "NAME\n  touch - create empty files\n\nSYNOPSIS\n  touch file...\n",
          "write.txt": "NAME\n  write - write text to file\n\nSYNOPSIS\n  write <file> <text...>\n",
          "env.txt": "NAME\n  env - print environment\n\nSYNOPSIS\n  env\n",
          "export.txt": "NAME\n  export - set environment variables\n\nSYNOPSIS\n  export KEY=VALUE...\n",
          "history.txt": "NAME\n  history - show command history\n\nSYNOPSIS\n  history\n",
          "grep.txt": "NAME\n  grep - search text\n\nSYNOPSIS\n  grep [-i] <pattern> [file...]\n",
          "head.txt": "NAME\n  head - first lines\n\nSYNOPSIS\n  head [-n N] [file...]\n",
          "tail.txt": "NAME\n  tail - last lines\n\nSYNOPSIS\n  tail [-n N] [-f] [file...]\n",
          "wc.txt": "NAME\n  wc - word count\n\nSYNOPSIS\n  wc [file...]\n",
          "sleep.txt": "NAME\n  sleep - delay for seconds\n\nSYNOPSIS\n  sleep <seconds>\n",
          "kill.txt": "NAME\n  kill - terminate a process\n\nSYNOPSIS\n  kill <pid>\n",
          "status.txt": "NAME\n  status - last command status\n\nSYNOPSIS\n  status\n",
          "id.txt": "NAME\n  id - user identity\n\nSYNOPSIS\n  id\n",
          "groups.txt": "NAME\n  groups - show user groups\n\nSYNOPSIS\n  groups\n",
          "stat.txt": "NAME\n  stat - file status\n\nSYNOPSIS\n  stat file...\n",
          "chmod.txt": "NAME\n  chmod - change permissions\n\nSYNOPSIS\n  chmod <mode> <file>\n",
          "chown.txt": "NAME\n  chown - change owner\n\nSYNOPSIS\n  chown <uid>:<gid> <file>\n",
          "motd.txt": "NAME\n  motd - message of the day\n\nSYNOPSIS\n  motd\n",
          "rm.txt": "NAME\n  rm - remove files\n\nSYNOPSIS\n  rm [-r] file...\n",
          "cp.txt": "NAME\n  cp - copy files\n\nSYNOPSIS\n  cp [-r] src... dest\n",
          "mv.txt": "NAME\n  mv - move files\n\nSYNOPSIS\n  mv src... dest\n",
          "which.txt": "NAME\n  which - locate a command\n\nSYNOPSIS\n  which name...\n",
          "hostname.txt": "NAME\n  hostname - show host name\n\nSYNOPSIS\n  hostname\n",
          "df.txt": "NAME\n  df - disk usage\n\nSYNOPSIS\n  df\n",
          "du.txt": "NAME\n  du - directory usage\n\nSYNOPSIS\n  du [-h] [-s] [path...]\n",
          "free.txt": "NAME\n  free - memory usage\n\nSYNOPSIS\n  free\n",
          "theme.txt": "NAME\n  theme - configure appearance\n\nSYNOPSIS\n  theme show | set <key> <value> | fetch <url> | clear-image | apply | reset\n\nKEYS\n  textColor         Hex color for text\n  mutedColor        Hex color for dim text\n  accentColor       Hex color for accents\n  promptColor       Hex color for prompt\n  cursorColor       Hex color for cursor\n  backgroundColor   Hex color for terminal/page base\n  backgroundOpacity 0-1 terminal transparency\n  backgroundImage   Data URL or image URL (use theme fetch)\n  blur              Terminal blur (px)\n  frameOpacity      0-1 frame transparency\n  frameBlur         Frame blur (px)\n  fontFamily        CSS font-family string\n  fontSize          CSS size (e.g. 15px)\n  lineHeight        Number (e.g. 1.35)\n  barColor          Top bar color\n  barBorder         Frame border color\n",
          "systemctl.txt": "NAME\n  systemctl - service manager\n\nSYNOPSIS\n  systemctl [list-units|status <unit>|start <unit>|stop <unit>]\n",
          "jobs.txt": "NAME\n  jobs - list background jobs\n\nSYNOPSIS\n  jobs\n",
          "fg.txt": "NAME\n  fg - bring job to foreground\n\nSYNOPSIS\n  fg [%job]\n",
          "bg.txt": "NAME\n  bg - resume job in background\n\nSYNOPSIS\n  bg [%job]\n",
          "man.txt": "NAME\n  man - show manual page\n\nSYNOPSIS\n  man <topic>\n",
          "sysinfo.txt": "NAME\n  sysinfo - show system summary\n\nSYNOPSIS\n  sysinfo\n",
          "neofetch.txt": "NAME\n  neofetch - system info with logo\n\nSYNOPSIS\n  neofetch\n",
          "cowsay.txt": "NAME\n  cowsay - ASCII cow message\n\nSYNOPSIS\n  cowsay <text>\n",
          "rev.txt": "NAME\n  rev - reverse text\n\nSYNOPSIS\n  rev <text>\n",
          "cmatrix.txt": "NAME\n  cmatrix - matrix rain\n\nSYNOPSIS\n  cmatrix\n",
          "pipes.txt": "NAME\n  pipes - animated pipes\n\nSYNOPSIS\n  pipes\n",
          "rig.txt": "NAME\n  rig - generate fake identity\n\nSYNOPSIS\n  rig\n",
          "oneko.txt": "NAME\n  oneko - animated cat\n\nSYNOPSIS\n  oneko\n",
          "top.txt": "NAME\n  top - process monitor\n\nSYNOPSIS\n  top\n",
          "fortune.txt": "NAME\n  fortune - random quote\n\nSYNOPSIS\n  fortune\n",
          "toilet.txt": "NAME\n  toilet - large text banner\n\nSYNOPSIS\n  toilet <text>\n",
          "figlet.txt": "NAME\n  figlet - ASCII text banner\n\nSYNOPSIS\n  figlet <text>\n",
          "nano.txt": "NAME\n  nano - text editor\n\nSYNOPSIS\n  nano <file>\n\nKEYS\n  Ctrl+O save, Ctrl+X exit\n",
          "tour.txt": "NAME\n  tour - guided Toynix walkthrough\n\nSYNOPSIS\n  tour [--fast]\n\nDESCRIPTION\n  Runs a short interactive walkthrough of Toynix features.\n  Use --fast to skip pauses.\n",
        },
        "motd": "Welcome to Toynix (web-native).\n",
      },
    },
    var: {
      log: {
        journal: {},
      },
    },
    home: {
      user: {
        ".profile": "# Toynix shell profile\nexport LANG=en_US.UTF-8\n",
        ".toynixrc": "# Toynix interactive shell rc\n# Put startup commands here.\n",
        "readme.txt": "Welcome to the browser-based Toynix TTY.\n",
      },
    },
    README: "This is a simulated Toynix terminal.\n",
  });

  vfs.mount("/", mem);

  const opfs = await OPFSAdapter.create();
  if (opfs) {
    await opfs.mkdirp("/home/user");
    await opfs.mkdirp("/var/log/journal");
    await opfs.writeFile("/home/user/readme.txt", "Welcome to the persistent home directory.\n");
    const hasRc = await opfs.exists("/home/user/.toynixrc");
    if (!hasRc) {
      await opfs.writeFile("/home/user/.toynixrc", "# Toynix interactive shell rc\n# Put startup commands here.\n");
    }
    vfs.mount("/home", opfs);
    vfs.mount("/var", opfs);
  }

  return vfs;
}
