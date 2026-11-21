import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createGame,
  getFullGameState,
  getGameByCode,
  getSessionByToken,
  getUploadsRoot,
  joinGame,
  resolveSafeUploadPath,
  upsertPhotoSubmission,
} from './server/db';
import {
  isValidChallengeId,
  isValidJoiningCode,
  mimeToExtension,
  validateImageMagicBytes,
  type GameRecord,
  type ParticipantRecord,
} from './src/shared/gameLogic';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE_NAME = 'hb_session';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB binary image limit
const IS_DEV = process.env.NODE_ENV !== 'production';
const MEDIA_SIGNING_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function devLog(context: string, details: Record<string, unknown>): void {
  if (!IS_DEV) return;
  console.warn(`[HumanBingo] ${context}`, details);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
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

function setSessionCookie(req: Request, res: Response, sessionId: string): void {
  const maxAge = 48 * 60 * 60; // 48 hours
  if (isSecureRequest(req)) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`,
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
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

function extractSessionToken(req: Request): string | undefined {
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

function computeGameMediaToken(gameId: string): string {
  return crypto.createHmac('sha256', MEDIA_SIGNING_SECRET).update(gameId).digest('hex');
}

function verifyGameMediaToken(gameId: string, provided: string | undefined): boolean {
  if (!provided || typeof provided !== 'string' || !/^[a-f0-9]{64}$/i.test(provided)) {
    return false;
  }
  const expected = computeGameMediaToken(gameId);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

type SessionResolution =
  | { ok: true; game: GameRecord; participant: ParticipantRecord; token: string }
  | { ok: false; status: number; code: string; error: string };

function resolveRequestSession(req: Request, expectedCode: string): SessionResolution {
  const token = extractSessionToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: 'SESSION_MISSING',
      error: 'Session expired. Please rejoin the game.',
    };
  }

  const session = getSessionByToken(token);
  if (!session) {
    return {
      ok: false,
      status: 401,
      code: 'SESSION_EXPIRED',
      error: 'Session expired. Please rejoin the game.',
    };
  }

  if (session.game.joiningCode !== expectedCode) {
    const targetGame = getGameByCode(expectedCode);
    if (!targetGame) {
      return {
        ok: false,
        status: 404,
        code: 'GAME_NOT_FOUND',
        error: 'Game code not found. Please check the 4-digit code.',
      };
    }
    return {
      ok: false,
      status: 403,
      code: 'WRONG_GAME',
      error: 'You are not a participant in this game.',
    };
  }

  return {
    ok: true,
    game: session.game,
    participant: session.participant,
    token,
  };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const gameRooms = new Map<string, Set<WebSocket>>();

  function attachSocketToRoom(ws: WebSocket, game: GameRecord) {
    const gameId = game.id;
    let room = gameRooms.get(gameId);
    if (!room) {
      room = new Set();
      gameRooms.set(gameId, room);
    }
    room.add(ws);

    ws.send(JSON.stringify({ type: 'connected', gameId, joiningCode: game.joiningCode }));

    ws.on('close', () => {
      const currentRoom = gameRooms.get(gameId);
      if (currentRoom) {
        currentRoom.delete(ws);
        if (currentRoom.size === 0) {
          gameRooms.delete(gameId);
        }
      }
    });
  }

  function broadcastToGame(gameId: string, event: Record<string, unknown>) {
    const clients = gameRooms.get(gameId);
    if (!clients || clients.size === 0) return;
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  server.on('upgrade', (req, socket, head) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (requestUrl.pathname !== '/ws') {
        return;
      }

      const cookies = parseCookies(req.headers.cookie);
      const cookieSession = getSessionByToken(cookies[SESSION_COOKIE_NAME]);
      const requestedCode = requestUrl.searchParams.get('code') || '';

      wss.handleUpgrade(req, socket, head, (ws) => {
        if (cookieSession && cookieSession.game.joiningCode === requestedCode) {
          attachSocketToRoom(ws, cookieSession.game);
          return;
        }

        // Allow in-memory Bearer session auth via first WebSocket message
        // (supports cross-origin iframes where third-party cookies are blocked)
        let authenticated = false;
        const authTimer = setTimeout(() => {
          if (!authenticated && ws.readyState === WebSocket.OPEN) {
            ws.close(4001, 'Session authentication timeout');
          }
        }, 5000);

        ws.on('message', (raw) => {
          if (authenticated) return;
          try {
            const msg = JSON.parse(String(raw)) as {
              type?: string;
              token?: string;
              joiningCode?: string;
            };
            if (msg.type === 'auth' && typeof msg.token === 'string') {
              const session = getSessionByToken(msg.token);
              if (session && session.game.joiningCode === (msg.joiningCode || requestedCode)) {
                authenticated = true;
                clearTimeout(authTimer);
                attachSocketToRoom(ws, session.game);
                return;
              }
            }
          } catch {
            // ignore malformed auth message
          }
          clearTimeout(authTimer);
          ws.close(4001, 'Unauthorized');
        });

        ws.on('close', () => {
          clearTimeout(authTimer);
        });
      });
    } catch {
      socket.destroy();
    }
  });

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Check active participant session (Bearer header or HttpOnly cookie)
  app.get('/api/session', (req, res) => {
    const token = extractSessionToken(req);
    const session = getSessionByToken(token);
    if (!session || !token) {
      res.json({ session: null });
      return;
    }
    const state = getFullGameState(session.game, session.participant);
    res.json({
      session: {
        ...state,
        sessionToken: token,
        mediaToken: computeGameMediaToken(session.game.id),
      },
    });
  });

  // Leave current game session
  app.post('/api/session/leave', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Create a new game with a unique 4-digit joining code
  app.post('/api/games', express.json({ limit: '16kb' }), (_req, res) => {
    try {
      const game = createGame();
      res.status(201).json({ game });
    } catch (err) {
      console.error('Failed to create game:', err);
      res.status(500).json({ error: 'Unable to create game right now. Please try again.' });
    }
  });

  // Validate code existence quickly
  app.get('/api/games/:code/check', (req, res) => {
    const code = String(req.params.code || '');
    if (!isValidJoiningCode(code)) {
      res.status(400).json({ error: 'Enter a 4-digit game code.' });
      return;
    }
    const game = getGameByCode(code);
    if (!game) {
      res.status(404).json({ error: 'Game code not found.' });
      return;
    }
    res.json({ game });
  });

  // Join an existing game with 4-digit code + name
  app.post('/api/games/join', express.json({ limit: '16kb' }), (req, res) => {
    const joiningCode = typeof req.body?.joiningCode === 'string' ? req.body.joiningCode.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name : '';

    const result = joinGame(joiningCode, name);
    if (!result.ok) {
      const status =
        result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'EXPIRED'
            ? 410
            : 400;
      devLog('POST /api/games/join failed', { status, code: result.code, joiningCode });
      res.status(status).json({ error: result.message, code: result.code });
      return;
    }

    setSessionCookie(req, res, result.sessionId);
    const state = getFullGameState(result.game, result.participant);

    broadcastToGame(result.game.id, {
      type: 'game:sync',
      reason: 'participant_joined',
      participantId: result.participant.id,
      participantName: result.participant.name,
    });

    res.status(200).json({
      ...state,
      sessionToken: result.sessionId,
      mediaToken: computeGameMediaToken(result.game.id),
    });
  });

  // Fetch authoritative game state (strictly scoped to participants of that game)
  app.get('/api/games/:code/state', (req, res) => {
    const code = String(req.params.code || '');
    const auth = resolveRequestSession(req, code);

    if (!auth.ok) {
      devLog('GET /api/games/:code/state rejected', {
        status: auth.status,
        reason: auth.code,
        joiningCode: code,
      });
      res.status(auth.status).json({ error: auth.error, code: auth.code });
      return;
    }

    const state = getFullGameState(auth.game, auth.participant);
    res.json({
      ...state,
      sessionToken: auth.token,
      mediaToken: computeGameMediaToken(auth.game.id),
    });
  });

  // Upload or replace a challenge photo (raw binary JPEG/PNG/WebP up to 4MB)
  app.post(
    '/api/games/:code/submissions',
    express.raw({
      type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
      limit: MAX_IMAGE_BYTES,
    }),
    (req, res) => {
      const code = String(req.params.code || '');
      const auth = resolveRequestSession(req, code);

      if (!auth.ok) {
        devLog('POST /api/games/:code/submissions rejected', {
          status: auth.status,
          reason: auth.code,
          joiningCode: code,
          hasAuthHeader: Boolean(req.headers.authorization),
          hasCookieHeader: Boolean(req.headers.cookie),
        });
        res.status(auth.status).json({ error: auth.error, code: auth.code });
        return;
      }

      if (auth.game.status === 'expired') {
        devLog('POST /api/games/:code/submissions expired', {
          status: 410,
          gameId: auth.game.id,
          participantId: auth.participant.id,
        });
        res.status(410).json({
          code: 'GAME_EXPIRED',
          error: 'Game has already closed after 48 hours. Existing photos are preserved.',
        });
        return;
      }

      const challengeId = Number(req.query.challengeId);
      if (!isValidChallengeId(challengeId)) {
        res.status(400).json({ error: 'Invalid challenge number.' });
        return;
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'No image data received. Please select a photo again.' });
        return;
      }

      if (body.length > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: 'Image is too large. Please choose a smaller photo.' });
        return;
      }

      const detectedMime = validateImageMagicBytes(body);
      if (!detectedMime) {
        res.status(400).json({
          error: 'Unsupported image format. Please upload a JPEG, PNG, or WebP photo.',
        });
        return;
      }

      const ext = mimeToExtension(detectedMime);
      const fileName = `${crypto.randomUUID()}.${ext}`;
      const targetPath = resolveSafeUploadPath(auth.game.id, fileName);
      if (!targetPath) {
        res.status(400).json({ error: 'Invalid upload destination.' });
        return;
      }

      try {
        const gameDir = path.resolve(getUploadsRoot(), auth.game.id);
        fs.mkdirSync(gameDir, { recursive: true });
        fs.writeFileSync(targetPath, body);

        const imageUrl = `/api/uploads/${auth.game.id}/${fileName}?v=${Date.now()}`;
        const result = upsertPhotoSubmission({
          game: auth.game,
          participant: auth.participant,
          challengeId,
          fileName,
          imageUrl,
        });

        // Clean up replaced image file if different
        if (result.oldFileName && result.oldFileName !== fileName) {
          const oldPath = resolveSafeUploadPath(auth.game.id, result.oldFileName);
          if (oldPath && fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }

        const state = getFullGameState(auth.game, auth.participant);

        broadcastToGame(auth.game.id, {
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
            mediaToken: computeGameMediaToken(auth.game.id),
          },
        });
      } catch (err) {
        const errCode =
          err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : 'UNKNOWN';
        devLog('Photo upload storage error', {
          status: 500,
          errCode,
          gameId: auth.game.id,
          participantId: auth.participant.id,
        });
        if (errCode === 'EACCES' || errCode === 'EPERM') {
          res.status(500).json({ error: 'Storage permission denied. Please try again.' });
          return;
        }
        res.status(500).json({ error: 'Photo upload failed. Please try again.' });
      }
    },
  );

  // Serve uploaded photos strictly to participants of that same game
  // Accepts either a verified participant session (cookie/Bearer) or a verified game-scoped HMAC media token
  app.get('/api/uploads/:gameId/:fileName', (req, res) => {
    const gameId = String(req.params.gameId || '');
    const fileName = String(req.params.fileName || '');

    const token = extractSessionToken(req);
    const session = getSessionByToken(token);
    const hasValidSession = Boolean(session && session.game.id === gameId);
    const mt = typeof req.query.mt === 'string' ? req.query.mt : undefined;
    const hasValidMediaToken = verifyGameMediaToken(gameId, mt);

    if (!hasValidSession && !hasValidMediaToken) {
      devLog('GET /api/uploads denied', { status: 403, gameId, hasSession: Boolean(session) });
      res.status(403).json({ error: 'You are not a participant in this game.' });
      return;
    }

    const safePath = resolveSafeUploadPath(gameId, fileName);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).json({ error: 'Photo not found.' });
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(safePath);
  });

  // Error handler for oversized raw body
  app.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Photo is too large. Please try a smaller photo.' });
      return;
    }
    next(err);
  });

  // Mount Vite in development, or serve built dist/ in production
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (isProd) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Human Bingo server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
