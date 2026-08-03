# iOS Payments Telegram Bot

Never miss an App Store purchase, subscription renewal, billing failure,
refund, or new customer review across your iOS apps. This service verifies
Apple's payment notifications, securely checks App Store Connect for reviews,
stores events in persistent SQLite, and sends clear Telegram alerts. If
Telegram is temporarily unavailable, delivery is retried without losing the
alert.

This is a small TypeScript/Next.js service for App Store Server Notifications
V2. It has one shared webhook URL for all registered apps, a protected app
registry API, owner-only Telegram commands, optional customer-review polling, a
command-line registry, durable Telegram retry queues, Docker support, and a
Coolify-ready health endpoint.

## Payment alerts

Production alerts omit a redundant environment label. Sandbox titles keep an
unmistakable `[SANDBOX]` label, use the `🧪` icon, and explicitly say
`test only; no real charge`. Transaction alerts also state the action and Apple
product type, so a first purchase, subscription renewal, one-time purchase, and
refund are visibly different.

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

For non-USD purchases, the amount shows a daily USD estimate first and Apple's
verified original amount second, for example `$5.12 (¥800)`. The service stores
the complete USD-based ISO currency table in SQLite and refreshes it daily from
[ExchangeRate-API](https://www.exchangerate-api.com). Payment webhooks never
wait on that provider: if a refresh fails, the previous stored rates remain in
use; if no rate exists, the original amount is still delivered.

## Customer-review alerts

The optional review worker uses Apple's official App Store Connect API to check
every enabled app for new written reviews. An alert shows the app, star rating,
title, review text, reviewer nickname, territory, and creation date.

Apple does not include customer reviews in App Store Server Notifications or
its App Store Connect webhook event types, so review alerts use scheduled
polling instead of a webhook. Review API responses require a short-lived ES256
token signed with an App Store Connect API key.

The first successful poll for each app creates a silent baseline from its most
recent reviews. It does not send old reviews. Later polls store and enqueue only
previously unseen Apple review IDs. Up to 1,000 reviews per app can be scanned
in one run, and the poll stops early when it reaches a known review.

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

Review alerts additionally require an App Store Connect team or individual API
key with permission to view the tracked apps' customer reviews.

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

# Optional: send only successful production subscriptions and customer reviews.
TELEGRAM_PAYMENT_NOTIFICATION_TYPES=SUBSCRIBED,DID_RENEW
TELEGRAM_PAYMENT_ENVIRONMENTS=Production
TELEGRAM_OUTBOX_CATEGORIES=app_review

# Optional review polling:
APP_STORE_CONNECT_KEY_TYPE=team
APP_STORE_CONNECT_ISSUER_ID=00000000-0000-0000-0000-000000000000
APP_STORE_CONNECT_KEY_ID=ABC123DEFG
APP_STORE_CONNECT_PRIVATE_KEY_BASE64=replace-with-base64-encoded-p8
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

The three optional notification allowlists control what is delivered:

- `TELEGRAM_PAYMENT_NOTIFICATION_TYPES` contains Apple V2 notification types.
  `SUBSCRIBED,DID_RENEW` means successful initial subscriptions,
  resubscriptions, renewals, and billing recoveries.
- `TELEGRAM_PAYMENT_ENVIRONMENTS=Production` suppresses every sandbox event.
- `TELEGRAM_OUTBOX_CATEGORIES=app_review` allows customer-review alerts while
  suppressing automatic app-registry change alerts.

Omit an allowlist to permit every value in that dimension. Disallowed Apple
events are still signature-verified, stored, and deduplicated in SQLite, but
are marked handled without contacting Telegram. The delivery worker applies
the current policy to existing queued messages too, so enabling a filter does
not release an old sandbox or failure backlog.

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
GET  /api/admin/reviews
POST /api/admin/reviews
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
It can also trigger an App Store review poll and read reviews stored by this
service. It cannot deploy the service, read environment variables, or control
other Coolify resources.

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

Manually poll Apple for reviews and return up to 100 reviews stored in SQLite:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${IOS_PAYMENTS_ADMIN_API_KEY}" \
  "${IOS_PAYMENTS_ADMIN_API_URL}/api/admin/reviews?limit=100&notify=true"
```

The response includes the poll summary, bundle IDs that failed, and stored
review details. `notify=true` also places the returned stored reviews in the
durable Telegram outbox, including reviews that were silently stored during
the initial baseline. Delivery is attempted immediately after the response and
retried by the existing one-minute worker if Telegram is unavailable. Apple's
review ID remains the deduplication key, so repeating the request does not send
the same review again.

Read already-stored reviews without contacting Apple:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer ${IOS_PAYMENTS_ADMIN_API_KEY}" \
  "${IOS_PAYMENTS_ADMIN_API_URL}/api/admin/reviews?limit=100"
```

`limit` defaults to `50` and must be from `1` to `200`. `notify` defaults to
`false` and accepts only `true` or `false`. Both endpoints require the dedicated
admin bearer key, return `Cache-Control: no-store`, and never return the App
Store Connect private key or temporary JWT.

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

## Configure customer-review alerts

Customer reviews need separate App Store Connect API credentials; they do not
use the payment webhook's Apple signature verification.

1. In App Store Connect, open **Users and Access → Integrations**.
2. Create a team API key with the least privilege needed to view customer
   reviews, such as **Customer Support**. Copy its issuer ID and key ID, and
   download the `.p8` private key. Apple allows the private key to be downloaded
   only once.
3. Base64-encode the key without placing it in the repository:

   ```bash
   base64 < AuthKey_ABC123DEFG.p8 | tr -d '\n'
   ```

4. Store the result in the deployment secret
   `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`. Also set
   `APP_STORE_CONNECT_KEY_TYPE=team`, `APP_STORE_CONNECT_ISSUER_ID`, and
   `APP_STORE_CONNECT_KEY_ID`.
5. Run the review worker every 10 minutes:

   ```bash
   node dist/scripts/reviews.js
   ```

For an individual API key, use
`APP_STORE_CONNECT_KEY_TYPE=individual`, omit
`APP_STORE_CONNECT_ISSUER_ID`, and set that key's ID and private key. The
individual user's role and per-app access determine which reviews it can read.

The worker exits nonzero if any app fails, continues checking the other apps,
and prints only the affected bundle ID and a sanitized error. It never prints
the API token, private key, or review text. Run the existing delivery worker
every minute to send queued review alerts and retry Telegram failures.
Temporary network errors, Apple HTTP `429` rate limits, and Apple `5xx`
responses are retried up to three times. Authentication, permission, and
unknown-app errors fail immediately so configuration problems remain visible.

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

Refresh and persist the complete currency-rate table:

```bash
# Local source checkout
npm run rates:dev

# Built application or production container
node dist/scripts/rates.js
```

Run it once after deployment and then daily. The open rate endpoint updates
once per day and permits cached use with attribution. Conversion is an
informational daily estimate, not an Apple proceeds, tax, or settlement value.

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
   optional notification allowlists described above,
   `DATABASE_PATH=/data/ios-payments.sqlite`, and
   `APPLE_ENABLE_ONLINE_CHECKS=true`. To enable review alerts, also add the
   `APP_STORE_CONNECT_*` secrets described above.
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

9. For reviews, add another Scheduled Task with cron expression
   `*/10 * * * *` and command:

   ```bash
   node dist/scripts/reviews.js
   ```

10. Add a daily Scheduled Task with cron expression `17 3 * * *` and command:

    ```bash
    node dist/scripts/rates.js
    ```

    Run this task once immediately after the first deployment to prime the
    persistent rate cache.
11. Configure the resulting HTTPS webhook URL in every app in App Store
    Connect.
12. Run the Telegram configuration command in the deployed container:

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
- Customer reviews are authenticated with a short-lived, P-256-signed App Store
  Connect JWT and deduplicated by Apple's review resource ID.
- Currency rates are accepted only from a fixed HTTPS origin, schema-validated,
  required to contain at least 100 currencies and `USD=1`, then atomically
  replaced in SQLite. A failed refresh cannot erase the last valid table.
- Telegram HTML is escaped, and the bot token is never logged.
- Registry and review messages use a durable SQLite outbox and the same retry
  worker as payment notifications.
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
database migrations and app state, payment and review deduplication, App Store
Connect JWT signing and response validation, delivery queue transitions,
message escaping, persistent exchange-rate validation, USD conversion, price
formatting, and body-size enforcement.

## Operational notes

- A `200` response means the verified event is durably stored, not necessarily
  already delivered to Telegram.
- A Telegram outage does not make Apple resend accepted events; the local retry
  worker handles them.
- USD conversions use the last successfully stored daily reference rate and
  can differ from card charges, taxes, Apple proceeds, and settlement amounts.
- A `404` usually means the app has not been registered or is disabled.
- A `401` means JWS, certificate, app identity, or environment verification
  failed.
- A `500`/`503` should be investigated; Apple will retry unsuccessful V2
  deliveries according to its documented schedule.
- Never commit `.env`, `.p8` App Store keys, encoded private keys, bot tokens,
  production databases, database WAL files, or exported notification payloads.

## License

MIT. See [LICENSE](LICENSE).
