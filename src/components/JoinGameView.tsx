import { useState, type FormEvent } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { isValidJoiningCode, sanitizeParticipantName } from '../shared/gameLogic';

interface JoinGameViewProps {
  initialCode?: string;
  lockCode?: boolean;
  onJoinSubmit: (joiningCode: string, name: string) => Promise<void>;
  onBack: () => void;
}

export function JoinGameView({
  initialCode = '',
  lockCode = false,
  onJoinSubmit,
  onBack,
}: JoinGameViewProps) {
  const [joiningCode, setJoiningCode] = useState(initialCode.replace(/\D/g, '').slice(0, 4));
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidJoiningCode(joiningCode)) {
      setError('Please enter the 4-digit game code.');
      return;
    }

    const cleanedName = sanitizeParticipantName(name);
    if (!cleanedName) {
      setError('Please enter your name so players can recognize you.');
      return;
    }

    setSubmitting(true);
    try {
      await onJoinSubmit(joiningCode, cleanedName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#F5F6F8] flex flex-col items-center justify-center px-4 py-6">
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 min-h-[44px] px-2 -ml-2 text-sm font-semibold text-[#172E4D]/75 hover:text-[#172E4D] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#218F87] rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back</span>
        </button>

        <section className="mt-3 rounded-3xl bg-white border border-[#172E4D]/10 p-6 sm:p-8 shadow-sm">
          <div className="text-center">
            <p className="text-xs font-bold tracking-widest uppercase text-[#218F87]">
              {lockCode ? 'Almost Ready' : 'Enter Session'}
            </p>
            <h1 className="mt-1.5 font-display text-2xl sm:text-3xl font-extrabold text-[#172E4D]">
              {lockCode ? 'ENTER YOUR NAME' : 'JOIN GAME'}
            </h1>
            <p className="mt-1.5 text-sm text-[#172E4D]/70">
              {lockCode
                ? `Joining room ${joiningCode} · No account needed`
                : 'Type the 4-digit code and your name to jump in.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
            <div>
              <label
                htmlFor="joining-code-input"
                className="block text-xs font-bold uppercase tracking-wider text-[#172E4D]/75 mb-1.5"
              >
                Four-digit game code
              </label>
              <input
                id="joining-code-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={joiningCode}
                readOnly={lockCode}
                onChange={(e) => {
                  const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setJoiningCode(digitsOnly);
                  if (error) setError(null);
                }}
                placeholder="4829"
                autoComplete="one-time-code"
                className={`w-full min-h-[54px] px-4 rounded-2xl border font-mono text-2xl font-bold tracking-[0.25em] text-center text-[#172E4D] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#218F87] ${
                  lockCode
                    ? 'bg-[#F5F6F8] border-[#172E4D]/10 text-[#172E4D]/80'
                    : 'bg-[#F5F6F8] border-[#172E4D]/20'
                }`}
              />
            </div>

            <div>
              <label
                htmlFor="player-name-input"
                className="block text-xs font-bold uppercase tracking-wider text-[#172E4D]/75 mb-1.5"
              >
                Your name
              </label>
              <input
                id="player-name-input"
                type="text"
                maxLength={40}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Maya"
                autoFocus={lockCode}
                className="w-full min-h-[52px] px-4 rounded-2xl bg-[#F5F6F8] border border-[#172E4D]/20 text-base font-medium text-[#172E4D] placeholder:text-[#172E4D]/40 focus:outline-none focus:ring-2 focus:ring-[#218F87]"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-2xl bg-[#FAD3CA] border border-[#F28B78] px-4 py-3 text-sm font-medium text-[#172E4D]"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 w-full min-h-[56px] px-6 py-3.5 rounded-2xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] disabled:opacity-60 text-white font-display font-bold text-base sm:text-lg tracking-wide shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172E4D]"
            >
              <Sparkles className="w-5 h-5" aria-hidden="true" />
              <span>{submitting ? 'JOINING...' : "LET'S PLAY!"}</span>
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
