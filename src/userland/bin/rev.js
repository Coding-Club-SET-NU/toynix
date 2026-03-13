export async function run(ctx, args) {
  const input = args.length ? args.join(" ") : (ctx.stdin || "");
  const lines = input.split("\n");
  lines.forEach((line) => {
    ctx.io.println(line.split("").reverse().join(""));
  });
}
