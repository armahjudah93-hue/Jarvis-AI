const test = require('node:test');
const assert = require('node:assert/strict');
const { routeCommand } = require('../backend/src/orchestrator.cjs');

const localConfig = { openaiApiKey: '', allowLocalFallback: true };

test('local command router prepares a validated client timer', async () => {
  const response = await routeCommand({ message: 'Set a timer for 5 minutes', history: [], config: localConfig });
  assert.equal(response.status, 'requires_client_action');
  assert.equal(response.orchestrator, 'local');
  assert.equal(response.action.name, 'create_timer');
  assert.equal(response.action.result.durationSeconds, 300);
});

test('local router does not claim to execute unsupported Mac actions', async () => {
  const response = await routeCommand({ message: 'Delete every file in Downloads', history: [], config: localConfig });
  assert.equal(response.status, 'unavailable');
  assert.equal(response.action, null);
  assert.match(response.message, /AI model is not configured/);
});
