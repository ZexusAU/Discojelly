#!/usr/bin/env node
/**
 * Interactive setup wizard: asks for your settings, validates them with the same
 * rules the bot uses, generates a webhook secret, and writes a private .env file.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { loadConfig } from './src/config.js';

// ENV_FILE lets the Docker wizard write to a mounted folder (see README).
const ENV_PATH = process.env.ENV_FILE || new URL('./.env', import.meta.url);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// A line iterator buffers input, so this also works when answers are piped in.
const input = rl[Symbol.asyncIterator]();

async function prompt(question) {
  process.stdout.write(question);
  const { value, done } = await input.next();
  if (done) {
    console.error('\nInput ended before setup finished. Nothing was written.');
    process.exit(1);
  }
  return value;
}

async function ask(question, { required = true, check } = {}) {
  for (;;) {
    const answer = (await prompt(question)).trim();
    if (!answer && !required) return '';
    if (!answer) {
      console.log('  This one is required.');
      continue;
    }
    const problem = check?.(answer);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    return answer;
  }
}

// Reuse the bot's own validation so the wizard can never accept something the bot rejects.
const validator = (key) => (value) => {
  const base = {
    DISCORD_BOT_TOKEN: 'x',
    DISCORD_CHANNEL_ID: '123456789012345678',
    JELLYSEERR_API_KEY: 'x',
    JELLYSEERR_URL: 'http://localhost:5055',
    WEBHOOK_SECRET: 'x'.repeat(16),
  };
  try {
    loadConfig({ ...base, [key]: value });
    return null;
  } catch (err) {
    return err.message.split('\n').slice(1).join(' ').replace(/^\s*-\s*/, '');
  }
};

console.log('\nDiscojelly setup\n================\n');

if (fs.existsSync(ENV_PATH)) {
  const overwrite = (await prompt('A .env file already exists. Overwrite it? (y/N) ')).trim().toLowerCase();
  if (overwrite !== 'y') {
    console.log('Leaving your existing .env untouched.');
    rl.close();
    process.exit(0);
  }
}

console.log('Tip: enable Developer Mode in Discord (Settings > Advanced) to right-click and "Copy ID".\n');

const values = {
  DISCORD_BOT_TOKEN: await ask('Discord bot token: ', { check: validator('DISCORD_BOT_TOKEN') }),
  DISCORD_CHANNEL_ID: await ask('Discord channel ID for requests: ', { check: validator('DISCORD_CHANNEL_ID') }),
  JELLYSEERR_URL: await ask('Jellyseerr URL the bot can reach (e.g. http://192.168.1.10:5055): ', {
    check: validator('JELLYSEERR_URL'),
  }),
  JELLYSEERR_API_KEY: await ask('Jellyseerr API key (Settings > General): ', { check: validator('JELLYSEERR_API_KEY') }),
};

console.log('\nOptional (press Enter to skip):');
const publicUrl = await ask('  Public Jellyseerr URL for the "Open in Jellyseerr" button: ', {
  required: false,
  check: validator('JELLYSEERR_PUBLIC_URL'),
});
const roleIds = await ask('  Discord role IDs allowed to approve/decline (comma separated; blank = "Manage Server" permission): ', {
  required: false,
  check: validator('ALLOWED_ROLE_IDS'),
});
const userIds = await ask('  Discord user IDs allowed to approve/decline (comma separated): ', {
  required: false,
  check: validator('ALLOWED_USER_IDS'),
});
rl.close();

const secret = crypto.randomBytes(24).toString('hex');
const lines = [
  ...Object.entries(values).map(([k, v]) => `${k}=${v}`),
  `WEBHOOK_SECRET=${secret}`,
  publicUrl && `JELLYSEERR_PUBLIC_URL=${publicUrl}`,
  roleIds && `ALLOWED_ROLE_IDS=${roleIds}`,
  userIds && `ALLOWED_USER_IDS=${userIds}`,
].filter(Boolean);

fs.writeFileSync(ENV_PATH, `${lines.join('\n')}\n`, { mode: 0o600 });
try {
  loadConfig(Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])));
} catch (err) {
  console.error(`\nWrote .env but it did not validate:\n${err.message}`);
  process.exit(1);
}

console.log(`
.env created (readable only by you).

Next: in Jellyseerr go to Settings > Notifications > Webhook and set
  Webhook URL:           http://<this-machine's-IP>:3000/webhook
  Authorization Header:  ${secret}
  Notification Types:    Request Pending Approval
  JSON Payload:          see the README ("Configure Jellyseerr")

Then start the bot with:  docker compose up -d   (or: npm start)
`);
