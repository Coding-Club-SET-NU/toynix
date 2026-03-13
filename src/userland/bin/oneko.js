export async function run(ctx, args) {
  const frames = [
    "(=^.^=)",
    "(=^.^=) ~",
    "~ (=^.^=)",
    "(=^.^=) ~~",
  ];
  for (let i = 0; i < 12; i += 1) {
    ctx.io.clear();
    ctx.io.println("oneko");
    ctx.io.println(frames[i % frames.length]);
    await new Promise((r) => setTimeout(r, 120));
  }
}
