import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';

const DIR = join(homedir(), '.config', 'get-me-a-zoox');
const PATH = join(DIR, 'credentials.json');

export async function loadCredentials() {
    try {
        return JSON.parse(await readFile(PATH, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

export async function saveCredentials(creds) {
    await mkdir(DIR, { recursive: true, mode: 0o700 });
    await writeFile(PATH, JSON.stringify(creds, null, 2));
    await chmod(PATH, 0o600);
    return PATH;
}

export const CREDENTIALS_PATH = PATH;
