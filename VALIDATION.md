# Verification — September 24, 2026

## Add-project hang fix (September 25, 2026)

Root cause: PSReadLine calls `AddToHistoryHandler` for every line it loads from the user's saved PowerShell history file when a new shell starts. Each replayed line reached the app as a "command" event, triggering a synchronous history write, an IPC refresh, and a suggestion reset. On this machine that was 680 events per new PowerShell pane. Adding a project opens a pane, so the flood blocked the main process (Windows recorded `AppHangB1`), polluted per-project history with global PowerShell history, and kept command suggestions permanently disabled.

Fix: the PowerShell hook now reports a command only when it matches the live PSReadLine buffer (replayed lines arrive while the buffer is empty), and the main process records a command only after the user has submitted input in that pane.

- Raw PTY capture: 680 replayed command events before the fix, 0 after; a typed command is still recorded.
- 21/21 unit tests pass.
- Git Bash cwd fix: panes inside MSYS mount points such as `%TEMP%` (shown by Bash as `/tmp`) were recorded as `C:\tmp`. The Bash hook now reports the Windows path via `pwd -W`.
- Packaged `release/win-unpacked/Better Terminal.exe`, run from `Downloads\Better Terminal`: `intelligence-smoke` 6/6, `smoke` 9/9, and `profiles` 6/6 pass. Before the fix, `intelligence-smoke` failed at command suggestions and `smoke` failed at command capture.

## Startup packaging fix

The application code and runtime are unchanged. The default distribution is now a ZIP extracted once, and a local `Better Terminal.lnk` shortcut points directly to the existing unpacked application. The optional single-file portable build remains available separately.

Local measurements using an isolated one-pane PowerShell workspace:

| Launch path | Electron runtime available | Interface ready | Shell ready |
| --- | --- | --- | --- |
| Direct executable, first run | 1.14 s | 1.68 s | 2.83 s |
| Self-extracting portable executable | 33.21 s | 33.68 s | 34.49 s |
| Direct executable, repeat | 0.59 s | 1.07 s | 1.87 s |

The NSIS portable launcher template extracts the full application before launching it and deletes the extracted copy after exit. Almost all measured delay occurs before Electron starts. Direct launching bypasses that stage. These are instrumented measurements on this computer, not a guarantee for other machines or a cold-boot benchmark. Test data was isolated from normal user data. See `../Better-Terminal-startup-benchmark.json` for the recorded results.

## Version 0.2.0 — saved projects and command suggestions

- TypeScript and production renderer build pass.
- **21/21 unit tests pass**, including project manifest detection, real TOML parsing, package-manager selection, malformed configuration handling, history ranking, saved-project persistence, stale-buffer rejection, and completion lifecycle checks.
- The new desktop suite passes with real PowerShell and Git Bash: adding projects through the folder-picker flow, reusing an existing session, clicking between projects, detecting Python TOML commands, typing suggestions, Up/Down navigation, Tab replacing the actual line buffer without executing, Enter execution, custom TOML tasks, Escape dismissal, and saved projects surviving a restart.
- A live raw-input program receives ordinary typing, Up/Down, and Tab without completion interference or leaked internal query sequences.
- The new completion suite and the original full desktop regression suite also pass against the packaged 0.2.0 executable, including history durability, split terminals, raw input, and output exceeding 1 MB. The updated preview was captured from this packaged build.

The earlier verification below describes the initial terminal foundation.

Verified on Windows 11 x64, Node.js 24.14.0, Electron 44.4.5, and node-pty 1.1.0.

- **Build:** TypeScript check and Vite production build pass. Vite reports one advisory about the renderer bundle size (about 659 KB before gzip); the bundle includes the terminal emulator.
- **Unit tests:** 10/10 pass. Coverage includes durable per-folder history, pins/settings, deletion boundaries, pagination, Unicode, input validation, and fragmented/authenticated shell metadata.
- **Development desktop:** Real PowerShell input and output, automatic folder tracking, per-folder command history, splits, keyboard resizing, raw-input/alternate-screen interaction, palette/settings, history search, restart persistence, and deletion pass.
- **Packaged desktop:** The same smoke suite passes against `release/win-unpacked/Better Terminal.exe`. This exercises actual packaged resources, native PTY loading, external shell scripts, and the production renderer. A stream exceeding 1 MB drains successfully and leaves the shell responsive.
- **Portable launcher:** `scripts/portable-smoke.cjs` passes against the delivered `Better-Terminal-0.1.0.exe`: extraction, window startup, real PowerShell execution, durable project history, and clean shutdown. This uses a temporary localhost CDP test connection because the NSIS launcher does not forward the inspector stream expected by Playwright's standard Electron launch helper.
- **Other profiles:** Git Bash output and automatic command capture pass. Command Prompt output passes. Reverse tab navigation passes.
- **Installed CLI tools:** `codex --version`, `claude --version`, and `gemini --version` launch inside the native PowerShell terminal. Authenticated agent work was not performed.
- **Visual check:** Inspected both midnight and graphite themes at 1440 × 920. The delivered preview shows the packaged app running the project's real unit tests alongside real source-file and package inspection commands.
- **Dependency audit:** The dependency installation reported zero known vulnerabilities at the time of the build.

WSL execution was not exercised. Full Windows Terminal parity and every third-party interactive CLI have not been verified. See the README for the current supported scope and limitations.

All test sessions used separate data directories under the task's `work/` directory. The normal application data was not populated with fixtures.
