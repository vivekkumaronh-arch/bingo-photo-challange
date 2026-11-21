import type {
  GameProgressSummary,
  GameRecord,
  LeaderboardEntry,
  ParticipantRecord,
  PhotoSubmissionRecord,
} from '../shared/gameLogic';

export interface GameStatePayload {
  game: GameRecord;
  participant: ParticipantRecord;
  participants: ParticipantRecord[];
  submissions: PhotoSubmissionRecord[];
  progress: GameProgressSummary;
  leaderboard: LeaderboardEntry[];
  sessionToken?: string;
  mediaToken?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// Held strictly in JS memory (never localStorage/sessionStorage) so requests
// work reliably even in cross-origin iframes that block third-party cookies.
let activeSessionToken: string | null = null;
let activeMediaToken: string | null = null;

function setSessionTokens(payload: GameStatePayload | null): void {
  if (!payload) {
    activeSessionToken = null;
    activeMediaToken = null;
    return;
  }
  if (payload.sessionToken) {
    activeSessionToken = payload.sessionToken;
  }
  if (payload.mediaToken) {
    activeMediaToken = payload.mediaToken;
  }
}

export function clearInMemorySession(): void {
  activeSessionToken = null;
  activeMediaToken = null;
}

export function resolveMediaUrl(imageUrl: string): string {
  if (!imageUrl || !activeMediaToken) return imageUrl;
  if (!imageUrl.startsWith('/api/uploads/')) return imageUrl;
  const separator = imageUrl.includes('?') ? '&' : '?';
  return `${imageUrl}${separator}mt=${encodeURIComponent(activeMediaToken)}`;
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (activeSessionToken) {
    headers.Authorization = `Bearer ${activeSessionToken}`;
  }
  return headers;
}

async function parseApiError(
  operation: string,
  res: Response,
  fallback: string,
): Promise<ApiError> {
  let message = fallback;
  let code: string | undefined;
  try {
    const data = (await res.json()) as { error?: string; code?: string };
    if (data?.error) message = data.error;
    if (data?.code) code = data.code;
  } catch {
    // ignore JSON parse failure
  }
  if (import.meta.env.DEV) {
    console.error(`[API] ${operation} failed (${res.status})`, { code, message });
  }
  return new ApiError(message, res.status, code);
}

export async function fetchSession(): Promise<GameStatePayload | null> {
  const res = await fetch('/api/session', {
    credentials: 'include',
    headers: buildAuthHeaders(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { session: GameStatePayload | null };
  const session = data.session ?? null;
  if (session) {
    setSessionTokens(session);
  }
  return session;
}

export async function createNewGame(): Promise<GameRecord> {
  const res = await fetch('/api/games', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw await parseApiError('POST /api/games', res, 'Could not create a new game.');
  }
  const data = (await res.json()) as { game: GameRecord };
  return data.game;
}

export async function joinExistingGame(joiningCode: string, name: string): Promise<GameStatePayload> {
  const res = await fetch('/api/games/join', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ joiningCode, name }),
  });
  if (!res.ok) {
    throw await parseApiError('POST /api/games/join', res, 'Could not join game.');
  }
  const payload = (await res.json()) as GameStatePayload;
  setSessionTokens(payload);
  return payload;
}

export async function fetchGameState(joiningCode: string): Promise<GameStatePayload> {
  const res = await fetch(`/api/games/${encodeURIComponent(joiningCode)}/state`, {
    credentials: 'include',
    headers: buildAuthHeaders(),
  });
  if (!res.ok) {
    throw await parseApiError(
      `GET /api/games/${joiningCode}/state`,
      res,
      'Unable to refresh game state.',
    );
  }
  const payload = (await res.json()) as GameStatePayload;
  setSessionTokens(payload);
  return payload;
}

export async function uploadChallengePhoto(
  joiningCode: string,
  challengeId: number,
  blob: Blob,
): Promise<{ submission: PhotoSubmissionRecord; replaced: boolean; state: GameStatePayload }> {
  const res = await fetch(
    `/api/games/${encodeURIComponent(joiningCode)}/submissions?challengeId=${encodeURIComponent(
      String(challengeId),
    )}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: buildAuthHeaders({
        'Content-Type': blob.type || 'image/jpeg',
      }),
      body: blob,
    },
  );
  if (!res.ok) {
    throw await parseApiError(
      `POST /api/games/${joiningCode}/submissions`,
      res,
      'Photo upload failed. Please try again.',
    );
  }
  const data = (await res.json()) as {
    submission: PhotoSubmissionRecord;
    replaced: boolean;
    state: GameStatePayload;
  };
  setSessionTokens(data.state);
  return data;
}

export async function leaveCurrentGame(): Promise<void> {
  clearInMemorySession();
  await fetch('/api/session/leave', {
    method: 'POST',
    credentials: 'include',
  });
}

export function connectGameWebSocket(
  joiningCode: string,
  onSync: () => void,
  onConnectionChange?: (connected: boolean) => void,
): () => void {
  let closedByUser = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closedByUser) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?code=${encodeURIComponent(joiningCode)}`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      if (activeSessionToken && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: 'auth',
            token: activeSessionToken,
            joiningCode,
          }),
        );
      }
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type?: string };
        if (msg.type === 'connected') {
          onConnectionChange?.(true);
        } else if (msg.type === 'game:sync') {
          onSync();
        }
      } catch {
        // ignore malformed frames
      }
    };

    socket.onerror = () => {
      onConnectionChange?.(false);
    };

    socket.onclose = () => {
      onConnectionChange?.(false);
      if (!closedByUser) {
        reconnectTimer = window.setTimeout(connect, 2500);
      }
    };
  };

  connect();

  return () => {
    closedByUser = true;
    onConnectionChange?.(false);
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    if (socket) {
      socket.close();
    }
  };
}
