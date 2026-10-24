# Discojelly

A small self-hosted Discord bot for [Jellyseerr](https://github.com/Fallenbagel/jellyseerr) (also works with Overseerr).

When someone requests a movie or show that needs approval, Discojelly posts it in a Discord channel with the poster, description and who asked for it. Authorised people click **Approve** or **Decline**, and the bot tells Jellyseerr. The message updates to show the result and who made the call.

- Poster, title, description, media type and requester shown on every request
- Approve / Decline buttons, restricted to the people you choose
- Optional "Open in Jellyseerr" button
- Webhook is protected by a shared secret
- One tiny container, two dependencies, no database

## Quick start (Docker)

You need Docker, a Discord bot, and a Jellyseerr API key.

### 1. Create the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application**.
2. Open the **Bot** tab, click **Reset Token**, and copy the token. Keep it private.
3. No privileged intents are needed. Leave them all off.
4. Start the bot once (step 3 below). It prints an **invite link** in its logs. Open it to add the bot to your server.
5. Make sure the bot can **View Channel**, **Send Messages** and **Embed Links** in the channel you want to use.

To copy IDs, turn on Developer Mode in Discord (Settings > Advanced), then right-click a channel or role and choose **Copy ID**.

### 2. Run the setup wizard

No clone or Node.js needed. In an empty folder on your server:

```bash
mkdir discojelly && cd discojelly
curl -O https://raw.githubusercontent.com/ZexusAU/Discojelly/main/docker-compose.yml

docker run -it --rm --user "$(id -u):$(id -g)" \
  -v "$PWD":/data -e ENV_FILE=/data/.env \
  ghcr.io/zexusau/discojelly:latest node setup.js
```

The wizard asks for your bot token, channel ID, Jellyseerr address and API key, generates the webhook secret for you, and saves everything to a private `.env` file in that folder. At the end it prints the exact values to paste into Jellyseerr.

Prefer to do it by hand? Download `.env.example` from this repo, save it as `.env`, and fill it in. Generate the secret with `openssl rand -hex 24`.

### 3. Start it

```bash
docker compose up -d
docker compose logs -f
```

You should see `Discord bot logged in as ...` and the invite link. Use the invite link to add the bot to your server (see step 1).

### 4. Configure Jellyseerr

In Jellyseerr go to **Settings > Notifications > Webhook** and set:

| Field | Value |
| --- | --- |
| Enable Agent | on |
| Webhook URL | `http://<bot-machine-ip>:3000/webhook` |
| Authorization Header | the `WEBHOOK_SECRET` from your `.env` |
| Notification Types | **Request Pending Approval** |
| JSON Payload | the template below |

```json
{
  "notification_type": "{{notification_type}}",
  "event": "{{event}}",
  "subject": "{{subject}}",
  "message": "{{message}}",
  "image": "{{image}}",
  "media": {
    "media_type": "{{media_type}}",
    "tmdbId": "{{media_tmdbid}}"
  },
  "request": {
    "request_id": "{{request_id}}",
    "requestedBy_username": "{{requestedBy_username}}"
  }
}
```

Press **Test**. The bot answers "ignored" for test messages, so Jellyseerr shows success but nothing is posted. Make a real request from a non-admin account to see it appear (requests from admins are auto-approved and never reach this bot).

If Jellyseerr runs in Docker on the same host, use the host's LAN IP or a shared Docker network name for the webhook URL rather than `localhost`.

## Running without Docker

Requires Node.js 20 or newer.

```bash
git clone https://github.com/ZexusAU/Discojelly.git
cd discojelly
npm install
npm run setup
npm start
```

## Configuration

All settings live in `.env`.

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | Bot token from the Developer Portal |
| `DISCORD_CHANNEL_ID` | yes | Channel where requests are posted |
| `JELLYSEERR_URL` | yes | Address the bot uses to reach Jellyseerr, e.g. `http://192.168.1.10:5055`. `/api/v1` is added for you |
| `JELLYSEERR_API_KEY` | yes | Jellyseerr > Settings > General |
| `WEBHOOK_SECRET` | yes | 16+ character secret; must match Jellyseerr's Authorization Header |
| `ALLOWED_ROLE_IDS` | no | Comma-separated role IDs allowed to approve/decline |
| `ALLOWED_USER_IDS` | no | Comma-separated user IDs allowed to approve/decline |
| `JELLYSEERR_PUBLIC_URL` | no | Address your browser uses; adds an "Open in Jellyseerr" button |
| `PORT` / `HOST` | no | Listen port (default `3000`) and address (default `0.0.0.0`) |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error` |

Upgrading from an early version? `JELLYSEERR_BASE_URL` still works, but you must now add a `WEBHOOK_SECRET`.

## Who can press the buttons?

By default only members with the **Manage Server** permission. Set `ALLOWED_ROLE_IDS` and/or `ALLOWED_USER_IDS` to choose exactly who instead. When either is set, only those people can act, even server admins. Anyone else gets a private "no permission" message and nothing is sent to Jellyseerr.

## Security notes

- Every webhook must carry your secret; requests without it get `401`. The comparison is constant-time.
- **Don't expose port 3000 to the internet.** Jellyseerr and the bot should talk over your LAN or a private Docker network. If you must publish it, put it behind a reverse proxy with HTTPS.
- The bot asks Discord for the minimum: no message-reading intent, no admin rights.
- Request IDs are validated as numbers before being used in any API call.
- Jellyseerr error bodies and webhook payloads are not logged (payloads only at `LOG_LEVEL=debug`).
- The container runs as a non-root user with a read-only filesystem and no extra capabilities.
- `.env` holds your bot token and API key. It is git-ignored; never commit or share it. If a token leaks, reset it in the Developer Portal and regenerate the Jellyseerr API key.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Bot exits immediately | It prints exactly which `.env` values are missing or invalid |
| Jellyseerr webhook shows an error | Webhook URL reachable from Jellyseerr? Authorization Header equals `WEBHOOK_SECRET`? |
| Nothing appears in Discord | Request must be *pending approval* (submitted by a non-admin). Check the bot can post in the channel. Logs say `Cannot access channel` if not |
| "Could not reach Jellyseerr" on click | `JELLYSEERR_URL` must be reachable **from the bot's container**, not just your browser |
| "rejected the API key" | Re-copy `JELLYSEERR_API_KEY` |
| Need more detail | Set `LOG_LEVEL=debug` in `.env` and run `docker compose up -d` again |

## Updating

```bash
docker compose pull && docker compose up -d
```

## Development

To build the image yourself instead of pulling it: `docker compose build`.

```bash
npm test
```

Tests use Node's built-in runner and need no extra packages.

## License

MIT
