import assert from 'node:assert/strict';
import test from 'node:test';
import { levelToneClass } from '../src/security.ts';

test('known log levels map to their visual tone', () => {
  assert.equal(levelToneClass('ERROR'), 'error');
  assert.equal(levelToneClass('warning'), 'warning');
  assert.equal(levelToneClass('INVALID'), 'invalid');
});

test('untrusted log levels cannot become HTML or CSS tokens', () => {
  for (const value of ['" onmouseover="alert(1)', 'error extra-class', '</b><script>alert(1)</script>']) {
    assert.equal(levelToneClass(value), 'other');
  }
});
