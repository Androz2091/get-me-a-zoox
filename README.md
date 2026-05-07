# get-me-a-zoox

Reverse-engineered SDK + CLI for the Zoox Rider mobile gateway. Polls the public `service-state` endpoint and notifies when a ride becomes available (`ride_service_saturated` flips to `false`).

Token-related work (capturing the Firebase ID token, SSL pinning bypass, etc.) is **not** included here — bring your own bearer.

## Install

```bash
npm install
chmod +x bin/cli.js
```

## CLI

```bash
node bin/cli.js --token "$ZOOX_TOKEN"
# or, after npm link:
get-me-a-zoox --token "$ZOOX_TOKEN"
```

The token can also be supplied via the `ZOOX_TOKEN` env var.

### Options

| Flag | Description | Default |
|---|---|---|
| `-t, --token <bearer>` | Firebase ID token | `$ZOOX_TOKEN` |
| `-s, --service-id <uuid>` | Ride service ID | `d1de4998-9827-4322-831e-7e83d0cd7fa4` |
| `-i, --interval <ms>` | Poll interval | `5000` |
| `--once` | Fetch once and exit | — |
| `--no-notify` | Disable macOS notification | — |

### Example

```
$ get-me-a-zoox -t "$ZOOX_TOKEN" -i 3000
polling d1de4998-9827-4322-831e-7e83d0cd7fa4 every 3000ms — Ctrl-C to stop
[18:51:02] SATURATED  wait=120s  queue=4  ops=true
[18:51:05] SATURATED  wait=98s   queue=3  ops=true
[18:51:08] AVAILABLE  wait=63s   queue=1  ops=true

*** Zoox is AVAILABLE — wait 63s, 1 in queue ***
```

## SDK

```js
import { ZooxClient, watchServiceState } from 'get-me-a-zoox';

const client = new ZooxClient({ token: process.env.ZOOX_TOKEN });

const state = await client.getServiceState('d1de4998-9827-4322-831e-7e83d0cd7fa4');
console.log(state.ride_service_saturated);

// or stream updates:
for await (const tick of watchServiceState(client, 'd1de4998-...', { intervalMs: 5000 })) {
    if (tick.state && !tick.state.ride_service_saturated) break;
}
```

### `ZooxClient(opts)`

- `token` (required) — Firebase ID token
- `baseUrl` — defaults to `https://mobile-gateway.prod.zooxapps.com`
- `sessionId` — defaults to a fresh UUID
- `userAgent` — defaults to the captured Pixel 9 Pro XL UA

### Endpoints

- `GET /v1/service-state/:rideServiceId` — returns operational status, estimated wait time, queue size, weekly schedule.
