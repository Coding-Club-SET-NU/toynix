function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUptime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  const remMins = mins % 60;
  if (days) return `${days}d ${remHours}h ${remMins}m`;
  if (hours) return `${hours}h ${remMins}m`;
  return `${mins}m`;
}

function pad(value, width) {
  return String(value).padEnd(width).slice(0, width);
}

export async function run(ctx) {
  const cols = Number(ctx.shell.env.get("COLUMNS") || "80");
  const rows = Number(ctx.shell.env.get("LINES") || "24");
  const viewRows = Math.max(5, rows - 6);

  if (ctx.input && ctx.input.setRawMode) ctx.input.setRawMode(true);

  try {
    while (true) {
      if (ctx.signal?.isInterrupted()) return 130;
      if (ctx.signal?.isStopped && ctx.signal.isStopped()) {
        await ctx.signal.waitIfStopped?.();
      }
      const uptime = ctx.kernel ? await ctx.kernel.getUptimeSeconds() : 0;
      const loadavg = await ctx.fs.readFile("/proc/loadavg");
      const load = (loadavg || "0.00 0.00 0.00").split(" ").slice(0, 3).join(" ");
      const meminfo = await ctx.fs.readFile("/proc/meminfo");
      const total = meminfo?.match(/MemTotal:\s+(\d+)/)?.[1] || "0";
      const free = meminfo?.match(/MemFree:\s+(\d+)/)?.[1] || "0";
      const used = Math.max(0, Number(total) - Number(free));

      const processes = ctx.kernel ? await ctx.kernel.listProcesses() : [];
      const running = processes.filter((p) => p.status === "running").length;
      const sleeping = processes.length - running;

      ctx.io.clear();
      const now = new Date();
      ctx.io.println(`top - ${now.toLocaleTimeString()} up ${formatUptime(uptime)},  load average: ${load}`.slice(0, cols));
      ctx.io.println(`Tasks: ${processes.length} total, ${running} running, ${sleeping} sleeping`.slice(0, cols));
      ctx.io.println(`Mem: ${total}k total, ${used}k used, ${free}k free`.slice(0, cols));
      ctx.io.println("".padEnd(cols, "-"));
      const header = `${pad("PID", 6)} ${pad("USER", 8)} ${pad("STAT", 6)} ${pad("NAME", cols - 24)}`;
      ctx.io.println(header.slice(0, cols));

      const shown = processes.slice(0, viewRows);
      shown.forEach((proc) => {
        const line = `${pad(proc.pid, 6)} ${pad(proc.user || "root", 8)} ${pad(proc.status || "run", 6)} ${pad(proc.name, cols - 24)}`;
        ctx.io.println(line.slice(0, cols));
      });

      ctx.io.println("".padEnd(cols, "-"));
      ctx.io.println("Press q to quit".padEnd(cols).slice(0, cols));

      const key = ctx.input && ctx.input.tryReadKey ? ctx.input.tryReadKey() : null;
      if (key) {
        const isQuitKey = key.key === "q" || key.key === "Q" || key.code === "KeyQ" || key.key === "Escape";
        const isCtrlC = key.ctrl && key.key && key.key.toLowerCase() === "c";
        if (isQuitKey || isCtrlC) {
          return 0;
        }
      }
      await sleep(200);
    }
  } finally {
    if (ctx.input && ctx.input.setRawMode) ctx.input.setRawMode(false);
  }
}
