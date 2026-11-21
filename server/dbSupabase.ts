import crypto from 'node:crypto';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calculateProgressStats,
  computeGameExpiry,
  computeLeaderboard,
  formatJoiningCode,
  isGameExpired,
  isValidChallengeId,
  isValidJoiningCode,
  mimeToExtension,
  sanitizeParticipantName,
  type GameRecord,
  type GameStatus,
  type ParticipantRecord,
  type PhotoSubmissionRecord,
} from '../src/shared/gameLogic';
import { buildSignedImageUrl, hashSessionToken } from './security';
import type {
  FullGameState,
  GameBackend,
  JoinGameResult,
  SaveSubmissionResult,
} from './storageTypes';
import { PHOTOS_BUCKET_NAME } from './supabase';

export class GameExpiredError extends Error {
  code = 'GAME_EXPIRED';

  constructor(message = 'Game has already closed after 48 hours. Existing photos are preserved.') {
    super(message);
    this.name = 'GameExpiredError';
  }
}

interface PgGameRow {
  id: string;
  joining_code: string;
  status: string;
  created_at: number;
  expires_at: number;
}

interface PgParticipantRow {
  id: string;
  game_id: string;
  name: string;
  joined_at: number;
}

interface PgSubmissionRow {
  id: string;
  game_id: string;
  participant_id: string;
  challenge_id: number;
  storage_path: string;
  created_at: number;
  updated_at: number;
}

interface UpsertRpcRow {
  id: string;
  game_id: string;
  participant_id: string;
  challenge_id: number;
  storage_path: string;
  created_at: number;
  updated_at: number;
  replaced: boolean;
  old_storage_path: string | null;
}

function formatSupabaseError(err: { code?: string; message?: string; details?: string }): Error {
  const error = new Error(err.message || 'Database operation failed');
  if (err.code) {
    (error as Error & { code?: string }).code = err.code;
  }
  return error;
}

export function isValidStoragePart(gameId: string, fileName: string): boolean {
  return /^[a-f0-9-]{8,64}$/i.test(gameId) && /^[a-f0-9-]+\.(jpg|png|webp)$/i.test(fileName);
}

export function createSupabaseBackend(
  supabase: SupabaseClient,
  sessionSecret: string,
): GameBackend {
  async function mapAndSyncGameRow(row: PgGameRow, nowMs: number = Date.now()): Promise<GameRecord> {
    const expired = row.status === 'expired' || isGameExpired(row.expires_at, nowMs);
    if (expired && row.status !== 'expired') {
      await supabase
        .from('games')
        .update({ status: 'expired' })
        .eq('id', row.id)
        .eq('status', 'active');
    }
    const status: GameStatus = expired ? 'expired' : 'active';
    return {
      id: row.id,
      joiningCode: row.joining_code,
      status,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
    };
  }

  async function getGameById(gameId: string, nowMs: number = Date.now()): Promise<GameRecord | null> {
    const { data, error } = await supabase
      .from('games')
      .select('id, joining_code, status, created_at, expires_at')
      .eq('id', gameId)
      .maybeSingle<PgGameRow>();

    if (error) throw formatSupabaseError(error);
    if (!data) return null;
    return mapAndSyncGameRow(data, nowMs);
  }

  return {
    async createGame(nowMs: number = Date.now()): Promise<GameRecord> {
      // Mark any elapsed active games as expired so their codes can be reused
      // without ever deleting historical game/participant/photo records.
      const { error: expireErr } = await supabase
        .from('games')
        .update({ status: 'expired' })
        .eq('status', 'active')
        .lte('expires_at', nowMs);

      if (expireErr) {
        throw formatSupabaseError(expireErr);
      }

      const id = crypto.randomUUID();
      const expiresAt = computeGameExpiry(nowMs);

      for (let attempt = 0; attempt < 50; attempt++) {
        const joiningCode = formatJoiningCode(crypto.randomInt(0, 10000));
        const { data, error } = await supabase
          .from('games')
          .insert({
            id,
            joining_code: joiningCode,
            status: 'active',
            created_at: nowMs,
            expires_at: expiresAt,
          })
          .select('id, joining_code, status, created_at, expires_at')
          .single<PgGameRow>();

        if (!error && data) {
          return {
            id: data.id,
            joiningCode: data.joining_code,
            status: 'active',
            createdAt: Number(data.created_at),
            expiresAt: Number(data.expires_at),
          };
        }

        // Postgres unique_violation (active code collision) -> retry with new 4-digit code
        if (error?.code === '23505') {
          continue;
        }

        if (error) {
          throw formatSupabaseError(error);
        }
      }

      throw new Error('No available active joining codes right now. Please try again.');
    },

    async getGameByCode(joiningCode: string, nowMs: number = Date.now()): Promise<GameRecord | null> {
      if (!isValidJoiningCode(joiningCode)) return null;

      // Prefer active game if present; otherwise return most recent historical expired game
      const { data, error } = await supabase
        .from('games')
        .select('id, joining_code, status, created_at, expires_at')
        .eq('joining_code', joiningCode)
        .order('status', { ascending: true }) // 'active' < 'expired'
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<PgGameRow>();

      if (error) throw formatSupabaseError(error);
      if (!data) return null;
      return mapAndSyncGameRow(data, nowMs);
    },

    async joinGame(
      joiningCode: string,
      rawName: string,
      nowMs: number = Date.now(),
    ): Promise<JoinGameResult> {
      if (!isValidJoiningCode(joiningCode)) {
        return { ok: false, code: 'INVALID_CODE', message: 'Please enter a valid 4-digit game code.' };
      }

      const cleanName = sanitizeParticipantName(rawName);
      if (!cleanName) {
        return { ok: false, code: 'INVALID_NAME', message: 'Please enter your name to join.' };
      }

      const game = await this.getGameByCode(joiningCode, nowMs);
      if (!game) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Game code not found. Check the 4 digits and try again.',
        };
      }
      if (game.status === 'expired') {
        return {
          ok: false,
          code: 'EXPIRED',
          message: 'This game has ended after 48 hours. New players can no longer join.',
        };
      }

      const participantId = crypto.randomUUID();
      const rawSessionToken = crypto.randomBytes(32).toString('hex');
      const sessionTokenHash = hashSessionToken(rawSessionToken, sessionSecret);

      const { data, error } = await supabase
        .from('participants')
        .insert({
          id: participantId,
          game_id: game.id,
          name: cleanName,
          session_token_hash: sessionTokenHash,
          joined_at: nowMs,
        })
        .select('id, game_id, name, joined_at')
        .single<PgParticipantRow>();

      if (error || !data) {
        throw formatSupabaseError(error || { message: 'Participant creation failed.' });
      }

      return {
        ok: true,
        game,
        participant: {
          id: data.id,
          gameId: data.game_id,
          name: data.name,
          joinedAt: Number(data.joined_at),
        },
        rawSessionToken,
      };
    },

    async getSessionByToken(
      rawSessionToken: string | undefined,
      nowMs: number = Date.now(),
    ): Promise<{ game: GameRecord; participant: ParticipantRecord } | null> {
      if (!rawSessionToken || typeof rawSessionToken !== 'string' || rawSessionToken.length < 16) {
        return null;
      }

      const tokenHash = hashSessionToken(rawSessionToken, sessionSecret);

      const { data: pRow, error } = await supabase
        .from('participants')
        .select('id, game_id, name, joined_at')
        .eq('session_token_hash', tokenHash)
        .maybeSingle<PgParticipantRow>();

      if (error) throw formatSupabaseError(error);
      if (!pRow) return null;

      const game = await getGameById(pRow.game_id, nowMs);
      if (!game) return null;

      return {
        game,
        participant: {
          id: pRow.id,
          gameId: pRow.game_id,
          name: pRow.name,
          joinedAt: Number(pRow.joined_at),
        },
      };
    },

    async getFullGameState(
      game: GameRecord,
      currentParticipant: ParticipantRecord,
    ): Promise<FullGameState> {
      const [{ data: pRows, error: pErr }, { data: sRows, error: sErr }] = await Promise.all([
        supabase
          .from('participants')
          .select('id, game_id, name, joined_at')
          .eq('game_id', game.id)
          .order('joined_at', { ascending: true }),
        supabase
          .from('photo_submissions')
          .select('id, game_id, participant_id, challenge_id, storage_path, created_at, updated_at')
          .eq('game_id', game.id)
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false }),
      ]);

      if (pErr) throw formatSupabaseError(pErr);
      if (sErr) throw formatSupabaseError(sErr);

      const participants: ParticipantRecord[] = (pRows as PgParticipantRow[]).map((p) => ({
        id: p.id,
        gameId: p.game_id,
        name: p.name,
        joinedAt: Number(p.joined_at),
      }));

      const nameByParticipantId = new Map<string, string>();
      for (const p of participants) {
        nameByParticipantId.set(p.id, p.name);
      }

      const nowMs = Date.now();
      const submissions: PhotoSubmissionRecord[] = (sRows as PgSubmissionRow[]).map((s) => {
        const fileName = path.posix.basename(s.storage_path);
        const updatedAt = Number(s.updated_at);
        return {
          id: s.id,
          gameId: s.game_id,
          participantId: s.participant_id,
          participantName: nameByParticipantId.get(s.participant_id) || 'Player',
          challengeId: s.challenge_id,
          imageUrl: buildSignedImageUrl(s.game_id, fileName, updatedAt, sessionSecret, nowMs),
          createdAt: Number(s.created_at),
          updatedAt,
        };
      });

      return {
        game,
        participant: currentParticipant,
        participants,
        submissions,
        progress: calculateProgressStats(participants, submissions),
        leaderboard: computeLeaderboard(participants, submissions),
      };
    },

    async savePhotoSubmission(params): Promise<SaveSubmissionResult> {
      const nowMs = params.nowMs ?? Date.now();
      if (!isValidChallengeId(params.challengeId)) {
        throw new Error('Invalid challenge ID.');
      }

      if (params.game.status === 'expired' || isGameExpired(params.game.expiresAt, nowMs)) {
        await supabase
          .from('games')
          .update({ status: 'expired' })
          .eq('id', params.game.id)
          .eq('status', 'active');
        throw new GameExpiredError();
      }

      const ext = mimeToExtension(params.mimeType);
      const newFileName = `${crypto.randomUUID()}.${ext}`;
      const newStoragePath = `${params.game.id}/${newFileName}`;

      // Step 1: Upload new object BEFORE touching database or old object
      const { error: uploadErr } = await supabase.storage
        .from(PHOTOS_BUCKET_NAME)
        .upload(newStoragePath, params.buffer, {
          contentType: params.mimeType,
          upsert: false,
        });

      if (uploadErr) {
        throw formatSupabaseError({ message: uploadErr.message || 'Storage upload failed.' });
      }

      // Step 2: Atomically commit DB row via non-throwing RPC
      const { data: rpcData, error: rpcErr } = await supabase.rpc('upsert_photo_submission', {
        p_game_id: params.game.id,
        p_participant_id: params.participant.id,
        p_challenge_id: params.challengeId,
        p_storage_path: newStoragePath,
        p_now_ms: nowMs,
      });

      const rpcRows = Array.isArray(rpcData) ? (rpcData as UpsertRpcRow[]) : [];

      if (rpcErr || rpcRows.length === 0) {
        // Compensating cleanup of the newly uploaded object; existing DB row and previous photo remain intact
        await supabase.storage
          .from(PHOTOS_BUCKET_NAME)
          .remove([newStoragePath])
          .catch(() => {});

        if (!rpcErr && rpcRows.length === 0) {
          throw new GameExpiredError();
        }
        throw formatSupabaseError(rpcErr || { message: 'Failed to save photo submission.' });
      }

      const saved = rpcRows[0];

      // Step 3: Remove previous object ONLY AFTER DB transaction committed
      if (saved.replaced && saved.old_storage_path && saved.old_storage_path !== newStoragePath) {
        await supabase.storage
          .from(PHOTOS_BUCKET_NAME)
          .remove([saved.old_storage_path])
          .catch((cleanupErr) => {
            console.warn('[HumanBingo] Old storage object cleanup warning:', cleanupErr);
          });
      }

      const updatedAt = Number(saved.updated_at);
      return {
        ok: true,
        replaced: Boolean(saved.replaced),
        submission: {
          id: saved.id,
          gameId: saved.game_id,
          participantId: saved.participant_id,
          participantName: params.participant.name,
          challengeId: saved.challenge_id,
          imageUrl: buildSignedImageUrl(saved.game_id, newFileName, updatedAt, sessionSecret, nowMs),
          createdAt: Number(saved.created_at),
          updatedAt,
        },
      };
    },

    async readPhotoObject(
      gameId: string,
      fileName: string,
    ): Promise<{ buffer: Buffer; contentType: string } | null> {
      if (!isValidStoragePart(gameId, fileName)) return null;
      const storagePath = `${gameId}/${fileName}`;

      const { data, error } = await supabase.storage
        .from(PHOTOS_BUCKET_NAME)
        .download(storagePath);

      if (error || !data) {
        return null;
      }

      const arrayBuffer = await data.arrayBuffer();
      const ext = path.extname(fileName).toLowerCase();
      const contentType =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

      return {
        buffer: Buffer.from(arrayBuffer),
        contentType,
      };
    },
  };
}
