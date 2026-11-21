import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { createExpressApp, parseCookies, SESSION_COOKIE_NAME } from './server/app';
import type { GameRecord } from './src/shared/gameLogic';

const PORT =
  Number(process.env.DEFAULT_APP_PORT) ||
  (process.env.NGINX_PORT ? 3000 : Number(process.env.PORT) || 3000);

async function startServer() {
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

  const { app, backend } = createExpressApp({
    onBroadcastSync: broadcastToGame,
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (requestUrl.pathname !== '/ws') {
        return;
      }

      const cookies = parseCookies(req.headers.cookie);
      const cookieToken = cookies[SESSION_COOKIE_NAME];
      const requestedCode = requestUrl.searchParams.get('code') || '';

      wss.handleUpgrade(req, socket, head, (ws) => {
        void (async () => {
          try {
            const cookieSession = await backend.getSessionByToken(cookieToken);
            if (cookieSession && cookieSession.game.joiningCode === requestedCode) {
              attachSocketToRoom(ws, cookieSession.game);
              return;
            }
          } catch {
            // Fall through to Bearer message authentication
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
            void (async () => {
              try {
                const msg = JSON.parse(String(raw)) as {
                  type?: string;
                  token?: string;
                  joiningCode?: string;
                };
                if (msg.type === 'auth' && typeof msg.token === 'string') {
                  const session = await backend.getSessionByToken(msg.token);
                  if (
                    session &&
                    session.game.joiningCode === (msg.joiningCode || requestedCode)
                  ) {
                    authenticated = true;
                    clearTimeout(authTimer);
                    attachSocketToRoom(ws, session.game);
                    return;
                  }
                }
              } catch {
                // ignore malformed auth message or lookup failure
              }
              clearTimeout(authTimer);
              ws.close(4001, 'Unauthorized');
            })();
          });

          ws.on('close', () => {
            clearTimeout(authTimer);
          });
        })();
      });
    } catch {
      socket.destroy();
    }
  });

  // Mount Vite in development, or serve built dist/ in production
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (isProd) {
    app.use(expressStaticMiddleware(distDir));
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

function expressStaticMiddleware(distDir: string) {
  const router = express.Router();
  router.use(express.static(distDir));
  router.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  return router;
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
