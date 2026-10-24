import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, normalizeApiUrl } from '../src/config.js';

const valid = {
  DISCORD_BOT_TOKEN: 'token',
  DISCORD_CHANNEL_ID: '123456789012345678',
  JELLYSEERR_URL: 'http://192.168.1.10:5055',
  JELLYSEERR_API_KEY: 'key',
  WEBHOOK_SECRET: 'a'.repeat(24),
};

test('normalizeApiUrl handles trailing slash and existing /api/v1', () => {
  assert.equal(normalizeApiUrl('http://h:5055'), 'http://h:5055/api/v1');
  assert.equal(normalizeApiUrl('http://h:5055/'), 'http://h:5055/api/v1');
  assert.equal(normalizeApiUrl('http://h:5055/api/v1/'), 'http://h:5055/api/v1');
  assert.equal(normalizeApiUrl('https://h/jelly'), 'https://h/jelly/api/v1');
});

test('normalizeApiUrl rejects non-http schemes', () => {
  assert.throws(() => normalizeApiUrl('file:///etc/passwd'));
});

test('loadConfig accepts a valid environment and applies defaults', () => {
  const c = loadConfig(valid);
  assert.equal(c.apiUrl, 'http://192.168.1.10:5055/api/v1');
  assert.equal(c.port, 3000);
  assert.deepEqual(c.allowedRoleIds, []);
});

test('loadConfig accepts the legacy JELLYSEERR_BASE_URL name', () => {
  const { JELLYSEERR_URL, ...rest } = valid;
  const c = loadConfig({ ...rest, JELLYSEERR_BASE_URL: 'http://h:5055/api/v1' });
  assert.equal(c.apiUrl, 'http://h:5055/api/v1');
});

test('loadConfig reports every problem at once', () => {
  assert.throws(
    () => loadConfig({}),
    (err) => {
      assert.equal(err.name, 'ConfigError');
      for (const key of ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID', 'JELLYSEERR_URL', 'JELLYSEERR_API_KEY', 'WEBHOOK_SECRET']) {
        assert.match(err.message, new RegExp(key));
      }
      return true;
    },
  );
});

test('loadConfig rejects a short webhook secret', () => {
  assert.throws(() => loadConfig({ ...valid, WEBHOOK_SECRET: 'short' }), /WEBHOOK_SECRET/);
});

test('loadConfig validates allow-list IDs', () => {
  assert.throws(() => loadConfig({ ...valid, ALLOWED_ROLE_IDS: 'abc' }), /ALLOWED_ROLE_IDS/);
  const c = loadConfig({ ...valid, ALLOWED_USER_IDS: '123456789012345678, 223456789012345678' });
  assert.equal(c.allowedUserIds.length, 2);
});
