import axios from 'axios';
import { randomUUID } from 'node:crypto';

export { FirebaseAuth } from './auth.js';
export { loadCredentials, saveCredentials, CREDENTIALS_PATH } from './credentials.js';

const DEFAULT_BASE_URL = 'https://mobile-gateway.prod.zooxapps.com';
const DEFAULT_USER_AGENT = 'RiderApp/26.15.410 (Locale en-US; Release; ) Android/36 (Google; Pixel 9 Pro XL)';

export class ZooxClient {
    constructor({ token, baseUrl = DEFAULT_BASE_URL, sessionId, userAgent = DEFAULT_USER_AGENT } = {}) {
        if (!token) throw new Error('ZooxClient: token is required');
        this.token = token;
        this.baseUrl = baseUrl;
        this.sessionId = sessionId ?? randomUUID();
        this.userAgent = userAgent;
        this.http = axios.create({
            baseURL: this.baseUrl,
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Authentication-Method': 'FIREBASE',
                Accept: 'application/json',
                'Accept-Charset': 'UTF-8',
                'X-Session-ID': this.sessionId,
                'User-Agent': this.userAgent
            }
        });
    }

    async getServiceState(rideServiceId) {
        const { data } = await this.http.get(`/v1/service-state/${rideServiceId}`);
        return data;
    }
}

export async function* watchServiceState(client, rideServiceId, { intervalMs = 5000, signal } = {}) {
    while (true) {
        if (signal?.aborted) return;
        let state;
        try {
            state = await client.getServiceState(rideServiceId);
        } catch (error) {
            yield { error, at: new Date() };
            await sleep(intervalMs, signal);
            continue;
        }
        yield { state, at: new Date() };
        await sleep(intervalMs, signal);
    }
}

function sleep(ms, signal) {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });
}
