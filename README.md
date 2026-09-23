# vscode-nushell-lang VSCode extension

[![vsm-version](https://img.shields.io/visual-studio-marketplace/v/TheNuProjectContributors.vscode-nushell-lang?style=flat-square&label=VS%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=TheNuProjectContributors.vscode-nushell-lang)
[![vsm-downloads](https://img.shields.io/visual-studio-marketplace/d/TheNuProjectContributors.vscode-nushell-lang?style=flat-square&label=downloads&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=TheNuProjectContributors.vscode-nushell-lang)
[![vsm-installs](https://img.shields.io/visual-studio-marketplace/i/TheNuProjectContributors.vscode-nushell-lang?style=flat-square&label=installs&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=TheNuProjectContributors.vscode-nushell-lang)

This [extension for VSCode](https://marketplace.visualstudio.com/items?itemName=TheNuProjectContributors.vscode-nushell-lang) provides editing, syntax highlighting, and IDE support for [Nushell](http://nushell.sh), a data-driven document language.

## Features

- Syntax highlighting grammar for Nushell scripts (`.nu` files) and `nushell` codeblocks in Markdown files
- Goto definition
- Hover support
- Validation (errors with red squiggly lines)
- Auto-complete built-in commands
- Inlays / Hints
- Configuration via vscode settings
- Step debugging of Nushell scripts (`nu --dap`, Nushell 0.116+)

## Finding `nu`

The language server, the Nushell terminal profile and the debugger all use the same `nu`, looked up in this order:

1. the `nushellLanguageServer.nushellExecutablePath` setting (when it is not the default `nu`);
2. `nu` on your `PATH`;
3. a copy downloaded by this extension.

When neither of the first two finds `nu`, the extension offers to download the latest [Nushell release](https://github.com/nushell/nushell/releases) for your platform (Linux, macOS and Windows on x64/arm64). The archive is checked against the release's `SHA256SUMS` and kept in the extension's global storage. Run **Nushell: Download / Update Nushell** to fetch a newer release, and use `nushellLanguageServer.autoDownload` (`ask` / `always` / `never`) to control the prompt.

## Debugging

Press **F5** in a `.nu` file (no `launch.json` needed), or add a configuration:

```json
{
  "type": "nushell",
  "request": "launch",
  "name": "Debug nu script",
  "program": "${file}",
  "cwd": "${workspaceFolder}",
  "args": [],
  "stopOnEntry": false
}
```

The debugger is built into Nushell (`nu --dap`, available from 0.116), so it needs no extra install. It supports:

- breakpoints, conditional breakpoints (`$total > 4000`), logpoints (`total {$total}`) and exception breakpoints ("Runtime errors");
- step over / into / out, through pipeline stages too, and a call stack with command names;
- variables inspected to any depth, an Environment scope, and watch / hover / Debug Console expressions;
- `def main` receives the launch `args`; scripts without `main` let you pick an entry point (`entryPoint`);
- `input` / `input list` answered through native VS Code prompts;
- **Visualize** (right-click a variable): tables as sortable, filterable grids, binaries as a hex view, JSON/XML strings formatted;
- **Nushell Debug: Show IR**: a live view of the compiled IR of the current block;
- **time travel**: Step Back / Reverse Continue over a recorded timeline (`nushellDebugger.timeTravel`, `nushellDebugger.timeTravelMaxSteps`);
- hot restart, optionally on every save (`nushellDebugger.restartOnSave`).

Known limitations: launch only (no attach), externals get no interactive stdin, `input listen` is not supported, and variables can't be edited while paused.

The `examples/debug/` folder has scripts that exercise each feature.

## Screenshot (v1.5.0)

With Dark+ Color Theme

![Nushell script with Dark+ color theme](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-dark.png)

With Light+ Color Theme

![Nushell script with Light+ color theme](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-light.png)

Inlays / Hints

![Inlays](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-inlays.png)

Completions support

![Completions](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-completions.png)

Hover over built-ins for help

![Hover](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-hover-builtin.png)

Hover over custom commands for help

![HoverCustom](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-hover-custom.png)

Hover over variable

![HoverVar](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-hover-var.png)

Error & Validation support

![Error 1](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-error1.png)
![Error 2](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-error2.png)
![Error 3](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-error3.png)

Goto Definition support

![goto](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-goto-def.png)

Extension Settings

![settings](https://raw.githubusercontent.com/nushell/vscode-nushell-lang/main/assets/150-ext-settings.png)

## Known Issues

See [our Github repository](https://github.com/nushell/vscode-nushell-lang/issues) for active issues.

## Help

We are happily accepting pull requests to make this better. :)
