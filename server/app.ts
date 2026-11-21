import express, { type Request, type Response } from 'express';
import {
  isValidChallengeId,
  isValidJoiningCode,
  validateImageMagicBytes,
} from '../src/shared/gameLogic';
import { createSqliteBackend } from './dbSqliteAdapter';
import { createSupabaseBackend, GameExpiredError } from './dbSupabase';
import { resolveSessionSecret, verifySignedMediaParams } from './security';
import type { GameBackend } from './storageTypes';
import { getSupabaseAdminClient, isSupabaseConfigured } from './supabase';

export const SESSION_COOKIE_NAME = 'hb_session';
// Keep raw upload strictly below Vercel's 4.5 MB serverless HTTP body limit
export const MAX_IMAGE_BYTES = Math.floor(3.5 * 1024 * 1024);

export interface ExpressAppOptions {
  requireSupabase?: boolean;
  onBroadcastSync?: (gameId: string, event: Record<string, unknown>) => void;
}

function devLog(context: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  console.warn(`[HumanBingo] ${context}`, details);
}

function classifyDatabaseError(
  err: unknown,
  fallbackMessage: string,
): { status: number; code: string; error: string } {
  const errObj = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null;
  const rawCode = errObj?.code ? String(errObj.code) : '';
  const rawMsg = errObj?.message ? String(errObj.message) : '';

  if (err instanceof GameExpiredError || rawCode === 'GAME_EXPIRED') {
    return {
      status: 410,
      code: 'GAME_EXPIRED',
      error: 'Game has already closed after 48 hours. Existing photos are preserved.',
    };
  }
  if (
    rawCode === '42501' ||
    rawCode === 'EACCES' ||
    rawCode === 'EPERM' ||
    rawCode === 'SQLITE_READONLY' ||
    /permission denied|row-level security|readonly/i.test(rawMsg)
  ) {
    return {
      status: 500,
      code: 'DB_PERMISSION_DENIED',
      error: 'Database permission denied. Check server configuration and RLS grants.',
    };
  }
  if (
    rawCode === 'SQLITE_BUSY' ||
    /fetch failed|network|ECONNREFUSED|ETIMEDOUT|database is locked|busy/i.test(rawMsg)
  ) {
    return {
      status: 503,
      code: 'DB_CONNECTION_FAILED',
      error: 'Database connection temporarily unavailable. Please try again.',
    };
  }
  if (rawCode === '42P01' || /no such table|relation .* does not exist|SQLITE_ERROR/i.test(rawMsg)) {
    return {
      status: 500,
      code: 'DB_SCHEMA_ERROR',
      error: 'Database schema error. Required tables or migrations are missing.',
    };
  }
  return {
    status: 500,
    code: rawCode || 'DB_OPERATION_FAILED',
    error: fallbackMessage,
  };
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') {
    return true;
  }
  if (req.headers['x-forwarded-ssl'] === 'on') {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('https://')) {
    return true;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.startsWith('https://')) {
    return true;
  }
  return false;
}

function setSessionCookie(req: Request, res: Response, rawToken: string): void {
  const maxAge = 48 * 60 * 60;
  if (isSecureRequest(req)) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`,
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
    );
  }
}

function clearSessionCookie(req: Request, res: Response): void {
  if (isSecureRequest(req)) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`,
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    );
  }
}

export function extractSessionToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer.length >= 16) {
      return bearer;
    }
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME];
}

export function createExpressApp(options: ExpressAppOptions = {}) {
  const app = express();
  app.set('trust proxy', 1);

  const sessionSecret = resolveSessionSecret();
  const useSupabase =
    Boolean(options.requireSupabase) ||
    process.env.VERCEL === '1' ||
    isSupabaseConfigured();

  let backend: GameBackend;
  if (useSupabase) {
    const client = getSupabaseAdminClient();
    backend = createSupabaseBackend(client, sessionSecret);
  } else {
    backend = createSqliteBackend(sessionSecret);
  }

  async function resolveRequestSession(req: Request, expectedCode: string) {
    const token = extractSessionToken(req);
    if (!token) {
      return {
        ok: false as const,
        status: 401,
        code: 'SESSION_MISSING',
        error: 'Session expired. Please rejoin the game.',
      };
    }

    const session = await backend.getSessionByToken(token);
    if (!session) {
      return {
        ok: false as const,
        status: 401,
        code: 'SESSION_EXPIRED',
        error: 'Session expired. Please rejoin the game.',
      };
    }

    if (session.game.joiningCode !== expectedCode) {
      const targetGame = await backend.getGameByCode(expectedCode);
      if (!targetGame) {
        return {
          ok: false as const,
          status: 404,
          code: 'GAME_NOT_FOUND',
          error: 'Game code not found. Please check the 4-digit code.',
        };
      }
      return {
        ok: false as const,
        status: 403,
        code: 'WRONG_GAME',
        error: 'You are not a participant in this game.',
      };
    }

    return {
      ok: true as const,
      game: session.game,
      participant: session.participant,
      token,
    };
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, storage: useSupabase ? 'supabase' : 'sqlite' });
  });

  app.get('/api/session', async (req, res) => {
    try {
      const token = extractSessionToken(req);
      const session = await backend.getSessionByToken(token);
      if (!session || !token) {
        res.json({ session: null });
        return;
      }
      const state = await backend.getFullGameState(session.game, session.participant);
      res.json({
        session: {
          ...state,
          sessionToken: token,
        },
      });
    } catch (err) {
      const mapped = classifyDatabaseError(err, 'Unable to restore session right now.');
      devLog('GET /api/session failed', { status: mapped.status, code: mapped.code });
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  app.post('/api/session/leave', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/games', express.json({ limit: '16kb' }), async (_req, res) => {
    try {
      const game = await backend.createGame();
      res.status(201).json({ game });
    } catch (err) {
      const mapped = classifyDatabaseError(err, 'Unable to create game right now. Please try again.');
      devLog('POST /api/games failed', {
        status: mapped.status,
        code: mapped.code,
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  app.get('/api/games/:code/check', async (req, res) => {
    const code = String(req.params.code || '');
    if (!isValidJoiningCode(code)) {
      res.status(400).json({ error: 'Enter a 4-digit game code.', code: 'INVALID_CODE' });
      return;
    }
    try {
      const game = await backend.getGameByCode(code);
      if (!game) {
        res.status(404).json({ error: 'Game code not found.', code: 'NOT_FOUND' });
        return;
      }
      res.json({ game });
    } catch (err) {
      const mapped = classifyDatabaseError(err, 'Database connection failed while checking game code.');
      devLog('GET /api/games/:code/check failed', {
        status: mapped.status,
        code: mapped.code,
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  app.post('/api/games/join', express.json({ limit: '16kb' }), async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ error: 'Invalid request.', code: 'INVALID_REQUEST' });
      return;
    }

    const joiningCode = typeof req.body.joiningCode === 'string' ? req.body.joiningCode.trim() : '';
    const name = typeof req.body.name === 'string' ? req.body.name : '';

    try {
      const result = await backend.joinGame(joiningCode, name);
      if (!result.ok) {
        const status =
          result.code === 'NOT_FOUND'
            ? 404
            : result.code === 'EXPIRED'
              ? 410
              : 400;
        devLog('POST /api/games/join rejected', { status, code: result.code, joiningCode });
        res.status(status).json({ error: result.message, code: result.code });
        return;
      }

      setSessionCookie(req, res, result.rawSessionToken);
      const state = await backend.getFullGameState(result.game, result.participant);

      options.onBroadcastSync?.(result.game.id, {
        type: 'game:sync',
        reason: 'participant_joined',
        participantId: result.participant.id,
        participantName: result.participant.name,
      });

      res.status(200).json({
        ...state,
        sessionToken: result.rawSessionToken,
      });
    } catch (err) {
      const mapped = classifyDatabaseError(err, 'Participant creation failed. Please try again.');
      devLog('POST /api/games/join database error', {
        status: mapped.status,
        code: mapped.code,
        joiningCode,
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  app.get('/api/games/:code/state', async (req, res) => {
    const code = String(req.params.code || '');
    try {
      const auth = await resolveRequestSession(req, code);
      if (!auth.ok) {
        devLog('GET /api/games/:code/state rejected', {
          status: auth.status,
          reason: auth.code,
          joiningCode: code,
        });
        res.status(auth.status).json({ error: auth.error, code: auth.code });
        return;
      }

      const state = await backend.getFullGameState(auth.game, auth.participant);
      res.json({
        ...state,
        sessionToken: auth.token,
      });
    } catch (err) {
      const mapped = classifyDatabaseError(err, 'Unable to fetch game state right now.');
      devLog('GET /api/games/:code/state failed', { status: mapped.status, code: mapped.code });
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  app.post(
    '/api/games/:code/submissions',
    express.raw({
      type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
      limit: MAX_IMAGE_BYTES,
    }),
    async (req, res) => {
      const code = String(req.params.code || '');
      try {
        const auth = await resolveRequestSession(req, code);
        if (!auth.ok) {
          devLog('POST /api/games/:code/submissions rejected', {
            status: auth.status,
            reason: auth.code,
            joiningCode: code,
          });
          res.status(auth.status).json({ error: auth.error, code: auth.code });
          return;
        }

        if (auth.game.status === 'expired') {
          res.status(410).json({
            code: 'GAME_EXPIRED',
            error: 'Game has already closed after 48 hours. Existing photos are preserved.',
          });
          return;
        }

        const challengeId = Number(req.query.challengeId);
        if (!isValidChallengeId(challengeId)) {
          res.status(400).json({ error: 'Invalid challenge number.', code: 'INVALID_CHALLENGE' });
          return;
        }

        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          res.status(400).json({ error: 'No image data received. Please select a photo again.' });
          return;
        }

        if (body.length > MAX_IMAGE_BYTES) {
          res.status(413).json({
            error: 'Image is too large (max 3.5 MB). Please choose a smaller photo.',
            code: 'PAYLOAD_TOO_LARGE',
          });
          return;
        }

        const detectedMime = validateImageMagicBytes(body);
        if (!detectedMime) {
          res.status(400).json({
            error: 'Unsupported image format. Please upload a JPEG, PNG, or WebP photo.',
            code: 'UNSUPPORTED_IMAGE_FORMAT',
          });
          return;
        }

        const result = await backend.savePhotoSubmission({
          game: auth.game,
          participant: auth.participant,
          challengeId,
          mimeType: detectedMime,
          buffer: body,
        });

        const state = await backend.getFullGameState(auth.game, auth.participant);

        options.onBroadcastSync?.(auth.game.id, {
          type: 'game:sync',
          reason: result.replaced ? 'photo_replaced' : 'photo_uploaded',
          challengeId,
          participantId: auth.participant.id,
          participantName: auth.participant.name,
        });

        res.status(200).json({
          submission: result.submission,
          replaced: result.replaced,
          state: {
            ...state,
            sessionToken: auth.token,
          },
        });
      } catch (err) {
        const mapped = classifyDatabaseError(err, 'Photo upload failed. Please try again.');
        devLog('POST /api/games/:code/submissions failed', {
          status: mapped.status,
          code: mapped.code,
          message: err instanceof Error ? err.message : String(err),
        });
        res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
      }
    },
  );

  // Serve private photos strictly to authenticated same-game sessions OR valid expiring path-bound HMAC signatures
  app.get('/api/uploads/:gameId/:fileName', async (req, res) => {
    const gameId = String(req.params.gameId || '');
    const fileName = String(req.params.fileName || '');
    const storagePath = `${gameId}/${fileName}`;

    try {
      const token = extractSessionToken(req);
      const session = await backend.getSessionByToken(token);
      const hasValidSession = Boolean(session && session.game.id === gameId);

      const expRaw = typeof req.query.exp === 'string' ? req.query.exp : undefined;
      const sigRaw = typeof req.query.sig === 'string' ? req.query.sig : undefined;
      const hasValidSignedUrl = verifySignedMediaParams(
        gameId,
        storagePath,
        expRaw,
        sigRaw,
        sessionSecret,
      );

      if (!hasValidSession && !hasValidSignedUrl) {
        devLog('GET /api/uploads denied', { status: 403, gameId, hasSession: Boolean(session) });
        res.status(403).json({ error: 'You are not authorized to view this photo.', code: 'FORBIDDEN' });
        return;
      }

      const obj = await backend.readPhotoObject(gameId, fileName);
      if (!obj) {
        res.status(404).json({ error: 'Photo not found.', code: 'NOT_FOUND' });
        return;
      }

      res.setHeader('Content-Type', obj.contentType);
      res.setHeader('Cache-Control', 'private, max-age=900');
      res.send(obj.buffer);
    } catch (err) {
      const mapped = classifyDatabaseError(err, 'Unable to load photo right now.');
      devLog('GET /api/uploads failed', { status: mapped.status, code: mapped.code });
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.', code: 'API_NOT_FOUND' });
  });

  app.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (err && typeof err === 'object' && 'type' in err) {
      const errType = (err as { type: string }).type;
      if (errType === 'entity.too.large') {
        res.status(413).json({
          error: 'Photo is too large (max 3.5 MB). Please try a smaller photo.',
          code: 'PAYLOAD_TOO_LARGE',
        });
        return;
      }
      if (errType === 'entity.parse.failed') {
        res.status(400).json({ error: 'Invalid request.', code: 'INVALID_REQUEST' });
        return;
      }
    }
    next(err);
  });

  return { app, backend };
}
