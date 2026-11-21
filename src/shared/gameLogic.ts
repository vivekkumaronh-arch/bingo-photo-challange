import { TOTAL_CHALLENGES } from './challenges';

export const GAME_DURATION_MS = 48 * 60 * 60 * 1000;

export type GameStatus = 'active' | 'expired';

export interface GameRecord {
  id: string;
  joiningCode: string;
  status: GameStatus;
  createdAt: number;
  expiresAt: number;
}

export interface ParticipantRecord {
  id: string;
  gameId: string;
  name: string;
  joinedAt: number;
}

export interface PhotoSubmissionRecord {
  id: string;
  gameId: string;
  participantId: string;
  participantName: string;
  challengeId: number;
  imageUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface ParticipantProgress {
  id: string;
  name: string;
  completedCount: number;
  totalChallenges: number;
  joinedAt: number;
  lastSubmissionAt: number | null;
}

export interface LeaderboardEntry extends ParticipantProgress {
  rank: number;
  rankLabel: string;
  scoreLabel: string;
}

export interface GameProgressSummary {
  totalPlayers: number;
  photosUploaded: number;
  challengesCompleted: number;
  participants: ParticipantProgress[];
}

export interface SharedGridStats {
  totalPlayers: number;
  totalPhotos: number;
  populatedChallenges: number;
  personalCompleted: number;
  totalChallenges: number;
}

export function calculateSharedGridStats(
  participants: ParticipantRecord[],
  submissions: PhotoSubmissionRecord[],
  currentParticipantId: string,
): SharedGridStats {
  const populatedSet = new Set<number>();
  const personalSet = new Set<number>();
  const uniqueSubmissionPairs = new Set<string>();

  for (const sub of submissions) {
    if (!isValidChallengeId(sub.challengeId)) continue;
    const pairKey = `${sub.participantId}:${sub.challengeId}`;
    if (!uniqueSubmissionPairs.has(pairKey)) {
      uniqueSubmissionPairs.add(pairKey);
    }
    populatedSet.add(sub.challengeId);
    if (sub.participantId === currentParticipantId) {
      personalSet.add(sub.challengeId);
    }
  }

  return {
    totalPlayers: participants.length,
    totalPhotos: uniqueSubmissionPairs.size,
    populatedChallenges: populatedSet.size,
    personalCompleted: personalSet.size,
    totalChallenges: TOTAL_CHALLENGES,
  };
}

export function formatJoiningCode(num: number): string {
  const clamped = Math.max(0, Math.min(9999, Math.floor(num)));
  return String(clamped).padStart(4, '0');
}

export function isValidJoiningCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

export function sanitizeParticipantName(rawName: string): string {
  return rawName.trim().replace(/\s+/g, ' ').slice(0, 40);
}

export function getParticipantInitials(name: string): string {
  const cleaned = sanitizeParticipantName(name);
  if (!cleaned) return '?';
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function isValidParticipantName(rawName: string): boolean {
  const cleaned = sanitizeParticipantName(rawName);
  return cleaned.length >= 1 && cleaned.length <= 40;
}

export function isValidChallengeId(challengeId: number): boolean {
  return Number.isInteger(challengeId) && challengeId >= 1 && challengeId <= TOTAL_CHALLENGES;
}

export function computeGameExpiry(createdAtMs: number): number {
  return createdAtMs + GAME_DURATION_MS;
}

export function isGameExpired(expiresAtMs: number, nowMs: number = Date.now()): boolean {
  return nowMs >= expiresAtMs;
}

export function formatTimeRemaining(expiresAtMs: number, nowMs: number = Date.now()): string {
  const diff = expiresAtMs - nowMs;
  if (diff <= 0) {
    return 'Ended';
  }
  const totalMinutes = Math.floor(diff / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 1) {
    return `${hours}h ${minutes}m left`;
  }
  return `${Math.max(1, minutes)}m left`;
}

export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - timestampMs);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatOrdinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${rank}th`;
  }
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/**
 * Computes deduplicated progress stats across all participants and submissions.
 * Even if raw submission rows contain duplicates for a (participantId, challengeId) pair,
 * only one completion per challenge per participant is counted.
 * Uses the earliest creation timestamp per pair so photo replacements never penalize rank tie-breakers.
 */
export function calculateProgressStats(
  participants: ParticipantRecord[],
  submissions: PhotoSubmissionRecord[],
): GameProgressSummary {
  const perParticipant = new Map<
    string,
    { challengeFirstAt: Map<number, number>; achievedAt: number | null }
  >();
  for (const p of participants) {
    perParticipant.set(p.id, { challengeFirstAt: new Map<number, number>(), achievedAt: null });
  }

  const seenPairs = new Set<string>();

  for (const sub of submissions) {
    if (!isValidChallengeId(sub.challengeId)) continue;
    const entry = perParticipant.get(sub.participantId);
    if (!entry) continue;

    const pairKey = `${sub.participantId}:${sub.challengeId}`;
    seenPairs.add(pairKey);

    const ts = sub.createdAt || sub.updatedAt;
    const prevTs = entry.challengeFirstAt.get(sub.challengeId);
    if (prevTs === undefined || ts < prevTs) {
      entry.challengeFirstAt.set(sub.challengeId, ts);
    }
  }

  for (const entry of perParticipant.values()) {
    let maxFirstAt: number | null = null;
    for (const firstAt of entry.challengeFirstAt.values()) {
      if (maxFirstAt === null || firstAt > maxFirstAt) {
        maxFirstAt = firstAt;
      }
    }
    entry.achievedAt = maxFirstAt;
  }

  const validUniqueCount = seenPairs.size;

  const participantProgress: ParticipantProgress[] = participants
    .map((p) => {
      const entry = perParticipant.get(p.id);
      return {
        id: p.id,
        name: p.name,
        completedCount: entry ? entry.challengeFirstAt.size : 0,
        totalChallenges: TOTAL_CHALLENGES,
        joinedAt: p.joinedAt,
        lastSubmissionAt: entry ? entry.achievedAt : null,
      };
    })
    .sort((a, b) => {
      if (b.completedCount !== a.completedCount) {
        return b.completedCount - a.completedCount;
      }
      if (a.joinedAt !== b.joinedAt) {
        return a.joinedAt - b.joinedAt;
      }
      return a.name.localeCompare(b.name);
    });

  return {
    totalPlayers: participants.length,
    photosUploaded: validUniqueCount,
    challengesCompleted: validUniqueCount,
    participants: participantProgress,
  };
}

export function computeLeaderboard(
  participants: ParticipantRecord[],
  submissions: PhotoSubmissionRecord[],
): LeaderboardEntry[] {
  const progress = calculateProgressStats(participants, submissions).participants;

  const sorted = [...progress].sort((a, b) => {
    if (b.completedCount !== a.completedCount) {
      return b.completedCount - a.completedCount;
    }
    if (a.lastSubmissionAt !== null && b.lastSubmissionAt !== null) {
      if (a.lastSubmissionAt !== b.lastSubmissionAt) {
        return a.lastSubmissionAt - b.lastSubmissionAt;
      }
    } else if (a.lastSubmissionAt !== null) {
      return -1;
    } else if (b.lastSubmissionAt !== null) {
      return 1;
    }
    if (a.joinedAt !== b.joinedAt) {
      return a.joinedAt - b.joinedAt;
    }
    return a.name.localeCompare(b.name);
  });

  return sorted.map((entry, idx) => {
    const rank = idx + 1;
    return {
      ...entry,
      rank,
      rankLabel: formatOrdinal(rank),
      scoreLabel: `${entry.completedCount}/${entry.totalChallenges}`,
    };
  });
}

export function filterParticipantsByName(
  participants: ParticipantRecord[],
  query: string,
): ParticipantRecord[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return participants;
  return participants.filter((p) => p.name.toLowerCase().includes(normalized));
}

export interface OverallGameProgress {
  completedSubmissions: number;
  possibleSubmissions: number;
  percent: number;
}

export function computeOverallGameProgress(
  totalPlayers: number,
  completedSubmissions: number,
): OverallGameProgress {
  const safePlayers = Math.max(0, totalPlayers);
  const possibleSubmissions = safePlayers * TOTAL_CHALLENGES;
  if (possibleSubmissions === 0) {
    return {
      completedSubmissions: 0,
      possibleSubmissions: 0,
      percent: 0,
    };
  }
  const clampedCompleted = Math.max(0, Math.min(possibleSubmissions, completedSubmissions));
  return {
    completedSubmissions: clampedCompleted,
    possibleSubmissions,
    percent: Math.round((clampedCompleted / possibleSubmissions) * 100),
  };
}

export interface ChallengeCompletionStat {
  challengeId: number;
  submissionsCount: number;
  completionPercent: number;
}

export function computeChallengeCompletionStats(
  participants: ParticipantRecord[],
  submissions: PhotoSubmissionRecord[],
): ChallengeCompletionStat[] {
  const participantIds = new Set(participants.map((p) => p.id));
  const counts = new Map<number, Set<string>>();
  for (let id = 1; id <= TOTAL_CHALLENGES; id += 1) {
    counts.set(id, new Set<string>());
  }

  for (const sub of submissions) {
    if (!isValidChallengeId(sub.challengeId)) continue;
    if (!participantIds.has(sub.participantId)) continue;
    counts.get(sub.challengeId)?.add(sub.participantId);
  }

  const totalPlayers = participants.length;
  const stats: ChallengeCompletionStat[] = [];
  for (let id = 1; id <= TOTAL_CHALLENGES; id += 1) {
    const count = counts.get(id)?.size ?? 0;
    stats.push({
      challengeId: id,
      submissionsCount: count,
      completionPercent: totalPlayers > 0 ? Math.round((count / totalPlayers) * 100) : 0,
    });
  }

  return stats.sort((a, b) => {
    if (b.submissionsCount !== a.submissionsCount) {
      return b.submissionsCount - a.submissionsCount;
    }
    return a.challengeId - b.challengeId;
  });
}

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function validateImageMagicBytes(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function mimeToExtension(mime: SupportedImageMime): 'jpg' | 'png' | 'webp' {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}
