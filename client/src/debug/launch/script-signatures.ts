// Reading a script's `def`s without running nushell.
//
// Launching needs two things before the adapter starts: which command to call
// (`main`, or a function the user picks) and whether it needs arguments. Both
// are answered by scanning the source text with regexes — deliberately shallow,
// good enough for top-level definitions.

/** A top-level `def` in a script, with its raw parameter list. */
export interface NuDefinition {
  name: string;
  signature: string;
}

/** Parameter list of the top-level `def main [...]`, or undefined when the script has no `main`. */
export function findMainSignature(source: string): string | undefined {
  const MAIN_DEF =
    /(?:^|\n)\s*(?:export\s+)?def\s+(?:--\S+\s+)*main\s*\[([^\]]*)\]/;
  const match = MAIN_DEF.exec(source);
  if (!match) {
    return undefined;
  }

  return match[1];
}

/** Every top-level `def`/`export def` except `main` — offered as entry points when there is no `main`. */
export function findDefs(source: string): NuDefinition[] {
  const ANY_DEF =
    /(?:^|\n)\s*(?:export\s+)?def\s+(?:--\S+\s+)*(?:"([^"]+)"|([\w:-]+))\s*\[([^\]]*)\]/g;
  const definitions: NuDefinition[] = [];
  let match: RegExpExecArray | null;
  while ((match = ANY_DEF.exec(source)) !== null) {
    const name = match[1] ?? match[2];
    if (!name) {
      continue;
    }

    if (name === 'main') {
      continue;
    }

    definitions.push({ name, signature: match[3] });
  }

  return definitions;
}

/** Does this signature have a parameter the caller must supply? */
export function hasRequiredPositional(signature: string): boolean {
  return splitParameters(signature).some(isRequiredPositional);
}

function splitParameters(signature: string): string[] {
  return signature
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(isParameter);
}

function isParameter(text: string): boolean {
  if (text.length === 0) {
    return false;
  }

  return !text.startsWith('#'); // a comment between parameters
}

function isRequiredPositional(parameter: string): boolean {
  if (parameter.startsWith('--')) {
    return false; // a flag
  }

  if (parameter.startsWith('...')) {
    return false; // a rest parameter
  }

  if (parameter.includes('=')) {
    return false; // has a default
  }

  if (/^\w+\?/.test(parameter)) {
    return false; // explicitly optional: `name?`
  }

  return true;
}
