# Better Terminal

A Windows desktop terminal built around your project folders. Real local shells, a quiet interface, and command history that stays with the folder where each command ran. No gradients, accounts, cloud sync, or telemetry.

## Run the app

For fast startup on this computer, open **`../Better Terminal.lnk`** or **`release/0.2.2/win-unpacked/Better Terminal.exe`**. Keep the executable alongside its supporting files. Node.js is not required to run the terminal application; your CLI tools still need their own usual installations. This development release is unsigned.

For another computer, extract **`release/0.2.2/Better-Terminal-0.2.2-win-x64.zip`** once, then open `Better Terminal.exe` from the extracted directory. You can create a shortcut to it.

Use the direct executable or ZIP distribution for everyday use. The older single-file `Better-Terminal-0.2.0.exe` self-extracting launcher was archived after Windows recorded a hang following folder selection. It also unpacks the entire Electron application on every launch, adding a substantial startup delay. The direct executable passed the same folder-selection test. Both formats use the same normal application data location, so projects and history carry over. The underlying cause of the portable hang has not been confirmed.

Use **Add project** to choose a folder. It is saved under **Projects** and opens directly in a terminal. Click a saved project to return to its live terminal, or start a new session if none is running. Projects survive application restarts. Visited folders appear separately under **Recently visited**. Hover a folder and click its pin to prioritize it. PowerShell and Git Bash also track folders visited with `cd`. Use **Split** for two independent terminals in the same folder, or the adjacent stacked-pane button for a horizontal divider. Drag the divider to resize; double-click it to reset.

Click a history command to insert it into the active terminal, then press Enter when ready. Multiline pastes ask for confirmation. Search, copy, export, delete individual commands, or clear a folder's history from the history panel. Removing a recent folder does not delete its history.

Use the shell dropdown beside each terminal number to switch that pane between PowerShell, Command Prompt, and other installed shells. The new shell starts in the same folder; the other split pane stays open. Switching replaces the current shell and respects the close-confirmation setting.

## Project commands and completion

The app inspects `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`, and .NET project files. It recognizes package managers and common frameworks without running project code. The stack badge in the toolbar opens a list of detected commands; its refresh button rescans the files.

Start typing at a PowerShell or Git Bash prompt. For example, `npm r` offers the scripts actually defined in `package.json`; typing a task name such as `dev` also finds its command. **Up/Down** chooses a suggestion, **Tab** fills the shell's command line, and **Enter** runs it. **Escape** dismisses the list. When no suggestion list is open, Tab and arrow keys keep their normal shell behavior. Suggestions also include matching commands from the current folder's saved history.

To define your own tasks, put `better-terminal.toml` (or `.better-terminal.toml`) in your project root:

```toml
[project]
name = "My application"
stack = ["TypeScript", "React"]

[commands]
dev = { run = "npm run dev", description = "Start the development server" }
check = "npm run build"
```

See `examples/better-terminal.toml` for a copyable example. Config files are parsed as data. Commands are never run just by adding a project, typing, or pressing Tab. Project commands are suggested at their project root to avoid running a task in the wrong directory; history suggestions remain specific to the current folder.

Completion reads the actual PSReadLine/Readline buffer and verifies it again before replacing it. It pauses when a command starts, so interactive agents receive their own Tab and arrow keys. Multiline input, reverse history search, and unsupported editing modes conservatively suspend suggestions until the next prompt. Bash completion currently requires its default Emacs editing mode. PowerShell requires PSReadLine. Completion uses Ctrl+F12 and Ctrl+Shift+F12 as internal shell bindings for the session.

## Included

- Recent and pinned folders, tracked automatically with supported shell integration.
- Independent tabs and two resizable panes per tab, side by side or stacked.
- Per-folder command history stored on disk without automatic expiration.
- History search, pagination, insertion, copying, JSON export, and explicit deletion.
- PowerShell, PowerShell 7 when installed, Git Bash when installed, Command Prompt, and WSL when a distribution is detected.
- ANSI/VT color and cursor handling, Unicode, raw input, alternate screen, mouse reporting, bracketed paste, terminal search, Ctrl+click web links, and configurable scrollback.
- Graphite, midnight, and light themes, font size, cursor style, and blinking-cursor settings.
- Command palette, keyboard shortcuts, renamed tabs, full screen, and normal Windows window controls.
- Restore tab folders, shell profiles, split orientation, and divider positions on the next launch.
- A styled in-app confirmation before closing running terminals, including window-close and Alt+F4 requests. Keep open or Escape cancels; Close app saves the current layout before exiting. Toggle confirmation in Settings.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New terminal tab | Ctrl+Shift+T |
| Split side by side | Ctrl+Shift+D |
| Split top and bottom | Ctrl+Shift+E |
| Close active pane | Ctrl+Shift+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Switch pane | Alt+Arrow |
| Command palette | Ctrl+Shift+P |
| Find in terminal output | Ctrl+Shift+F |
| Toggle project history | Ctrl+Shift+H |
| Copy / paste | Ctrl+Shift+C / Ctrl+Shift+V |
| Settings | Ctrl+, |
| Increase / decrease font size | Ctrl+Plus / Ctrl+Minus |
| Reset font size | Ctrl+0 |
| Full screen | F11 |

Ctrl+C, Ctrl+R, and ordinary terminal keys go to the shell. Double-click a tab label to rename it. The divider supports arrow keys when focused.

## Develop

Requires Windows 10/11 x64 and Node.js 22.12 or newer. Development was verified using Node.js 24.14.0.

```powershell
npm ci
npm run dev
```

`npm run dev` starts Vite and Electron together. To run the production renderer:

```powershell
npm run build
npm start
```

To generate the ZIP distribution, which is extracted once:

```powershell
npm run dist
```

`npm run dist:dir` produces the directly runnable app folder. `npm run dist:portable` still builds the optional self-extracting executable, with its slower launch behavior.

Dependencies are pinned in `package-lock.json`. The first installation or launch downloads Electron; packaging may download the NSIS build tools. Native Windows node-pty binaries use N-API and ship with the dependency. The tested prebuilt binaries are packaged without an unnecessary native rebuild.

## Validation

```powershell
npm test
npm run build
npm run test:e2e
npm run test:profiles
npm run test:intelligence
node scripts/portable-smoke.cjs
```

The unit suite checks durable history, folder isolation, pagination, deletion, Unicode, settings validation, and shell-protocol parsing across arbitrary chunks. The desktop smoke suite launches actual Electron/ConPTY sessions and checks shell input/output, folder changes, independent splits, resizing, alternate-screen/raw-input behavior, settings, search, persistence after restart, and deletion. Profile checks exercise Git Bash and Command Prompt and invoke the installed Codex, Claude, and Gemini version commands. Those three CLI tools are prerequisites only for `test:profiles`.

The desktop tests use separate data and project folders under the system temp folder and do not replace the normal app's saved workspace. They launch visible app windows while testing. Results and screenshots are written to `test-results/`.

After packaging, `node scripts/portable-smoke.cjs` verifies the actual portable launcher. For the full production-build suite, set `BT_PACKAGED_EXE` to the absolute path of `release/0.2.2/win-unpacked/Better Terminal.exe`, then run `npm run test:e2e`. The standard Electron test helper should target the unpacked executable, not the NSIS launcher.

## Data and architecture

Normal user data is stored under `%APPDATA%/better-terminal/`:

- `state.json`: folder bookmarks, preferences, and saved tab layout; written by atomic replacement.
- `history/<folder-id>.jsonl`: append-only command records, rewritten only for explicit deletion. Folder IDs are hashes of normalized absolute paths.

Back up this directory to preserve history. There is no retention timer or automatic trimming of saved commands. The terminal's scrollback setting only limits displayed output. History is local plaintext; commands containing tokens or other secrets are retained too. Deleting an entry here does not delete a shell's independent PSReadLine or Bash history file.

The Electron main process owns the filesystem and native PTYs. A sandboxed renderer uses a narrow, context-isolated preload bridge, validated IPC senders, and no Node.js integration. Shell integration sends session-authenticated OSC metadata. PowerShell records accepted shell commands through PSReadLine; a prompt-based fallback handles environments without its history hook. Git Bash records completed commands at the prompt. Keystrokes typed inside native interactive programs are not treated as shell commands. Renderer acknowledgments apply backpressure to large PTY output streams.

The renderer uses React, TypeScript, and xterm.js. It keeps hidden tabs mounted so background terminals continue running. The app does not rewrite user shell profile files. PowerShell's process-local execution-policy override allows the bundled integration script to run; it does not change the machine execution policy.

References: [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [Microsoft node-pty](https://github.com/microsoft/node-pty), [xterm.js](https://github.com/xtermjs/xterm.js).

## Current boundaries

This is a working first release, not complete Windows Terminal feature parity.

- Automatic folder tracking and command history currently support **PowerShell and Git Bash**. Command Prompt and WSL provide real terminal sessions but do not yet have shell integration; the UI explicitly indicates this. SSH or a nested shell needs its own integration for remote/nested command history.
- A supported shell starts from its selected folder. History is scoped to the exact working directory, not a repository root that includes every subfolder.
- Git Bash records a command after it finishes and returns to a prompt. Bash commands excluded by the user's Bash history settings, and final commands such as `exit`, may not be recorded. PowerShell's fallback without PSReadLine also records on return to the prompt.
- Restoring a workspace starts fresh shell processes. Running jobs, agent conversations, scrollback, environment changes, and unsent input do not resume across an app restart.
- The terminal behavior needed by interactive agents was exercised with a raw-input/alternate-screen test program. Installed Codex, Claude, and Gemini version commands were checked. Authenticated workflows for every CLI agent have not been exhaustively tested.
- There are two panes per tab and a 32-pane process limit. Custom shell profiles, tab drag reordering, automatic updates, Windows default-terminal registration, image protocols, and GPU acceleration are future work.
- Very large history files currently use a linear scan for queries. Commands remain on disk, but an indexed storage layer would improve years-long, high-volume history searches.

The main implementation is in `electron/main.cjs`, `electron/store.cjs`, `electron/protocol.cjs`, `src/App.tsx`, and `src/TerminalPane.tsx`.
