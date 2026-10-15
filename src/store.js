// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container),
// in `airthings-state.json`:
//   - `credentials`: a fingerprint (SHA-256, truncated) of the client id and
//     secret the rest belongs to — never the credentials themselves;
//   - `token`: the access token and its expiry, so a restart does not spend
//     a request of the hourly quota on a new one;
//   - `accountId`: the Airthings account id (constant for a consumer account);
//   - `sensors`: per serial number, the feature keys already seen in a
//     reading and whether a battery level was seen, so a restart publishes
//     the same features (no "Update" proposed in the Discovery tab for nothing).
// Losing the file is harmless: one more token, one more account request.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'airthings-store' });
const FILE_NAME = 'airthings-state.json';

export class Store {
  constructor(directory = process.env.AIRTHINGS_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.pending = null;
    this.writing = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      return {};
    }
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    this.latest = data;
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          // Owner only: the file holds an access token.
          await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
          await rename(temporary, this.path);
        } catch (err) {
          logger.warn(`Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
