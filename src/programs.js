export function registerBuiltinPrograms(registry) {
  registry.register("help", async (ctx) => {
    ctx.io.println("Built-ins: ls cd pwd cat echo clear help whoami uname date uptime ps journalctl dmesg mkdir touch write");
    ctx.io.println("Built-ins: env export history grep head tail wc sleep kill status id groups stat chmod chown motd rm cp mv which");
    ctx.io.println("Built-ins: hostname df du free theme");
    ctx.io.println("Shell: jobs fg bg man");
    ctx.io.println("System: systemctl");
    ctx.io.println("External: sysinfo neofetch cowsay rev cmatrix pipes rig oneko top fortune toilet figlet nano tour");
  });

  registry.register("ls", async (ctx, args) => {
    let target = ".";
    let showAll = false;
    let longMode = false;
    for (const arg of args) {
      if (arg === "-a") {
        showAll = true;
      } else if (arg === "-l") {
        longMode = true;
      } else {
        target = arg;
      }
    }
    const resolved = ctx.fs.resolveWithCwd(ctx.shell.cwd, target);
    const list = await ctx.fs.list(resolved);
    if (!list) {
      ctx.io.println(`ls: cannot access '${target}': No such directory`);
      return 2;
    }
    const filtered = showAll ? list : list.filter((name) => !name.startsWith("."));
    if (!longMode) {
      ctx.io.println(filtered.join("  "));
      return 0;
    }
    for (const name of filtered) {
      const path = ctx.fs.resolveWithCwd(resolved, name);
      const stat = await ctx.fs.stat(path);
      if (!stat) continue;
      const perms = formatMode(stat);
      const size = stat.type === "dir" ? 0 : (await ctx.fs.readFile(path))?.length || 0;
      const stamp = new Date(stat.mtime).toLocaleString();
      ctx.io.println(`${perms} ${stat.uid}:${stat.gid} ${String(size).padStart(6)} ${stamp} ${name}`);
    }
    return 0;
  });

  registry.register("cd", async (ctx, args) => {
    const target = args[0] || ctx.shell.home;
    const resolvedTarget = target === "-" ? ctx.shell.prevCwd : target;
    const resolved = ctx.fs.resolveWithCwd(ctx.shell.cwd, resolvedTarget);
    if (!(await ctx.fs.isDir(resolved))) {
      ctx.io.println(`cd: ${target}: No such directory`);
      return 1;
    }
    ctx.shell.setCwd(resolved);
    return 0;
  });

  registry.register("pwd", async (ctx) => {
    ctx.io.println(ctx.shell.cwd);
    return 0;
  });

  registry.register("status", async (ctx) => {
    ctx.io.println(String(ctx.shell.lastStatus));
    return 0;
  });

  registry.register("cat", async (ctx, args) => {
    if (!args.length) {
      if (ctx.stdin) {
        ctx.io.println(ctx.stdin.trimEnd());
        return 0;
      }
      ctx.io.println("cat: missing operand");
      return 1;
    }
    for (const name of args) {
      const resolved = ctx.fs.resolveWithCwd(ctx.shell.cwd, name);
      const content = await ctx.fs.readFile(resolved);
      if (content === null) {
        ctx.io.println(`cat: ${name}: No such file`);
        return 1;
      }
      ctx.io.println(content.trimEnd());
    }
    return 0;
  });

  registry.register("echo", async (ctx, args) => {
    ctx.io.println(args.join(" "));
    return 0;
  });

  registry.register("clear", async (ctx) => {
    ctx.io.clear();
    return 0;
  });

  registry.register("whoami", async (ctx) => {
    ctx.io.println(ctx.shell.username);
    return 0;
  });

  registry.register("uname", async (ctx) => {
    const args = ctx.args || [];
    if (args && args.includes("-a")) {
      ctx.io.println("Linux toynix 6.x-web #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux");
    } else {
      ctx.io.println("Linux");
    }
    return 0;
  });

  registry.register("date", async (ctx) => {
    const args = ctx.args || [];
    if (args && args.includes("-u")) {
      ctx.io.println(new Date().toUTCString());
    } else {
      ctx.io.println(new Date().toString());
    }
    return 0;
  });

  registry.register("hostname", async (ctx) => {
    const hostname = await ctx.fs.readFile("/etc/hostname");
    ctx.io.println((hostname || "toynix").trim());
    return 0;
  });

  registry.register("uptime", async (ctx) => {
    const seconds = ctx.kernel ? await ctx.kernel.getUptimeSeconds() : 0;
    if (ctx.args && ctx.args.includes("-p")) {
      ctx.io.println(formatUptime(seconds));
    } else {
      ctx.io.println(`up ${seconds}s`);
    }
    return 0;
  });

  registry.register("ps", async (ctx) => {
    if (!ctx.kernel) return;
    const processes = await ctx.kernel.listProcesses();
    ctx.io.println("PID   USER     TYPE      STATUS   NAME");
    processes.forEach((proc) => {
      ctx.io.println(`${String(proc.pid).padEnd(5)} ${String(proc.user || "root").padEnd(8)} ${proc.type.padEnd(9)} ${proc.status.padEnd(8)} ${proc.name}`);
    });
    return 0;
  });

  registry.register("id", async (ctx) => {
    const passwd = await ctx.fs.readFile("/etc/passwd");
    if (!passwd) {
      ctx.io.println("id: cannot read /etc/passwd");
      return 1;
    }
    const entry = passwd.split("\n").find((line) => line.startsWith(`${ctx.shell.username}:`));
    if (!entry) {
      ctx.io.println(`id: ${ctx.shell.username}: no such user`);
      return 1;
    }
    const parts = entry.split(":");
    const uid = parts[2];
    const gid = parts[3];
    ctx.io.println(`uid=${uid}(${ctx.shell.username}) gid=${gid}(${ctx.shell.username})`);
    return 0;
  });

  registry.register("groups", async (ctx) => {
    const group = await ctx.fs.readFile("/etc/group");
    if (!group) {
      ctx.io.println("groups: cannot read /etc/group");
      return 1;
    }
    const groups = [];
    group.split("\n").forEach((line) => {
      const [name, , , members] = line.split(":");
      if (!name) return;
      if (!members) return;
      if (members.split(",").includes(ctx.shell.username)) {
        groups.push(name);
      }
      if (name === ctx.shell.username) groups.push(name);
    });
    ctx.io.println(groups.length ? groups.join(" ") : ctx.shell.username);
    return 0;
  });

  registry.register("journalctl", async (ctx) => {
    const content = await ctx.fs.readFile("/var/log/journal/boot.journal");
    if (!content) {
      ctx.io.println("No journal entries.");
      return 1;
    }
    const args = ctx.args || [];
    const nIndex = args.indexOf("-n");
    if (nIndex >= 0 && args[nIndex + 1]) {
      const count = Number(args[nIndex + 1]);
      const lines = content.trimEnd().split("\n");
      ctx.io.println(lines.slice(-count).join("\n"));
      return 0;
    }
    ctx.io.println(content.trimEnd());
    return 0;
  });

  registry.register("dmesg", async (ctx) => {
    if (!ctx.kernel) return;
    const lines = await ctx.kernel.getKernelLogs();
    if (!lines.length) {
      ctx.io.println("dmesg: kernel ring buffer empty");
      return 1;
    }
    lines.forEach((line) => ctx.io.println(line));
    return 0;
  });

  registry.register("mkdir", async (ctx, args) => {
    if (!args.length) {
      ctx.io.println("mkdir: missing operand");
      return 1;
    }
    for (const name of args) {
      if (name === "-p") continue;
      const resolved = ctx.fs.resolveWithCwd(ctx.shell.cwd, name);
      await ctx.fs.mkdirp(resolved);
    }
    return 0;
  });

  registry.register("touch", async (ctx, args) => {
    if (!args.length) {
      ctx.io.println("touch: missing file operand");
      return 1;
    }
    for (const name of args) {
      const resolved = ctx.fs.resolveWithCwd(ctx.shell.cwd, name);
      const exists = await ctx.fs.exists(resolved);
      if (!exists) {
        await ctx.fs.writeFile(resolved, "");
      }
    }
    return 0;
  });

  registry.register("write", async (ctx, args) => {
    if (args.length < 2) {
      ctx.io.println("write: usage: write <file> <text...>");
      return 1;
    }
    const [file, ...rest] = args;
    const resolved = ctx.fs.resolveWithCwd(ctx.shell.cwd, file);
    await ctx.fs.writeFile(resolved, `${rest.join(" ")}\n`);
    return 0;
  });

  registry.register("stat", async (ctx, args) => {
    if (!args.length) {
      ctx.io.println("stat: missing file operand");
      return 1;
    }
    for (const name of args) {
      const path = ctx.fs.resolveWithCwd(ctx.shell.cwd, name);
      const stat = await ctx.fs.stat(path);
      if (!stat) {
        ctx.io.println(`stat: cannot stat '${name}'`);
        continue;
      }
      ctx.io.println(`  File: ${name}`);
      ctx.io.println(`  Type: ${stat.type}`);
      ctx.io.println(`  Mode: ${formatMode(stat)} (${stat.mode.toString(8)})`);
      ctx.io.println(`  Uid: ${stat.uid}  Gid: ${stat.gid}`);
      ctx.io.println(`Access: ${new Date(stat.atime).toLocaleString()}`);
      ctx.io.println(`Modify: ${new Date(stat.mtime).toLocaleString()}`);
      ctx.io.println(`Change: ${new Date(stat.ctime).toLocaleString()}`);
    }
    return 0;
  });

  registry.register("chmod", async (ctx, args) => {
    if (args.length < 2) {
      ctx.io.println("chmod: usage: chmod <mode> <file>");
      return 1;
    }
    const mode = Number.parseInt(args[0], 8);
    if (Number.isNaN(mode)) {
      ctx.io.println("chmod: invalid mode");
      return 1;
    }
    for (const name of args.slice(1)) {
      const path = ctx.fs.resolveWithCwd(ctx.shell.cwd, name);
      const ok = await ctx.fs.chmod(path, mode);
      if (!ok) ctx.io.println(`chmod: cannot access '${name}'`);
    }
    return 0;
  });

  registry.register("chown", async (ctx, args) => {
    if (args.length < 2) {
      ctx.io.println("chown: usage: chown <uid>:<gid> <file>");
      return 1;
    }
    const [owner, ...files] = args;
    const [uidStr, gidStr] = owner.split(":");
    const uid = Number(uidStr);
    const gid = Number(gidStr);
    if (Number.isNaN(uid) || Number.isNaN(gid)) {
      ctx.io.println("chown: invalid uid:gid");
      return 1;
    }
    for (const name of files) {
      const path = ctx.fs.resolveWithCwd(ctx.shell.cwd, name);
      const ok = await ctx.fs.chown(path, uid, gid);
      if (!ok) ctx.io.println(`chown: cannot access '${name}'`);
    }
    return 0;
  });

  registry.register("sleep", async (ctx, args) => {
    const seconds = Number(args[0]);
    if (Number.isNaN(seconds)) {
      ctx.io.println("sleep: invalid time interval");
      return 1;
    }
    const totalMs = seconds * 1000;
    let elapsed = 0;
    const step = 100;
    while (elapsed < totalMs) {
      if (ctx.signal?.isInterrupted()) return 130;
      if (ctx.signal?.isStopped && ctx.signal.isStopped()) {
        await ctx.signal.waitIfStopped?.();
      }
      const wait = Math.min(step, totalMs - elapsed);
      await new Promise((resolve) => setTimeout(resolve, wait));
      elapsed += wait;
    }
    return 0;
  });

  registry.register("kill", async (ctx, args) => {
    const pid = Number(args[0]);
    if (Number.isNaN(pid)) {
      ctx.io.println("kill: usage: kill <pid>");
      return 1;
    }
    if (!ctx.kernel || !ctx.kernel.kill) {
      ctx.io.println("kill: kernel unavailable");
      return 1;
    }
    const ok = await ctx.kernel.kill(pid);
    return ok ? 0 : 1;
  });

  registry.register("systemctl", async (ctx, args) => {
    if (!ctx.kernel || !ctx.kernel.listUnits) {
      ctx.io.println("systemctl: service manager unavailable");
      return 1;
    }
    const command = args[0] || "list-units";
    if (command === "list-units") {
      const units = await ctx.kernel.listUnits();
      ctx.io.println("UNIT                          LOAD   ACTIVE   SUB     DESCRIPTION");
      units.forEach((unit) => {
        const name = String(unit.name).padEnd(30);
        const active = String(unit.active).padEnd(7);
        const sub = String(unit.sub).padEnd(7);
        ctx.io.println(`${name} loaded ${active} ${sub} ${unit.description || ""}`);
      });
      return 0;
    }
    if (command === "status") {
      const name = args[1];
      if (!name) {
        ctx.io.println("systemctl status <unit>");
        return 1;
      }
      const status = await ctx.kernel.statusUnit(name);
      if (!status) {
        ctx.io.println(`Unit ${name} not found.`);
        return 1;
      }
      ctx.io.println(`${status.name} - ${status.description}`);
      ctx.io.println(`   Active: ${status.active} (${status.sub})`);
      if (status.pid) ctx.io.println(`   Main PID: ${status.pid}`);
      return 0;
    }
    if (command === "start") {
      const name = args[1];
      if (!name) {
        ctx.io.println("systemctl start <unit>");
        return 1;
      }
      const ok = await ctx.kernel.startUnit(name);
      return ok ? 0 : 1;
    }
    if (command === "stop") {
      const name = args[1];
      if (!name) {
        ctx.io.println("systemctl stop <unit>");
        return 1;
      }
      const ok = await ctx.kernel.stopUnit(name);
      return ok ? 0 : 1;
    }
    ctx.io.println(`systemctl: unknown command ${command}`);
    return 1;
  });

  registry.register("env", async (ctx) => {
    ctx.shell.env.forEach((value, key) => {
      ctx.io.println(`${key}=${value}`);
    });
    return 0;
  });

  registry.register("export", async (ctx, args) => {
    if (!args.length) {
      ctx.shell.env.forEach((value, key) => {
        ctx.io.println(`${key}=${value}`);
      });
      return 0;
    }
    for (const arg of args) {
      const [key, ...rest] = arg.split("=");
      ctx.shell.env.set(key, rest.join("="));
    }
    return 0;
  });

  registry.register("history", async (ctx) => {
    ctx.shell.history.forEach((entry, index) => {
      ctx.io.println(`${String(index + 1).padStart(4)}  ${entry}`);
    });
    return 0;
  });

  registry.register("grep", async (ctx, args) => {
    const flags = args.filter((arg) => arg.startsWith("-"));
    const pattern = args.find((arg) => !arg.startsWith("-"));
    const files = args.filter((arg) => arg !== pattern && !arg.startsWith("-"));
    if (!pattern) {
      ctx.io.println("grep: missing pattern");
      return 2;
    }
    const useInsensitive = flags.includes("-i");
    const regex = new RegExp(pattern, useInsensitive ? "i" : "");
    const inputs = await collectInputs(ctx, files);
    inputs.forEach((input) => {
      input.split("\n").forEach((line) => {
        if (regex.test(line)) ctx.io.println(line);
      });
    });
    return 0;
  });

  registry.register("head", async (ctx, args) => {
    const { count, files } = parseCountArgs(args);
    const inputs = await collectInputs(ctx, files);
    inputs.forEach((input) => {
      const lines = input.split("\n").slice(0, count);
      lines.forEach((line) => ctx.io.println(line));
    });
    return 0;
  });

  registry.register("tail", async (ctx, args) => {
    const follow = args.includes("-f");
    const { count, files } = parseCountArgs(args.filter((arg) => arg !== "-f"));
    if (follow && files.length) {
      const path = ctx.fs.resolveWithCwd(ctx.shell.cwd, files[0]);
      let lastLength = 0;
      for (;;) {
        if (ctx.signal?.isInterrupted()) return 130;
        if (ctx.signal?.isStopped && ctx.signal.isStopped()) {
          await ctx.signal.waitIfStopped?.();
        }
        const content = (await ctx.fs.readFile(path)) || "";
        if (content.length > lastLength) {
          const delta = content.slice(lastLength);
          delta.split("\n").forEach((line) => {
            if (line.length) ctx.io.println(line);
          });
          lastLength = content.length;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const inputs = await collectInputs(ctx, files);
    inputs.forEach((input) => {
      const lines = input.split("\n").slice(-count);
      lines.forEach((line) => ctx.io.println(line));
    });
    return 0;
  });

  registry.register("wc", async (ctx, args) => {
    const inputs = await collectInputs(ctx, args);
    inputs.forEach((input) => {
      const lines = input.split("\n").filter((line) => line.length);
      const words = input.trim().split(/\s+/).filter(Boolean);
      const bytes = new TextEncoder().encode(input).length;
      ctx.io.println(`${lines.length} ${words.length} ${bytes}`);
    });
    return 0;
  });

  registry.register("motd", async (ctx) => {
    const motd = await ctx.fs.readFile("/usr/share/motd");
    if (!motd) {
      ctx.io.println("motd: not found");
      return 1;
    }
    ctx.io.println(motd.trimEnd());
    return 0;
  });

  registry.register("rm", async (ctx, args) => {
    if (!args.length) {
      ctx.io.println("rm: missing operand");
      return 1;
    }
    const recursive = args.includes("-r") || args.includes("-rf") || args.includes("-R");
    const targets = args.filter((arg) => !arg.startsWith("-"));
    for (const name of targets) {
      const path = ctx.fs.resolveWithCwd(ctx.shell.cwd, name);
      const ok = await ctx.fs.remove(path, recursive);
      if (!ok) ctx.io.println(`rm: cannot remove '${name}'`);
    }
    return 0;
  });

  registry.register("cp", async (ctx, args) => {
    if (args.length < 2) {
      ctx.io.println("cp: missing file operand");
      return 1;
    }
    const recursive = args.includes("-r") || args.includes("-R");
    const files = args.filter((arg) => !arg.startsWith("-"));
    const dest = files.pop();
    for (const src of files) {
      const srcPath = ctx.fs.resolveWithCwd(ctx.shell.cwd, src);
      const destPath = ctx.fs.resolveWithCwd(ctx.shell.cwd, dest);
      const isDir = await ctx.fs.isDir(srcPath);
      if (isDir && !recursive) {
        ctx.io.println(`cp: -r not specified; omitting directory '${src}'`);
        continue;
      }
      await ctx.fs.copy(srcPath, destPath);
    }
    return 0;
  });

  registry.register("mv", async (ctx, args) => {
    if (args.length < 2) {
      ctx.io.println("mv: missing file operand");
      return 1;
    }
    const files = args.filter((arg) => !arg.startsWith("-"));
    const dest = files.pop();
    for (const src of files) {
      const srcPath = ctx.fs.resolveWithCwd(ctx.shell.cwd, src);
      const destPath = ctx.fs.resolveWithCwd(ctx.shell.cwd, dest);
      await ctx.fs.move(srcPath, destPath);
    }
    return 0;
  });

  registry.register("which", async (ctx, args) => {
    if (!args.length) {
      ctx.io.println("which: missing operand");
      return 1;
    }
    for (const name of args) {
      const paths = (ctx.shell.env.get("PATH") || "/usr/bin").split(":");
      let found = false;
      for (const prefix of paths) {
        const candidate = ctx.fs.resolveWithCwd("/", `${prefix}/${name}`);
        if (await ctx.fs.exists(candidate)) {
          ctx.io.println(candidate);
          found = true;
          break;
        }
      }
      if (!found) ctx.io.println(`${name} not found`);
    }
    return 0;
  });

  registry.register("df", async (ctx) => {
    const total = Math.floor((navigator.deviceMemory || 8) * 1024 * 1024);
    const used = Math.floor(total * 0.35);
    const avail = total - used;
    ctx.io.println("Filesystem     1K-blocks   Used   Available  Use%  Mounted on");
    ctx.io.println(`webfs          ${total}  ${used}  ${avail}  35%  /`);
    ctx.io.println(`homefs         ${total}  ${used}  ${avail}  35%  /home`);
    return 0;
  });

  registry.register("du", async (ctx, args) => {
    const human = args.includes("-h");
    const summarize = args.includes("-s");
    const targets = args.filter((arg) => !arg.startsWith("-"));
    const list = targets.length ? targets : ["."];
    for (const target of list) {
      const path = ctx.fs.resolveWithCwd(ctx.shell.cwd, target);
      const sizeBytes = await getSize(ctx, path);
      const sizeBlocks = Math.ceil(sizeBytes / 1024);
      const label = human ? formatSize(sizeBytes) : String(sizeBlocks);
      ctx.io.println(`${label}\t${summarize ? target : path}`);
      if (!summarize && await ctx.fs.isDir(path)) {
        const entries = await ctx.fs.list(path);
        if (entries) {
          for (const name of entries) {
            const child = ctx.fs.resolveWithCwd(path, name);
            const childSizeBytes = await getSize(ctx, child);
            const childBlocks = Math.ceil(childSizeBytes / 1024);
            const childLabel = human ? formatSize(childSizeBytes) : String(childBlocks);
            ctx.io.println(`${childLabel}\t${child}`);
          }
        }
      }
    }
    return 0;
  });

  registry.register("free", async (ctx) => {
    const meminfo = await ctx.fs.readFile("/proc/meminfo");
    if (!meminfo) {
      ctx.io.println("free: cannot read /proc/meminfo");
      return 1;
    }
    const total = meminfo.split("\n").find((l) => l.startsWith("MemTotal"))?.split(/\s+/)[1] || "0";
    const free = meminfo.split("\n").find((l) => l.startsWith("MemFree"))?.split(/\s+/)[1] || "0";
    const used = Math.max(0, Number(total) - Number(free));
    ctx.io.println("              total        used        free");
    ctx.io.println(`Mem:    ${total.padStart(8)}    ${String(used).padStart(8)}    ${free.padStart(8)}`);
    return 0;
  });

  registry.register("man", async (ctx, args) => {
    const name = args[0];
    if (!name) {
      ctx.io.println("man: missing topic");
      return 1;
    }
    const path = ctx.fs.resolveWithCwd("/", `/usr/share/man/${name}.txt`);
    const content = await ctx.fs.readFile(path);
    if (!content) {
      ctx.io.println(`No manual entry for ${name}`);
      return 1;
    }
    ctx.io.println(content.trimEnd());
    return 0;
  });

  registry.register("theme", async (ctx, args) => {
    const command = args[0] || "show";
    if (!ctx.kernel || !ctx.kernel.getTheme) {
      ctx.io.println("theme: unavailable");
      return 1;
    }
    if (command === "show") {
      const theme = await ctx.kernel.getTheme();
      ctx.io.println(formatThemeForDisplay(theme));
      return 0;
    }
    if (command === "apply" || command === "load") {
      const theme = await ctx.kernel.applyTheme();
      ctx.io.println("theme: applied");
      ctx.io.println(formatThemeForDisplay(theme));
      return 0;
    }
    if (command === "reset") {
      const theme = await ctx.kernel.resetTheme();
      ctx.io.println("theme: reset");
      ctx.io.println(formatThemeForDisplay(theme));
      return 0;
    }
    if (command === "set") {
      const key = args[1];
      const value = args.slice(2).join(" ");
      if (!key || value === "") {
        ctx.io.println("theme set <key> <value>");
        return 1;
      }
      const parsed = parseThemeValue(key, value);
      await ctx.kernel.setTheme(key, parsed);
      ctx.io.println(`theme: ${key} updated`);
      return 0;
    }
    if (command === "fetch") {
      const url = args[1];
      if (!url) {
        ctx.io.println("theme fetch <url>");
        return 1;
      }
      await ctx.kernel.fetchThemeImage(url);
      ctx.io.println("theme: background image fetched");
      return 0;
    }
    if (command === "clear-image") {
      await ctx.kernel.setTheme("backgroundImage", "");
      ctx.io.println("theme: background image cleared");
      return 0;
    }
    ctx.io.println("theme: usage");
    ctx.io.println("  theme show");
    ctx.io.println("  theme set <key> <value>");
    ctx.io.println("  theme fetch <url>");
    ctx.io.println("  theme clear-image");
    ctx.io.println("  theme apply");
    ctx.io.println("  theme reset");
    return 1;
  });
}

function parseThemeValue(key, value) {
  const numericKeys = new Set(["backgroundOpacity", "blur", "lineHeight", "frameOpacity", "frameBlur"]);
  if (numericKeys.has(key)) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

function formatThemeForDisplay(theme) {
  if (!theme || typeof theme !== "object") {
    return JSON.stringify(theme, null, 2);
  }
  const output = { ...theme };
  if (typeof output.backgroundImage === "string" && output.backgroundImage.length) {
    const raw = output.backgroundImage;
    const kind = raw.startsWith("data:") ? "data-url" : "url";
    const preview = raw.length > 64 ? `${raw.slice(0, 48)}...${raw.slice(-12)}` : raw;
    output.backgroundImage = `${kind} (${raw.length} chars) ${preview}`;
  }
  return JSON.stringify(output, null, 2);
}

function formatMode(stat) {
  const mode = stat.mode || 0;
  const typeChar = stat.type === "dir" ? "d" : "-";
  const flags = ["r", "w", "x"];
  let perms = "";
  for (let i = 2; i >= 0; i -= 1) {
    const shift = i * 3;
    const bits = (mode >> shift) & 0b111;
    for (let j = 0; j < 3; j += 1) {
      perms += bits & (1 << (2 - j)) ? flags[j] : "-";
    }
  }
  return `${typeChar}${perms}`;
}

async function collectInputs(ctx, files) {
  if (!files.length) {
    return [ctx.stdin || ""];
  }
  const results = [];
  for (const name of files) {
    const resolved = ctx.fs.resolveWithCwd(ctx.shell.cwd, name);
    const content = await ctx.fs.readFile(resolved);
    results.push(content || "");
  }
  return results;
}

function parseCountArgs(args) {
  let count = 10;
  const files = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-n" && args[i + 1]) {
      count = Number(args[i + 1]);
      i += 1;
      continue;
    }
    files.push(args[i]);
  }
  return { count, files };
}

function formatUptime(seconds) {
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours % 24) parts.push(`${hours % 24} hour${hours % 24 === 1 ? "" : "s"}`);
  if (mins % 60) parts.push(`${mins % 60} min`);
  return `up ${parts.join(", ") || "0 min"}`;
}

async function getSize(ctx, path) {
  const isDir = await ctx.fs.isDir(path);
  if (!isDir) {
    const content = await ctx.fs.readFile(path);
    return content ? content.length : 0;
  }
  let total = 0;
  const entries = await ctx.fs.list(path);
  if (entries) {
    for (const name of entries) {
      total += await getSize(ctx, ctx.fs.resolveWithCwd(path, name));
    }
  }
  return total;
}

function formatSize(size) {
  const units = ["B", "K", "M", "G", "T"];
  let idx = 0;
  let value = size;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(1)}${units[idx]}`;
}
