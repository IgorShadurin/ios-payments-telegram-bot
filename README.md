# iOS Payments Telegram Bot

Receive verified payment and subscription events from several iOS apps and send
clear notifications to one Telegram chat. Every event is saved in persistent
SQLite first, so a Telegram outage does not lose payment data.

This is a small TypeScript/Next.js service for App Store Server Notifications
V2. It has one shared webhook URL for all registered apps, a protected app
registry API, owner-only Telegram commands, a command-line registry, durable
Telegram retry queues, Docker support, and a Coolify-ready health endpoint.

## What it reports

Messages have specific titles for important events, including:

- new subscription and resubscription;
- one-time purchase;
- successful renewal and billing recovery;
- failed renewal, grace-period expiry, and subscription expiry;
- refund, reversed refund, declined refund, and revoked purchase;
- auto-renew changes, offer redemption, price changes, and Apple test events;
- new Apple event types that the installed official library can decode.

The stored record also keeps useful verified fields such as product ID,
transaction IDs, environment, price, currency, purchase date, expiry date, and
renewal date.

## How verification works

Apple sends an HTTPS `POST` containing a compact JWS in `signedPayload`. The
service:

1. decodes the unsigned body only to find a possible bundle ID and environment;
2. finds that bundle ID in the local app registry;
3. uses Apple's official
   [`@apple/app-store-server-library`](https://github.com/apple/app-store-server-library-node)
   and the bundled
   [Apple root certificates](https://www.apple.com/certificateauthority/) to
   verify the certificate chain and JWS signature;
4. checks the environment and bundle ID, plus the numeric App Store app ID for
   production;
5. separately verifies nested transaction and renewal JWS values;
6. writes the event to SQLite using Apple's `notificationUUID` as an idempotency
   key;
7. returns success and attempts Telegram delivery after the response.

A decoded-but-unverified payload is never accepted as payment data. No App Store
Connect private key is required to receive notifications.

Apple recommends V2 for new implementations. Its documentation explains the
[signed V2 payload](https://developer.apple.com/documentation/appstoreservernotifications/receiving-app-store-server-notifications),
[HTTPS setup](https://developer.apple.com/documentation/appstoreservernotifications/enabling-app-store-server-notifications),
and [delivery retries](https://developer.apple.com/documentation/appstoreservernotifications/responding-to-app-store-server-notifications).

## Requirements

- Node.js 22.13 or newer;
- a Telegram bot token from
  [@BotFather](https://core.telegram.org/bots/features#botfather);
- a Telegram chat, group, or channel where the bot can post;
- each app's bundle ID and numeric App Store ID;
- HTTPS in production (Coolify supplies the reverse proxy and TLS).

## Local setup

Install dependencies and create the local environment file:

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=replace-with-your-real-bot-token
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_ALLOWED_USER_IDS=123456789
TELEGRAM_WEBHOOK_SECRET=replace-with-a-random-64-character-hex-secret
IOS_PAYMENTS_ADMIN_API_KEY=replace-with-a-random-64-character-hex-key
DATABASE_PATH=./data/ios-payments.sqlite
APPLE_ENABLE_ONLINE_CHECKS=true
```

`TELEGRAM_CHAT_ID` can be a private chat ID, a negative group/channel ID, or a
supergroup ID. Send the bot a message, then use Telegram's
[`getUpdates`](https://core.telegram.org/bots/api#getupdates) method to inspect
the resulting `message.chat.id`. If the destination is a forum topic, also set
`TELEGRAM_MESSAGE_THREAD_ID`.

`TELEGRAM_ALLOWED_USER_IDS` is a comma-separated allowlist of Telegram user
IDs. Commands work only when an allowlisted user sends them in that user's
private chat with the bot. The bot returns no message for other users, bots,
groups, supergroups, or channels.

Generate the webhook secret independently:

```bash
openssl rand -hex 32
```

The approved private-chat commands are:

```text
/apps  Show enabled tracked iOS apps
/help  Show every command
/start Show every command
```

Unknown commands, ordinary text, and unsupported messages from an approved
user return the complete command list.

Register every app before accepting its notifications:

```bash
npm run apps:dev -- add \
  --name "My App A" \
  --bundle-id com.example.appa \
  --app-apple-id 1234567890

npm run apps:dev -- add \
  --name "My App B" \
  --bundle-id com.example.appb \
  --app-apple-id 9876543210

npm run apps:dev -- list
```

The App Store ID is the numeric ID shown for the app in App Store Connect. It is
not the bundle ID, Team ID, or an In-App Purchase product ID.

Other registry commands:

```bash
npm run apps:dev -- update \
  --bundle-id com.example.appa \
  --name "My App A Pro"

npm run apps:dev -- disable --bundle-id com.example.appa
npm run apps:dev -- enable --bundle-id com.example.appa
npm run apps:dev -- remove --bundle-id com.example.appa
```

`disable` and `remove` both stop tracking without deleting payment history.
Every actual add, update, enable, disable, or remove operation creates a
Telegram audit message. If Telegram is unavailable, that message remains in
the durable SQLite outbox for the scheduled retry worker.

Start the development server:

```bash
npm run dev
```

The endpoints are:

```text
POST /api/apple/notifications
POST /api/telegram/webhook
GET  /api/health
GET  /api/admin/apps
PUT  /api/admin/apps/{bundleId}
DELETE /api/admin/apps/{bundleId}
```

For local Apple testing, expose port 3000 through an HTTPS tunnel. Do not use a
temporary tunnel URL for production.

## Configure Telegram commands

After deploying the HTTPS service, register its webhook and command menu:

```bash
npm run build
npm run telegram:configure -- \
  --url https://payments.example.com/api/telegram/webhook
```

This command reads `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and
`TELEGRAM_ALLOWED_USER_IDS` from the environment. It:

- registers only `message` updates with Telegram's secret webhook header;
- drops messages that arrived before command handling was enabled;
- removes any default/global command menu;
- sets the command menu only for each approved private chat;
- reads the webhook configuration back without printing either secret.

Telegram retries webhook updates when the endpoint does not return a successful
HTTP response. Run the configuration command again after changing the webhook
URL, secret, or approved-user list.

## Protected app registry API

Use this API from trusted automation instead of sharing a Coolify API token. It
can only list, register, update, enable, or remove apps from payment tracking.
It cannot deploy the service, read environment variables, or control other
Coolify resources.

Generate a dedicated 256-bit key:

```bash
openssl rand -hex 32
```

Store it as `IOS_PAYMENTS_ADMIN_API_KEY` in the service and in a
permission-restricted operator environment outside every Git repository. Send
it only in the `Authorization` header; never put it in a URL, command committed
to Git, screenshot, or log.

Register or update an app idempotently:

```bash
export IOS_PAYMENTS_ADMIN_API_URL=https://payments.example.com
export IOS_PAYMENTS_ADMIN_API_KEY=replace-with-the-dedicated-key

curl --fail-with-body \
  --request PUT \
  --header "Authorization: Bearer ${IOS_PAYMENTS_ADMIN_API_KEY}" \
  --header "Content-Type: application/json" \
  --data '{"name":"My App","appAppleId":1234567890}' \
  "${IOS_PAYMENTS_ADMIN_API_URL}/api/admin/apps/com.example.myapp"
```

List all registered and removed apps:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer ${IOS_PAYMENTS_ADMIN_API_KEY}" \
  "${IOS_PAYMENTS_ADMIN_API_URL}/api/admin/apps"
```

Remove an app from tracking while preserving its payment history:

```bash
curl --fail-with-body \
  --request DELETE \
  --header "Authorization: Bearer ${IOS_PAYMENTS_ADMIN_API_KEY}" \
  "${IOS_PAYMENTS_ADMIN_API_URL}/api/admin/apps/com.example.myapp"
```

An exact repeated `PUT` or `DELETE` returns `action: "unchanged"` and does not
send a duplicate Telegram audit message. Missing or incorrect credentials
receive HTTP `401`.

## Configure App Store Connect

For each app:

1. open the app in App Store Connect;
2. find its App Store Server Notifications settings;
3. choose **Version 2**;
4. set the production URL to
   `https://payments.example.com/api/apple/notifications`;
5. optionally use the same URL for sandbox notifications;
6. save and send a test notification through the App Store Server API.

The same endpoint is intentionally used by every app. TestFlight notifications
use the sandbox environment. Apple requires TLS 1.2 or newer and will retry V2
failures five times; see
[Enabling App Store Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications/enabling-app-store-server-notifications).

Example request shape (the JWS itself must be genuinely signed by Apple):

```bash
curl -i https://payments.example.com/api/apple/notifications \
  -H 'content-type: application/json' \
  --data '{"signedPayload":"eyJ...real-apple-jws..."}'
```

Expected accepted response:

```json
{"ok":true,"duplicate":false}
```

A fabricated or altered JWS receives an error and is never inserted.

## Delivery queue and retries

The webhook commits a verified event to SQLite before acknowledging it. The
first Telegram attempt happens immediately after the HTTP response. A failed
attempt becomes a queued retry with increasing delays up to 24 hours.

Run the retry worker periodically:

```bash
# Local source checkout
npm run deliver:dev -- --limit 100

# Built application or production container
node dist/scripts/deliver.js --limit 100
```

Run it every minute from cron or a Coolify Scheduled Task. Multiple attempts are
safe: each row is claimed atomically and delivered rows are not sent again.

## Docker Compose

```bash
cp .env.example .env
# Edit .env first.
docker compose build

# Register apps in the persistent named volume.
docker compose run --rm ios-payments-bot \
  node dist/scripts/apps.js add \
  --name "My App" \
  --bundle-id com.example.myapp \
  --app-apple-id 1234567890

docker compose up -d
```

The named volume is mounted at `/data`, matching the default container
`DATABASE_PATH`.

## Deploy to Coolify

1. Create an Application from this Git repository and select the included
   `Dockerfile`.
2. Set container port `3000` and assign a public HTTPS domain.
3. Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
   `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_WEBHOOK_SECRET`,
   `IOS_PAYMENTS_ADMIN_API_KEY`, optional `TELEGRAM_MESSAGE_THREAD_ID`,
   `DATABASE_PATH=/data/ios-payments.sqlite`, and
   `APPLE_ENABLE_ONLINE_CHECKS=true`.
4. Add persistent volume storage with destination path `/data`. Coolify's
   [persistent storage guide](https://coolify.io/docs/knowledge-base/persistent-storage)
   explains named volumes and bind mounts.
5. Set the health-check path to `/api/health`.
6. Deploy one replica. SQLite storage must not be shared across multiple
   containers or network filesystems.
7. Open the application's terminal and register each app:

   ```bash
   node dist/scripts/apps.js add \
     --name "My App" \
     --bundle-id com.example.myapp \
     --app-apple-id 1234567890
   ```

8. Add a Scheduled Task with cron expression `* * * * *` and command:

   ```bash
   node dist/scripts/deliver.js --limit 100
   ```

9. Configure the resulting HTTPS webhook URL in every app in App Store Connect.
10. Run the Telegram configuration command in the deployed container:

    ```bash
    node dist/scripts/configure-telegram.js \
      --url https://payments.example.com/api/telegram/webhook
    ```

Back up the `/data` volume. The SQLite database is the event history and retry
queue.

## Security and privacy choices

- Only Apple-signed V2 payloads for enabled, registered apps are accepted.
- Production events must match both the bundle ID and numeric App Store ID.
- Certificate expiration and revocation checks are enabled by default.
- Nested transaction and renewal values are verified, not merely decoded.
- Request bodies are limited to 512 KiB and parsed as UTF-8 JSON.
- SQL uses parameterized statements; app input is validated.
- App-management API access uses a separate high-entropy bearer key compared
  in constant time; responses are marked `no-store`.
- Incoming Telegram commands require Telegram's high-entropy webhook secret,
  an approved sender ID, and a matching private chat. Unapproved messages are
  acknowledged without a reply or identifying log.
- Duplicate Apple deliveries are idempotent by `notificationUUID`.
- Telegram HTML is escaped, and the bot token is never logged.
- Registry audit messages use a durable SQLite outbox and the same retry worker
  as payment notifications.
- Raw JWS values, `appAccountToken`, and external purchase tokens are not
  retained in the sanitized database payload.
- `.env`, SQLite files, logs, builds, and editor files are excluded from Git.
- Dependencies are pinned by `package-lock.json`; run `npm audit` when updating.

Keep `APPLE_ENABLE_ONLINE_CHECKS=true` in production. Turning it off disables
Apple certificate revocation and current-date checks and is intended only for
isolated troubleshooting.

An IP allowlist is optional because cryptographic verification is the trust
boundary. If infrastructure policy requires one, Apple documents `17.0.0.0/8`
for production and sandbox notifications. Rate limits at the reverse proxy
should leave enough headroom for Apple retries and subscription bursts.

## Development checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Tests cover certificate fingerprints, fake-signature rejection, routing hints,
database migrations and app state, deduplication, delivery queue transitions,
message escaping, price formatting, and body-size enforcement.

## Operational notes

- A `200` response means the verified event is durably stored, not necessarily
  already delivered to Telegram.
- A Telegram outage does not make Apple resend accepted events; the local retry
  worker handles them.
- A `404` usually means the app has not been registered or is disabled.
- A `401` means JWS, certificate, app identity, or environment verification
  failed.
- A `500`/`503` should be investigated; Apple will retry unsuccessful V2
  deliveries according to its documented schedule.
- Never commit `.env`, `.p8` App Store keys, bot tokens, production databases,
  database WAL files, or exported notification payloads.

## License

MIT. See [LICENSE](LICENSE).
