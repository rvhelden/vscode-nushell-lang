import * as path from 'path';
import * as vscode from 'vscode';

import { resolveNushell } from '../../nushell/resolve';
import { DEBUG_TYPE } from '../shared/debug-type';
import { isNuDocument } from '../shared/nu-document';
import { resolveEntryPoint } from './entry-point';
import { resolveLaunchPaths } from './launch-paths';

export class LaunchConfigurationProvider
  implements vscode.DebugConfigurationProvider
{
  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    fillInActiveFile(folder, config);
    if (!config.program) {
      void vscode.window.showErrorMessage(
        "Nushell Debug: no program specified. Open a .nu file or set 'program' in launch.json.",
      );
      return undefined;
    }

    return config;
  }

  /**
   * Runs after ${file}/${workspaceFolder} substitution, so `program` is a real
   * path we can read — which is what lets us ask about entry point and args.
   */
  async resolveDebugConfigurationWithSubstitutedVariables(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): Promise<vscode.DebugConfiguration | undefined> {
    if (config.request !== 'launch') {
      return config;
    }

    if (typeof config.program !== 'string') {
      return config;
    }

    const paths = resolveLaunchPaths(
      folder?.uri.fsPath,
      config.program,
      config.cwd,
    );
    config.program = paths.program;
    config.cwd = paths.cwd;
    return await resolveEntryPoint(config, config.program, quietNushell());
  }
}

/**
 * The `nu` to parse the script with. Unlike `ensureNushell` this doesn't
 * report a missing `nu`: the adapter factory does that once, right after.
 */
function quietNushell(): string | undefined {
  const resolution = resolveNushell();
  return resolution.kind === 'found' ? resolution.path : undefined;
}

/** F5 with no launch.json: debug the active .nu file. */
function fillInActiveFile(
  folder: vscode.WorkspaceFolder | undefined,
  config: vscode.DebugConfiguration,
): void {
  if (config.type || config.request || config.name) {
    return; // a real launch config; leave it alone
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  if (!isNuDocument(editor.document)) {
    return;
  }

  const script = editor.document.uri.fsPath;
  config.type = DEBUG_TYPE;
  config.request = 'launch';
  config.name = 'Debug nu script';
  config.program = script;
  config.cwd = folder?.uri.fsPath ?? path.dirname(script);
}
