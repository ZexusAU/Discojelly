import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { buildRequestMessage, createInteractionHandler, isAllowed, parseRequestPayload } from '../src/discord.js';
import { createJellyseerrClient } from '../src/jellyseerr.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const payload = {
  notification_type: 'MEDIA_PENDING',
  subject: 'Dune (2021)',
  message: 'A noble family becomes embroiled in a war.',
  image: 'https://image.tmdb.org/t/p/w600/x.jpg',
  media: { media_type: 'movie', tmdbId: '438631' },
  request: { request_id: '42', requestedBy_username: 'alice' },
};

test('parseRequestPayload extracts fields and rejects bad request IDs', () => {
  const d = parseRequestPayload(payload);
  assert.equal(d.requestId, '42');
  assert.equal(d.requestedBy, 'alice');
  assert.equal(parseRequestPayload({ ...payload, request: { request_id: '4/../2' } }), null);
  assert.equal(parseRequestPayload({ ...payload, request: {} }), null);
});

test('parseRequestPayload drops invalid or non-http image URLs', () => {
  assert.equal(parseRequestPayload({ ...payload, image: '' }).image, null);
  assert.equal(parseRequestPayload({ ...payload, image: 'javascript:alert(1)' }).image, null);
});

test('buildRequestMessage produces embed with buttons and truncates long text', () => {
  const data = parseRequestPayload({ ...payload, message: 'x'.repeat(5000) });
  const msg = buildRequestMessage(data, { publicUrl: 'https://jelly.example.com' });
  const embed = msg.embeds[0].toJSON();
  assert.ok(embed.description.length <= 1000);
  const buttons = msg.components[0].toJSON().components;
  assert.equal(buttons[0].custom_id, 'jr:approve:42');
  assert.equal(buttons[1].custom_id, 'jr:decline:42');
  assert.equal(buttons[2].url, 'https://jelly.example.com/movie/438631');
});

test('buildRequestMessage omits link button without a public URL', () => {
  const msg = buildRequestMessage(parseRequestPayload(payload));
  assert.equal(msg.components[0].toJSON().components.length, 2);
});

const cfg = { channelId: '111111111111111111', allowedRoleIds: [], allowedUserIds: [] };
const fakeInteraction = (over = {}) => ({
  user: { id: '999999999999999999', tag: 'bob', username: 'bob' },
  member: { roles: { cache: new Map() } },
  memberPermissions: { has: () => false },
  ...over,
});

test('isAllowed defaults to Manage Server permission', () => {
  assert.equal(isAllowed(fakeInteraction(), cfg), false);
  const admin = fakeInteraction({ memberPermissions: { has: (f) => f === PermissionFlagsBits.ManageGuild } });
  assert.equal(isAllowed(admin, cfg), true);
});

test('isAllowed honours explicit role and user lists over permissions', () => {
  const roleCfg = { ...cfg, allowedRoleIds: ['222222222222222222'] };
  const withRole = fakeInteraction({ member: { roles: { cache: new Map([['222222222222222222', {}]]) } } });
  assert.equal(isAllowed(withRole, roleCfg), true);
  const admin = fakeInteraction({ memberPermissions: { has: () => true } });
  assert.equal(isAllowed(admin, roleCfg), false, 'admin not on the list should be denied');
  assert.equal(isAllowed(fakeInteraction(), { ...cfg, allowedUserIds: ['999999999999999999'] }), true);
});

function buttonInteraction(customId, over = {}) {
  const calls = [];
  const i = fakeInteraction({
    isButton: () => true,
    customId,
    channelId: cfg.channelId,
    memberPermissions: { has: () => true },
    message: {
      embeds: [{ title: 'Dune', fields: [], data: { title: 'Dune' }, toJSON: () => ({ title: 'Dune' }) }],
      components: [{ components: [] }],
    },
    reply: async (a) => calls.push(['reply', a]),
    deferUpdate: async () => calls.push(['deferUpdate']),
    editReply: async (a) => calls.push(['editReply', a]),
    followUp: async (a) => calls.push(['followUp', a]),
    ...over,
  });
  return { i, calls };
}

test('button click by an authorised user calls Jellyseerr and updates the message', async () => {
  const requests = [];
  const jellyseerr = createJellyseerrClient({
    apiUrl: 'http://j/api/v1',
    apiKey: 'k',
    fetchImpl: async (url, opts) => { requests.push([url, opts]); return { ok: true, status: 200 }; },
  });
  const handle = createInteractionHandler({ config: cfg, jellyseerr, logger: silent });
  const { i, calls } = buttonInteraction('jr:approve:42');
  await handle(i);
  assert.equal(requests[0][0], 'http://j/api/v1/request/42/approve');
  assert.equal(requests[0][1].headers['X-Api-Key'], 'k');
  assert.deepEqual(calls.map((c) => c[0]), ['deferUpdate', 'editReply']);
  assert.deepEqual(calls[1][1].components, []);
});

test('button click by an unauthorised user is refused and Jellyseerr is never called', async () => {
  let called = false;
  const handle = createInteractionHandler({
    config: cfg,
    jellyseerr: { setRequestStatus: async () => { called = true; } },
    logger: silent,
  });
  const { i, calls } = buttonInteraction('jr:decline:42', { memberPermissions: { has: () => false } });
  await handle(i);
  assert.equal(called, false);
  assert.equal(calls[0][0], 'reply');
});

test('malformed custom IDs and other channels are ignored', async () => {
  const handle = createInteractionHandler({
    config: cfg,
    jellyseerr: { setRequestStatus: async () => { throw new Error('should not be called'); } },
    logger: silent,
  });
  for (const id of ['jr:approve:../../x', 'approve_42', 'jr:delete:1']) {
    const { i, calls } = buttonInteraction(id);
    await handle(i);
    assert.equal(calls.length, 0);
  }
  const { i, calls } = buttonInteraction('jr:approve:42', { channelId: '555555555555555555' });
  await handle(i);
  assert.equal(calls.length, 0);
});

test('Jellyseerr failure is reported privately to the clicker', async () => {
  const jellyseerr = createJellyseerrClient({
    apiUrl: 'http://j/api/v1', apiKey: 'k',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  const handle = createInteractionHandler({ config: cfg, jellyseerr, logger: silent });
  const { i, calls } = buttonInteraction('jr:approve:42');
  await handle(i);
  assert.equal(calls.at(-1)[0], 'followUp');
  assert.match(calls.at(-1)[1].content, /no longer exists/);
});

test('Jellyseerr client rejects non-numeric IDs and maps network errors', async () => {
  const ok = createJellyseerrClient({ apiUrl: 'http://j/api/v1', apiKey: 'k', fetchImpl: async () => ({ ok: true }) });
  await assert.rejects(() => ok.setRequestStatus('approve', '1/../../settings'), /Invalid request ID/);
  await assert.rejects(() => ok.setRequestStatus('delete', '1'), /Unsupported action/);
  const down = createJellyseerrClient({
    apiUrl: 'http://j/api/v1', apiKey: 'k',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  await assert.rejects(() => down.setRequestStatus('approve', '1'), /Could not reach Jellyseerr/);
});
