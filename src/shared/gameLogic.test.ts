import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatJoiningCode,
  isValidJoiningCode,
  sanitizeParticipantName,
  getParticipantInitials,
  isValidParticipantName,
  computeGameExpiry,
  isGameExpired,
  calculateProgressStats,
  calculateSharedGridStats,
  computeLeaderboard,
  filterParticipantsByName,
  computeOverallGameProgress,
  computeChallengeCompletionStats,
  validateImageMagicBytes,
  GAME_DURATION_MS,
  type ParticipantRecord,
  type PhotoSubmissionRecord,
} from './gameLogic';

test('joining code formatting preserves leading zeros and validates strict 4 digits', () => {
  assert.equal(formatJoiningCode(0), '0000');
  assert.equal(formatJoiningCode(7), '0007');
  assert.equal(formatJoiningCode(42), '0042');
  assert.equal(formatJoiningCode(4829), '4829');

  assert.equal(isValidJoiningCode('0042'), true);
  assert.equal(isValidJoiningCode('0000'), true);
  assert.equal(isValidJoiningCode('4829'), true);
  assert.equal(isValidJoiningCode('42'), false);
  assert.equal(isValidJoiningCode('12345'), false);
  assert.equal(isValidJoiningCode('abcd'), false);
});

test('participant name sanitization trims and collapses spaces', () => {
  assert.equal(sanitizeParticipantName('   Maya   Lin  '), 'Maya Lin');
  assert.equal(isValidParticipantName('   '), false);
  assert.equal(isValidParticipantName('Alex'), true);
  assert.equal(sanitizeParticipantName('A'.repeat(60)).length, 40);
});

test('48-hour game expiry calculation enforces boundary accurately', () => {
  const created = 1_700_000_000_000;
  const expires = computeGameExpiry(created);
  assert.equal(expires - created, GAME_DURATION_MS);
  assert.equal(isGameExpired(expires, created + GAME_DURATION_MS - 1), false);
  assert.equal(isGameExpired(expires, created + GAME_DURATION_MS), true);
  assert.equal(isGameExpired(expires, created + GAME_DURATION_MS + 60_000), true);
});

test('progress and leaderboard deduplicate replaced photos and rank accurately', () => {
  const participants: ParticipantRecord[] = [
    { id: 'p1', gameId: 'g1', name: 'Aisha', joinedAt: 100 },
    { id: 'p2', gameId: 'g1', name: 'Ben', joinedAt: 200 },
    { id: 'p3', gameId: 'g1', name: 'Chloe', joinedAt: 300 },
  ];

  const submissions: PhotoSubmissionRecord[] = [
    // Aisha completes challenge 1 twice (duplicate/replace should count as 1)
    {
      id: 's1',
      gameId: 'g1',
      participantId: 'p1',
      participantName: 'Aisha',
      challengeId: 1,
      imageUrl: '/a1.webp',
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 's1b',
      gameId: 'g1',
      participantId: 'p1',
      participantName: 'Aisha',
      challengeId: 1,
      imageUrl: '/a1-new.webp',
      createdAt: 1000,
      updatedAt: 2000,
    },
    // Ben completes 2 challenges faster than Chloe (and later replaces photo without losing tie-breaker)
    {
      id: 's2',
      gameId: 'g1',
      participantId: 'p2',
      participantName: 'Ben',
      challengeId: 2,
      imageUrl: '/b2.webp',
      createdAt: 1100,
      updatedAt: 9999,
    },
    {
      id: 's3',
      gameId: 'g1',
      participantId: 'p2',
      participantName: 'Ben',
      challengeId: 3,
      imageUrl: '/b3.webp',
      createdAt: 1200,
      updatedAt: 1200,
    },
    // Chloe completes 2 challenges later
    {
      id: 's4',
      gameId: 'g1',
      participantId: 'p3',
      participantName: 'Chloe',
      challengeId: 4,
      imageUrl: '/c4.webp',
      createdAt: 1500,
      updatedAt: 1500,
    },
    {
      id: 's5',
      gameId: 'g1',
      participantId: 'p3',
      participantName: 'Chloe',
      challengeId: 5,
      imageUrl: '/c5.webp',
      createdAt: 1600,
      updatedAt: 1600,
    },
  ];

  const progress = calculateProgressStats(participants, submissions);
  assert.equal(progress.totalPlayers, 3);
  assert.equal(progress.photosUploaded, 5);
  assert.equal(progress.challengesCompleted, 5);

  const board = computeLeaderboard(participants, submissions);
  assert.equal(board.length, 3);
  assert.equal(board[0].name, 'Ben');
  assert.equal(board[0].rankLabel, '1st');
  assert.equal(board[0].scoreLabel, '2/9');
  assert.equal(board[1].name, 'Chloe');
  assert.equal(board[1].rankLabel, '2nd');
  assert.equal(board[1].scoreLabel, '2/9');
  assert.equal(board[2].name, 'Aisha');
  assert.equal(board[2].rankLabel, '3rd');
  assert.equal(board[2].scoreLabel, '1/9');
});

test('image magic byte validation accepts JPEG, PNG, WebP and rejects invalid payloads', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');

  assert.equal(validateImageMagicBytes(jpeg), 'image/jpeg');
  assert.equal(validateImageMagicBytes(png), 'image/png');
  assert.equal(validateImageMagicBytes(webp), 'image/webp');
  assert.equal(validateImageMagicBytes(html), null);
});

test('shared grid stats separate populated challenges from personal completions and total photos', () => {
  const participants: ParticipantRecord[] = [
    { id: 'p1', gameId: 'g1', name: 'Ankit', joinedAt: 100 },
    { id: 'p2', gameId: 'g1', name: 'Sakshi', joinedAt: 200 },
    { id: 'p3', gameId: 'g1', name: 'Rahul', joinedAt: 300 },
  ];

  // Two players upload to Challenge 01, one player uploads to Challenge 05
  const submissions: PhotoSubmissionRecord[] = [
    {
      id: 's1',
      gameId: 'g1',
      participantId: 'p1',
      participantName: 'Ankit',
      challengeId: 1,
      imageUrl: '/u1.webp',
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 's2',
      gameId: 'g1',
      participantId: 'p2',
      participantName: 'Sakshi',
      challengeId: 1,
      imageUrl: '/u2.webp',
      createdAt: 2000,
      updatedAt: 2000,
    },
    {
      id: 's3',
      gameId: 'g1',
      participantId: 'p3',
      participantName: 'Rahul',
      challengeId: 5,
      imageUrl: '/u3.webp',
      createdAt: 3000,
      updatedAt: 3000,
    },
  ];

  const ankitStats = calculateSharedGridStats(participants, submissions, 'p1');
  assert.equal(ankitStats.totalPlayers, 3);
  assert.equal(ankitStats.totalPhotos, 3);
  assert.equal(ankitStats.populatedChallenges, 2);
  assert.equal(ankitStats.personalCompleted, 1);

  const sakshiStats = calculateSharedGridStats(participants, submissions, 'p2');
  assert.equal(sakshiStats.populatedChallenges, 2);
  assert.equal(sakshiStats.personalCompleted, 1);

  const newViewerStats = calculateSharedGridStats(participants, submissions, 'p4');
  assert.equal(newViewerStats.populatedChallenges, 2);
  assert.equal(newViewerStats.personalCompleted, 0);
});

test('participant initials derive cleanly from single and multi-word names', () => {
  assert.equal(getParticipantInitials('Ankit'), 'AN');
  assert.equal(getParticipantInitials('Maya Lin'), 'ML');
  assert.equal(getParticipantInitials('  Rahul   Kumar  Singh '), 'RS');
  assert.equal(getParticipantInitials(''), '?');
});

test('filterParticipantsByName filters case-insensitively and preserves order on empty query', () => {
  const participants: ParticipantRecord[] = [
    { id: '1', gameId: 'g', name: 'Alice Johnson', joinedAt: 10 },
    { id: '2', gameId: 'g', name: 'Bob', joinedAt: 20 },
    { id: '3', gameId: 'g', name: 'Charlie', joinedAt: 30 },
  ];

  assert.equal(filterParticipantsByName(participants, '').length, 3);
  assert.deepEqual(
    filterParticipantsByName(participants, '  ali ').map((p) => p.name),
    ['Alice Johnson'],
  );
  assert.deepEqual(
    filterParticipantsByName(participants, 'o').map((p) => p.name),
    ['Alice Johnson', 'Bob'],
  );
  assert.equal(filterParticipantsByName(participants, 'xyz').length, 0);
});

test('computeOverallGameProgress calculates proportion of all participant-challenge submissions', () => {
  assert.deepEqual(computeOverallGameProgress(0, 0), {
    completedSubmissions: 0,
    possibleSubmissions: 0,
    percent: 0,
  });
  assert.deepEqual(computeOverallGameProgress(4, 9), {
    completedSubmissions: 9,
    possibleSubmissions: 36,
    percent: 25,
  });
});

test('computeChallengeCompletionStats counts unique submissions per challenge and sorts descending', () => {
  const participants: ParticipantRecord[] = [
    { id: 'p1', gameId: 'g', name: 'A', joinedAt: 1 },
    { id: 'p2', gameId: 'g', name: 'B', joinedAt: 2 },
    { id: 'p3', gameId: 'g', name: 'C', joinedAt: 3 },
  ];
  const submissions: PhotoSubmissionRecord[] = [
    {
      id: '1',
      gameId: 'g',
      participantId: 'p1',
      participantName: 'A',
      challengeId: 4,
      imageUrl: '/1.png',
      createdAt: 10,
      updatedAt: 10,
    },
    {
      id: '2',
      gameId: 'g',
      participantId: 'p2',
      participantName: 'B',
      challengeId: 4,
      imageUrl: '/2.png',
      createdAt: 20,
      updatedAt: 20,
    },
    {
      id: '3',
      gameId: 'g',
      participantId: 'p3',
      participantName: 'C',
      challengeId: 1,
      imageUrl: '/3.png',
      createdAt: 30,
      updatedAt: 30,
    },
  ];

  const stats = computeChallengeCompletionStats(participants, submissions);
  assert.equal(stats.length, 9);
  assert.equal(stats[0].challengeId, 4);
  assert.equal(stats[0].submissionsCount, 2);
  assert.equal(stats[0].completionPercent, 67);
  assert.equal(stats[1].challengeId, 1);
  assert.equal(stats[1].submissionsCount, 1);
  assert.equal(stats[2].submissionsCount, 0);
});

