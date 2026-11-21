import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hashSessionToken, MIN_SESSION_SECRET_LENGTH } from '../server/security';
import { PHOTOS_BUCKET_NAME } from '../server/supabase';
import {
  GAME_DURATION_MS,
  isValidChallengeId,
  isValidJoiningCode,
  sanitizeParticipantName,
  validateImageMagicBytes,
} from '../src/shared/gameLogic';

interface SqliteGameRow {
  id: string;
  joining_code: string;
  status: string;
  created_at: number;
  expires_at: number;
}

interface SqliteParticipantRow {
  id: string;
  game_id: string;
  name: string;
  session_id: string;
  joined_at: number;
}

interface SqliteSubmissionRow {
  id: string;
  game_id: string;
  participant_id: string;
  challenge_id: number;
  image_url: string;
  file_name: string;
  created_at: number;
  updated_at: number;
}

export interface MigrationManifest {
  version: 1;
  startedAt: string;
  completedAt?: string;
  sqlitePath: string;
  uploadsDir: string;
  bucket: string;
  insertedGameIds: string[];
  insertedParticipantIds: string[];
  insertedSubmissionIds: string[];
  uploadedStoragePaths: string[];
}

export interface DryRunReport {
  sqlitePath: string;
  uploadsDir: string;
  counts: {
    games: number;
    activeGames: number;
    expiredGames: number;
    participants: number;
    photoSubmissions: number;
    validUploadFiles: number;
    totalUploadBytes: number;
  };
  issues: string[];
  warnings: string[];
}

interface ParsedArgs {
  mode: 'dry-run' | 'execute' | 'rollback' | 'help';
  sqlitePath: string;
  uploadsDir: string;
  manifestPath?: string;
}

function parseCliArgs(argv: string[]): ParsedArgs {
  let mode: ParsedArgs['mode'] = 'help';
  let sqlitePath = path.resolve(process.cwd(), 'data', 'human_bingo.sqlite');
  let uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
  let manifestPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      mode = 'dry-run';
    } else if (arg === '--execute') {
      mode = 'execute';
    } else if (arg === '--rollback') {
      mode = 'rollback';
      manifestPath = argv[i + 1];
      i += 1;
    } else if (arg === '--sqlite' && argv[i + 1]) {
      sqlitePath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === '--uploads' && argv[i + 1]) {
      uploadsDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      mode = 'help';
    }
  }

  return { mode, sqlitePath, uploadsDir, manifestPath };
}

function printUsage(): void {
  console.log(`Human Bingo SQLite -> Supabase Migration Tool

Usage:
  npx tsx scripts/migrate-sqlite-to-supabase.ts --dry-run [--sqlite <path>] [--uploads <path>]
  npx tsx scripts/migrate-sqlite-to-supabase.ts --execute [--sqlite <path>] [--uploads <path>]
  npx tsx scripts/migrate-sqlite-to-supabase.ts --rollback <manifest-json-path>

Required Environment Variables for --execute / --rollback:
  SUPABASE_URL          Supabase project URL
  SUPABASE_SECRET_KEY   Supabase secret or service_role key
  SESSION_SECRET        HMAC secret (>= 32 chars, only required for --execute)
`);
}

function readSqliteSnapshot(sqlitePath: string): {
  games: SqliteGameRow[];
  participants: SqliteParticipantRow[];
  submissions: SqliteSubmissionRow[];
} {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at: ${sqlitePath}`);
  }

  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((t) => t.name));

    for (const required of ['games', 'participants', 'photo_submissions']) {
      if (!tableNames.has(required)) {
        throw new Error(`Missing required SQLite table: ${required}`);
      }
    }

    const games = db
      .prepare(`SELECT id, joining_code, status, created_at, expires_at FROM games ORDER BY created_at ASC`)
      .all() as unknown as SqliteGameRow[];

    const participants = db
      .prepare(`SELECT id, game_id, name, session_id, joined_at FROM participants ORDER BY joined_at ASC`)
      .all() as unknown as SqliteParticipantRow[];

    const submissions = db
      .prepare(
        `SELECT id, game_id, participant_id, challenge_id, image_url, file_name, created_at, updated_at
         FROM photo_submissions
         ORDER BY created_at ASC`,
      )
      .all() as unknown as SqliteSubmissionRow[];

    return { games, participants, submissions };
  } finally {
    db.close();
  }
}

export function runDryRunValidation(sqlitePath: string, uploadsDir: string, nowMs = Date.now()): DryRunReport {
  const { games, participants, submissions } = readSqliteSnapshot(sqlitePath);
  const issues: string[] = [];
  const warnings: string[] = [];

  const gameById = new Map<string, SqliteGameRow>();
  const activeCodes = new Map<string, string>();
  let activeGames = 0;
  let expiredGames = 0;

  for (const g of games) {
    gameById.set(g.id, g);
    if (!isValidJoiningCode(g.joining_code)) {
      issues.push(`Game ${g.id} has invalid joining_code: "${g.joining_code}"`);
    }
    if (g.expires_at !== g.created_at + GAME_DURATION_MS) {
      issues.push(
        `Game ${g.id} violates 48h expiry invariant (created_at=${g.created_at}, expires_at=${g.expires_at})`,
      );
    }
    const isExpired = g.status === 'expired' || nowMs >= g.expires_at;
    if (isExpired) {
      expiredGames += 1;
    } else {
      activeGames += 1;
      const existingActiveId = activeCodes.get(g.joining_code);
      if (existingActiveId) {
        issues.push(
          `Duplicate active joining_code "${g.joining_code}" on games ${existingActiveId} and ${g.id}`,
        );
      } else {
        activeCodes.set(g.joining_code, g.id);
      }
    }
  }

  const participantById = new Map<string, SqliteParticipantRow>();
  const seenSessionIds = new Set<string>();

  for (const p of participants) {
    participantById.set(p.id, p);
    if (!gameById.has(p.game_id)) {
      issues.push(`Participant ${p.id} references missing game_id ${p.game_id}`);
    }
    const cleanedName = sanitizeParticipantName(p.name);
    if (!cleanedName) {
      issues.push(`Participant ${p.id} has empty name after sanitization`);
    }
    if (!p.session_id || p.session_id.length < 16) {
      issues.push(`Participant ${p.id} has invalid session_id`);
    }
    if (seenSessionIds.has(p.session_id)) {
      issues.push(`Duplicate session_id found on participant ${p.id}`);
    }
    seenSessionIds.add(p.session_id);
  }

  const seenPairs = new Set<string>();
  const expectedFiles = new Set<string>();
  let validUploadFiles = 0;
  let totalUploadBytes = 0;

  for (const s of submissions) {
    const parentGame = gameById.get(s.game_id);
    const parentParticipant = participantById.get(s.participant_id);
    if (!parentGame) {
      issues.push(`Submission ${s.id} references missing game_id ${s.game_id}`);
    }
    if (!parentParticipant) {
      issues.push(`Submission ${s.id} references missing participant_id ${s.participant_id}`);
    } else if (parentParticipant.game_id !== s.game_id) {
      issues.push(
        `Submission ${s.id} game_id (${s.game_id}) mismatches participant's game_id (${parentParticipant.game_id})`,
      );
    }
    if (!isValidChallengeId(s.challenge_id)) {
      issues.push(`Submission ${s.id} has out-of-range challenge_id=${s.challenge_id}`);
    }
    const pairKey = `${s.participant_id}:${s.challenge_id}`;
    if (seenPairs.has(pairKey)) {
      issues.push(`Duplicate (participant_id, challenge_id) pair ${pairKey}`);
    }
    seenPairs.add(pairKey);

    const filePath = path.resolve(uploadsDir, s.game_id, s.file_name);
    expectedFiles.add(filePath);
    if (!fs.existsSync(filePath)) {
      issues.push(`Missing upload file on disk for submission ${s.id}: ${s.game_id}/${s.file_name}`);
    } else {
      const buf = fs.readFileSync(filePath);
      const mime = validateImageMagicBytes(buf);
      if (!mime) {
        issues.push(`Upload file failed magic-byte JPEG/PNG/WebP check: ${s.game_id}/${s.file_name}`);
      } else {
        validUploadFiles += 1;
        totalUploadBytes += buf.length;
      }
    }
  }

  // Check for orphan files in uploads directory
  if (fs.existsSync(uploadsDir)) {
    for (const gameEntry of fs.readdirSync(uploadsDir, { withFileTypes: true })) {
      if (!gameEntry.isDirectory()) continue;
      const gameDir = path.resolve(uploadsDir, gameEntry.name);
      for (const fileEntry of fs.readdirSync(gameDir, { withFileTypes: true })) {
        if (!fileEntry.isFile()) continue;
        const fullPath = path.resolve(gameDir, fileEntry.name);
        if (!expectedFiles.has(fullPath)) {
          warnings.push(`Orphan upload file not referenced in SQLite: ${gameEntry.name}/${fileEntry.name}`);
        }
      }
    }
  }

  return {
    sqlitePath,
    uploadsDir,
    counts: {
      games: games.length,
      activeGames,
      expiredGames,
      participants: participants.length,
      photoSubmissions: submissions.length,
      validUploadFiles,
      totalUploadBytes,
    },
    issues,
    warnings,
  };
}

function createSupabaseClientFromEnv(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set.');
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function requireStrictSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim() || '';
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be set to at least ${MIN_SESSION_SECRET_LENGTH} characters before running live migration.`,
    );
  }
  return secret;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchExistingIds(
  supabase: SupabaseClient,
  table: 'games' | 'participants' | 'photo_submissions',
  ids: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const chunk of chunkArray(ids, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase.from(table).select('id').in('id', chunk);
    if (error) {
      throw new Error(`Failed querying existing ${table} IDs: ${error.message}`);
    }
    for (const row of data ?? []) {
      existing.add(String((row as { id: string }).id));
    }
  }
  return existing;
}

function writeManifest(manifestPath: string, manifest: MigrationManifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

async function executeMigration(sqlitePath: string, uploadsDir: string): Promise<void> {
  const dryRun = runDryRunValidation(sqlitePath, uploadsDir);
  if (dryRun.issues.length > 0) {
    console.error('SQLite preflight validation failed:');
    for (const issue of dryRun.issues) {
      console.error(`  - ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  const sessionSecret = requireStrictSessionSecret();
  const supabase = createSupabaseClientFromEnv();
  const { games, participants, submissions } = readSqliteSnapshot(sqlitePath);
  const nowMs = Date.now();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.resolve(
    process.cwd(),
    'data',
    'migrations',
    `supabase-migration-${stamp}.json`,
  );

  const manifest: MigrationManifest = {
    version: 1,
    startedAt: new Date().toISOString(),
    sqlitePath,
    uploadsDir,
    bucket: PHOTOS_BUCKET_NAME,
    insertedGameIds: [],
    insertedParticipantIds: [],
    insertedSubmissionIds: [],
    uploadedStoragePaths: [],
  };
  writeManifest(manifestPath, manifest);
  console.log(`Manifest initialized: ${manifestPath}`);

  const existingGameIds = await fetchExistingIds(
    supabase,
    'games',
    games.map((g) => g.id),
  );
  const existingParticipantIds = await fetchExistingIds(
    supabase,
    'participants',
    participants.map((p) => p.id),
  );
  const existingSubmissionIds = await fetchExistingIds(
    supabase,
    'photo_submissions',
    submissions.map((s) => s.id),
  );

  // 1. Insert new games (preserving all historical expired and active games)
  for (const g of games) {
    if (existingGameIds.has(g.id)) continue;
    const effectiveStatus = g.status === 'expired' || nowMs >= g.expires_at ? 'expired' : 'active';
    const { error } = await supabase.from('games').insert({
      id: g.id,
      joining_code: g.joining_code,
      status: effectiveStatus,
      created_at: g.created_at,
      expires_at: g.expires_at,
    });
    if (error) {
      throw new Error(`Failed migrating game ${g.id} (${g.joining_code}): ${error.message}`);
    }
    manifest.insertedGameIds.push(g.id);
    writeManifest(manifestPath, manifest);
  }

  // 2. Insert new participants (converting plaintext session_id to HMAC-SHA256 hash)
  for (const p of participants) {
    if (existingParticipantIds.has(p.id)) continue;
    const cleanName = sanitizeParticipantName(p.name) || 'Player';
    const tokenHash = hashSessionToken(p.session_id, sessionSecret);
    const { error } = await supabase.from('participants').insert({
      id: p.id,
      game_id: p.game_id,
      name: cleanName,
      session_token_hash: tokenHash,
      joined_at: p.joined_at,
    });
    if (error) {
      throw new Error(`Failed migrating participant ${p.id}: ${error.message}`);
    }
    manifest.insertedParticipantIds.push(p.id);
    writeManifest(manifestPath, manifest);
  }

  // 3. Upload photo binaries to private bucket + insert photo_submissions rows
  for (const s of submissions) {
    if (existingSubmissionIds.has(s.id)) continue;

    const storagePath = `${s.game_id}/${s.file_name}`;
    const localFilePath = path.resolve(uploadsDir, s.game_id, s.file_name);
    const buffer = fs.readFileSync(localFilePath);
    const mime = validateImageMagicBytes(buffer);
    if (!mime) {
      throw new Error(`Invalid image magic bytes in ${localFilePath}`);
    }

    const { error: uploadErr } = await supabase.storage
      .from(PHOTOS_BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: mime,
        upsert: false,
      });

    if (uploadErr) {
      const msg = uploadErr.message || '';
      if (!/already exists|duplicate/i.test(msg)) {
        throw new Error(`Failed uploading ${storagePath}: ${msg}`);
      }
    } else {
      manifest.uploadedStoragePaths.push(storagePath);
      writeManifest(manifestPath, manifest);
    }

    const { error: insertErr } = await supabase.from('photo_submissions').insert({
      id: s.id,
      game_id: s.game_id,
      participant_id: s.participant_id,
      challenge_id: s.challenge_id,
      storage_path: storagePath,
      created_at: s.created_at,
      updated_at: s.updated_at,
    });

    if (insertErr) {
      throw new Error(`Failed migrating photo submission ${s.id}: ${insertErr.message}`);
    }
    manifest.insertedSubmissionIds.push(s.id);
    writeManifest(manifestPath, manifest);
  }

  // 4. Verify all SQLite IDs now exist in Supabase
  const [verifiedGames, verifiedParticipants, verifiedSubmissions] = await Promise.all([
    fetchExistingIds(supabase, 'games', games.map((g) => g.id)),
    fetchExistingIds(supabase, 'participants', participants.map((p) => p.id)),
    fetchExistingIds(supabase, 'photo_submissions', submissions.map((s) => s.id)),
  ]);

  if (
    verifiedGames.size !== games.length ||
    verifiedParticipants.size !== participants.length ||
    verifiedSubmissions.size !== submissions.length
  ) {
    throw new Error(
      `Post-migration count mismatch. Games: ${verifiedGames.size}/${games.length}, Participants: ${verifiedParticipants.size}/${participants.length}, Submissions: ${verifiedSubmissions.size}/${submissions.length}`,
    );
  }

  manifest.completedAt = new Date().toISOString();
  writeManifest(manifestPath, manifest);

  console.log('Migration complete and verified.');
  console.log(
    JSON.stringify(
      {
        manifestPath,
        insertedGames: manifest.insertedGameIds.length,
        insertedParticipants: manifest.insertedParticipantIds.length,
        insertedSubmissions: manifest.insertedSubmissionIds.length,
        uploadedStorageObjects: manifest.uploadedStoragePaths.length,
      },
      null,
      2,
    ),
  );
}

async function executeRollback(manifestPath: string): Promise<void> {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Migration manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as MigrationManifest;
  const supabase = createSupabaseClientFromEnv();

  // Delete ONLY the exact rows and storage paths recorded in this migration manifest.
  // Never uses TRUNCATE or unfiltered DELETE so unrelated records remain untouched.
  for (const chunk of chunkArray(manifest.uploadedStoragePaths, 100)) {
    if (chunk.length === 0) continue;
    const { error } = await supabase.storage.from(manifest.bucket || PHOTOS_BUCKET_NAME).remove(chunk);
    if (error) {
      throw new Error(`Rollback failed removing storage objects: ${error.message}`);
    }
  }

  for (const chunk of chunkArray(manifest.insertedSubmissionIds, 200)) {
    if (chunk.length === 0) continue;
    const { error } = await supabase.from('photo_submissions').delete().in('id', chunk);
    if (error) {
      throw new Error(`Rollback failed deleting photo_submissions: ${error.message}`);
    }
  }

  for (const chunk of chunkArray(manifest.insertedParticipantIds, 200)) {
    if (chunk.length === 0) continue;
    const { error } = await supabase.from('participants').delete().in('id', chunk);
    if (error) {
      throw new Error(`Rollback failed deleting participants: ${error.message}`);
    }
  }

  for (const chunk of chunkArray(manifest.insertedGameIds, 200)) {
    if (chunk.length === 0) continue;
    const { error } = await supabase.from('games').delete().in('id', chunk);
    if (error) {
      throw new Error(`Rollback failed deleting games: ${error.message}`);
    }
  }

  console.log(
    `Rollback completed using ${manifestPath}: removed ${manifest.uploadedStoragePaths.length} storage objects, ${manifest.insertedSubmissionIds.length} submissions, ${manifest.insertedParticipantIds.length} participants, ${manifest.insertedGameIds.length} games.`,
  );
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.mode === 'help') {
    printUsage();
    return;
  }

  if (args.mode === 'dry-run') {
    const report = runDryRunValidation(args.sqlitePath, args.uploadsDir);
    console.log(JSON.stringify(report, null, 2));
    if (report.issues.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.mode === 'execute') {
    await executeMigration(args.sqlitePath, args.uploadsDir);
    return;
  }

  if (args.mode === 'rollback') {
    if (!args.manifestPath) {
      throw new Error('Please provide a manifest file path: --rollback <manifest-json-path>');
    }
    await executeRollback(path.resolve(process.cwd(), args.manifestPath));
  }
}

const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith(path.join('scripts', 'migrate-sqlite-to-supabase.ts'));

if (isEntrypoint) {
  main().catch((err) => {
    console.error('Migration command failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
