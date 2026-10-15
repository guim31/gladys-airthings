// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTPS request on the global
// fetch of Node 22+, with a timeout and a bounded body. The client takes it as
// a parameter: the tests replace it with an in-memory Airthings cloud
// (test/helpers/fakeAirthings.js).
// -----------------------------------------------------------------------------

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 15_000 } = {},
) {
  const response = await fetch(url, {
    method,
    headers: { accept: 'application/json', ...headers },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BODY_BYTES) {
    throw new Error('Response too large');
  }
  return {
    status: response.status,
    // Lower-case names, like node:http.
    headers: Object.fromEntries(response.headers.entries()),
    body: buffer.toString('utf8'),
  };
}
