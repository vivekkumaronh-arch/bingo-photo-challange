import { useState, type ReactNode } from 'react';
import { BarChart3, Check, Copy, Grid3X3, LogOut, Trophy, Users } from 'lucide-react';
import { formatTimeRemaining, type GameRecord, type ParticipantRecord } from '../shared/gameLogic';

export type GameTab = 'play' | 'players' | 'progress' | 'leaderboard';

interface GameShellProps {
  game: GameRecord;
  participant: ParticipantRecord;
  personalCompletedCount: number;
  activeTab: GameTab;
  onTabChange: (tab: GameTab) => void;
  onOpenMyGrid: () => void;
  onLeaveGame: () => void;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ id: GameTab; label: string; icon: typeof Grid3X3 }> = [
  { id: 'play', label: 'PLAY', icon: Grid3X3 },
  { id: 'players', label: 'PLAYERS', icon: Users },
  { id: 'progress', label: 'PROGRESS', icon: BarChart3 },
  { id: 'leaderboard', label: 'LEADERBOARD', icon: Trophy },
];

export function GameShell({
  game,
  participant,
  personalCompletedCount,
  activeTab,
  onTabChange,
  onOpenMyGrid,
  onLeaveGame,
  children,
}: GameShellProps) {
  const [copied, setCopied] = useState(false);

  const isExpired = game.status === 'expired';
  const timeText = formatTimeRemaining(game.expiresAt);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(game.joiningCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard failures
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F4F6F8] pb-24 md:pb-10">
      {/* Compact Non-Sticky Top Bar */}
      <header className="bg-white border-b border-[#172E4D]/10">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <span className="font-display text-base sm:text-lg font-extrabold text-[#172E4D] whitespace-nowrap shrink-0">
              HUMAN BINGO
            </span>
            <button
              type="button"
              onClick={handleCopyCode}
              title="Copy joining code"
              aria-label={`Joining code ${game.joiningCode}, tap to copy`}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-xl bg-[#F5D98B]/65 hover:bg-[#F5D98B] text-[#172E4D] font-mono text-xs sm:text-sm font-bold tabular-nums shrink-0 cursor-pointer transition-colors"
            >
              <span>{game.joiningCode}</span>
              {copied ? (
                <Check className="w-3.5 h-3.5 text-[#218F87]" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav
            aria-label="Game navigation"
            className="hidden md:flex items-center gap-1 bg-[#F4F6F8] p-1 rounded-2xl"
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold tracking-wide flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all duration-150 cursor-pointer ${
                    active
                      ? 'bg-[#218F87] text-white shadow-xs'
                      : 'text-[#172E4D]/75 hover:text-[#172E4D] hover:bg-white/70'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Player Info + Leave Button */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0 min-w-0">
            <div className="text-right min-w-0">
              <p className="text-xs font-bold text-[#172E4D] truncate max-w-[90px] sm:max-w-[140px]">
                {participant.name}
              </p>
              <p className="text-[10px] sm:text-[11px] font-medium text-[#172E4D]/60 whitespace-nowrap">
                {timeText}
              </p>
            </div>

            <button
              type="button"
              onClick={onLeaveGame}
              aria-label="Exit current game"
              title="Exit game"
              className="min-w-[44px] min-h-[44px] rounded-xl text-[#172E4D]/70 hover:text-[#172E4D] hover:bg-[#F4F6F8] flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#218F87]"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* Expired Game Notice */}
      {isExpired && (
        <div className="max-w-5xl mx-auto px-3 sm:px-6 pt-3">
          <div
            role="status"
            className="rounded-2xl bg-[#F5D98B]/55 border border-[#EBD182] px-4 py-3 text-xs sm:text-sm font-semibold text-[#172E4D]"
          >
            This 48-hour game has ended. Existing photos and rankings are preserved, and new uploads are closed.
          </div>
        </div>
      )}

      {/* Clearly Visible MY GRID Shortcut Bar when viewing other tabs */}
      {activeTab !== 'play' && (
        <div className="max-w-5xl mx-auto px-3 sm:px-6 pt-3">
          <div className="rounded-2xl bg-white border border-[#172E4D]/10 px-3.5 py-2.5 flex items-center justify-between gap-3 shadow-xs">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-bold text-[#172E4D] truncate">
                Your Bingo Board{' '}
                <span className="font-mono text-[#218F87] tabular-nums">
                  {personalCompletedCount}/9
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={onOpenMyGrid}
              data-testid="my-grid-shortcut"
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] text-white font-display font-bold text-xs tracking-wide inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
            >
              <Grid3X3 className="w-4 h-4" aria-hidden="true" />
              <span>MY GRID</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content with Smooth Tab Transition */}
      <main className="max-w-5xl mx-auto px-3 sm:px-6 pt-3.5 pb-4">
        <div key={activeTab} className="animate-tab-enter">
          {children}
        </div>
      </main>

      {/* Fixed Mobile Bottom Navigation Bar (4 tabs, safe-area aware) */}
      <nav
        aria-label="Mobile game navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#172E4D]/10 shadow-[0_-4px_20px_rgba(23,46,77,0.05)] pb-safe"
      >
        <div className="grid grid-cols-4 items-center h-16 max-w-lg mx-auto px-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`min-h-[48px] mx-0.5 rounded-2xl flex flex-col items-center justify-center gap-1 px-1 transition-all duration-150 active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#218F87] ${
                  active
                    ? 'text-[#218F87] bg-[#CFE5D7]/65 font-extrabold'
                    : 'text-[#172E4D]/60 hover:text-[#172E4D]'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                <span className="text-[10px] font-bold tracking-tight whitespace-nowrap leading-none">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
