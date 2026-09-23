import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

import { parseNuVersion } from '../../nushell/release';
import { helpListsDap } from './dap-support';

const execFileAsync = promisify(execFile);

/** The first Nushell release that ships `nu --dap`. */
export const MIN_DAP_VERSION = '0.116.0';

/** Finds (and if needed, downloads) the `nu` to run; undefined when there is none. */
export type NushellResolver = () => Promise<string | undefined>;

/**
 * The debugger ships inside Nushell itself: `nu --dap` starts a Debug Adapter
 * Protocol server over stdio — the same entry point Zed, Neovim, and any other
 * DAP client use. All we do is find a `nu` (the same one the language server
 * uses) and spawn it.
 */
export class AdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  /** `nu` paths already known to support `--dap`. */
  private readonly supported = new Set<string>();

  constructor(private readonly resolveNushell: NushellResolver) {}

  /** Throws when there is no usable `nu`; VS Code shows the message and aborts the launch. */
  async createDebugAdapterDescriptor(): Promise<vscode.DebugAdapterDescriptor> {
    const nu = await this.resolveNushell();
    if (!nu) {
      throw new Error("Nushell Debug: no 'nu' executable found.");
    }

    await this.checkDapSupport(nu);
    return new vscode.DebugAdapterExecutable(nu, ['--dap']);
  }

  /**
   * Checks the flag rather than the version, so dev and nightly builds that
   * already have `--dap` work too. Not cached on failure: the user may
   * upgrade `nu` before the next launch.
   */
  private async checkDapSupport(nu: string): Promise<void> {
    if (this.supported.has(nu)) {
      return;
    }

    let help: string;
    try {
      help = (await execFileAsync(nu, ['--help'], { timeout: 10000 })).stdout;
    } catch {
      return; // could not ask: let `nu --dap` speak for itself
    }

    if (helpListsDap(help)) {
      this.supported.add(nu);
      return;
    }

    const version = await nuVersion(nu);
    throw new Error(
      `Nushell Debug: ${nu}${version ? ` (${version})` : ''} does not support 'nu --dap'; ` +
        `debugging needs Nushell ${MIN_DAP_VERSION} or newer. ` +
        'Upgrade nu, or point nushellLanguageServer.nushellExecutablePath at a newer one ' +
        "(e.g. the copy installed by 'Nushell: Download / Update Nushell').",
    );
  }
}

async function nuVersion(nu: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(nu, ['--version'], {
      timeout: 10000,
    });
    return parseNuVersion(stdout);
  } catch {
    return undefined;
  }
}
