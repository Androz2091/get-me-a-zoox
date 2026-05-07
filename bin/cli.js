#!/usr/bin/env node
import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { ZooxClient, watchServiceState } from '../src/index.js';

const program = new Command();

program
    .name('get-me-a-zoox')
    .description('Poll the Zoox service-state endpoint and notify when a ride becomes available.')
    .option('-t, --token <bearer>', 'Firebase ID token (Authorization: Bearer <token>). Falls back to $ZOOX_TOKEN.')
    .option('-s, --service-id <uuid>', 'Ride service ID', 'd1de4998-9827-4322-831e-7e83d0cd7fa4')
    .option('-i, --interval <ms>', 'Poll interval in milliseconds', (v) => parseInt(v, 10), 5000)
    .option('--once', 'Fetch once and exit')
    .option('--no-notify', 'Disable macOS notification on availability')
    .parse(process.argv);

const opts = program.opts();
const token = opts.token || process.env.ZOOX_TOKEN;
if (!token) {
    console.error('error: token is required (--token or $ZOOX_TOKEN)');
    process.exit(1);
}
const client = new ZooxClient({ token });

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
        continue;
    }
    const s = tick.state;
    const saturated = s.ride_service_saturated;
    const wait = s.estimated_wait_time;
    const queued = s.riders_awaiting_assignment;
    const opStatus = s.service_operations_status;
    const flag = saturated ? 'SATURATED' : 'AVAILABLE';
    console.log(`[${ts}] ${flag}  wait=${wait}s  queue=${queued}  ops=${opStatus}`);

    if (lastSaturated === true && saturated === false && !firedAvailable) {
        firedAvailable = true;
        announceAvailable(opts.notify, s);
    }
    lastSaturated = saturated;
}

function announceAvailable(notify, state) {
    const msg = `Zoox is AVAILABLE — wait ${state.estimated_wait_time}s, ${state.riders_awaiting_assignment} in queue`;
    process.stdout.write('\x07'); // terminal bell
    console.log(`\n*** ${msg} ***\n`);
    if (notify && process.platform === 'darwin') {
        const script = `display notification "${msg.replace(/"/g, '\\"')}" with title "get-me-a-zoox" sound name "Glass"`;
        execFile('osascript', ['-e', script], () => {});
    }
}
