export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function tokenize(input) {
  const tokens = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === " ") {
      if (current.length) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length) {
    tokens.push(current);
  }

  return tokens;
}

export function normalizePath(path) {
  if (!path) return "/";
  const isAbs = path.startsWith("/");
  const parts = path.split("/").filter(Boolean);
  const stack = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return `/${stack.join("/")}`;
}

export function resolvePath(cwd, inputPath) {
  if (!inputPath || inputPath === "") return cwd;
  if (inputPath.startsWith("/")) return normalizePath(inputPath);
  return normalizePath(`${cwd}/${inputPath}`);
}
