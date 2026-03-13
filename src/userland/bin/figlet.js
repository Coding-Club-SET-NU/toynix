export async function run(ctx, args) {
  const text = args.length ? args.join(" ") : "figlet";
  const top = text.toUpperCase();
  const border = "=".repeat(top.length + 4);
  ctx.io.println(border);
  ctx.io.println(`| ${top} |`);
  ctx.io.println(border);
}
