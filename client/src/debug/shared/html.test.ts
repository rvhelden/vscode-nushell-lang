import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fillTemplate, hint } from './html';

test('fillTemplate substitutes every placeholder verbatim', () => {
  assert.equal(
    fillTemplate('<h2>{{name}}</h2>{{name}}: {{type}}', {
      name: '$files',
      type: 'table',
    }),
    '<h2>$files</h2>$files: table',
  );
});

test('fillTemplate leaves an unknown placeholder in place', () => {
  assert.equal(
    fillTemplate('{{known}} {{unknown}}', { known: 'x' }),
    'x {{unknown}}',
  );
});

test('fillTemplate never expands placeholders that arrive inside a value', () => {
  assert.equal(
    fillTemplate('{{data}}', { data: '{"text":"{{name}}"}', name: 'leak' }),
    '{"text":"{{name}}"}',
  );
});

test('hint escapes its text', () => {
  assert.equal(hint('a <b>'), '<p class="hint">a &lt;b&gt;</p>');
});
