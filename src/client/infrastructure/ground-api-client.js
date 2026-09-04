import { GROUND_ERROR_STATUS } from '../../domain/ground-hosted-contract.js';

const GROUND_ENDPOINT_PATH = '/api/ground';
const FALLBACK_CODE = 'GROUND_TEMPORARILY_UNAVAILABLE';

const groundError = (code, { cause, status } = {}) => Object.assign(
  new Error(`Ground request failed: ${code}`),
  { cause, code, status },
);

const readCode = (body) => (
  typeof body?.code === 'string' && GROUND_ERROR_STATUS[body.code] ? body.code : FALLBACK_CODE
);

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

export class GroundApiClient {
  constructor({ authClient, fetchImpl = globalThis.fetch.bind(globalThis) }) {
    this.authClient = authClient;
    this.fetchImpl = fetchImpl;
  }

  // The bearer token is read fresh for every request and never retained, so a
  // refreshed or revoked anonymous session can never be replayed from memory.
  async request(operation, input = {}) {
    const accessToken = await this.authClient.accessToken();
    let response;
    try {
      response = await this.fetchImpl(GROUND_ENDPOINT_PATH, {
        body: JSON.stringify({ operation, ...input }),
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      });
    } catch (cause) {
      throw groundError(FALLBACK_CODE, { cause });
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw groundError(readCode(body), { status: response.status });
    }
    return body;
  }
}
