# Toynix TTY (Browser)

A browser-native Toynix OS simulation. This is not a real kernel or hardware emulator, but it uses a modular runtime, OPFS-backed storage, journald-style logs, a pseudo-terminal, a worker-based userland, pipelines/redirection, process tracking, and file metadata to feel close to a real system.

## Run
Open `index.html` in a browser.

## Provide Boot Logs
Add log arrays before the module script in `index.html`:

```html
<script>
  window.TOYNIX_KERNEL_LOGS = [
    "[    0.000000] Linux version 6.x (toynix@build) #1 SMP",
    "[    0.100000] ACPI: Early table checksum verification disabled",
  ];
  window.TOYNIX_SYSTEMD_LOGS = [
    "[  OK  ] Started Network Manager.",
    "[  OK  ] Reached target Graphical Interface.",
  ];
</script>
```

## Built-in Commands
`ls`, `cd`, `pwd`, `cat`, `echo`, `clear`, `help`, `whoami`, `uname`, `date`, `uptime`, `hostname`, `ps`, `journalctl`, `dmesg`, `mkdir`, `touch`, `write`, `env`, `export`, `history`, `grep`, `head`, `tail`, `wc`, `sleep`, `kill`, `status`, `id`, `groups`, `stat`, `chmod`, `chown`, `motd`, `rm`, `cp`, `mv`, `which`, `df`, `du`, `free`.

## Userland Modules
External commands are loaded as modules by the worker. Examples: `sysinfo`, `neofetch`, `cowsay`, `rev`, `cmatrix`, `pipes`, `rig`, `oneko`, `top`, `fortune`, `toilet`, `figlet`, `nano`.

## Shell Features
- Pipelines: `cat file | grep foo | head -n 5`
- Redirection: `echo hi > out.txt` or `echo hi >> out.txt`

## Structure
- `src/terminal.js`: terminal rendering + input
- `src/bootloader.js`: boot menu + capability checks
- `src/boot.js`: boot sequence + log buffers
- `src/vfs.js`: OPFS + in-memory virtual filesystem + metadata
- `src/procfs.js`: `/proc` virtual data
- `src/devfs.js`: `/dev` devices
- `src/journal.js`: journald-style log capture
- `src/kernel.js`: process manager scaffolding
- `src/pty.js`: pseudo-terminal
- `src/program-registry.js`: program registry + loader
- `src/workers/init.js`: init worker
- `src/workers/userland.js`: shell + commands in worker
- `src/workers/module-loader.js`: module loader
- `src/userland/bin/`: userland command modules
- `src/programs.js`: built-in commands
- `src/shell.js`: shell parser + dispatcher
- `src/main.js`: wiring, login flow
