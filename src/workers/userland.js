import { ProgramRegistry } from "../program-registry.js";
import { registerBuiltinPrograms } from "../programs.js";
import { Shell } from "../shell.js";
import { resolvePath } from "../utils.js";
import { loadUserlandModule } from "./module-loader.js";

let shell = null;
let cwd = "/";
let username = "user";
let interrupted = false;
let userInfo = { uid: 0, gid: 0, groups: [0], username: "root" };
let foregroundJob = null;
let jobCounter = 0;
let lastJobId = null;
const jobs = new Map();
const tty = {
  raw: false,
  echo: true,
  canonical: true,
};

let binEntriesCache = [];
let binEntriesLoaded = false;
let binEntriesLogged = false;

let rpcId = 0;
const pending = new Map();
const keyQueue = [];
const keyWaiters = [];

function send(payload) {
  self.postMessage(payload);
}

function enqueueKey(event) {
  if (keyWaiters.length) {
    const waiter = keyWaiters.shift();
    waiter(event);
    return;
  }
  keyQueue.push(event);
}

function readKey() {
  return new Promise((resolve) => {
    if (keyQueue.length) {
      resolve(keyQueue.shift());
      return;
    }
    keyWaiters.push(resolve);
  });
}

function tryReadKey() {
  if (!keyQueue.length) return null;
  return keyQueue.shift();
}

function rpcCall(method, params) {
  rpcId += 1;
  const id = rpcId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ type: "rpc", id, method, params });
  });
}

async function rawReadFile(path) {
  return rpcCall("fs.readFile", { path });
}

async function refreshUserInfo(name) {
  const passwd = await rawReadFile("/etc/passwd");
  const group = await rawReadFile("/etc/group");
  let uid = 0;
  let gid = 0;
  const groups = [];
  if (passwd) {
    const entry = passwd.split("\n").find((line) => line.startsWith(`${name}:`));
    if (entry) {
      const parts = entry.split(":");
      uid = Number(parts[2]) || 0;
      gid = Number(parts[3]) || 0;
    }
  }
  if (group) {
    group.split("\n").forEach((line) => {
      const [groupName, , groupId, members] = line.split(":");
      if (!groupName) return;
      const gidNum = Number(groupId);
      if (Number.isNaN(gidNum)) return;
      if (groupName === name) {
        groups.push(gidNum);
      }
      if (members && members.split(",").includes(name)) {
        groups.push(gidNum);
      }
    });
  }
  userInfo = {
    uid,
    gid,
    groups: Array.from(new Set([gid, ...groups])),
    username: name,
  };
}

function isRoot() {
  return userInfo.uid === 0;
}

function hasPerm(mode, bit) {
  return (mode & bit) === bit;
}

function pickModeBits(stat) {
  const mode = stat?.mode ?? 0;
  if (userInfo.uid === stat.uid) return (mode >> 6) & 0b111;
  if (userInfo.groups.includes(stat.gid)) return (mode >> 3) & 0b111;
  return mode & 0b111;
}

async function canRead(path) {
  if (isRoot()) return true;
  const stat = await rpcCall("fs.stat", { path });
  if (!stat) return true;
  const bits = pickModeBits(stat);
  return hasPerm(bits, 0b100);
}

async function canWrite(path) {
  if (isRoot()) return true;
  const stat = await rpcCall("fs.stat", { path });
  if (!stat) return true;
  const bits = pickModeBits(stat);
  return hasPerm(bits, 0b010);
}

async function canExecute(path) {
  if (isRoot()) return true;
  const stat = await rpcCall("fs.stat", { path });
  if (!stat) return true;
  const bits = pickModeBits(stat);
  return hasPerm(bits, 0b001);
}

function parentPath(path) {
  if (path === "/") return "/";
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}` || "/";
}

function deny(path) {
  throw new Error(`EACCES: permission denied, ${path}`);
}

const fsProxy = {
  async list(path) {
    if (!(await canRead(path)) || !(await canExecute(path))) deny(path);
    return rpcCall("fs.list", { path });
  },
  async readFile(path) {
    if (!(await canRead(path))) deny(path);
    return rpcCall("fs.readFile", { path });
  },
  async writeFile(path, content) {
    const exists = await rpcCall("fs.exists", { path });
    if (exists) {
      if (!(await canWrite(path))) deny(path);
    } else {
      const parent = parentPath(path);
      if (!(await canWrite(parent)) || !(await canExecute(parent))) deny(path);
    }
    return rpcCall("fs.writeFile", { path, content });
  },
  async mkdirp(path) {
    const parent = parentPath(path);
    if (!(await canWrite(parent)) || !(await canExecute(parent))) deny(path);
    return rpcCall("fs.mkdirp", { path });
  },
  async isDir(path) {
    return rpcCall("fs.isDir", { path });
  },
  async exists(path) {
    return rpcCall("fs.exists", { path });
  },
  async stat(path) {
    return rpcCall("fs.stat", { path });
  },
  async chmod(path, mode) {
    if (!isRoot()) {
      const stat = await rpcCall("fs.stat", { path });
      if (!stat || stat.uid !== userInfo.uid) deny(path);
    }
    return rpcCall("fs.chmod", { path, mode });
  },
  async chown(path, uid, gid) {
    if (!isRoot()) deny(path);
    return rpcCall("fs.chown", { path, uid, gid });
  },
  async remove(path, recursive) {
    const parent = parentPath(path);
    if (!(await canWrite(parent)) || !(await canExecute(parent))) deny(path);
    return rpcCall("fs.remove", { path, recursive });
  },
  async copy(source, dest) {
    return rpcCall("fs.copy", { source, dest });
  },
  async move(source, dest) {
    return rpcCall("fs.move", { source, dest });
  },
  resolveWithCwd(current, inputPath) {
    return resolvePath(current, inputPath);
  },
};

const kernelProxy = {
  async getUptimeSeconds() {
    return rpcCall("kernel.uptime", {});
  },
  async listProcesses() {
    return rpcCall("kernel.ps", {});
  },
  async getKernelLogs() {
    return rpcCall("kernel.dmesg", {});
  },
  async kill(pid) {
    return rpcCall("kernel.kill", { pid });
  },
  async listUnits() {
    return rpcCall("service.list", {});
  },
  async statusUnit(name) {
    return rpcCall("service.status", { name });
  },
  async startUnit(name) {
    return rpcCall("service.start", { name });
  },
  async stopUnit(name) {
    return rpcCall("service.stop", { name });
  },
  async getTheme() {
    return rpcCall("theme.get", {});
  },
  async applyTheme() {
    return rpcCall("theme.apply", {});
  },
  async setTheme(key, value) {
    return rpcCall("theme.set", { key, value });
  },
  async setThemeMany(values) {
    return rpcCall("theme.setMany", { values });
  },
  async fetchThemeImage(url) {
    return rpcCall("theme.fetchImage", { url });
  },
  async resetTheme() {
    return rpcCall("theme.reset", {});
  },
};

const io = {
  println(text = "") {
    send({ type: "pty", data: `${text}\n` });
  },
  clear() {
    send({ type: "clear" });
  },
};

const input = {
  readKey,
  tryReadKey,
  canonical: true,
  setRawMode(enabled) {
    const next = !!enabled;
    if (tty.raw === next) return;
    tty.raw = next;
    send({ type: "raw-mode", enabled: next });
  },
  setEcho(enabled) {
    tty.echo = !!enabled;
  },
  setCanonical(enabled) {
    const next = !!enabled;
    tty.canonical = next;
    this.canonical = next;
  },
};

function makeSignal() {
  return {
    interrupted: false,
    stopped: false,
    resumeWaiters: [],
    isInterrupted() {
      return this.interrupted || interrupted;
    },
    isStopped() {
      return this.stopped;
    },
    stop() {
      this.stopped = true;
    },
    resume() {
      if (!this.stopped) return;
      this.stopped = false;
      const waiters = this.resumeWaiters.slice();
      this.resumeWaiters = [];
      waiters.forEach((fn) => fn());
    },
    async waitIfStopped() {
      while (this.stopped) {
        await new Promise((resolve) => this.resumeWaiters.push(resolve));
      }
    },
  };
}

function resetStopPromise(job) {
  let stopResolve = null;
  const stopPromise = new Promise((resolve) => { stopResolve = resolve; });
  job.stopPromise = stopPromise;
  job.stopResolve = stopResolve;
}

async function initShell() {
  const registry = new ProgramRegistry();
  registerBuiltinPrograms(registry);
  registry.setLoader(loadUserlandModule);
  shell = new Shell({ fs: fsProxy, registry, kernel: kernelProxy, username, input });
  await shell.init();
  cwd = shell.cwd;
  await refreshUserInfo(username);
  await refreshBinEntries();
  send({ type: "prompt", value: shell.getPrompt() });
}

async function handleLine(line) {
  if (!shell) return;
  let trimmed = line.trim();
  let promptSent = false;
  const sendPrompt = () => {
    if (promptSent) return;
    promptSent = true;
    send({ type: "prompt", value: shell.getPrompt() });
  };
  try {
  if (trimmed === "jobs") {
    if (!jobs.size) {
      sendPrompt();
      return;
    }
    jobs.forEach((job) => {
      const label = job.status === "stopped" ? "Stopped" : "Running";
      io.println(`[${job.id}] ${label} ${job.cmd}`);
    });
    sendPrompt();
    return;
  }
  if (trimmed.startsWith("fg")) {
    const parts = trimmed.split(/\s+/);
    const raw = parts[1] || "";
    const id = raw.startsWith("%") ? Number(raw.slice(1)) : Number(raw) || lastJobId;
    const job = jobs.get(id);
    if (!job) {
      io.println("fg: no such job");
      sendPrompt();
      return;
    }
    foregroundJob = job;
    if (job.status === "stopped") {
      job.signal.resume();
      job.status = "running";
      resetStopPromise(job);
    }
    const outcome = await Promise.race([job.promise, job.stopPromise]);
    if (outcome === "stopped") {
      foregroundJob = null;
      sendPrompt();
      return;
    }
    foregroundJob = null;
    jobs.delete(id);
    sendPrompt();
    return;
  }
  if (trimmed.startsWith("bg")) {
    const parts = trimmed.split(/\s+/);
    const raw = parts[1] || "";
    const id = raw.startsWith("%") ? Number(raw.slice(1)) : Number(raw) || lastJobId;
    const job = jobs.get(id);
    if (!job) {
      io.println("bg: no such job");
      sendPrompt();
      return;
    }
    if (job.status !== "stopped") {
      io.println("bg: job already running");
      sendPrompt();
      return;
    }
    job.signal.resume();
    job.status = "running";
    resetStopPromise(job);
    io.println(`[${job.id}] ${job.cmd} &`);
    sendPrompt();
    return;
  }
  if (trimmed === "!!" && shell.history.length) {
    trimmed = shell.history[shell.history.length - 1];
    io.println(trimmed);
  } else if (trimmed.startsWith("!") && trimmed.length > 1) {
    const index = Number(trimmed.slice(1)) - 1;
    if (!Number.isNaN(index) && shell.history[index]) {
      trimmed = shell.history[index];
      io.println(trimmed);
    }
  }
  if (!trimmed) {
    sendPrompt();
    return;
  }
  let background = false;
  if (trimmed.endsWith("&")) {
    background = true;
    trimmed = trimmed.slice(0, -1).trim();
  }
  if (trimmed.startsWith("stty")) {
    const args = trimmed.split(/\s+/).slice(1);
    if (!args.length) {
      io.println(`echo ${tty.echo ? "on" : "off"}, ${tty.canonical ? "icanon" : "-icanon"}, raw ${tty.raw ? "on" : "off"}`);
      send({ type: "prompt", value: shell.getPrompt() });
      return;
    }
    args.forEach((arg) => {
      if (arg === "raw") {
        tty.raw = true;
        tty.canonical = false;
        send({ type: "raw-mode", enabled: true });
      } else if (arg === "-raw") {
        tty.raw = false;
        send({ type: "raw-mode", enabled: false });
      } else if (arg === "echo") {
        tty.echo = true;
      } else if (arg === "-echo") {
        tty.echo = false;
      } else if (arg === "icanon") {
        tty.canonical = true;
      } else if (arg === "-icanon") {
        tty.canonical = false;
      }
    });
    sendPrompt();
    return;
  }
  send({ type: "log", level: "info", message: `$ ${trimmed}` });
  const jobId = ++jobCounter;
  lastJobId = jobId;
  const signal = makeSignal();
  let stopResolve = null;
  const stopPromise = new Promise((resolve) => { stopResolve = resolve; });
  const pid = await rpcCall("proc.start", {
    name: trimmed.split(" ")[0],
    cmdline: trimmed,
    user: shell.username,
  });
  const job = {
    id: jobId,
    pid,
    cmd: trimmed,
    status: "running",
    promise: null,
    signal,
    stopPromise,
    stopResolve,
  };
  const promise = shell.runLine(trimmed, io, signal)
    .then(async (status) => {
      await rpcCall("proc.end", { pid, status });
      job.status = "done";
      job.exitCode = status;
      if (jobs.has(jobId)) {
        jobs.delete(jobId);
        io.println(`[${jobId}] Done ${trimmed}`);
      }
      return status;
    });
  job.promise = promise;

  if (background) {
    jobs.set(jobId, job);
    io.println(`[${jobId}] ${pid}`);
    sendPrompt();
    return;
  }

  foregroundJob = job;
  const outcome = await Promise.race([job.promise, job.stopPromise]);
  if (outcome === "stopped") {
    foregroundJob = null;
    jobs.set(jobId, job);
    sendPrompt();
    return;
  }
  foregroundJob = null;
  cwd = shell.cwd;
  sendPrompt();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.println(message || "Command failed");
    sendPrompt();
  }
}

async function handleSetUser(name) {
  if (!shell) return;
  await shell.setUser(name);
  username = shell.username;
  cwd = shell.cwd;
  await refreshUserInfo(username);
  await refreshBinEntries();
  const motd = await fsProxy.readFile("/usr/share/motd");
  if (motd) {
    motd.split("\n").forEach((line) => {
      if (line.trim().length) io.println(line);
    });
  }
  await runRcFile();
  io.println("Tip: type help for commands or tour for a guided walkthrough.");
  send({ type: "prompt", value: shell.getPrompt() });
}

async function runRcFile() {
  const rcPath = `/home/${username}/.toynixrc`;
  const content = await fsProxy.readFile(rcPath);
  if (!content) return;
  const lines = content.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    await shell.runLine(line, io, null);
  }
}

self.onmessage = async (event) => {
  const payload = event.data || {};

  if (payload.type === "init") {
    send({ type: "log", level: "info", message: "Userland online." });
    await initShell();
    return;
  }

  if (payload.type === "rpc-res") {
    const entry = pending.get(payload.id);
    if (!entry) return;
    pending.delete(payload.id);
    if (payload.error) {
      entry.reject(new Error(payload.error));
      return;
    }
    entry.resolve(payload.result);
    return;
  }

  if (payload.type === "line") {
    await handleLine(payload.line || "");
  }

  if (payload.type === "set-user") {
    await handleSetUser(payload.username || "user");
  }

  if (payload.type === "interrupt") {
    if (foregroundJob && foregroundJob.signal) {
      foregroundJob.signal.interrupted = true;
    } else {
      interrupted = true;
    }
  }

  if (payload.type === "stop") {
    if (foregroundJob && foregroundJob.signal) {
      foregroundJob.signal.stop();
      foregroundJob.status = "stopped";
      if (foregroundJob.stopResolve) foregroundJob.stopResolve("stopped");
      jobs.set(foregroundJob.id, foregroundJob);
      lastJobId = foregroundJob.id;
      io.println(`[${foregroundJob.id}] Stopped ${foregroundJob.cmd}`);
    }
  }

  if (payload.type === "tty-char") {
    if (!tty.canonical) {
      send({ type: "line", line: payload.data || "" });
    }
  }

  if (payload.type === "set-dimensions") {
    if (shell) {
      shell.env.set("COLUMNS", String(payload.columns || 80));
      shell.env.set("LINES", String(payload.lines || 30));
    }
  }

  if (payload.type === "raw-key") {
    enqueueKey(payload);
  }

  if (payload.type === "complete") {
    if (!shell) return;
    const completion = await completeInput(payload.line || "");
    send({ type: "complete", replacement: completion.replacement, suggestions: completion.suggestions });
  }
};

async function completeInput(line) {
  const match = line.match(/^(.*\s)?([^\s]*)$/);
  const head = match && match[1] ? match[1] : "";
  const fragment = match && match[2] ? match[2] : "";

  const longestCommonPrefix = (list) => {
    if (!list.length) return "";
    let prefix = list[0];
    for (let i = 1; i < list.length; i += 1) {
      const item = list[i];
      let j = 0;
      while (j < prefix.length && j < item.length && prefix[j] === item[j]) j += 1;
      prefix = prefix.slice(0, j);
      if (!prefix) break;
    }
    return prefix;
  };

  const hasSlash = fragment.includes("/");
  if (!head && !hasSlash) {
    const builtins = shell.registry.list ? shell.registry.list() : [];
    await refreshBinEntries();
    const binEntries = await getBinEntries();
    const shellKeywords = ["jobs", "fg", "bg", "systemctl", "stty"];
    const candidates = new Set([...(builtins || []), ...(binEntries || []), ...shellKeywords]);
    const matches = Array.from(candidates).filter((name) => name.startsWith(fragment)).sort();
    if (!matches.length) {
      return { replacement: line, suggestions: [] };
    }
    if (matches.length === 1) {
      return { replacement: `${matches[0]} `, suggestions: [] };
    }
    const lcp = longestCommonPrefix(matches);
    if (lcp && lcp.length > fragment.length) {
      return { replacement: `${lcp}`, suggestions: matches };
    }
    return { replacement: line, suggestions: matches };
  }
  const baseDir = hasSlash ? fragment.slice(0, fragment.lastIndexOf("/")) : ".";
  const prefix = hasSlash ? fragment.slice(fragment.lastIndexOf("/") + 1) : fragment;
  const resolvedDir = fsProxy.resolveWithCwd(shell.cwd, baseDir || ".");
  const entries = (await fsProxy.list(resolvedDir)) || [];
  const matches = entries.filter((name) => name.startsWith(prefix));

  if (!matches.length) {
    return { replacement: line, suggestions: [] };
  }
  if (matches.length === 1) {
    const candidate = matches[0];
    const fullPath = baseDir && baseDir !== "." ? `${baseDir}/${candidate}` : candidate;
    const resolvedCandidate = fsProxy.resolveWithCwd(shell.cwd, fullPath);
    const isDir = await fsProxy.isDir(resolvedCandidate);
    const suffix = isDir ? "/" : " ";
    return { replacement: `${head}${fullPath}${suffix}`, suggestions: [] };
  }
  const lcp = longestCommonPrefix(matches);
  if (lcp && lcp.length > prefix.length) {
    const fullPath = baseDir && baseDir !== "." ? `${baseDir}/${lcp}` : lcp;
    return { replacement: `${head}${fullPath}`, suggestions: matches };
  }
  return { replacement: line, suggestions: matches };
}

async function refreshBinEntries() {
  try {
    const direct = await rpcCall("fs.list", { path: "/usr/bin" });
    if (Array.isArray(direct)) {
      binEntriesCache = direct.slice();
      binEntriesLoaded = true;
      if (!binEntriesLogged) {
        await rpcCall("journal.log", {
          source: "userland",
          level: "info",
          message: `autocomplete: indexed /usr/bin (${direct.length} entries)`,
        });
        binEntriesLogged = true;
      }
      return;
    }
    binEntriesCache = [];
    binEntriesLoaded = true;
    if (!binEntriesLogged) {
      await rpcCall("journal.log", {
        source: "userland",
        level: "warn",
        message: "autocomplete: /usr/bin list returned empty",
      });
      binEntriesLogged = true;
    }
  } catch (err) {
    binEntriesCache = [];
    binEntriesLoaded = true;
    if (!binEntriesLogged) {
      await rpcCall("journal.log", {
        source: "userland",
        level: "error",
        message: `autocomplete: failed to list /usr/bin (${err instanceof Error ? err.message : String(err)})`,
      });
      binEntriesLogged = true;
    }
  }
}

async function getBinEntries() {
  if (!binEntriesLoaded || !binEntriesCache.length) {
    await refreshBinEntries();
  }
  return binEntriesCache;
}
