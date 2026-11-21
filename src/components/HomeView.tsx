import { useState } from 'react';
import { Plus, Users, Sparkles } from 'lucide-react';

interface HomeViewProps {
  onCreateGame: () => void;
  onJoinGame: () => void;
  isCreating: boolean;
  errorMessage: string | null;
}

const HERO_ILLUSTRATION_URL = '/src/assets/images/human_bingo_hero_1795267517089.jpg';

export function HomeView({
  onCreateGame,
  onJoinGame,
  isCreating,
  errorMessage,
}: HomeViewProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <main className="min-h-[100dvh] bg-[#F5F6F8] flex items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 items-center">
        {/* Visual Hero Card */}
        <div className="order-1 md:order-2 flex justify-center">
          <div className="relative w-full max-w-md rounded-3xl overflow-hidden bg-[#CFE5D7] border border-[#172E4D]/10 shadow-sm">
            {!imgFailed ? (
              <img
                src={HERO_ILLUSTRATION_URL}
                alt="Friends smiling and taking a selfie together playing Human Bingo"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full aspect-[4/3] object-cover block"
              />
            ) : (
              <div className="w-full aspect-[4/3] bg-gradient-to-br from-[#CFE5D7] via-[#F5D98B]/60 to-[#DCD3F0] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/80 flex items-center justify-center text-[#218F87] mb-3 shadow-sm">
                  <Sparkles className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="font-display font-bold text-lg text-[#172E4D]">
                  9 Challenges · 1 Shared Wall
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Title + Primary Actions */}
        <div className="order-2 md:order-1 flex flex-col items-center md:items-start text-center md:text-left">
          <div className="inline-flex items-center gap-2 mb-3 text-xs font-semibold tracking-wider uppercase text-[#218F87]">
            <span>3×3 Photo Challenge</span>
            <span aria-hidden="true">·</span>
            <span>Multiplayer Social Game</span>
          </div>

          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-[#172E4D] leading-[1.08] text-balance">
            HUMAN BINGO
          </h1>

          <p className="mt-2.5 text-lg sm:text-xl font-semibold text-[#218F87]">
            Meet People. Discover Connections.
          </p>

          <p className="mt-3 text-sm sm:text-base text-[#172E4D]/75 max-w-md leading-relaxed">
            Find people, complete fun challenges and capture unforgettable moments.
          </p>

          {errorMessage && (
            <div
              role="alert"
              className="mt-4 w-full max-w-sm rounded-2xl bg-[#FAD3CA] border border-[#F28B78] px-4 py-3 text-sm font-medium text-[#172E4D]"
            >
              {errorMessage}
            </div>
          )}

          <div className="mt-6 sm:mt-8 w-full max-w-sm flex flex-col gap-3">
            <button
              type="button"
              onClick={onCreateGame}
              disabled={isCreating}
              className="w-full min-h-[56px] px-6 py-3.5 rounded-2xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] disabled:opacity-60 text-white font-display font-bold text-base sm:text-lg tracking-wide shadow-sm transition-all flex items-center justify-center gap-2.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172E4D]"
            >
              <Plus className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{isCreating ? 'CREATING GAME...' : 'CREATE GAME'}</span>
            </button>

            <button
              type="button"
              onClick={onJoinGame}
              disabled={isCreating}
              className="w-full min-h-[56px] px-6 py-3.5 rounded-2xl bg-[#172E4D] hover:bg-[#223F66] active:scale-[0.98] disabled:opacity-60 text-white font-display font-bold text-base sm:text-lg tracking-wide shadow-sm transition-all flex items-center justify-center gap-2.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#218F87]"
            >
              <Users className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>JOIN GAME</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
