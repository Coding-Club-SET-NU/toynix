export async function run(ctx, args) {
  const text = args.length ? args.join(" ") : "toilet";
  const line = "#".repeat(text.length + 6);
  ctx.io.println(line);
  ctx.io.println(`## ${text} ##`);
  ctx.io.println(line);
}
