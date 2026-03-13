import { Terminal } from "./terminal.js";
import { BootSystem } from "./boot.js";
import { BootLoader } from "./bootloader.js";
import { createDefaultVfs } from "./vfs.js";
import { Journal } from "./journal.js";
import { Kernel } from "./kernel.js";
import { ProcFS } from "./procfs.js";
import { DevFS } from "./devfs.js";
import { PTY } from "./pty.js";
import { ServiceManager } from "./service-manager.js";

const terminalEl = document.getElementById("terminal");
const terminal = new Terminal(terminalEl);
const clockEl = document.getElementById("topbar-clock");
const ttyActiveEl = document.getElementById("tty-active");
const ttyTabs = Array.from(document.querySelectorAll(".tty-tab"));
const TTY_COUNT = 6;
const ttySessions = Array.from({ length: 8 }, (_, idx) => (idx === 0 ? null : createSession(idx)));
let activeTty = 1;
let vfsRef = null;
let lastDimensions = { columns: 80, lines: 30 };
let themeState = null;
const THEME_PATH = "/home/user/.config/toynix/theme.json";

let bootComplete = false;

function updateClock() {
  if (!clockEl) return;
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString();
}

updateClock();
setInterval(updateClock, 1000);

terminal.setOnLine(async (line) => {
  const session = getSession(activeTty);
  if (!session) return;
  session.input = "";
  session.acceptingInput = false;
  session.commandRunning = false;
  session.buffer.push({ text: `${session.prompt || ""}${line}`, dim: false });

  if (session.state === "login") {
    const username = line.trim();
    if (!username) {
      setLoginPrompt(session);
      return;
    }
    if (!session.workerProcess || !vfsRef) return;
    const passwd = await vfsRef.readFile("/etc/passwd");
    const users = passwd
      ? passwd
        .split("\n")
        .map((entry) => entry.replace(/\r/g, "").trim())
        .filter(Boolean)
        .map((entry) => entry.split(":")[0])
      : [];
    const fallbackUsers = ["user", "root"];
    const exists = users.includes(username) || (!users.length && fallbackUsers.includes(username));
    if (!exists) {
      addLine(session, "Login incorrect");
      setLoginPrompt(session);
      return;
    }
    addLine(session, "");
    session.state = "shell";
    session.acceptingInput = false;
    if (isActive(session)) terminal.setInputEnabled(false);
    session.workerProcess.worker.postMessage({ type: "set-user", username });
    return;
  }

  if (session.state === "shell") {
    if (!session.workerProcess) return;
    session.commandRunning = true;
    session.acceptingInput = false;
    if (isActive(session)) terminal.setInputEnabled(false);
    session.workerProcess.worker.postMessage({ type: "line", line });
  }
});

terminal.setOnInterrupt(() => {
  const session = getSession(activeTty);
  if (!session) return;
  if (session.state === "login") {
    addLine(session, "^C");
    setLoginPrompt(session);
    return;
  }
  if (session.state === "shell" && session.workerProcess) {
    session.workerProcess.worker.postMessage({ type: "interrupt" });
    addLine(session, "^C");
    if (!session.commandRunning) {
      setSessionPrompt(session, session.prompt || "");
    }
  }
});

terminal.setOnStop(() => {
  const session = getSession(activeTty);
  if (!session || session.state !== "shell" || !session.workerProcess) return;
  session.workerProcess.worker.postMessage({ type: "stop" });
  addLine(session, "^Z");
});

terminal.setOnClear(() => {
  const session = getSession(activeTty);
  if (!session) return;
  clearSession(session);
  if (session.state === "login") {
    setLoginPrompt(session);
  } else if (session.state === "shell") {
    setSessionPrompt(session, session.prompt || "");
  }
});

terminal.setOnAutocomplete((input) => {
  const session = getSession(activeTty);
  if (!session || session.state !== "shell" || !session.workerProcess) return;
  session.workerProcess.worker.postMessage({ type: "complete", line: input });
});

async function start() {
  terminal.setInputEnabled(false);
  const vfs = await createDefaultVfs();
  vfsRef = vfs;
  const journal = new Journal({ vfs });
  const kernel = new Kernel({ vfs, journal });
  const services = new ServiceManager({ vfs, journal, kernel });
  await services.loadUnits();
  themeState = await loadThemeFromVfs(vfs, journal);
  applyTheme(themeState);
  vfs.mount("/proc", new ProcFS(kernel));
  vfs.mount("/dev", new DevFS());
  for (let i = 1; i <= TTY_COUNT; i += 1) {
    kernel.addProcess({ name: `tty${i}`, type: "session" });
  }

  await journal.log({ source: "kernel", message: "Web-native kernel initialized." });
  await journal.log({ source: "systemd", message: "Launching init sequence." });
  await journal.log({ source: "systemd", message: "Mounting virtual filesystems." });
  await journal.log({ source: "systemd", message: "Starting getty@tty1 service." });

  await kernel.spawnWorker({ name: "init", url: new URL("./workers/init.js", import.meta.url) });
  for (let i = 1; i <= TTY_COUNT; i += 1) {
    const session = getSession(i);
    if (!session) continue;
    session.pty = new PTY();
    session.pty.onLine((line) => addLine(session, line));
    session.workerProcess = await kernel.spawnWorker({
      name: `userland-tty${i}`,
      url: new URL("./workers/userland.js", import.meta.url),
      onMessage: async (payload, process) => {
        await handleUserlandMessage({ vfs, journal, kernel, services }, session, payload, process);
      },
    });
  }

  updateDimensions();
  window.addEventListener("resize", () => {
    clearTimeout(window.__termResizeTimer);
    window.__termResizeTimer = setTimeout(updateDimensions, 150);
  });

  const tty1 = getSession(1);
  const tty1Terminal = makeSessionTerminal(tty1);
  const bootloader = new BootLoader(tty1Terminal);
  const choice = await bootloader.run();
  await journal.log({ source: "bootloader", message: `Selected entry: ${choice}` });

  const kernelLogs = window.TOYNIX_KERNEL_LOGS || [];
  if (kernelLogs.length) {
    kernel.setKernelLogs(kernelLogs);
  }
  const serviceLogs = await services.boot("multi-user.target");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const journalLines = journal.getLines();
  const systemdLogs = window.TOYNIX_SYSTEMD_LOGS || journalLines || serviceLogs;
  const boot = new BootSystem({ kernelLogs, systemdLogs, journal, kernel });

  await boot.run(tty1Terminal);

  for (let i = 1; i <= TTY_COUNT; i += 1) {
    const session = getSession(i);
    if (!session) continue;
    session.state = "login";
    session.prompt = "toynix login: ";
    session.acceptingInput = i === activeTty;
    if (!session.buffer.length || session.buffer[session.buffer.length - 1]?.text !== `Toynix tty${i}`) {
      addLine(session, `Toynix tty${i}`);
    }
  }
  bootComplete = true;
  updateTtyUI();
  if (tty1) {
    if (isActive(tty1)) {
      terminal.setPrompt(tty1.prompt);
      terminal.setInputEnabled(true);
    }
  }
}

start();

function updateDimensions() {
  const { columns, lines } = getTerminalDimensions();
  if (columns === lastDimensions.columns && lines === lastDimensions.lines) return;
  lastDimensions = { columns, lines };
  for (let i = 1; i <= TTY_COUNT; i += 1) {
    const session = getSession(i);
    if (session?.workerProcess) {
      session.workerProcess.worker.postMessage({ type: "set-dimensions", columns, lines });
    }
  }
}

function getTerminalDimensions() {
  const style = getComputedStyle(terminalEl);
  const probe = document.createElement("span");
  probe.textContent = "M";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.lineHeight = style.lineHeight;
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  document.body.removeChild(probe);
  const charWidth = rect.width || 9;
  const lineHeight = rect.height || 18;
  const columns = Math.max(40, Math.floor(terminalEl.clientWidth / charWidth));
  const lines = Math.max(12, Math.floor(terminalEl.clientHeight / lineHeight));
  return { columns, lines };
}

async function handleRpc({ vfs, journal, kernel, services }, payload) {
  const { method, params } = payload;
  if (method === "fs.list") return vfs.list(params.path);
  if (method === "fs.readFile") return vfs.readFile(params.path);
  if (method === "fs.writeFile") return vfs.writeFile(params.path, params.content);
  if (method === "fs.mkdirp") return vfs.mkdirp(params.path);
  if (method === "fs.isDir") return vfs.isDir(params.path);
  if (method === "fs.exists") return vfs.exists(params.path);
  if (method === "fs.stat") return vfs.stat(params.path);
  if (method === "fs.chmod") return vfs.chmod(params.path, params.mode);
  if (method === "fs.chown") return vfs.chown(params.path, params.uid, params.gid);
  if (method === "fs.remove") return vfs.remove(params.path, params.recursive);
  if (method === "fs.copy") return vfs.copy(params.source, params.dest);
  if (method === "fs.move") return vfs.move(params.source, params.dest);
  if (method === "kernel.uptime") return kernel.getUptimeSeconds();
  if (method === "kernel.ps") return kernel.listProcesses();
  if (method === "kernel.dmesg") return kernel.getKernelLogs();
  if (method === "kernel.kill") return kernel.kill(params.pid);
  if (method === "proc.start") {
    return kernel.startProcess({
      name: params.name || "task",
      cmdline: params.cmdline || "",
      user: params.user || "root",
    });
  }
  if (method === "proc.end") {
    return kernel.endProcess(params.pid, params.status);
  }
  if (method === "journal.log") {
    return journal.log({
      source: params.source || "userland",
      level: params.level || "info",
      message: params.message || "",
    });
  }
  if (method === "service.list") return services.listUnits();
  if (method === "service.status") return services.getStatus(params.name);
  if (method === "service.start") return services.startUnit(params.name);
  if (method === "service.stop") return services.stopUnit(params.name);
  if (method === "service.boot") return services.boot(params.target);
  if (method === "theme.get") return themeState || getDefaultTheme();
  if (method === "theme.apply") {
    themeState = await loadThemeFromVfs(vfs, journal);
    applyTheme(themeState);
    return themeState;
  }
  if (method === "theme.set") {
    themeState = normalizeTheme({ ...(themeState || getDefaultTheme()), [params.key]: params.value });
    await saveThemeToVfs(vfs, themeState);
    applyTheme(themeState);
    return themeState;
  }
  if (method === "theme.setMany") {
    themeState = normalizeTheme({ ...(themeState || getDefaultTheme()), ...(params.values || {}) });
    await saveThemeToVfs(vfs, themeState);
    applyTheme(themeState);
    return themeState;
  }
  if (method === "theme.fetchImage") {
    const dataUrl = await fetchImageAsDataUrl(params.url);
    const current = themeState || getDefaultTheme();
    const next = { ...current, backgroundImage: dataUrl };
    if (current.backgroundOpacity === 1) next.backgroundOpacity = 0.85;
    if (current.frameOpacity === 1) next.frameOpacity = 0.9;
    themeState = normalizeTheme(next);
    await saveThemeToVfs(vfs, themeState);
    applyTheme(themeState);
    return themeState;
  }
  if (method === "theme.reset") {
    themeState = getDefaultTheme();
    await saveThemeToVfs(vfs, themeState);
    applyTheme(themeState);
    return themeState;
  }
  throw new Error(`Unknown RPC method: ${method}`);
}

function createSession(id) {
  const session = {
    id,
    name: `tty${id}`,
    buffer: [],
    prompt: "",
    input: "",
    acceptingInput: false,
    state: id === 7 ? "disabled" : "boot",
    commandRunning: false,
    rawMode: false,
    history: [],
    historyIndex: null,
    historyTemp: "",
    workerProcess: null,
    pty: null,
    pendingPrompt: "",
  };
  return session;
}

function getSession(id) {
  return ttySessions[id] || null;
}

function isActive(session) {
  return session && session.id === activeTty;
}

function addLine(session, text, opts = {}) {
  if (!session) return;
  const entry = {
    text: text == null ? "" : String(text),
    dim: !!opts.dim,
  };
  session.buffer.push(entry);
  if (isActive(session)) {
    terminal.println(entry.text, { dim: entry.dim });
  }
}

function clearSession(session) {
  if (!session) return;
  session.buffer = [];
  if (isActive(session)) terminal.clear();
}

function setLoginPrompt(session) {
  if (!session) return;
  session.prompt = "toynix login: ";
  session.input = "";
  session.acceptingInput = true;
  if (isActive(session)) {
    terminal.setPrompt(session.prompt);
    terminal.setInputValue("");
    terminal.setInputEnabled(true);
  }
}

function setSessionPrompt(session, prompt) {
  if (!session) return;
  session.prompt = prompt || "";
  if (session.state === "shell") {
    session.acceptingInput = true;
    session.commandRunning = false;
  }
  if (isActive(session)) {
    terminal.setPrompt(session.prompt);
    terminal.setInputEnabled(true);
  }
}

function saveTerminalState(session) {
  if (!session) return;
  session.prompt = terminal.prompt;
  session.input = terminal.input;
  session.acceptingInput = terminal.acceptingInput;
  session.history = terminal.history.slice();
  session.historyIndex = terminal.historyIndex;
  session.historyTemp = terminal.historyTemp;
}

function restoreTerminalState(session) {
  if (!session) return;
  terminal.clear();
  session.buffer.forEach((line) => terminal.println(line.text, { dim: line.dim }));
  terminal.setPrompt(session.prompt || "");
  terminal.setInputValue(session.input || "");
  terminal.history = session.history.slice();
  terminal.historyIndex = session.historyIndex;
  terminal.historyTemp = session.historyTemp || "";
  terminal.setInputEnabled(!!session.acceptingInput);
  applyRawHandler(session);
}

function applyRawHandler(session) {
  if (!isActive(session) || !session) return;
  if (!session.rawMode || !session.workerProcess) {
    terminal.setRawKeyHandler(null);
    return;
  }
  terminal.setRawKeyHandler((event) => {
    event.preventDefault();
    if (event.ctrlKey && event.key.toLowerCase() === "z") {
      session.workerProcess.worker.postMessage({ type: "stop" });
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      session.workerProcess.worker.postMessage({ type: "interrupt" });
      return;
    }
    session.workerProcess.worker.postMessage({
      type: "raw-key",
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
    });
  });
}

function makeSessionTerminal(session) {
  return {
    println(text, opts) {
      addLine(session, text, opts);
    },
    print(text, opts) {
      addLine(session, text, opts);
    },
    clear() {
      clearSession(session);
    },
    setPrompt(prompt) {
      session.prompt = prompt || "";
      if (isActive(session)) terminal.setPrompt(session.prompt);
    },
    setInputEnabled(enabled) {
      session.acceptingInput = !!enabled;
      if (isActive(session)) terminal.setInputEnabled(!!enabled);
    },
    setRawKeyHandler(handler) {
      if (isActive(session)) terminal.setRawKeyHandler(handler);
    },
  };
}

async function handleUserlandMessage({ vfs, journal, kernel, services }, session, payload, process) {
  if (payload.type === "pty") {
    session.pty?.write(payload.data || "");
    return;
  }
  if (payload.type === "log") {
    await journal.log({
      source: session.name,
      level: payload.level || "info",
      message: payload.message || "",
    });
    return;
  }
  if (payload.type === "clear") {
    clearSession(session);
    return;
  }
  if (payload.type === "prompt") {
    session.pendingPrompt = payload.value || "";
    if (session.state === "shell") {
      setSessionPrompt(session, session.pendingPrompt);
    }
    return;
  }
  if (payload.type === "raw-mode") {
    session.rawMode = !!payload.enabled;
    if (isActive(session)) applyRawHandler(session);
    return;
  }
  if (payload.type === "tty-raw-write") {
    addLine(session, payload.data || "");
    return;
  }
  if (payload.type === "tty-line") {
    if (isActive(session)) terminal.sendCanonicalLine(payload.line || "");
    return;
  }
  if (payload.type === "complete") {
    if (!isActive(session)) return;
    const replacement = payload.replacement || "";
    const suggestions = payload.suggestions || [];
    terminal.setInputEnabled(false);
    if (suggestions.length > 1) {
      terminal.println(suggestions.join("  "));
    }
    terminal.setInputValue(replacement);
    terminal.setInputEnabled(true);
    return;
  }
  if (payload.type === "rpc") {
    let result = null;
    let error = null;
    try {
      result = await handleRpc({ vfs, journal, kernel, services }, payload);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    process.worker.postMessage({
      type: "rpc-res",
      id: payload.id,
      result,
      error,
    });
    return;
  }
}

function updateTtyUI() {
  if (ttyActiveEl) ttyActiveEl.textContent = `tty${activeTty}`;
  ttyTabs.forEach((tab) => {
    const isActive = tab.dataset.tty === `tty${activeTty}`;
    tab.classList.toggle("is-active", isActive);
    if (isActive) tab.setAttribute("aria-pressed", "true");
    else tab.removeAttribute("aria-pressed");
  });
}

function switchToTty(id) {
  if (!bootComplete) return;
  const next = getSession(id);
  if (!next || id === activeTty) return;
  const current = getSession(activeTty);
  saveTerminalState(current);
  activeTty = id;
  updateTtyUI();
  if (next.state !== "disabled") {
    next.acceptingInput = next.state === "login" || (next.state === "shell" && !next.commandRunning);
  } else {
    next.acceptingInput = false;
  }
  if (next.state === "disabled" && !next.buffer.length) {
    addLine(next, "tty7: graphical session not started.", { dim: true });
    addLine(next, "Use the TTY bar to switch back.", { dim: true });
  }
  restoreTerminalState(next);
}

function getDefaultTheme() {
  return {
    textColor: "#d2d2d2",
    mutedColor: "#7a7a7a",
    accentColor: "#00c08b",
    promptColor: "#d2d2d2",
    cursorColor: "#d2d2d2",
    backgroundColor: "#000000",
    backgroundImage: "",
    backgroundOpacity: 1,
    frameOpacity: 1,
    frameBlur: 0,
    blur: 0,
    fontFamily: "\"Fira Mono\", \"Cascadia Mono\", \"Consolas\", \"Menlo\", \"Monaco\", monospace",
    fontSize: "15px",
    lineHeight: 1.35,
    barColor: "#0b0b0b",
    barBorder: "#1c1c1c",
  };
}

function normalizeTheme(theme) {
  const base = getDefaultTheme();
  const next = { ...base, ...(theme || {}) };
  next.backgroundOpacity = toNumberOr(next.backgroundOpacity, base.backgroundOpacity);
  next.frameOpacity = toNumberOr(next.frameOpacity, base.frameOpacity);
  next.frameBlur = toNumberOr(next.frameBlur, base.frameBlur);
  next.blur = toNumberOr(next.blur, base.blur);
  next.lineHeight = toNumberOr(next.lineHeight, base.lineHeight);
  return next;
}

async function loadThemeFromVfs(vfs, journal) {
  try {
    await vfs.mkdirp("/home/user/.config/toynix");
    const raw = await vfs.readFile(THEME_PATH);
    if (!raw) {
      const defaults = getDefaultTheme();
      await saveThemeToVfs(vfs, defaults);
      return defaults;
    }
    const parsed = JSON.parse(raw);
    return normalizeTheme(parsed);
  } catch (err) {
    await journal?.log({
      source: "theme",
      level: "warn",
      message: "Failed to parse theme config, using defaults.",
    });
    return getDefaultTheme();
  }
}

async function saveThemeToVfs(vfs, theme) {
  const payload = JSON.stringify(theme, null, 2);
  await vfs.mkdirp("/home/user/.config/toynix");
  await vfs.writeFile(THEME_PATH, payload);
}

function applyTheme(theme) {
  const root = document.documentElement;
  const body = document.body;
  root.style.setProperty("--fg", theme.textColor);
  root.style.setProperty("--muted", theme.mutedColor);
  root.style.setProperty("--accent", theme.accentColor);
  root.style.setProperty("--prompt", theme.promptColor);
  root.style.setProperty("--cursor", theme.cursorColor);
  root.style.setProperty("--bar", theme.barColor);
  root.style.setProperty("--bar-border", theme.barBorder);
  root.style.setProperty("--font", theme.fontFamily);
  root.style.setProperty("--font-size", theme.fontSize);
  root.style.setProperty("--line-height", String(theme.lineHeight));
  root.style.setProperty("--bg", theme.backgroundColor);
  const bgImage = normalizeBackgroundImage(theme.backgroundImage);
  root.style.setProperty("--page-bg", theme.backgroundColor);
  root.style.setProperty("--page-bg-image", bgImage);
  root.style.setProperty("--terminal-bg", resolveTerminalBg(theme.backgroundColor, theme.backgroundOpacity));
  root.style.setProperty("--terminal-blur", `${theme.blur}px`);
  root.style.setProperty("--frame-bg", resolveTerminalBg(theme.backgroundColor, theme.frameOpacity));
  root.style.setProperty("--frame-blur", `${theme.frameBlur}px`);
  root.style.setProperty("--frame-bg-image", bgImage);
  root.style.setProperty("--frame-border", theme.barBorder || "#1c1c1c");

  const backgroundColor = theme.backgroundColor || "#000000";
  root.style.backgroundColor = backgroundColor;
  if (body) body.style.backgroundColor = backgroundColor;
  if (bgImage === "none") {
    root.style.backgroundImage = "none";
    if (body) body.style.backgroundImage = "none";
  } else {
    root.style.backgroundImage = bgImage;
    if (body) body.style.backgroundImage = bgImage;
    root.style.backgroundSize = "cover";
    root.style.backgroundPosition = "center";
    if (body) {
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
    }
  }
}

function normalizeBackgroundImage(value) {
  if (!value) return "none";
  if (value.startsWith("url(")) return value;
  return `url("${value}")`;
}

function resolveTerminalBg(color, opacity) {
  const clamped = Math.min(1, Math.max(0, Number(opacity)));
  if (!color) return `rgba(0, 0, 0, ${clamped})`;
  const rgb = hexToRgb(color);
  if (!rgb) {
    if (clamped >= 0.99) return color;
    return `rgba(0, 0, 0, ${clamped})`;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
}


function toNumberOr(value, fallback) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function hexToRgb(input) {
  const hex = String(input).trim().replace("#", "");
  if (hex.length !== 3 && hex.length !== 6) return null;
  const full = hex.length === 3
    ? hex.split("").map((ch) => ch + ch).join("")
    : hex;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

async function fetchImageAsDataUrl(url) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

ttyTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const raw = tab.dataset.tty || "";
    const num = Number(raw.replace("tty", ""));
    if (Number.isNaN(num)) return;
    switchToTty(num);
  });
});
