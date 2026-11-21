-- Human Bingo PostgreSQL Schema Migration for Supabase
-- Run once in Supabase SQL Editor (or Supabase CLI migration) BEFORE running migrate-sqlite-to-supabase.ts.
-- Do NOT execute automatically without review.

-- ============================================================
-- 1. TABLES & INTEGRITY CONSTRAINTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  joining_code TEXT NOT NULL CHECK (joining_code ~ '^[0-9]{4}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  CONSTRAINT games_48h_expiry_check CHECK (expires_at = created_at + 172800000)
);

-- Uniqueness enforced ONLY on active games so historical expired games are never deleted
CREATE UNIQUE INDEX IF NOT EXISTS games_active_joining_code_unique
  ON public.games (joining_code)
  WHERE status = 'active';

-- Supports code lookup prioritizing active games, otherwise latest historical game
CREATE INDEX IF NOT EXISTS idx_games_code_created
  ON public.games (joining_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_games_active_expires_at
  ON public.games (expires_at ASC)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  session_token_hash TEXT NOT NULL UNIQUE CHECK (session_token_hash ~ '^[a-f0-9]{64}$'),
  joined_at BIGINT NOT NULL,
  CONSTRAINT participants_id_game_id_unique UNIQUE (id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_game_joined
  ON public.participants (game_id, joined_at ASC);

CREATE TABLE IF NOT EXISTS public.photo_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL,
  challenge_id INTEGER NOT NULL CHECK (challenge_id BETWEEN 1 AND 9),
  storage_path TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT photo_submissions_participant_challenge_unique UNIQUE (participant_id, challenge_id),
  CONSTRAINT photo_submissions_participant_game_fkey
    FOREIGN KEY (participant_id, game_id)
    REFERENCES public.participants(id, game_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submissions_game_updated
  ON public.photo_submissions (game_id, updated_at DESC, created_at DESC);

-- ============================================================
-- 2. ATOMIC PHOTO SUBMISSION UPSERT RPC
-- ============================================================
-- Locks the parent game row, checks 48-hour expiry, marks status = 'expired'
-- when elapsed, and returns 0 rows WITHOUT raising an exception so the expiry
-- status UPDATE commits cleanly. Backend treats an empty result as GAME_EXPIRED.

CREATE OR REPLACE FUNCTION public.upsert_photo_submission(
  p_game_id UUID,
  p_participant_id UUID,
  p_challenge_id INTEGER,
  p_storage_path TEXT,
  p_now_ms BIGINT
)
RETURNS TABLE (
  id UUID,
  game_id UUID,
  participant_id UUID,
  challenge_id INTEGER,
  storage_path TEXT,
  created_at BIGINT,
  updated_at BIGINT,
  replaced BOOLEAN,
  old_storage_path TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_game_expires_at BIGINT;
  v_game_status TEXT;
  v_existing_id UUID;
  v_existing_path TEXT;
  v_existing_created BIGINT;
BEGIN
  SELECT g.expires_at, g.status
    INTO v_game_expires_at, v_game_status
  FROM public.games g
  WHERE g.id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_game_status = 'expired' OR v_game_expires_at <= p_now_ms THEN
    IF v_game_status <> 'expired' THEN
      UPDATE public.games g
      SET status = 'expired'
      WHERE g.id = p_game_id;
    END IF;
    -- Commit the 'expired' update cleanly and return 0 rows
    RETURN;
  END IF;

  SELECT ps.id, ps.storage_path, ps.created_at
    INTO v_existing_id, v_existing_path, v_existing_created
  FROM public.photo_submissions ps
  WHERE ps.participant_id = p_participant_id
    AND ps.challenge_id = p_challenge_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.photo_submissions ps
    SET storage_path = p_storage_path,
        updated_at = p_now_ms
    WHERE ps.id = v_existing_id;

    RETURN QUERY
    SELECT
      v_existing_id,
      p_game_id,
      p_participant_id,
      p_challenge_id,
      p_storage_path,
      v_existing_created,
      p_now_ms,
      TRUE,
      v_existing_path;
  ELSE
    INSERT INTO public.photo_submissions (
      game_id, participant_id, challenge_id, storage_path, created_at, updated_at
    )
    VALUES (
      p_game_id, p_participant_id, p_challenge_id, p_storage_path, p_now_ms, p_now_ms
    )
    RETURNING
      photo_submissions.id,
      photo_submissions.game_id,
      photo_submissions.participant_id,
      photo_submissions.challenge_id,
      photo_submissions.storage_path,
      photo_submissions.created_at,
      photo_submissions.updated_at,
      FALSE,
      NULL::TEXT
    INTO id, game_id, participant_id, challenge_id, storage_path, created_at, updated_at, replaced, old_storage_path;

    RETURN NEXT;
  END IF;
END;
$$;

-- ============================================================
-- 3. ROW LEVEL SECURITY & PRIVILEGE ISOLATION
-- ============================================================

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.games FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.photo_submissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_photo_submission(UUID, UUID, INTEGER, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.games, public.participants, public.photo_submissions TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_photo_submission(UUID, UUID, INTEGER, TEXT, BIGINT) TO service_role;
