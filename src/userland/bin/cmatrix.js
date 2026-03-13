const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*";

export async function run(ctx, args) {
  const width = Number(ctx.shell?.env?.get("COLUMNS")) || 80;
  const height = Number(ctx.shell?.env?.get("LINES")) || 30;
  const frames = 10000;
  const delay = 110;
  const cols = Array.from({ length: width }, () => Math.floor(Math.random() * height));

  // Clear once at the start to prep the canvas
  ctx.io.clear();

  for (let f = 0; f < frames; f += 1) {
    if (ctx.signal?.isInterrupted()) return 130;
    if (ctx.signal?.isStopped && ctx.signal.isStopped()) {
      await ctx.signal.waitIfStopped?.();
    }

    const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
    
    for (let x = 0; x < width; x += 1) {
      const y = cols[x];
      const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
      if (y >= 0 && y < height) grid[y][x] = ch;
      cols[x] = (y + 1) % height;
    }

    // THE FIX: 
    // 1. \x1b[H moves the cursor to the top-left instead of blanking the screen.
    // 2. .slice(0, height - 1) prevents the terminal from scrolling/jumping.
    // 3. One single output call kills the flickering.
    const output = "\x1b[H" + grid.slice(0, height - 1).map((row) => row.join("")).join("\n");
    
    // Using println just once for the whole block
    ctx.io.println(output);

    await new Promise((r) => setTimeout(r, delay));
  }
  return 0;
}