export async function run(ctx) {
  const uptime = ctx.kernel ? await ctx.kernel.getUptimeSeconds() : 0;
  const meminfo = await ctx.fs.readFile("/proc/meminfo");
  const cpuinfo = await ctx.fs.readFile("/proc/cpuinfo");
  const hostname = (await ctx.fs.readFile("/etc/hostname")) || "toynix\n";

  ctx.io.println("Toynix Web System Info");
  ctx.io.println(`Hostname: ${hostname.trim()}`);
  ctx.io.println(`Uptime: ${uptime}s`);
  if (meminfo) {
    ctx.io.println(meminfo.trimEnd());
  }
  if (cpuinfo) {
    const first = cpuinfo.split("\n\n")[0];
    ctx.io.println(first.trimEnd());
  }
}
