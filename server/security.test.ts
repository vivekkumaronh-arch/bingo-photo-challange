import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createSupabaseBackend, GameExpiredError } from './dbSupabase';
import {
  buildSignedImageUrl,
  createSignedMediaParams,
  hashSessionToken,
  resolveSessionSecret,
  verifySignedMediaParams,
} from './security';
import { MAX_UPLOAD_BYTES, isSupportedUploadFile } from '../src/utils/imageCompress';

const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Session Secret & HMAC Hashing', () => {
  it('requires SESSION_SECRET >= 32 chars in production and Vercel', () => {
    assert.throws(
      () => resolveSessionSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      /SESSION_SECRET/,
    );
    assert.throws(
      () => resolveSessionSecret({ VERCEL: '1' } as NodeJS.ProcessEnv),
      /SESSION_SECRET/,
    );
    assert.throws(
      () => resolveSessionSecret({ NODE_ENV: 'production', SESSION_SECRET: 'short' } as NodeJS.ProcessEnv),
      /SESSION_SECRET/,
    );
    assert.equal(
      resolveSessionSecret({ NODE_ENV: 'production', SESSION_SECRET: TEST_SECRET } as NodeJS.ProcessEnv),
      TEST_SECRET,
    );
  });

  it('hashes session tokens using HMAC-SHA256 keyed by SESSION_SECRET (not plain SHA-256)', () => {
    const token = 'a'.repeat(48);
    const hash1 = hashSessionToken(token, TEST_SECRET);
    const hash2 = hashSessionToken(token, 'f'.repeat(64));

    assert.match(hash1, /^[a-f0-9]{64}$/);
    assert.notEqual(hash1, token);
    assert.notEqual(hash1, hash2);
  });
});

describe('Expiring Path-Bound Media Tokens', () => {
  it('accepts valid non-expired path-bound signature and rejects tampering/expiry', () => {
    const now = 1_700_000_000_000;
    const gameId = '11111111-1111-4111-8111-111111111111';
    const fileName = '22222222-2222-4222-8222-222222222222.webp';
    const storagePath = `${gameId}/${fileName}`;

    const { exp, sig } = createSignedMediaParams(gameId, storagePath, TEST_SECRET, now, 60_000);
    assert.equal(
      verifySignedMediaParams(gameId, storagePath, String(exp), sig, TEST_SECRET, now + 10_000),
      true,
    );

    // Expired
    assert.equal(
      verifySignedMediaParams(gameId, storagePath, String(exp), sig, TEST_SECRET, now + 60_000),
      false,
    );

    // Bound to exact gameId and storagePath
    assert.equal(
      verifySignedMediaParams(
        '33333333-3333-4333-8333-333333333333',
        storagePath,
        String(exp),
        sig,
        TEST_SECRET,
        now + 10_000,
      ),
      false,
    );
    assert.equal(
      verifySignedMediaParams(
        gameId,
        `${gameId}/other.webp`,
        String(exp),
        sig,
        TEST_SECRET,
        now + 10_000,
      ),
      false,
    );

    // Tampered signature
    const tamperedSig = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    assert.equal(
      verifySignedMediaParams(gameId, storagePath, String(exp), tamperedSig, TEST_SECRET, now + 10_000),
      false,
    );

    const url = buildSignedImageUrl(gameId, fileName, now, TEST_SECRET, now);
    assert.match(url, /^\/api\/uploads\/[^/]+\/[^?]+\?v=\d+&exp=\d+&sig=[a-f0-9]{64}$/);
  });
});

describe('Upload Format & Size Guards', () => {
  it('allows only JPEG, PNG, and WebP and rejects HEIC/HEIF', () => {
    assert.equal(isSupportedUploadFile({ type: 'image/jpeg', name: 'a.jpg' }), true);
    assert.equal(isSupportedUploadFile({ type: 'image/png', name: 'a.png' }), true);
    assert.equal(isSupportedUploadFile({ type: 'image/webp', name: 'a.webp' }), true);
    assert.equal(isSupportedUploadFile({ type: '', name: 'photo.jpg' }), true);
    assert.equal(isSupportedUploadFile({ type: 'image/heic', name: 'IMG_1.HEIC' }), false);
    assert.equal(isSupportedUploadFile({ type: '', name: 'IMG_1.heic' }), false);
    assert.equal(isSupportedUploadFile({ type: 'image/gif', name: 'anim.gif' }), false);
    assert.ok(MAX_UPLOAD_BYTES <= 3.5 * 1024 * 1024);
    assert.ok(MAX_UPLOAD_BYTES < 4.5 * 1024 * 1024);
  });
});

describe('Supabase Backend Contract (Mocked Client)', () => {
  it('retries 23505 joining-code collisions without deleting historical games', async () => {
    let deleteCalled = false;
    let insertAttempts = 0;

    const fakeClient = {
      from(table: string) {
        assert.equal(table, 'games');
        return {
          update() {
            return {
              eq() {
                return {
                  lte: async () => ({ error: null }),
                };
              },
            };
          },
          insert(payload: Record<string, unknown>) {
            insertAttempts += 1;
            return {
              select() {
                return {
                  async single() {
                    if (insertAttempts === 1) {
                      return { data: null, error: { code: '23505', message: 'duplicate active code' } };
                    }
                    return { data: payload, error: null };
                  },
                };
              },
            };
          },
          delete() {
            deleteCalled = true;
            return {};
          },
        };
      },
    };

    const backend = createSupabaseBackend(fakeClient as never, TEST_SECRET);
    const game = await backend.createGame(1_700_000_000_000);
    assert.equal(insertAttempts, 2);
    assert.equal(deleteCalled, false);
    assert.match(game.joiningCode, /^\d{4}$/);
  });

  it('stores HMAC session_token_hash on joinGame rather than plaintext token', async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const now = 1_700_000_000_000;

    const fakeClient = {
      from(table: string) {
        if (table === 'games') {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        order() {
                          return {
                            limit() {
                              return {
                                async maybeSingle() {
                                  return {
                                    data: {
                                      id: '11111111-1111-4111-8111-111111111111',
                                      joining_code: '4821',
                                      status: 'active',
                                      created_at: now,
                                      expires_at: now + 172_800_000,
                                    },
                                    error: null,
                                  };
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        return {
          insert(payload: Record<string, unknown>) {
            capture.row = payload;
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: {
                        id: payload.id,
                        game_id: payload.game_id,
                        name: payload.name,
                        joined_at: payload.joined_at,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    const backend = createSupabaseBackend(fakeClient as never, TEST_SECRET);
    const joined = await backend.joinGame('4821', 'Alice', now + 1000);
    assert.equal(joined.ok, true);
    if (joined.ok) {
      assert.ok(capture.row);
      assert.equal('session_id' in capture.row, false);
      assert.equal(
        capture.row.session_token_hash,
        hashSessionToken(joined.rawSessionToken, TEST_SECRET),
      );
    }
  });

  it('interprets empty upsert_photo_submission RPC result as GAME_EXPIRED and rolls back new upload', async () => {
    const events: string[] = [];
    const removedPaths: string[] = [];
    const now = 1_700_000_000_000;

    const fakeClient = {
      storage: {
        from() {
          return {
            async upload(storagePath: string) {
              events.push(`upload:${storagePath}`);
              return { error: null };
            },
            async remove(paths: string[]) {
              events.push(`remove:${paths.join(',')}`);
              removedPaths.push(...paths);
              return { error: null };
            },
          };
        },
      },
      async rpc(fnName: string) {
        events.push(`rpc:${fnName}`);
        // Empty array simulates SQL function committing status='expired' and returning 0 rows
        return { data: [], error: null };
      },
    };

    const backend = createSupabaseBackend(fakeClient as never, TEST_SECRET);
    await assert.rejects(
      () =>
        backend.savePhotoSubmission({
          game: {
            id: '11111111-1111-4111-8111-111111111111',
            joiningCode: '4821',
            status: 'active',
            createdAt: now,
            expiresAt: now + 172_800_000,
          },
          participant: {
            id: '22222222-2222-4222-8222-222222222222',
            gameId: '11111111-1111-4111-8111-111111111111',
            name: 'Alice',
            joinedAt: now,
          },
          challengeId: 1,
          mimeType: 'image/webp',
          buffer: Buffer.from([1, 2, 3]),
          nowMs: now + 1000,
        }),
      (err) => err instanceof GameExpiredError,
    );

    assert.equal(events.length, 3);
    assert.ok(events[0].startsWith('upload:'));
    assert.equal(events[1], 'rpc:upsert_photo_submission');
    assert.ok(events[2].startsWith('remove:'));
    assert.equal(removedPaths.length, 1);
  });

  it('deletes previous storage object ONLY AFTER upsert_photo_submission RPC succeeds', async () => {
    const events: string[] = [];
    const now = 1_700_000_000_000;
    const gameId = '11111111-1111-4111-8111-111111111111';
    const oldPath = `${gameId}/old-photo.jpg`;

    const fakeClient = {
      storage: {
        from() {
          return {
            async upload(storagePath: string) {
              events.push(`upload:${storagePath}`);
              return { error: null };
            },
            async remove(paths: string[]) {
              events.push(`remove:${paths.join(',')}`);
              return { error: null };
            },
          };
        },
      },
      async rpc(_fnName: string, args: { p_storage_path: string }) {
        events.push(`rpc:${args.p_storage_path}`);
        return {
          data: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              game_id: gameId,
              participant_id: '22222222-2222-4222-8222-222222222222',
              challenge_id: 2,
              storage_path: args.p_storage_path,
              created_at: now,
              updated_at: now + 5000,
              replaced: true,
              old_storage_path: oldPath,
            },
          ],
          error: null,
        };
      },
    };

    const backend = createSupabaseBackend(fakeClient as never, TEST_SECRET);
    const res = await backend.savePhotoSubmission({
      game: {
        id: gameId,
        joiningCode: '4821',
        status: 'active',
        createdAt: now,
        expiresAt: now + 172_800_000,
      },
      participant: {
        id: '22222222-2222-4222-8222-222222222222',
        gameId,
        name: 'Alice',
        joinedAt: now,
      },
      challengeId: 2,
      mimeType: 'image/webp',
      buffer: Buffer.from([1, 2, 3]),
      nowMs: now + 5000,
    });

    assert.equal(res.replaced, true);
    assert.equal(events.length, 3);
    assert.ok(events[0].startsWith(`upload:${gameId}/`));
    assert.ok(events[1].startsWith(`rpc:${gameId}/`));
    assert.equal(events[2], `remove:${oldPath}`);
  });
});

describe('PostgreSQL Migration SQL Invariants', () => {
  it('enforces RLS, service_role grants, composite FK, partial code uniqueness, and non-throwing expiry RPC', () => {
    const sqlPath = path.resolve(process.cwd(), 'supabase', 'migrations', '001_initial_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    assert.match(sql, /ALTER TABLE public\.games ENABLE ROW LEVEL SECURITY/i);
    assert.match(sql, /ALTER TABLE public\.participants ENABLE ROW LEVEL SECURITY/i);
    assert.match(sql, /ALTER TABLE public\.photo_submissions ENABLE ROW LEVEL SECURITY/i);

    assert.match(sql, /REVOKE ALL ON TABLE public\.games FROM PUBLIC, anon, authenticated/i);
    assert.match(sql, /GRANT USAGE ON SCHEMA public TO service_role/i);
    assert.match(sql, /GRANT ALL PRIVILEGES ON TABLE public\.games, public\.participants, public\.photo_submissions TO service_role/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.upsert_photo_submission/i);

    assert.match(sql, /WHERE status = 'active'/i);
    assert.match(sql, /FOREIGN KEY \(participant_id, game_id\)\s+REFERENCES public\.participants\(id, game_id\)/i);
    assert.match(sql, /SELECT g\.expires_at, g\.status[\s\S]*FOR UPDATE/i);

    // Must never raise exception inside upsert_photo_submission so status='expired' UPDATE commits
    assert.doesNotMatch(sql, /RAISE EXCEPTION/i);
    // Must never delete historical games
    assert.doesNotMatch(sql, /DELETE FROM public\.games/i);
    assert.doesNotMatch(sql, /TRUNCATE/i);
  });
});
