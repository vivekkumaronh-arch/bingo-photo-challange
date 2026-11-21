import type {
  GameProgressSummary,
  GameRecord,
  LeaderboardEntry,
  ParticipantRecord,
  PhotoSubmissionRecord,
  SupportedImageMime,
} from '../src/shared/gameLogic';

export interface FullGameState {
  game: GameRecord;
  participant: ParticipantRecord;
  participants: ParticipantRecord[];
  submissions: PhotoSubmissionRecord[];
  progress: GameProgressSummary;
  leaderboard: LeaderboardEntry[];
}

export type JoinGameResult =
  | {
      ok: true;
      game: GameRecord;
      participant: ParticipantRecord;
      rawSessionToken: string;
    }
  | {
      ok: false;
      code: 'INVALID_CODE' | 'INVALID_NAME' | 'NOT_FOUND' | 'EXPIRED';
      message: string;
    };

export interface SaveSubmissionResult {
  ok: true;
  submission: PhotoSubmissionRecord;
  replaced: boolean;
}

export interface GameBackend {
  createGame(nowMs?: number): Promise<GameRecord>;
  getGameByCode(joiningCode: string, nowMs?: number): Promise<GameRecord | null>;
  joinGame(joiningCode: string, rawName: string, nowMs?: number): Promise<JoinGameResult>;
  getSessionByToken(
    rawSessionToken: string | undefined,
    nowMs?: number,
  ): Promise<{ game: GameRecord; participant: ParticipantRecord } | null>;
  getFullGameState(game: GameRecord, currentParticipant: ParticipantRecord): Promise<FullGameState>;
  savePhotoSubmission(params: {
    game: GameRecord;
    participant: ParticipantRecord;
    challengeId: number;
    mimeType: SupportedImageMime;
    buffer: Buffer;
    nowMs?: number;
  }): Promise<SaveSubmissionResult>;
  readPhotoObject(
    gameId: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null>;
}
