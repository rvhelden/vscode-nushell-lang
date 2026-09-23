import * as fs from 'fs';
import * as vscode from 'vscode';

import { promptArgs } from './argument-prompt';
import {
  NuDefinition,
  findDefs,
  findMainSignature,
  hasRequiredPositional,
} from './script-signatures';

/** The extra entry in the entry-point picker: don't call a command, just run the file. */
const RUN_TOP_TO_BOTTOM = '▶ Run script top-to-bottom';

/**
 * Decide what the adapter should call and with which arguments: `main` when
 * the script has one, otherwise a function the user picks (or nothing, to run
 * the file top-to-bottom). Every path may return undefined, which aborts the
 * launch — that is how a cancelled prompt is reported.
 */
export async function resolveEntryPoint(
  config: vscode.DebugConfiguration,
  program: string,
): Promise<vscode.DebugConfiguration | undefined> {
  const source = readScript(program);
  const mainSignature = findMainSignature(source);
  if (mainSignature === undefined) {
    return await askForEntryPoint(config, source);
  }

  return await ensureArgs(config, 'main', mainSignature);
}

/** Unreadable file: return no source and let the adapter produce the real error. */
function readScript(program: string): string {
  try {
    return fs.readFileSync(program, 'utf8');
  } catch {
    return '';
  }
}

/** No `main`: let the user pick a function to debug (or run the script top-to-bottom). */
async function askForEntryPoint(
  config: vscode.DebugConfiguration,
  source: string,
): Promise<vscode.DebugConfiguration | undefined> {
  if (config.entryPoint !== undefined) {
    return config; // the launch config already names one
  }

  const defs = findDefs(source);
  if (defs.length === 0) {
    return config; // nothing to choose between
  }

  const picked = await pickEntryPoint(defs);
  if (picked === undefined) {
    return undefined; // cancelled
  }

  if (picked === RUN_TOP_TO_BOTTOM) {
    return config;
  }

  config.entryPoint = picked;
  return await ensureArgs(config, picked, signatureOf(defs, picked));
}

async function pickEntryPoint(
  defs: NuDefinition[],
): Promise<string | undefined> {
  const names = defs.map((def) => def.name);
  return await vscode.window.showQuickPick([RUN_TOP_TO_BOTTOM, ...names], {
    title: 'Nushell Debug: entry point',
    placeHolder:
      'This script has no `main`. Choose a function to debug (or run it top-to-bottom).',
    ignoreFocusOut: true,
  });
}

function signatureOf(defs: NuDefinition[], name: string): string {
  return defs.find((def) => def.name === name)?.signature ?? '';
}

/** Prompt for arguments when the entry point requires some and the launch config has none. */
async function ensureArgs(
  config: vscode.DebugConfiguration,
  entryPoint: string,
  signature: string,
): Promise<vscode.DebugConfiguration | undefined> {
  if (config.args !== undefined) {
    return config;
  }

  if (!hasRequiredPositional(signature)) {
    return config;
  }

  const args = await promptArgs(`${entryPoint} [${signature.trim()}]`);
  if (args === undefined) {
    return undefined; // cancelled
  }

  config.args = args;
  return config;
}
