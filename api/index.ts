import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createExpressApp } from '../server/app';

let cachedApp: Express | null = null;

function getApp(): Express {
  if (!cachedApp) {
    cachedApp = createExpressApp({ requireSupabase: true }).app;
  }
  return cachedApp;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  try {
    const app = getApp();
    app(req as never, res as never);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Server configuration error.';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: message,
        code: 'SERVER_CONFIG_ERROR',
      }),
    );
  }
}
