function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pause(ctx) {
  if (!ctx.input || !ctx.input.readKey) return true;
  if (ctx.input.setRawMode) ctx.input.setRawMode(true);
  try {
    for (;;) {
      const key = await ctx.input.readKey();
      if (!key) continue;
      const isEnter = key.key === "Enter" || key.code === "Enter";
      const isQuit = key.key === "q" || key.key === "Q";
      if (isQuit) return false;
      if (isEnter) return true;
    }
  } finally {
    if (ctx.input && ctx.input.setRawMode) ctx.input.setRawMode(false);
  }
}

async function waitStep(ctx, fast) {
  if (fast) return true;
  ctx.io.println("");
  ctx.io.println("Press Enter to continue, or q to quit the tour.");
  const ok = await pause(ctx);
  if (ok) ctx.io.clear();
  return ok;
}

async function runCommand(ctx, cmd) {
  ctx.io.println(`${ctx.shell.getPrompt()}${cmd}`);
  await ctx.shell.runLine(cmd, ctx.io, ctx.signal);
}

export async function run(ctx, args = []) {
  const fast = args.includes("--fast") || args.includes("-f");

  ctx.io.println("Toynix tour: quick walkthrough of the essentials.");
  if (!(await waitStep(ctx, fast))) return 0;

  await runCommand(ctx, "whoami");
  await runCommand(ctx, "hostname");
  await runCommand(ctx, "uname -a");

  if (!(await waitStep(ctx, fast))) return 0;

  await runCommand(ctx, "pwd");
  await runCommand(ctx, "ls");
  await runCommand(ctx, "cd /");
  await runCommand(ctx, "ls");
  await runCommand(ctx, "cd /home/user");

  if (!(await waitStep(ctx, fast))) return 0;

  await runCommand(ctx, "date");
  await runCommand(ctx, "uptime");
  await runCommand(ctx, "df");
  await runCommand(ctx, "free");

  if (!(await waitStep(ctx, fast))) return 0;

  await runCommand(ctx, "theme show");

  if (!(await waitStep(ctx, fast))) return 0;

  await runCommand(ctx, "dmesg | head -n 5");
  await runCommand(ctx, "journalctl -n 5");

  if (!(await waitStep(ctx, fast))) return 0;

  await runCommand(ctx, "neofetch");

  if (!fast) {
    await sleep(200);
  }

  ctx.io.println("Tour complete. Type help to explore more commands.");
  return 0;
}
