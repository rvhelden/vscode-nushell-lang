/** Split a command line into arguments, honoring single and double quotes. */
export function splitArgs(line: string): string[] {
  const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const args: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(line)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }

  return args;
}
