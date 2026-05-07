# get-me-a-zoox

Reverse-engineered SDK + CLI for the Zoox Rider mobile gateway. Authenticates via Firebase phone auth, polls the `service-state` endpoint, and rings a loud alarm when a ride becomes available (`ride_service_saturated` flips to `false`).

## Install

```bash
npm install
npm link   # optional, exposes `get-me-a-zoox` globally
```

## Quickstart

One-time login (you'll receive an SMS):

```bash
get-me-a-zoox login --phone +14155550123 --integrity-token "$INTEGRITY"
# enter SMS code when prompted
```

Then watch (auto-refreshes the bearer using the stored refresh token):

```bash
get-me-a-zoox watch -i 5000
```

## Commands

### `login`

Runs the Firebase phone-auth flow (`sendVerificationCode` → `verifyPhoneNumber`) and saves credentials to `~/.config/get-me-a-zoox/credentials.json` (mode `600`).

| Flag | Description |
|---|---|
| `-p, --phone <number>` | Phone number in E.164 format (e.g. `+14155550123`) |
| `--integrity-token <token>` | Fresh Play Integrity token captured from the Zoox Android app login |
| `--code <smsCode>` | Skip the interactive prompt by passing the SMS code |
| `--app-signature-hash <hash>` | Defaults to the captured Zoox value |

> **About `--integrity-token`:** Google Play Integrity tokens are signed by Google Play services on a real Android device. The simplest way to grab one: open Charles, tap "Sign in" in the Zoox app, and copy the `playIntegrityToken` field from the `sendVerificationCode` request body. The token is short-lived (single-use), so capture it right before running `login`.

### `refresh`

Mints a new ID token using the stored refresh token. Works for weeks — no SMS needed.

```bash
get-me-a-zoox refresh         # prints the new idToken
get-me-a-zoox refresh --print-only
```

### `token`

Prints the current bearer token, refreshing if it's expired or near expiry.

```bash
export ZOOX_TOKEN=$(get-me-a-zoox token)
```

### `watch` (default)

Polls `service-state` and triggers the alarm on availability. Resolves the bearer in this order: `--token` → `$ZOOX_TOKEN` → stored credentials (auto-refreshed).

| Flag | Description | Default |
|---|---|---|
| `-t, --token <bearer>` | Override token | stored / env |
| `-s, --service-id <uuid>` | Ride service ID | `d1de4998-9827-4322-831e-7e83d0cd7fa4` |
| `-i, --interval <ms>` | Poll interval | `5000` |
| `--once` | Fetch once and exit | — |
| `--no-notify` | Disable macOS notification | — |
| `--no-alarm` | Disable loud alarm (afplay loop + spoken alert) | — |
| `--alarm-repeats <n>` | Times to play the alarm sound | `6` |
| `--alarm-sound <path>` | Sound file (afplay-compatible) | `/System/Library/Sounds/Sosumi.aiff` |
| `--test-alarm` | Trigger the alarm immediately and exit | — |

When availability is detected the CLI bumps macOS output volume to 100, loops the alarm sound, fires a system notification, and uses `say` to announce "Zoox is available — get a ride now!". Run `--test-alarm` first so it doesn't startle anyone.

### Example

```
$ get-me-a-zoox watch -i 3000
polling d1de4998-9827-4322-831e-7e83d0cd7fa4 every 3000ms — Ctrl-C to stop
[18:51:02] SATURATED  wait=120s  queue=4  ops=true
[18:51:05] SATURATED  wait=98s   queue=3  ops=true
[18:51:08] AVAILABLE  wait=63s   queue=1  ops=true

*** Zoox is AVAILABLE — wait 63s, 1 in queue ***
```

## SDK

```js
import {
    ZooxClient,
    watchServiceState,
    FirebaseAuth,
    loadCredentials,
    saveCredentials
} from 'get-me-a-zoox';

// auth
const auth = new FirebaseAuth();
const { sessionInfo } = await auth.sendVerificationCode({
    phoneNumber: '+14155550123',
    playIntegrityToken: integrityToken
});
const tokens = await auth.verifyPhoneNumber({ sessionInfo, code: '123456' });

// later, refresh without SMS
const fresh = await auth.refreshIdToken({ refreshToken: tokens.refreshToken });

// service-state
const client = new ZooxClient({ token: fresh.idToken });
for await (const tick of watchServiceState(client, 'd1de4998-...', { intervalMs: 5000 })) {
    if (tick.state && !tick.state.ride_service_saturated) break;
}
```

## Endpoints used

| Method | URL | Purpose |
|---|---|---|
| GET | `googleapis.com/identitytoolkit/v3/relyingparty/getRecaptchaParam` | (unused for phone auth on Android) |
| POST | `googleapis.com/identitytoolkit/v3/relyingparty/sendVerificationCode` | Sends SMS, returns `sessionInfo` |
| POST | `googleapis.com/identitytoolkit/v3/relyingparty/verifyPhoneNumber` | Trades `sessionInfo` + SMS code for `idToken` + `refreshToken` |
| POST | `securetoken.googleapis.com/v1/token` | Refreshes `idToken` from `refreshToken` |
| GET | `mobile-gateway.prod.zooxapps.com/v1/service-state/:id` | Operational status / wait time / queue |

## Credentials

Stored at `~/.config/get-me-a-zoox/credentials.json` with mode `600`. Treat it like an SSH private key — anyone with the refresh token can mint bearers for your account until you sign out elsewhere.
