/** Whether `nu --help` output lists the `--dap` flag. */
export function helpListsDap(help: string): boolean {
  return /(^|\s)--dap\b/m.test(help);
}
