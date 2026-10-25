# Windows setup and launch

Install Node.js 24 or newer with npm, then clone or extract SOURCEWATCH into a directory you can write to. Neither administrator rights nor PowerShell execution-policy changes are required by these scripts. Installation downloads npm dependencies and Chromium, so setup needs network access and disk space.

## First run

In File Explorer, open the SOURCEWATCH folder and double-click `setup-sourcewatch.cmd`. Keep the window open until it reports completion. Then double-click `start-sourcewatch.cmd` and open **http://127.0.0.1:3210** in your browser. The launcher prints the address; it does not open a browser automatically.

Alternatively, open **Command Prompt** and run:

```bat
cd /d "C:\path\to\sourcewatch"
setup-sourcewatch.cmd
start-sourcewatch.cmd
```

The scripts explicitly invoke `npm.cmd` and `npx.cmd`. You do not need to enable PowerShell scripts, change system policy, configure a firewall rule, or run an elevated terminal.

## Daily use

Run `start-sourcewatch.cmd`. It changes into its own directory, checks Node/npm, checks dependencies, builds the UI if `dist\index.html` is missing, and starts the local service. If dependencies are absent, it tells you to run setup rather than installing them unexpectedly.

Leave the terminal window open while using SOURCEWATCH. Scheduled monitoring runs only while the service is running. Press Ctrl+C to stop it; Command Prompt may ask whether to terminate the batch job. Data remains in the local `data` directory unless you configured a different path.

Both scripts set `PLAYWRIGHT_BROWSERS_PATH` to the project's `.browsers` directory for their own process. Setup installs Chromium there, and the launcher uses that same browser location. An unrelated Chromium installation elsewhere does not replace this setup step. No global environment setting is changed.

After updating source code, rerun setup to refresh dependencies, Chromium, and the built UI. If dependencies are already current, run `npm.cmd run build` explicitly before starting. The launcher only builds when the UI is missing; it does not detect stale frontend files.

## Optional session settings

From Command Prompt, configure a different port or data directory for this launch:

```bat
cd /d "C:\path\to\sourcewatch"
set "PORT=3211"
set "SOURCEWATCH_DATA=C:\path\to\research-data"
start-sourcewatch.cmd
```

Open the address printed by the launcher. These values apply to this terminal session; `.env.example` is documentation and is not loaded automatically. The service remains bound to `127.0.0.1`.

## Troubleshooting

- **Node/npm missing or too old:** install Node.js 24 or newer, close the terminal, and retry from a fresh window.
- **Dependencies or Chromium missing:** run `setup-sourcewatch.cmd` from this project's directory and inspect any download error.
- **Port in use:** stop the other local instance or set `PORT` as above.
- **Capture fails:** inspect the app's error and warnings. Private URLs, unsupported page types, resource limits, or access controls can legitimately prevent capture.
- **Setup fails:** the script stops at the failing installation/build step and returns a nonzero exit code. Read the visible error before closing the window.

The scripts themselves do not modify execution policy, firewall settings, startup registration, or system browser settings. They are conveniences for the existing local service, not an installed Windows background service.

## Validation checkpoint

The 1.1 candidate launcher was run through `cmd.exe /c start-sourcewatch.cmd` using isolated port 3212. The service reported version 1.1.0; status/settings and HTTP 200 were checked, then the service was stopped. This does not establish double-click behavior. Setup script validation was static at this checkpoint; consult the final handoff for any later executed checks.
