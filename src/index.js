import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createJellyseerrClient } from './jellyseerr.js';
import { createWebhookServer } from './server.js';
import { buildRequestMessage, createInteractionHandler, parseRequestPayload } from './discord.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`\n${err.message}\n\nSee the README, or run "npm run setup" to create a .env file.`);
  process.exit(1);
}

const logger = createLogger(config.logLevel);
const jellyseerr = createJellyseerrClient({ apiUrl: config.apiUrl, apiKey: config.apiKey });

// Only the Guilds intent is needed: buttons are interactions, not message events,
// so the privileged "Message Content" intent is deliberately NOT requested.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  logger.info(`Discord bot logged in as ${c.user.tag}`);
  logger.info(
    `Invite link: https://discord.com/oauth2/authorize?client_id=${c.user.id}&scope=bot&permissions=19456`,
  );
  try {
    await c.channels.fetch(config.channelId);
  } catch {
    logger.error(
      `Cannot access channel ${config.channelId}. Check the ID and that the bot can view and post in that channel.`,
    );
  }
});

client.on(Events.InteractionCreate, createInteractionHandler({ config, jellyseerr, logger }));
client.on(Events.Error, (err) => logger.error('Discord client error:', err.message));

async function postPendingRequest(payload) {
  const data = parseRequestPayload(payload);
  if (!data) {
    logger.warn('MEDIA_PENDING webhook had no valid request_id; check your Jellyseerr JSON payload template');
    return;
  }
  const channel = await client.channels.fetch(config.channelId);
  if (!channel?.isSendable()) throw new Error('Configured Discord channel is not a text channel the bot can post in');
  await channel.send(buildRequestMessage(data, { publicUrl: config.publicUrl }));
  logger.info(`Posted request ${data.requestId} ("${data.title}") to Discord`);
}

const server = createWebhookServer({
  secret: config.webhookSecret,
  onPendingRequest: postPendingRequest,
  isReady: () => client.isReady(),
  logger,
});

server.listen(config.port, config.host, () => {
  logger.info(`Webhook server listening on ${config.host}:${config.port} (POST /webhook, GET /health)`);
});

client.login(config.botToken).catch((err) => {
  logger.error(`Discord login failed: ${err.message}`);
  process.exit(1);
});

// Clean shutdown so `docker stop` is fast and doesn't kill in-flight requests.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    await client.destroy();
    process.exit(0);
  });
}
