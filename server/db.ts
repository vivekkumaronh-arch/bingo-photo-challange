import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  calculateProgressStats,
  computeGameExpiry,
  computeLeaderboard,
  formatJoiningCode,
  isGameExpired,
  isValidChallengeId,
  isValidJoiningCode,
  sanitizeParticipantName,
  type GameProgressSummary,
  type GameRecord,
  type GameStatus,
  type LeaderboardEntry,
  type ParticipantRecord,
  type PhotoSubmissionRecord,
} from '../src/shared/gameLogic';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_ROOT = path.resolve(DATA_DIR, 'uploads');
const DB_PATH = path.resolve(DATA_DIR, 'human_bingo.sqlite');

fs.mkdirSync(UPLOADS_ROOT, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    joining_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    session_id TEXT UNIQUE NOT NULL,
    joined_at INTEGER NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_participants_game_id ON participants(game_id);
  CREATE INDEX IF NOT EXISTS idx_participants_session_id ON participants(session_id);

  CREATE TABLE IF NOT EXISTS photo_submissions (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    challenge_id INTEGER NOT NULL CHECK(challenge_id BETWEEN 1 AND 9),
    image_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(participant_id, challenge_id),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_submissions_game_id ON photo_submissions(game_id);
`);

export function getUploadsRoot(): string {
  return UPLOADS_ROOT;
}

export function resolveSafeUploadPath(gameId: string, fileName: string): string | null {
  if (!/^[a-f0-9-]{8,64}$/i.test(gameId)) return null;
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(fileName)) return null;
  const gameDir = path.resolve(UPLOADS_ROOT, gameId);
  const fullPath = path.resolve(gameDir, fileName);
  if (!fullPath.startsWith(UPLOADS_ROOT + path.sep)) return null;
  if (!fullPath.startsWith(gameDir + path.sep)) return null;
  return fullPath;
}

interface RawGameRow {
  id: string;
  joining_code: string;
  status: string;
  created_at: number;
  expires_at: number;
}

interface RawParticipantRow {
  id: string;
  game_id: string;
  name: string;
  session_id: string;
  joined_at: number;
}

interface RawSubmissionRow {
  id: string;
  game_id: string;
  participant_id: string;
  participant_name: string;
  challenge_id: number;
  image_url: string;
  file_name: string;
  created_at: number;
  updated_at: number;
}

function mapGameRow(row: RawGameRow, nowMs: number = Date.now()): GameRecord {
  const expired = row.status === 'expired' || isGameExpired(row.expires_at, nowMs);
  if (expired && row.status !== 'expired') {
    db.prepare(`UPDATE games SET status = 'expired' WHERE id = ?`).run(row.id);
  }
  const status: GameStatus = expired ? 'expired' : 'active';
  return {
    id: row.id,
    joiningCode: row.joining_code,
    status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function mapParticipantRow(row: RawParticipantRow): ParticipantRecord {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    joinedAt: row.joined_at,
  };
}

function mapSubmissionRow(row: RawSubmissionRow): PhotoSubmissionRecord {
  return {
    id: row.id,
    gameId: row.game_id,
    participantId: row.participant_id,
    participantName: row.participant_name,
    challengeId: row.challenge_id,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createGame(nowMs: number = Date.now()): GameRecord {
  const id = crypto.randomUUID();
  const expiresAt = computeGameExpiry(nowMs);

  const checkStmt = db.prepare(`SELECT id, status, expires_at FROM games WHERE joining_code = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO games (id, joining_code, status, created_at, expires_at) VALUES (?, ?, 'active', ?, ?)`,
  );

  for (let attempt = 0; attempt < 50; attempt++) {
    const code = formatJoiningCode(crypto.randomInt(0, 10000));
    const existing = checkStmt.get(code) as { id: string; status: string; expires_at: number } | undefined;
    if (!existing) {
      insertStmt.run(id, code, nowMs, expiresAt);
      return {
        id,
        joiningCode: code,
        status: 'active',
        createdAt: nowMs,
        expiresAt,
      };
    }
  }

  // Fallback: recycle an expired game's code if 4-digit space is saturated
  const expiredGame = db
    .prepare(`SELECT id, joining_code FROM games WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT 1`)
    .get(nowMs) as { id: string; joining_code: string } | undefined;

  if (expiredGame) {
    db.prepare(`DELETE FROM games WHERE id = ?`).run(expiredGame.id);
    const oldUploadDir = path.resolve(UPLOADS_ROOT, expiredGame.id);
    if (oldUploadDir.startsWith(UPLOADS_ROOT + path.sep)) {
      fs.rmSync(oldUploadDir, { recursive: true, force: true });
    }
    insertStmt.run(id, expiredGame.joining_code, nowMs, expiresAt);
    return {
      id,
      joiningCode: expiredGame.joining_code,
      status: 'active',
      createdAt: nowMs,
      expiresAt,
    };
  }

  throw new Error('No available joining codes');
}

export function getGameByCode(joiningCode: string, nowMs: number = Date.now()): GameRecord | null {
  if (!isValidJoiningCode(joiningCode)) return null;
  const row = db
    .prepare(`SELECT id, joining_code, status, created_at, expires_at FROM games WHERE joining_code = ?`)
    .get(joiningCode) as RawGameRow | undefined;
  if (!row) return null;
  return mapGameRow(row, nowMs);
}

export function getGameById(gameId: string, nowMs: number = Date.now()): GameRecord | null {
  const row = db
    .prepare(`SELECT id, joining_code, status, created_at, expires_at FROM games WHERE id = ?`)
    .get(gameId) as RawGameRow | undefined;
  if (!row) return null;
  return mapGameRow(row, nowMs);
}

export function joinGame(
  joiningCode: string,
  rawName: string,
  nowMs: number = Date.now(),
): {
  ok: true;
  game: GameRecord;
  participant: ParticipantRecord;
  sessionId: string;
} | {
  ok: false;
  code: 'INVALID_CODE' | 'INVALID_NAME' | 'NOT_FOUND' | 'EXPIRED';
  message: string;
} {
  if (!isValidJoiningCode(joiningCode)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Please enter a valid 4-digit game code.' };
  }
  const cleanName = sanitizeParticipantName(rawName);
  if (!cleanName) {
    return { ok: false, code: 'INVALID_NAME', message: 'Please enter your name to join.' };
  }

  const game = getGameByCode(joiningCode, nowMs);
  if (!game) {
    return { ok: false, code: 'NOT_FOUND', message: 'Game code not found. Check the 4 digits and try again.' };
  }
  if (game.status === 'expired') {
    return {
      ok: false,
      code: 'EXPIRED',
      message: 'This game has ended after 48 hours. New players can no longer join.',
    };
  }

  const participantId = crypto.randomUUID();
  const sessionId = crypto.randomBytes(24).toString('hex');

  db.prepare(
    `INSERT INTO participants (id, game_id, name, session_id, joined_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(participantId, game.id, cleanName, sessionId, nowMs);

  return {
    ok: true,
    game,
    participant: {
      id: participantId,
      gameId: game.id,
      name: cleanName,
      joinedAt: nowMs,
    },
    sessionId,
  };
}

export function getSessionByToken(
  sessionId: string | undefined,
  nowMs: number = Date.now(),
): { game: GameRecord; participant: ParticipantRecord } | null {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 16) {
    return null;
  }

  const pRow = db
    .prepare(`SELECT id, game_id, name, session_id, joined_at FROM participants WHERE session_id = ?`)
    .get(sessionId) as RawParticipantRow | undefined;
  if (!pRow) return null;

  const game = getGameById(pRow.game_id, nowMs);
  if (!game) return null;

  return {
    game,
    participant: mapParticipantRow(pRow),
  };
}

export interface FullGameState {
  game: GameRecord;
  participant: ParticipantRecord;
  participants: ParticipantRecord[];
  submissions: PhotoSubmissionRecord[];
  progress: GameProgressSummary;
  leaderboard: LeaderboardEntry[];
}

export function getFullGameState(
  game: GameRecord,
  currentParticipant: ParticipantRecord,
): FullGameState {
  const participantRows = db
    .prepare(
      `SELECT id, game_id, name, session_id, joined_at
       FROM participants
       WHERE game_id = ?
       ORDER BY joined_at ASC`,
    )
    .all(game.id) as unknown as RawParticipantRow[];

  const submissionRows = db
    .prepare(
      `SELECT s.id, s.game_id, s.participant_id, p.name AS participant_name,
              s.challenge_id, s.image_url, s.file_name, s.created_at, s.updated_at
       FROM photo_submissions s
       INNER JOIN participants p ON p.id = s.participant_id
       WHERE s.game_id = ?
       ORDER BY s.updated_at DESC, s.created_at DESC`,
    )
    .all(game.id) as unknown as RawSubmissionRow[];

  const participants = participantRows.map(mapParticipantRow);
  const submissions = submissionRows.map(mapSubmissionRow);
  const progress = calculateProgressStats(participants, submissions);
  const leaderboard = computeLeaderboard(participants, submissions);

  return {
    game,
    participant: currentParticipant,
    participants,
    submissions,
    progress,
    leaderboard,
  };
}

export function upsertPhotoSubmission(params: {
  game: GameRecord;
  participant: ParticipantRecord;
  challengeId: number;
  fileName: string;
  imageUrl: string;
  nowMs?: number;
}): {
  submission: PhotoSubmissionRecord;
  replaced: boolean;
  oldFileName: string | null;
} {
  const nowMs = params.nowMs ?? Date.now();
  if (!isValidChallengeId(params.challengeId)) {
    throw new Error('Invalid challenge ID');
  }

  const existing = db
    .prepare(
      `SELECT id, file_name, created_at FROM photo_submissions WHERE participant_id = ? AND challenge_id = ?`,
    )
    .get(params.participant.id, params.challengeId) as
    | { id: string; file_name: string; created_at: number }
    | undefined;

  const submissionId = existing ? existing.id : crypto.randomUUID();
  const createdAt = existing ? existing.created_at : nowMs;

  db.prepare(
    `INSERT INTO photo_submissions (id, game_id, participant_id, challenge_id, image_url, file_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(participant_id, challenge_id)
     DO UPDATE SET
       image_url = excluded.image_url,
       file_name = excluded.file_name,
       updated_at = excluded.updated_at`,
  ).run(
    submissionId,
    params.game.id,
    params.participant.id,
    params.challengeId,
    params.imageUrl,
    params.fileName,
    createdAt,
    nowMs,
  );

  return {
    submission: {
      id: submissionId,
      gameId: params.game.id,
      participantId: params.participant.id,
      participantName: params.participant.name,
      challengeId: params.challengeId,
      imageUrl: params.imageUrl,
      createdAt,
      updatedAt: nowMs,
    },
    replaced: Boolean(existing),
    oldFileName: existing ? existing.file_name : null,
  };
}
