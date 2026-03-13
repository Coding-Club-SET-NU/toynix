export async function run(ctx, args) {
  const width = Number(ctx.shell?.env?.get("COLUMNS")) || 80;
  const height = Number(ctx.shell?.env?.get("LINES")) || 30;
  const frames = 10000;
  const delay = 80; // Speed it up slightly for the vibe
  const pipes = Array.from({ length: 12 }, () => ({
    x: Math.floor(Math.random() * width),
    y: Math.floor(Math.random() * height),
    dir: Math.floor(Math.random() * 4),
    trail: [],
  }));
  const trailLength = Math.max(12, Math.floor(width / 6));

  const deltas = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];
  const glyphs = {
    "0,1": "┐", "2,3": "└", "1,3": "─", "0,2": "─",
    "0,0": "│", "1,1": "─", "2,2": "│", "3,3": "─",
    "0,3": "┘", "3,0": "└", "1,0": "┌", "1,2": "┐",
    "2,1": "┌", "3,2": "┘",
  };

  // Pre-clear once at the start
  ctx.io.clear();

  for (let f = 0; f < frames; f += 1) {
    if (ctx.signal?.isInterrupted()) return 130;
    
    const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
    
    pipes.forEach((pipe) => {
      const turn = Math.random() < 0.3;
      const prevDir = pipe.dir;
      if (turn) {
        pipe.dir = (pipe.dir + (Math.random() > 0.5 ? 1 : 3)) % 4;
      }
      const next = deltas[pipe.dir];
      const nextX = (pipe.x + next.dx + width) % width;
      const nextY = (pipe.y + next.dy + height) % height;
      
      pipe.trail.push({ x: pipe.x, y: pipe.y, from: prevDir, to: pipe.dir });
      if (pipe.trail.length > trailLength) pipe.trail.shift();
      
      pipe.x = nextX;
      pipe.y = nextY;
    });

    pipes.forEach((pipe) => {
      pipe.trail.forEach((seg) => {
        const key = `${Math.min(seg.from, seg.to)},${Math.max(seg.from, seg.to)}`;
        const glyph = glyphs[key] || "+";
        if (seg.y >= 0 && seg.y < height && seg.x >= 0 && seg.x < width) {
          grid[seg.y][seg.x] = glyph;
        }
      });
    });

    // Build the frame, but stop at height - 1 to prevent scrolling jumps
        const frame = grid
          .slice(0, height - 1) 
          .map(row => row.join(""))
          .join("\n");

        ctx.io.clear(); 
        // Use write or println - since we sliced 1 row off, it won't overflow
        ctx.io.println(frame);

    await new Promise((r) => setTimeout(r, delay));
  }
  return 0;
}