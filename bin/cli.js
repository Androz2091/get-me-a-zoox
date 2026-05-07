#!/usr/bin/env node
import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
    ZooxClient,
    watchServiceState,
    FirebaseAuth,
    loadCredentials,
    saveCredentials,
    CREDENTIALS_PATH
} from '../src/index.js';

const program = new Command();

program
    .name('get-me-a-zoox')
    .description('Reverse-engineered SDK + CLI for the Zoox Rider mobile gateway.');

program
    .command('login')
    .description('Authenticate with Firebase phone auth (one-time). Saves refresh token for future use.')
    .requiredOption('-p, --phone <number>', 'Phone number in E.164 format, e.g. +14155550123')
    .requiredOption('--integrity-token <token>', 'Fresh playIntegrityToken captured from the Zoox app login (Charles).')
    .option('--code <smsCode>', 'SMS verification code (skip the interactive prompt).')
    .option('--app-signature-hash <hash>', 'Android app signature hash', 'n1dJu658sfb')
    .action(async (opts) => {
        const auth = new FirebaseAuth();
        console.log(`requesting SMS for ${opts.phone}…`);
        let session;
        try {
            session = await auth.sendVerificationCode({
                phoneNumber: opts.phone,
                playIntegrityToken: opts.integrityToken,
                appSignatureHash: opts.appSignatureHash
            });
        } catch (err) {
            fail('sendVerificationCode failed', err);
        }
        console.log('SMS sent. sessionInfo acquired.');

        const code = opts.code ?? (await prompt('Enter the 6-digit code: ')).trim();
        let result;
        try {
            result = await auth.verifyPhoneNumber({ sessionInfo: session.sessionInfo, code });
        } catch (err) {
            fail('verifyPhoneNumber failed', err);
        }

        const creds = {
            phoneNumber: result.phoneNumber,
            localId: result.localId,
            idToken: result.idToken,
            refreshToken: result.refreshToken,
            idTokenExpiresAt: Date.now() + parseInt(result.expiresIn, 10) * 1000,
            updatedAt: new Date().toISOString()
        };
        const path = await saveCredentials(creds);
        console.log(`logged in as ${result.phoneNumber} (localId=${result.localId})`);
        console.log(`credentials saved to ${path}`);
        console.log(`idToken expires in ${result.expiresIn}s`);
    });

program
    .command('refresh')
    .description('Refresh and print the bearer token using the stored refresh token.')
    .option('--print-only', 'Print the new token without saving')
    .action(async (opts) => {
        const creds = await requireCreds();
        const auth = new FirebaseAuth();
        let refreshed;
        try {
            refreshed = await auth.refreshIdToken({ refreshToken: creds.refreshToken });
        } catch (err) {
            fail('refresh failed (refresh token may be revoked)', err);
        }
        if (!opts.printOnly) {
            await saveCredentials({
                ...creds,
                idToken: refreshed.idToken,
                refreshToken: refreshed.refreshToken,
                idTokenExpiresAt: Date.now() + refreshed.expiresIn * 1000,
                updatedAt: new Date().toISOString()
            });
        }
        console.log(refreshed.idToken);
    });

program
    .command('token')
    .description('Print the current bearer (refreshing if expired or near expiry).')
    .action(async () => {
        const token = await ensureFreshToken();
        console.log(token);
    });

program
    .command('watch', { isDefault: true })
    .description('Poll service-state and notify when a ride becomes available.')
    .option('-t, --token <bearer>', 'Bearer token. Falls back to stored credentials or $ZOOX_TOKEN.')
    .option('-s, --service-id <uuid>', 'Ride service ID', 'd1de4998-9827-4322-831e-7e83d0cd7fa4')
    .option('-i, --interval <ms>', 'Poll interval in milliseconds', (v) => parseInt(v, 10), 5000)
    .option('--once', 'Fetch once and exit')
    .option('--no-notify', 'Disable macOS notification on availability')
    .option('--no-alarm', 'Disable loud alarm on availability')
    .option('--alarm-repeats <n>', 'How many times to play the alarm', (v) => parseInt(v, 10), 6)
    .option('--alarm-sound <path>', 'Path to a sound file to play (afplay-compatible)', '/System/Library/Sounds/Sosumi.aiff')
    .option('--test-alarm', 'Trigger the alarm immediately and exit')
    .action(watchAction);

await program.parseAsync(process.argv);

async function watchAction(opts) {
    if (opts.testAlarm) {
        announceAvailable({ estimated_wait_time: 0, riders_awaiting_assignment: 0 }, opts);
        await new Promise((r) => setTimeout(r, 4000));
        process.exit(0);
    }

    let token = opts.token || process.env.ZOOX_TOKEN;
    let creds = null;
    if (!token) {
        creds = await loadCredentials();
        if (creds) token = await ensureFreshToken(creds);
    }
    if (!token) {
        console.error('error: no token. Run `get-me-a-zoox login` first, or pass --token / $ZOOX_TOKEN.');
        process.exit(1);
    }

    let client = new ZooxClient({ token });

    if (opts.once) {
        const state = await client.getServiceState(opts.serviceId);
        console.log(JSON.stringify(state, null, 2));
        process.exit(0);
    }

    const ac = new AbortController();
    process.on('SIGINT', () => { console.log('\nstopping…'); ac.abort(); });

    let lastSaturated = null;
    let firedAvailable = false;

    console.log(`polling ${opts.serviceId} every ${opts.interval}ms — Ctrl-C to stop`);

    for await (const tick of watchServiceState(client, opts.serviceId, { intervalMs: opts.interval, signal: ac.signal })) {
        const ts = tick.at.toLocaleTimeString();
        if (tick.error) {
            const status = tick.error.response?.status;
            console.error(`[${ts}] error${status ? ` (${status})` : ''}: ${tick.error.message}`);
            if (status === 401 || status === 403) {
                const fresh = await ensureFreshToken().catch(() => null);
                if (fresh) {
                    console.log(`[${ts}] refreshed bearer; reattaching client`);
                    client = new ZooxClient({ token: fresh });
                    // mutate the iterator's client reference: simpler — break out and restart loop
                    // (watchServiceState uses the original client; recreate the loop below)
                    ac.abort();
                    return watchAction(opts);
                }
            }
            continue;
        }
        const s = tick.state;
        const saturated = s.ride_service_saturated;
        const flag = saturated ? 'SATURATED' : 'AVAILABLE';
        console.log(`[${ts}] ${flag}  wait=${s.estimated_wait_time}s  queue=${s.riders_awaiting_assignment}  ops=${s.service_operations_status}`);

        if (lastSaturated === true && saturated === false && !firedAvailable) {
            firedAvailable = true;
            announceAvailable(s, opts);
        }
        lastSaturated = saturated;
    }
}

async function ensureFreshToken(existingCreds) {
    const creds = existingCreds ?? await loadCredentials();
    if (!creds) throw new Error('no stored credentials');
    const skewMs = 60_000;
    if (creds.idToken && creds.idTokenExpiresAt && creds.idTokenExpiresAt - Date.now() > skewMs) {
        return creds.idToken;
    }
    const auth = new FirebaseAuth();
    const refreshed = await auth.refreshIdToken({ refreshToken: creds.refreshToken });
    await saveCredentials({
        ...creds,
        idToken: refreshed.idToken,
        refreshToken: refreshed.refreshToken,
        idTokenExpiresAt: Date.now() + refreshed.expiresIn * 1000,
        updatedAt: new Date().toISOString()
    });
    return refreshed.idToken;
}

async function requireCreds() {
    const creds = await loadCredentials();
    if (!creds) {
        console.error(`no credentials at ${CREDENTIALS_PATH}. Run \`get-me-a-zoox login\` first.`);
        process.exit(1);
    }
    return creds;
}

async function prompt(question) {
    const rl = createInterface({ input: stdin, output: stdout });
    try { return await rl.question(question); }
    finally { rl.close(); }
}

function fail(msg, err) {
    const detail = err?.response?.data ? JSON.stringify(err.response.data) : err?.message;
    console.error(`${msg}: ${detail}`);
    process.exit(1);
}

function announceAvailable(state, opts) {
    const msg = `Zoox is AVAILABLE — wait ${state.estimated_wait_time}s, ${state.riders_awaiting_assignment} in queue`;
    process.stdout.write('\x07');
    console.log(`\n*** ${msg} ***\n`);
    if (process.platform !== 'darwin') return;
    if (opts.notify) {
        const script = `display notification "${msg.replace(/"/g, '\\"')}" with title "get-me-a-zoox" sound name "Glass"`;
        execFile('osascript', ['-e', script], () => {});
    }
    if (opts.alarm) {
        execFile('osascript', ['-e', 'set volume output volume 100 without output muted'], () => {});
        for (let i = 0; i < opts.alarmRepeats; i++) {
            execFile('afplay', ['-v', '2', opts.alarmSound], () => {});
        }
        execFile('say', ['-v', 'Alex', '-r', '180', 'Zoox is available! Get a ride now!'], () => {});
    }
}
