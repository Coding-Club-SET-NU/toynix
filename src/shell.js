import { tokenize } from "./utils.js";

export class Shell {
  constructor({ fs, registry, kernel, username, input }) {
    this.fs = fs;
    this.registry = registry;
    this.kernel = kernel;
    this.username = username || "user";
    this.input = input || null;
    this.hostname = "toynix";
    this.home = `/home/${this.username}`;
    this.cwd = this.home;
    this.prevCwd = this.cwd;
    this.history = [];
    this.lastStatus = 0;
    this.env = new Map([["PATH", "/usr/bin:/bin"]]);
  }

  async init() {
    const hostname = await this.fs.readFile("/etc/hostname");
    if (hostname) {
      this.hostname = hostname.trim();
    }
    this.env.set("HOSTNAME", this.hostname);
    this.env.set("HOME", this.home);
    this.env.set("USER", this.username);
    this.env.set("SHELL", "/bin/sh");
    this.env.set("COLUMNS", "80");
    this.env.set("LINES", "30");
    if (this.input && this.input.setCanonical) {
      this.input.setCanonical(true);
    }
    if (this.input && this.input.setEcho) {
      this.input.setEcho(true);
    }
  }

  async setUser(username) {
    this.username = username;
    this.home = `/home/${this.username}`;
    if (!(await this.fs.isDir(this.home))) {
      await this.fs.mkdirp(this.home);
    }
    this.setCwd(this.home);
    this.env.set("HOME", this.home);
    this.env.set("USER", this.username);
  }

  setCwd(path) {
    this.prevCwd = this.cwd;
    this.cwd = path;
  }

  getPrompt() {
    return `${this.username}@${this.hostname} ${this.cwd} $ `;
  }

  async runLine(line, io, signal = null) {
    this.history.push(line);
    const segments = splitPipeline(line);
    let stdin = "";
    let lastStatus = 0;

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i].trim();
      if (!segment) continue;

      const tokens = tokenize(segment);
      if (!tokens.length) continue;

      let redirect = null;
      if (i === segments.length - 1) {
        const redirIndex = tokens.findIndex((token) => token === ">" || token === ">>");
        if (redirIndex >= 0) {
          const op = tokens[redirIndex];
          const target = tokens[redirIndex + 1];
          if (target) {
            redirect = { target, append: op === ">>" };
            tokens.splice(redirIndex, tokens.length - redirIndex);
          }
        }
      }

      const [cmd, ...args] = tokens;
      const program = this.registry.getOrLoad
        ? await this.registry.getOrLoad(cmd)
        : this.registry.get(cmd);
      if (!program) {
        io.println(`${cmd}: command not found`);
        this.lastStatus = 127;
        return this.lastStatus;
      }

      const isLast = i === segments.length - 1;
      if (this.input && this.input.setRawMode) {
        this.input.setRawMode(false);
      }
      const bufferIO = createBufferIO();
      const activeIO = isLast && !redirect ? io : bufferIO;

      let status = 0;
      try {
        status = await program({
          io: activeIO,
          fs: this.fs,
          shell: this,
          kernel: this.kernel,
          stdin,
          signal,
          input: this.input,
          args,
        }, args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        io.println(message || "Command failed");
        status = 1;
      }

      stdin = bufferIO.getBuffer();
      lastStatus = typeof status === "number" ? status : 0;

      if (isLast && redirect) {
        const path = this.fs.resolveWithCwd(this.cwd, redirect.target);
        if (redirect.append) {
          const existing = await this.fs.readFile(path);
          const next = existing ? `${existing}${stdin}` : stdin;
          await this.fs.writeFile(path, next);
        } else {
          await this.fs.writeFile(path, stdin);
        }
      }
    }

    this.lastStatus = lastStatus;
    return lastStatus;
  }
}

function splitPipeline(line) {
  const segments = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (ch === "|") {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  if (current.length) segments.push(current);
  return segments;
}

function createBufferIO() {
  let buffer = "";
  return {
    println(text = "") {
      buffer += `${text}\n`;
    },
    clear() {},
    getBuffer() {
      return buffer;
    },
  };
}
