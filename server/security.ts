import crypto from 'node:crypto';

export const MEDIA_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MIN_SESSION_SECRET_LENGTH = 32;

let cachedDevSecret: string | null = null;

export function resolveSessionSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.SESSION_SECRET?.trim() || '';
  const isStrictProd = env.NODE_ENV === 'production' || env.VERCEL === '1';

  if (configured.length >= MIN_SESSION_SECRET_LENGTH) {
    return configured;
  }

  if (isStrictProd) {
    throw new Error(
      `SESSION_SECRET environment variable must be configured with at least ${MIN_SESSION_SECRET_LENGTH} characters in production.`,
    );
  }

  if (configured.length > 0 && configured.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters when provided.`,
    );
  }

  if (!cachedDevSecret) {
    cachedDevSecret = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[HumanBingo] SESSION_SECRET is not set; using an ephemeral dev-only HMAC secret for this process.',
    );
  }

  return cachedDevSecret;
}

export function hashSessionToken(rawToken: string, sessionSecret: string): string {
  if (!sessionSecret || sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error('Cannot hash session token without a valid SESSION_SECRET.');
  }
  return crypto.createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
}

export function computeMediaSignature(
  gameId: string,
  storagePath: string,
  expiresAtMs: number,
  sessionSecret: string,
): string {
  return crypto
    .createHmac('sha256', sessionSecret)
    .update(`${gameId}:${storagePath}:${expiresAtMs}`)
    .digest('hex');
}

export function createSignedMediaParams(
  gameId: string,
  storagePath: string,
  sessionSecret: string,
  nowMs: number = Date.now(),
  ttlMs: number = MEDIA_TOKEN_TTL_MS,
): { exp: number; sig: string } {
  const exp = nowMs + ttlMs;
  const sig = computeMediaSignature(gameId, storagePath, exp, sessionSecret);
  return { exp, sig };
}

export function verifySignedMediaParams(
  gameId: string,
  storagePath: string,
  expRaw: string | undefined,
  sigRaw: string | undefined,
  sessionSecret: string,
  nowMs: number = Date.now(),
): boolean {
  if (!expRaw || !sigRaw || !/^\d{10,16}$/.test(expRaw) || !/^[a-f0-9]{64}$/i.test(sigRaw)) {
    return false;
  }

  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp <= nowMs) {
    return false;
  }

  const expectedHex = computeMediaSignature(gameId, storagePath, exp, sessionSecret);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(sigRaw.toLowerCase(), 'hex');

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function buildSignedImageUrl(
  gameId: string,
  fileName: string,
  updatedAt: number,
  sessionSecret: string,
  nowMs: number = Date.now(),
): string {
  const storagePath = `${gameId}/${fileName}`;
  const { exp, sig } = createSignedMediaParams(gameId, storagePath, sessionSecret, nowMs);
  return `/api/uploads/${encodeURIComponent(gameId)}/${encodeURIComponent(fileName)}?v=${updatedAt}&exp=${exp}&sig=${sig}`;
}
