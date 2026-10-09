// Reading a script's `def`s without running it.
//
// Launching needs two things before the adapter starts: which command to call
// (`main`, or a function the user picks) and whether it needs arguments. Both
// come from nushell's own parser: `ast --json` parses the script (nothing is
// evaluated) and describes every top-level command with its signature.

import { promises as fs } from 'fs';
import * as path from 'path';

import { runNu } from '../shared/run-nu';

/** A top-level `def` in a script. */
export interface NuDefinition {
  name: string;
  /** The parameter list as written, without its brackets — for display. */
  signature: string;
  /** Does it have a positional parameter the caller must supply? */
  hasRequired: boolean;
}

/**
 * The script's top-level `def`s, parsed by `nu`. Undefined when that fails
 * (unreadable file, `nu` error, an AST shape we don't recognize): the launch
 * then goes ahead without asking, and nu-dap reports a missing argument.
 */
export async function readDefinitions(
  nu: string,
  program: string,
): Promise<NuDefinition[] | undefined> {
  try {
    const source = await fs.readFile(program, 'utf8');
    const stdout = await runNu(
      nu,
      'ast --json --minify $in | get block',
      source,
      path.dirname(program), // so `use ./lib.nu` resolves
    );
    return definitionsFromAst(JSON.parse(stdout));
  } catch {
    return undefined;
  }
}

/**
 * The `def`s among the top-level statements of an `ast --json` block. Defs in
 * a module or another def's body sit in nested blocks, so they are not seen.
 *
 * The JSON is nushell's internal AST, not a stable interface: every step is
 * checked, and a statement of a shape we don't recognize is skipped.
 */
export function definitionsFromAst(block: unknown): NuDefinition[] {
  const pipelines = field(block, 'pipelines');
  if (!Array.isArray(pipelines)) {
    return [];
  }

  const definitions: NuDefinition[] = [];
  for (const pipeline of pipelines) {
    const elements = field(pipeline, 'elements');
    const first: unknown = Array.isArray(elements) ? elements[0] : undefined;
    const call = field(field(field(first, 'expr'), 'expr'), 'Call');
    const definition = definitionFromCall(call);
    if (definition) {
      definitions.push(definition);
    }
  }

  return definitions;
}

/** `def name [...] {}` / `export def ...`, read from its call. */
function definitionFromCall(call: unknown): NuDefinition | undefined {
  const head = field(field(call, 'head'), 'span_source');
  if (typeof head !== 'string') {
    return undefined;
  }

  const command = head.trim().split(/\s+/).join(' ');
  if (command !== 'def' && command !== 'export def') {
    return undefined;
  }

  const args = field(call, 'arguments');
  if (!Array.isArray(args)) {
    return undefined;
  }

  const positionals = args.map((arg) => field(arg, 'Positional'));
  const name = positionals
    .map((positional) => field(field(positional, 'expr'), 'String'))
    .find((value) => typeof value === 'string');
  const signatureArg = positionals.find(
    (positional) => field(field(positional, 'expr'), 'Signature') !== undefined,
  );
  const signature = field(field(signatureArg, 'expr'), 'Signature');
  const required = field(signature, 'required_positional');
  const written = field(field(signatureArg, 'span'), 'span_source');
  if (typeof name !== 'string' || !Array.isArray(required)) {
    return undefined;
  }

  return {
    name,
    signature: typeof written === 'string' ? written.slice(1, -1) : '',
    hasRequired: required.length > 0,
  };
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}
