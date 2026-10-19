const test = require('node:test');
const assert = require('node:assert/strict');
const { SafeExpressionParser, calculate, createTimer, getTime } = require('../backend/src/tools.cjs');

test('calculator evaluates only supported arithmetic without eval', () => {
  assert.equal(new SafeExpressionParser('2 + 3 * (4 - 1)').parse(), 11);
  assert.equal(calculate({ expression: '2^8' }).value, 256);
  assert.throws(() => calculate({ expression: 'process.exit()' }), /Calculations support/);
  assert.throws(() => calculate({ expression: '2 / 0' }), /Division by zero/);
});

test('timer validates bounded duration and preserves a label', () => {
  assert.deepEqual(createTimer({ durationSeconds: 300, label: 'Tea' }), { durationSeconds: 300, label: 'Tea', startsOnClient: true });
  assert.throws(() => createTimer({ durationSeconds: 0 }), /between 1 and/);
  assert.throws(() => createTimer({ durationSeconds: 100000 }), /between 1 and/);
});

test('time tool returns a trusted ISO timestamp and honors a valid IANA zone', () => {
  const result = getTime({ timeZone: 'Europe/Paris' });
  assert.match(result.iso, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.timeZone, 'Europe/Paris');
  assert.throws(() => getTime({ timeZone: 'Not/AZone' }), /not recognized/);
});
