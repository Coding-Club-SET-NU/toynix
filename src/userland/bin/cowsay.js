export async function run(ctx, args) {
  const text = args.length ? args.join(" ") : (ctx.stdin || "Hello from cowsay");
  const lines = text.split("\n");
  const width = Math.max(...lines.map((l) => l.length));
  const top = " " + "_".repeat(width + 2);
  const bottom = " " + "-".repeat(width + 2);
  ctx.io.println(top);
  lines.forEach((line) => {
    ctx.io.println(`| ${line.padEnd(width)} |`);
  });
  ctx.io.println(bottom);
  ctx.io.println("        \\   ^__^");
  ctx.io.println("         \\  (oo)\\_______");
  ctx.io.println("            (__)\\       )\\/\\");
  ctx.io.println("                ||----w |");
  ctx.io.println("                ||     ||");
}
