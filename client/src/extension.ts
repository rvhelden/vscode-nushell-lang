/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import { window, type OutputChannel } from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  Trace,
  RevealOutputChannelOn,
} from 'vscode-languageclient/node';

import { registerDebugger } from './debug/register';
import {
  downloadNushell,
  ensureNushell,
  resolveNushell,
} from './nushell/resolve';

let client: LanguageClient | undefined;
let outputChannel: OutputChannel | undefined; // Single output channel for server logs and trace

function startLanguageServer(
  context: vscode.ExtensionContext,
  found_nushell_path: string,
): void {
  // Prevent duplicate clients/channels
  if (client) {
    vscode.window.showInformationMessage(
      'Nushell Language Server is already running.',
    );
    return;
  }
  // Channel to receive both server logs and JSON-RPC trace between VS Code and the LSP server
  if (outputChannel) {
    try {
      outputChannel.dispose();
    } catch {
      // ignore
    }
  }
  outputChannel = window.createOutputChannel('Nushell Language Server');
  context.subscriptions.push(outputChannel);

  // Use Nushell's native LSP server
  const serverOptions: ServerOptions = {
    run: {
      command: found_nushell_path,
      args: ['--lsp'],
    },
    debug: {
      command: found_nushell_path,
      args: ['--lsp'],
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Route general server logs to a single channel
    outputChannel: outputChannel,
    // Never auto-reveal the server output channel
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    // Send JSON-RPC trace to the same channel as server logs
    traceOutputChannel: outputChannel,
    markdown: {
      isTrusted: true,
      supportHtml: true,
    },
    initializationOptions: {
      timeout: 10000, // 10 seconds
    },
    // Register the server for nushell files
    documentSelector: [
      { scheme: 'file', language: 'nushell' },
      { scheme: 'untitled', language: 'nushell' },
    ],
    synchronize: {
      // Notify the server about file changes to nushell files
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.nu'),
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    'nushellLanguageServer',
    'Nushell Language Server',
    serverOptions,
    clientOptions,
  );

  // Initialize trace level from settings and react to changes
  const applyTraceFromConfig = () => {
    const configured = vscode.workspace
      .getConfiguration('nushellLanguageServer')
      .get<'off' | 'messages' | 'verbose'>('trace.server');
    const level: 'off' | 'messages' | 'verbose' = configured ?? 'messages';
    const map: Record<'off' | 'messages' | 'verbose', Trace> = {
      off: Trace.Off,
      messages: Trace.Messages,
      verbose: Trace.Verbose,
    };
    client?.setTrace(map[level]);
    try {
      outputChannel.appendLine(`[Nushell] JSON-RPC tracing set to: ${level}`);
    } catch {
      // ignore
    }
  };
  applyTraceFromConfig();
  const cfgDisp = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('nushellLanguageServer.trace.server')) {
      applyTraceFromConfig();
    }
  });
  context.subscriptions.push(cfgDisp);
  // Log client lifecycle
  client.onDidChangeState((e) => {
    try {
      outputChannel.appendLine(`[Nushell] Client state changed: ${e.newState}`);
    } catch {
      // ignore
    }
  });

  // Start the language client and register a disposable that stops it when disposed
  client.start().catch((error) => {
    vscode.window.showErrorMessage(
      `Failed to start Nushell language server: ${error.message}`,
    );
  });

  const disposable = new vscode.Disposable(() => {
    if (client) {
      client.stop().catch((error) => {
        console.error(
          'Failed to stop Nushell Language Server on dispose:',
          error,
        );
      });
    }
  });
  context.subscriptions.push(disposable);
}

export function activate(context: vscode.ExtensionContext) {
  // The language server, the terminal profile and the debugger share one `nu`,
  // resolved as: nushellExecutablePath setting -> PATH -> downloaded copy.
  const nushell = () => ensureNushell(context);

  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider('nushell_default', {
      async provideTerminalProfile(
        token: vscode.CancellationToken,
      ): Promise<vscode.TerminalProfile | undefined> {
        // Consume token to satisfy no-unused-vars without changing behavior
        void token;
        const nushellPath = await nushell();
        if (!nushellPath) {
          return undefined;
        }

        return {
          options: {
            name: 'Nushell',
            shellPath: nushellPath,
            iconPath: vscode.Uri.joinPath(
              context.extensionUri,
              'assets/nu.svg',
            ),
          },
        };
      },
    }),
  );

  // The debugger resolves `nu` itself when a session starts
  context.subscriptions.push(...registerDebugger(nushell));

  // Register a command to stop the language server
  const stopCommand = vscode.commands.registerCommand(
    'nushell.stopLanguageServer',
    async () => {
      if (client) {
        try {
          await stopLanguageServer();
          vscode.window.showInformationMessage(
            'Nushell Language Server stopped.',
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to stop Nushell Language Server: ${error}`,
          );
        }
      } else {
        vscode.window.showInformationMessage(
          'Nushell Language Server is not running.',
        );
      }
    },
  );
  context.subscriptions.push(stopCommand);

  // Register a command to open documentation
  const openDocsCommand = vscode.commands.registerCommand(
    'nushell.openDocs',
    async () => {
      await vscode.env.openExternal(
        vscode.Uri.parse('https://www.nushell.sh/book/'),
      );
    },
  );
  context.subscriptions.push(openDocsCommand);

  // Register a command to start the language server
  const startCommand = vscode.commands.registerCommand(
    'nushell.startLanguageServer',
    async () => {
      const nushellPath = await nushell();
      if (!nushellPath) {
        return;
      }
      startLanguageServer(context, nushellPath);
      if (client) {
        vscode.window.showInformationMessage(
          'Nushell Language Server started.',
        );
      }
    },
  );
  context.subscriptions.push(startCommand);

  // Register a command to download (or update) the extension-managed Nushell
  const downloadCommand = vscode.commands.registerCommand(
    'nushell.downloadNushell',
    async () => {
      const downloaded = await downloadNushell(context);
      if (!downloaded) {
        return;
      }
      // Only (re)start the server when the downloaded copy is the one in use
      const resolution = resolveNushell(context);
      if (resolution.kind === 'found' && resolution.source === 'downloaded') {
        await restartLanguageServer(context, resolution.path);
      }
    },
  );
  context.subscriptions.push(downloadCommand);

  // Restart the language server when the executable path setting changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        !e.affectsConfiguration('nushellLanguageServer.nushellExecutablePath')
      ) {
        return;
      }
      const nushellPath = await nushell();
      if (nushellPath) {
        await restartLanguageServer(context, nushellPath);
      }
    }),
  );

  console.log('Activating Nushell Language Server extension.');

  // Start the language server once a `nu` is available (possibly after downloading it)
  void nushell().then((nushellPath) => {
    if (!nushellPath) {
      return;
    }
    console.log(`Found nushell executable at: ${nushellPath}`);
    startLanguageServer(context, nushellPath);
  });
}

async function stopLanguageServer(): Promise<void> {
  if (!client) {
    return;
  }
  const running = client;
  client = undefined;
  await running.stop();
}

async function restartLanguageServer(
  context: vscode.ExtensionContext,
  nushellPath: string,
): Promise<void> {
  try {
    await stopLanguageServer();
  } catch (error) {
    console.error('Failed to stop Nushell Language Server:', error);
  }
  startLanguageServer(context, nushellPath);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
