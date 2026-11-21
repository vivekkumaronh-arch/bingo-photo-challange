import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mimeToExtension } from '../src/shared/gameLogic';
import {
  createGame as sqliteCreateGame,
  getFullGameState as sqliteGetFullGameState,
  getGameByCode as sqliteGetGameByCode,
  getSessionByToken as sqliteGetSessionByToken,
  getUploadsRoot,
  joinGame as sqliteJoinGame,
  resolveSafeUploadPath,
  upsertPhotoSubmission as sqliteUpsertPhotoSubmission,
} from './db';
import { GameExpiredError } from './dbSupabase';
import { buildSignedImageUrl } from './security';
import type { GameBackend } from './storageTypes';

export function createSqliteBackend(sessionSecret: string): GameBackend {
  return {
    async createGame(nowMs) {
      return sqliteCreateGame(nowMs);
    },

    async getGameByCode(joiningCode, nowMs) {
      return sqliteGetGameByCode(joiningCode, nowMs);
    },

    async joinGame(joiningCode, rawName, nowMs) {
      const result = sqliteJoinGame(joiningCode, rawName, nowMs);
      if (!result.ok) {
        return result;
      }
      return {
        ok: true,
        game: result.game,
        participant: result.participant,
        rawSessionToken: result.sessionId,
      };
    },

    async getSessionByToken(rawSessionToken, nowMs) {
      return sqliteGetSessionByToken(rawSessionToken, nowMs);
    },

    async getFullGameState(game, currentParticipant) {
      const state = sqliteGetFullGameState(game, currentParticipant);
      const nowMs = Date.now();
      return {
        ...state,
        submissions: state.submissions.map((sub) => {
          const cleanPath = sub.imageUrl.split('?')[0];
          const fileName = path.posix.basename(cleanPath);
          return {
            ...sub,
            imageUrl: buildSignedImageUrl(sub.gameId, fileName, sub.updatedAt, sessionSecret, nowMs),
          };
        }),
      };
    },

    async savePhotoSubmission(params) {
      const nowMs = params.nowMs ?? Date.now();
      if (params.game.status === 'expired' || nowMs >= params.game.expiresAt) {
        throw new GameExpiredError();
      }

      const ext = mimeToExtension(params.mimeType);
      const fileName = `${crypto.randomUUID()}.${ext}`;
      const targetPath = resolveSafeUploadPath(params.game.id, fileName);
      if (!targetPath) {
        throw new Error('Invalid upload destination.');
      }

      const gameDir = path.resolve(getUploadsRoot(), params.game.id);
      fs.mkdirSync(gameDir, { recursive: true });
      fs.writeFileSync(targetPath, params.buffer);

      let result;
      try {
        const imageUrl = buildSignedImageUrl(params.game.id, fileName, nowMs, sessionSecret, nowMs);
        result = sqliteUpsertPhotoSubmission({
          game: params.game,
          participant: params.participant,
          challengeId: params.challengeId,
          fileName,
          imageUrl,
          nowMs,
        });
      } catch (err) {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        throw err;
      }

      if (result.oldFileName && result.oldFileName !== fileName) {
        const oldPath = resolveSafeUploadPath(params.game.id, result.oldFileName);
        if (oldPath && fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch {
            // best-effort old photo cleanup
          }
        }
      }

      return {
        ok: true,
        submission: result.submission,
        replaced: result.replaced,
      };
    },

    async readPhotoObject(gameId, fileName) {
      const safePath = resolveSafeUploadPath(gameId, fileName);
      if (!safePath || !fs.existsSync(safePath)) return null;
      const ext = path.extname(safePath).toLowerCase();
      const contentType =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return {
        buffer: fs.readFileSync(safePath),
        contentType,
      };
    },
  };
}
