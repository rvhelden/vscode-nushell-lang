import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { helpListsDap } from './dap-support';

test('helpListsDap finds the --dap flag in nu --help output', () => {
  const help =
    "  --lsp\n      start nu as a language server\n  --dap\n      start nu's debug adapter protocol server (over stdio)\n";
  assert.equal(helpListsDap(help), true);
});

test('helpListsDap is false without the flag', () => {
  assert.equal(helpListsDap('  --lsp\n  --mcp\n  --dapper\n'), false);
});
