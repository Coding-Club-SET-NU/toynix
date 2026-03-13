import { resolvePath } from "./utils.js";

class FsNode {
  constructor(type, name) {
    this.type = type;
    this.name = name;
    this.children = {};
    this.content = "";
  }
}

export class VirtualFileSystem {
  constructor() {
    this.root = new FsNode("dir", "");
  }

  seed(tree) {
    const walk = (node, subtree) => {
      for (const [name, value] of Object.entries(subtree)) {
        if (typeof value === "string") {
          const file = new FsNode("file", name);
          file.content = value;
          node.children[name] = file;
        } else {
          const dir = new FsNode("dir", name);
          node.children[name] = dir;
          walk(dir, value);
        }
      }
    };

    walk(this.root, tree);
  }

  resolve(cwd, path) {
    return resolvePath(cwd, path);
  }

  getNode(path) {
    if (path === "/") return this.root;
    const parts = path.split("/").filter(Boolean);
    let current = this.root;

    for (const part of parts) {
      const next = current.children[part];
      if (!next) return null;
      current = next;
    }

    return current;
  }

  list(path) {
    const node = this.getNode(path);
    if (!node || node.type !== "dir") return null;
    return Object.keys(node.children).sort();
  }

  readFile(path) {
    const node = this.getNode(path);
    if (!node || node.type !== "file") return null;
    return node.content;
  }

  isDir(path) {
    const node = this.getNode(path);
    return !!node && node.type === "dir";
  }
}

export function createDefaultFileSystem() {
  const fs = new VirtualFileSystem();
  fs.seed({
    home: {
      toynix: {
        ".profile": "# Toynix shell profile\nexport LANG=en_US.UTF-8\n",
        "readme.txt": "Welcome to the browser-based Toynix TTY.\n",
      },
    },
    etc: {
      "hostname": "toynix\n",
      "os-release": "NAME=Toynix\nPRETTY_NAME=Toynix\n",
    },
    var: {
      log: {
        "boot.log": "",
      },
    },
    usr: {
      bin: {},
    },
    README: "This is a simulated Toynix terminal.\n",
  });
  return fs;
}
