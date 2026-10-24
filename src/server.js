import http from 'node:http';
import crypto from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;

/** Constant-time string comparison (avoids leaking the secret through timing). */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Accepts the secret as-is or as "Bearer <secret>" in the Authorization header. */
export function isAuthorized(header, secret) {
  if (!header) return false;
  const value = header.startsWith('Bearer ') ? header.slice(7) : header;
  return safeEqual(value.trim(), secret);
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Create (but do not start) the webhook HTTP server.
 * @param {object} opts
 * @param {string} opts.secret                 shared secret Jellyseerr must send
 * @param {(payload: object) => Promise<void>} opts.onPendingRequest  called for MEDIA_PENDING
 * @param {() => boolean} [opts.isReady]       reports Discord readiness for /health
 */
export function createWebhookServer({ secret, onPendingRequest, isReady = () => true, logger }) {
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/health') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const ready = isReady();
      return send(res, ready ? 200 : 503, { status: ready ? 'ok' : 'starting' });
    }

    if (pathname !== '/webhook') return send(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    if (!isAuthorized(req.headers.authorization, secret)) {
      logger.warn(`Rejected webhook with missing/invalid Authorization header from ${req.socket.remoteAddress}`);
      return send(res, 401, { error: 'Unauthorized' });
    }

    let payload;
    try {
      payload = await readJson(req);
    } catch (err) {
      return send(res, err.status ?? 400, { error: err.message });
    }

    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return send(res, 400, { error: 'Invalid payload' });
    }

    logger.debug('Webhook received:', JSON.stringify(payload));

    // Only new requests awaiting approval are interesting; acknowledge everything else
    // (including Jellyseerr's "Test" button) so Jellyseerr doesn't report a failure.
    if (payload.notification_type !== 'MEDIA_PENDING') {
      logger.info(`Ignoring webhook of type ${String(payload.notification_type).slice(0, 40)}`);
      return send(res, 200, { status: 'ignored' });
    }

    try {
      await onPendingRequest(payload);
      return send(res, 200, { status: 'ok' });
    } catch (err) {
      logger.error('Failed to forward request to Discord:', err.message);
      return send(res, 502, { error: 'Failed to post to Discord' });
    }
  });

  // Defence against slow-loris style connections.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return server;
}
