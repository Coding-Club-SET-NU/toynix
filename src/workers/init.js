let pid = null;
let name = "init";

self.onmessage = (event) => {
  const payload = event.data || {};
  if (payload.type === "init") {
    pid = payload.pid;
    name = payload.name || name;
    self.postMessage({ type: "log", level: "info", message: `Process ${name} (pid ${pid}) online.` });
    self.postMessage({ type: "log", level: "info", message: "Launching getty@tty1" });
  }
};
