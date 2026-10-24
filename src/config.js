/**
 * Environment parsing and validation.
 * All problems are collected and reported together so first-time users can fix
 * their .env in one pass instead of one error at a time.
 */

const SNOWFLAKE = /^\d{17,20}$/;

/** Split a comma/space separated list of Discord IDs. */
function parseIdList(raw, name, errors) {
  if (!raw) return [];
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    if (!SNOWFLAKE.test(id)) errors.push(`${name} contains an invalid Discord ID: "${id}"`);
  }
  return ids;
}

/**
 * Accepts "http://host:5055", "http://host:5055/", or "http://host:5055/api/v1"
 * and always returns the API root ending in /api/v1.
 */
export function normalizeApiUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('must start with http:// or https://');
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/api/v1')) path += '/api/v1';
  return `${url.origin}${path}`;
}

export function loadConfig(env = process.env) {
  const errors = [];
  const get = (key) => (env[key] ?? '').trim();

  const botToken = get('DISCORD_BOT_TOKEN');
  if (!botToken) errors.push('DISCORD_BOT_TOKEN is required');

  const channelId = get('DISCORD_CHANNEL_ID');
  if (!SNOWFLAKE.test(channelId)) {
    errors.push('DISCORD_CHANNEL_ID is required and must be a numeric Discord channel ID');
  }

  const apiKey = get('JELLYSEERR_API_KEY');
  if (!apiKey) errors.push('JELLYSEERR_API_KEY is required');

  // JELLYSEERR_BASE_URL is the name used by early versions; still accepted.
  const rawUrl = get('JELLYSEERR_URL') || get('JELLYSEERR_BASE_URL');
  let apiUrl = '';
  if (!rawUrl) {
    errors.push('JELLYSEERR_URL is required (e.g. http://192.168.1.10:5055)');
  } else {
    try {
      apiUrl = normalizeApiUrl(rawUrl);
    } catch (err) {
      errors.push(`JELLYSEERR_URL is not a valid URL: ${err.message}`);
    }
  }

  let publicUrl = '';
  const rawPublic = get('JELLYSEERR_PUBLIC_URL');
  if (rawPublic) {
    try {
      const u = new URL(rawPublic);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      publicUrl = u.origin + u.pathname.replace(/\/+$/, '');
    } catch {
      errors.push('JELLYSEERR_PUBLIC_URL is not a valid http(s) URL');
    }
  }

  const webhookSecret = get('WEBHOOK_SECRET');
  if (webhookSecret.length < 16) {
    errors.push(
      'WEBHOOK_SECRET is required and must be at least 16 characters (run "npm run setup" to generate one)',
    );
  }

  const port = Number(get('PORT') || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a number between 1 and 65535');
  }

  const logLevel = (get('LOG_LEVEL') || 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    errors.push('LOG_LEVEL must be one of: debug, info, warn, error');
  }

  const allowedRoleIds = parseIdList(get('ALLOWED_ROLE_IDS'), 'ALLOWED_ROLE_IDS', errors);
  const allowedUserIds = parseIdList(get('ALLOWED_USER_IDS'), 'ALLOWED_USER_IDS', errors);

  if (errors.length > 0) {
    const err = new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
    err.name = 'ConfigError';
    throw err;
  }

  return {
    botToken,
    channelId,
    apiKey,
    apiUrl,
    publicUrl,
    webhookSecret,
    port,
    host: get('HOST') || '0.0.0.0',
    logLevel,
    allowedRoleIds,
    allowedUserIds,
  };
}
