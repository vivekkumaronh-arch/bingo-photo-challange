import { useState } from 'react';
import { ArrowLeft, Check, Copy, Play, Share2 } from 'lucide-react';
import type { GameRecord } from '../shared/gameLogic';

interface CreateGameViewProps {
  game: GameRecord;
  onStartPlaying: (joiningCode: string) => void;
  onBack: () => void;
}

export function CreateGameView({ game, onStartPlaying, onBack }: CreateGameViewProps) {
  const [copied, setCopied] = useState(false);
  const [sharedFeedback, setSharedFeedback] = useState<string | null>(null);

  const shareUrl = `${window.location.origin}/?code=${encodeURIComponent(game.joiningCode)}`;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(game.joiningCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setSharedFeedback(`Code: ${game.joiningCode}`);
      setTimeout(() => setSharedFeedback(null), 2500);
    }
  };

  const handleShare = async () => {
    const shareText = `Join my Human Bingo game! Use code ${game.joiningCode} at ${shareUrl}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Join Human Bingo',
          text: `Join my Human Bingo game! Code: ${game.joiningCode}`,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to clipboard if user cancels or share fails
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setSharedFeedback('Invite link copied!');
      setTimeout(() => setSharedFeedback(null), 2500);
    } catch {
      setSharedFeedback(`Share code ${game.joiningCode}`);
      setTimeout(() => setSharedFeedback(null), 2500);
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

        <section className="mt-3 rounded-3xl bg-white border border-[#172E4D]/10 p-6 sm:p-8 shadow-sm text-center">
          <p className="text-xs font-bold tracking-widest uppercase text-[#218F87]">
            New Session Created
          </p>
          <h1 className="mt-1.5 font-display text-2xl sm:text-3xl font-extrabold text-[#172E4D]">
            YOUR GAME IS READY!
          </h1>

          <div className="mt-6 rounded-2xl bg-[#F5D98B]/45 border border-[#EBD182] py-6 px-4">
            <p className="text-xs font-bold tracking-widest uppercase text-[#172E4D]/70">
              JOINING CODE
            </p>
            <div
              data-testid="joining-code-display"
              className="mt-2 font-mono text-5xl sm:text-6xl font-bold tracking-[0.22em] text-[#172E4D] tabular-nums pl-[0.22em]"
            >
              {game.joiningCode}
            </div>
          </div>

          <p className="mt-4 text-sm text-[#172E4D]/75">
            Share this code with everyone participating.
          </p>

          {sharedFeedback && (
            <p role="status" className="mt-2 text-xs font-semibold text-[#218F87]">
              {sharedFeedback}
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleCopyCode}
              className="min-h-[48px] px-4 py-3 rounded-2xl bg-[#D5E4F5] hover:bg-[#C3D8F0] active:scale-[0.98] text-[#172E4D] font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-[#218F87]" aria-hidden="true" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" aria-hidden="true" />
                  <span>Copy</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleShare}
              className="min-h-[48px] px-4 py-3 rounded-2xl bg-[#DCD3F0] hover:bg-[#CDC1E9] active:scale-[0.98] text-[#172E4D] font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
            >
              <Share2 className="w-4 h-4" aria-hidden="true" />
              <span>Share</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onStartPlaying(game.joiningCode)}
            className="mt-4 w-full min-h-[54px] px-6 py-3.5 rounded-2xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] text-white font-display font-bold text-base sm:text-lg flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172E4D]"
          >
            <Play className="w-5 h-5 fill-current" aria-hidden="true" />
            <span>Start Playing</span>
          </button>
        </section>
      </div>
    </main>
  );
}
