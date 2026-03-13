function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function insertText(lines, row, col, text) {
  const line = lines[row] || "";
  const next = `${line.slice(0, col)}${text}${line.slice(col)}`;
  lines[row] = next;
  return { row, col: col + text.length };
}

function splitLine(lines, row, col) {
  const line = lines[row] || "";
  const left = line.slice(0, col);
  const right = line.slice(col);
  lines[row] = left;
  lines.splice(row + 1, 0, right);
  return { row: row + 1, col: 0 };
}

function joinWithPrevious(lines, row, col) {
  if (row <= 0) return { row, col };
  const prev = lines[row - 1] || "";
  const line = lines[row] || "";
  const nextCol = prev.length;
  lines[row - 1] = `${prev}${line}`;
  lines.splice(row, 1);
  return { row: row - 1, col: nextCol };
}

function deleteChar(lines, row, col) {
  const line = lines[row] || "";
  if (col > 0) {
    lines[row] = `${line.slice(0, col - 1)}${line.slice(col)}`;
    return { row, col: col - 1 };
  }
  return joinWithPrevious(lines, row, col);
}

function getTerminalSize(env) {
  const cols = Number(env.get("COLUMNS") || "80");
  const rows = Number(env.get("LINES") || "24");
  return { cols: Math.max(40, cols), rows: Math.max(12, rows) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(ctx, args) {
  const target = args[0];
  if (!target) {
    ctx.io.println("nano: missing file operand");
    return 1;
  }

  const path = ctx.fs.resolveWithCwd(ctx.shell.cwd, target);
  let content = await ctx.fs.readFile(path);
  if (content === null) content = "";
  content = content.replace(/\r/g, "");
  let lines = content.length ? content.split("\n") : [""];

  let cursorRow = 0;
  let cursorCol = 0;
  let viewTop = 0;
  let status = "Ctrl+O Save  Ctrl+X Exit";

  const { cols, rows } = getTerminalSize(ctx.shell.env);
  const viewRows = Math.max(1, rows - 2);

  function ensureVisible() {
    if (cursorRow < viewTop) viewTop = cursorRow;
    if (cursorRow >= viewTop + viewRows) {
      viewTop = cursorRow - viewRows + 1;
    }
    viewTop = Math.max(0, Math.min(viewTop, Math.max(0, lines.length - viewRows)));
  }

  function render() {
    ensureVisible();
    ctx.io.clear();
    const title = `GNU nano (web)  ${target}`;
    ctx.io.println(title.slice(0, cols));

    for (let i = 0; i < viewRows; i += 1) {
      const line = lines[viewTop + i] || "";
      let output = line;
      if (viewTop + i === cursorRow) {
        const col = clamp(cursorCol, 0, line.length);
        output = `${line.slice(0, col)}_${line.slice(col)}`;
      }
      ctx.io.println(output.slice(0, cols));
    }

    ctx.io.println(status.padEnd(cols).slice(0, cols));
  }

  async function save() {
    await ctx.fs.writeFile(path, lines.join("\n"));
    status = `Wrote ${target}`;
  }

  if (ctx.input && ctx.input.setRawMode) {
    ctx.input.setRawMode(true);
  }

  render();

  try {
    for (;;) {
      if (ctx.signal?.isInterrupted()) return 130;
      if (ctx.signal?.isStopped && ctx.signal.isStopped()) {
        await ctx.signal.waitIfStopped?.();
      }
      const keyEvent = ctx.input && ctx.input.tryReadKey
        ? ctx.input.tryReadKey()
        : ctx.input
          ? await ctx.input.readKey()
          : null;
      if (!keyEvent) {
        await sleep(20);
        continue;
      }

      const key = keyEvent.key;
      const ctrl = !!keyEvent.ctrl;
      const alt = !!keyEvent.alt;

      if (ctrl && key.toLowerCase() === "x") {
        break;
      }
      if (ctrl && key.toLowerCase() === "o") {
        await save();
        render();
        continue;
      }

      if (key === "ArrowLeft") {
        if (cursorCol > 0) cursorCol -= 1;
        else if (cursorRow > 0) {
          cursorRow -= 1;
          cursorCol = (lines[cursorRow] || "").length;
        }
        render();
        continue;
      }
      if (key === "ArrowRight") {
        const line = lines[cursorRow] || "";
        if (cursorCol < line.length) cursorCol += 1;
        else if (cursorRow < lines.length - 1) {
          cursorRow += 1;
          cursorCol = 0;
        }
        render();
        continue;
      }
      if (key === "ArrowUp") {
        if (cursorRow > 0) cursorRow -= 1;
        cursorCol = clamp(cursorCol, 0, (lines[cursorRow] || "").length);
        render();
        continue;
      }
      if (key === "ArrowDown") {
        if (cursorRow < lines.length - 1) cursorRow += 1;
        cursorCol = clamp(cursorCol, 0, (lines[cursorRow] || "").length);
        render();
        continue;
      }
      if (key === "Home") {
        cursorCol = 0;
        render();
        continue;
      }
      if (key === "End") {
        cursorCol = (lines[cursorRow] || "").length;
        render();
        continue;
      }
      if (key === "Backspace") {
        const next = deleteChar(lines, cursorRow, cursorCol);
        cursorRow = next.row;
        cursorCol = next.col;
        render();
        continue;
      }
      if (key === "Enter") {
        const next = splitLine(lines, cursorRow, cursorCol);
        cursorRow = next.row;
        cursorCol = next.col;
        render();
        continue;
      }
      if (key === "Tab") {
        const next = insertText(lines, cursorRow, cursorCol, "  ");
        cursorRow = next.row;
        cursorCol = next.col;
        render();
        continue;
      }

      if (key.length === 1 && !ctrl && !alt) {
        const next = insertText(lines, cursorRow, cursorCol, key);
        cursorRow = next.row;
        cursorCol = next.col;
        render();
      }
      if (ctx.input && ctx.input.tryReadKey) {
        await sleep(20);
      }
    }
  } finally {
    if (ctx.input && ctx.input.setRawMode) {
      ctx.input.setRawMode(false);
    }
  }

  ctx.io.println("");
  return 0;
}
