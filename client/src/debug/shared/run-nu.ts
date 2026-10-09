import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Run a nu `command` with `input` as `$in` and return its stdout. No config is
 * loaded, so the user's config can't change the output. Rejects when `nu`
 * fails or takes longer than 10s.
 */
export async function runNu(
  nu: string,
  command: string,
  input: string,
  cwd: string | undefined,
): Promise<string> {
  const run = execFileAsync(
    nu,
    ['--no-config-file', '--stdin', '-c', command],
    {
      cwd,
      timeout: 10000,
      maxBuffer: 256 * 1024 * 1024, // an AST is far bigger than its source
    },
  );
  run.child.stdin?.end(input);
  const { stdout } = await run;
  return stdout;
}
