export class Terminal {
  constructor(container) {
    this.container = container;
    this.prompt = "";
    this.input = "";
    this.acceptingInput = false;
    this.onLine = null;
    this.currentLineEl = null;
    this.rawKeyHandler = null;
    this.onInterrupt = null;
    this.onStop = null;
    this.onClear = null;
    this.onAutocomplete = null;
    this.history = [];
    this.historyIndex = null;
    this.historyTemp = "";

    this.container.addEventListener("click", () => {
      this.container.focus();
    });

    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        this.pasteFromClipboard();
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        this.copySelectionToClipboard();
        return;
      }
      if (this.rawKeyHandler) {
        this.rawKeyHandler(event);
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (this.onInterrupt) this.onInterrupt();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (this.onStop) this.onStop();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        this.input = "";
        this.renderInput();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        this.input = this.input.replace(/\s*\S+\s*$/, "");
        this.renderInput();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        if (this.onClear) this.onClear();
        return;
      }
      if (!this.acceptingInput) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "Backspace") {
        event.preventDefault();
        this.input = this.input.slice(0, -1);
        this.renderInput();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const line = this.input;
        this.finalizeInputLine();
        this.input = "";
        if (line.trim().length) {
          this.history.push(line);
          this.historyIndex = null;
          this.historyTemp = "";
        }
        if (this.onLine) this.onLine(line);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!this.history.length) return;
        if (this.historyIndex === null) {
          this.historyTemp = this.input;
          this.historyIndex = this.history.length - 1;
        } else if (this.historyIndex > 0) {
          this.historyIndex -= 1;
        }
        this.input = this.history[this.historyIndex] || "";
        this.renderInput();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (this.historyIndex === null) return;
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex += 1;
          this.input = this.history[this.historyIndex] || "";
        } else {
          this.historyIndex = null;
          this.input = this.historyTemp || "";
        }
        this.renderInput();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (this.onAutocomplete) this.onAutocomplete(this.input);
        return;
      }

      if (event.key.length === 1) {
        event.preventDefault();
        this.input += event.key;
        this.renderInput();
      }
    });

    this.container.addEventListener("paste", (event) => {
      if (!this.acceptingInput) return;
      const text = event.clipboardData?.getData("text") || "";
      if (!text) return;
      event.preventDefault();
      this.insertText(text);
    });
  }

  setPrompt(prompt) {
    this.prompt = prompt;
  }

  setOnLine(handler) {
    this.onLine = handler;
  }

  setRawKeyHandler(handler) {
    this.rawKeyHandler = handler;
  }

  sendCanonicalLine(line) {
    if (this.onLine) this.onLine(line);
  }

  setOnInterrupt(handler) {
    this.onInterrupt = handler;
  }

  setOnStop(handler) {
    this.onStop = handler;
  }

  setOnClear(handler) {
    this.onClear = handler;
  }

  setOnAutocomplete(handler) {
    this.onAutocomplete = handler;
  }

  setInputValue(value) {
    this.input = value;
    this.renderInput();
  }

  setInputEnabled(enabled) {
    this.acceptingInput = enabled;
    if (enabled) {
      this.startInputLine();
    } else {
      this.finalizeInputLine();
    }
  }

  clear() {
    this.container.innerHTML = "";
    this.currentLineEl = null;
  }

  print(text, opts = {}) {
    if (!text) return;
    const line = this.createLine(opts);
    line.textContent = text;
    this.container.appendChild(line);
    this.scrollToBottom();
  }

  println(text = "", opts = {}) {
    const line = this.createLine(opts);
    line.textContent = text;
    this.container.appendChild(line);
    this.scrollToBottom();
  }

  startInputLine() {
    if (this.currentLineEl) return;
    const line = this.createLine();

    const promptSpan = document.createElement("span");
    promptSpan.className = "prompt";
    promptSpan.textContent = this.prompt;

    const inputSpan = document.createElement("span");
    inputSpan.className = "input";
    inputSpan.textContent = this.input;

    const cursor = document.createElement("span");
    cursor.className = "cursor";

    line.appendChild(promptSpan);
    line.appendChild(inputSpan);
    line.appendChild(cursor);

    this.currentLineEl = line;
    this.container.appendChild(line);
    this.scrollToBottom();
  }

  renderInput() {
    if (!this.currentLineEl) return;
    const inputSpan = this.currentLineEl.querySelector(".input");
    if (inputSpan) inputSpan.textContent = this.input;
    this.scrollToBottom();
  }

  insertText(text) {
    if (!text) return;
    const sanitized = String(text).replace(/\r/g, "");
    const lines = sanitized.split("\n");
    if (lines.length === 1) {
      this.input += lines[0];
      this.renderInput();
      return;
    }
    const [first, ...rest] = lines;
    this.input += first;
    this.renderInput();
    rest.forEach((line) => {
      const submit = this.input;
      this.finalizeInputLine();
      this.input = "";
      if (submit.trim().length) {
        this.history.push(submit);
        this.historyIndex = null;
        this.historyTemp = "";
      }
      if (this.onLine) this.onLine(submit);
      this.startInputLine();
      this.input += line;
      this.renderInput();
    });
  }

  async pasteFromClipboard() {
    if (!this.acceptingInput) return;
    if (!navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      this.insertText(text);
    } catch (err) {
      // ignore clipboard errors
    }
  }

  async copySelectionToClipboard() {
    const selection = window.getSelection?.();
    const text = selection ? selection.toString() : "";
    if (!text) return;
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // ignore clipboard errors
    }
  }

  finalizeInputLine() {
    if (!this.currentLineEl) return;
    const cursor = this.currentLineEl.querySelector(".cursor");
    if (cursor) cursor.remove();
    this.currentLineEl = null;
  }

  createLine(opts = {}) {
    const line = document.createElement("div");
    line.className = "line";
    if (opts.dim) line.classList.add("dim");
    return line;
  }

  scrollToBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  }
}
