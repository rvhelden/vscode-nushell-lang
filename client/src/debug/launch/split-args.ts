/**
 * Split a command line into arguments, honoring single and double quotes.
 * Quotes group anywhere in a token (`--name="a b"` is one argument) and are
 * dropped from the result.
 */
export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let inToken = false; // tells `""` (an empty argument) apart from no argument
  let quote: string | undefined;

  for (const char of line) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
    } else if (/\s/.test(char)) {
      if (inToken) {
        args.push(current);
        current = '';
        inToken = false;
      }
    } else {
      current += char;
      inToken = true;
    }
  }

  if (inToken) {
    args.push(current); // an unclosed quote runs to the end of the line
  }

  return args;
}
