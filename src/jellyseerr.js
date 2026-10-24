/** Thin Jellyseerr/Overseerr API client. Uses Node's built-in fetch. */

export class JellyseerrError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'JellyseerrError';
    this.status = status;
  }
}

const ACTIONS = new Set(['approve', 'decline']);

export function createJellyseerrClient({ apiUrl, apiKey, fetchImpl = fetch, timeoutMs = 10_000 }) {
  /** Approve or decline a request. `requestId` must be a positive integer string. */
  async function setRequestStatus(action, requestId) {
    if (!ACTIONS.has(action)) throw new Error(`Unsupported action: ${action}`);
    if (!/^\d{1,10}$/.test(String(requestId))) throw new Error('Invalid request ID');

    let res;
    try {
      res = await fetchImpl(`${apiUrl}/request/${requestId}/${action}`, {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timed out' : err.message;
      throw new JellyseerrError(`Could not reach Jellyseerr (${reason})`, 0);
    }

    if (!res.ok) {
      throw new JellyseerrError(describeFailure(res.status), res.status);
    }
    return true;
  }

  return { setRequestStatus };
}

/** Human-friendly explanations that never echo the response body (it may contain internals). */
function describeFailure(status) {
  switch (status) {
    case 401:
    case 403:
      return 'Jellyseerr rejected the API key (check JELLYSEERR_API_KEY)';
    case 404:
      return 'That request no longer exists in Jellyseerr';
    case 409:
      return 'That request was already handled';
    default:
      return `Jellyseerr returned HTTP ${status}`;
  }
}
