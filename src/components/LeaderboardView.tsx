import { Award, Crown, Medal, Trophy } from 'lucide-react';
import { getParticipantInitials, type LeaderboardEntry } from '../shared/gameLogic';

interface LeaderboardViewProps {
  leaderboard: LeaderboardEntry[];
  currentParticipantId: string;
}

const PODIUM_CONFIG = [
  {
    rankIndex: 0,
    badgeLabel: '1st',
    bg: '#F9E7AE',
    border: '#EBD182',
    iconBg: '#FFF8DF',
    iconColor: '#9C6800',
    barColor: '#218F87',
    pedestalHeight: 'min-h-[196px] sm:min-h-[218px]',
    icon: Crown,
  },
  {
    rankIndex: 1,
    badgeLabel: '2nd',
    bg: '#D5E4F5',
    border: '#A3C4E8',
    iconBg: '#EFF6FD',
    iconColor: '#1E4C7A',
    barColor: '#1E4C7A',
    pedestalHeight: 'min-h-[164px] sm:min-h-[182px]',
    icon: Trophy,
  },
  {
    rankIndex: 2,
    badgeLabel: '3rd',
    bg: '#FAD3CA',
    border: '#F28B78',
    iconBg: '#FFF1EE',
    iconColor: '#9E3320',
    barColor: '#F28B78',
    pedestalHeight: 'min-h-[144px] sm:min-h-[162px]',
    icon: Award,
  },
];

export function LeaderboardView({ leaderboard, currentParticipantId }: LeaderboardViewProps) {
  if (leaderboard.length === 0) {
    return (
      <section className="rounded-3xl bg-white border border-[#172E4D]/10 px-6 py-12 text-center shadow-xs">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-[#F9E7AE] text-[#172E4D] flex items-center justify-center">
          <Trophy className="w-8 h-8" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-display text-xl font-bold text-[#172E4D]">
          Leaderboard is warming up
        </h2>
        <p className="mt-1.5 text-sm text-[#172E4D]/70">
          Complete photo challenges to claim 1st place on the podium!
        </p>
      </section>
    );
  }

  const topThree = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  // Arrange visual podium order: 2nd (left), 1st (center), 3rd (right) when >= 3 players
  const podiumOrder =
    topThree.length === 3
      ? [
          { entry: topThree[1], config: PODIUM_CONFIG[1] },
          { entry: topThree[0], config: PODIUM_CONFIG[0] },
          { entry: topThree[2], config: PODIUM_CONFIG[2] },
        ]
      : topThree.map((entry, idx) => ({ entry, config: PODIUM_CONFIG[idx] }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-extrabold text-[#172E4D]">
            Leaderboard
          </h1>
          <p className="text-xs sm:text-sm text-[#172E4D]/70">
            Ranked by completed challenges, then earliest completion time.
          </p>
        </div>
      </div>

      {/* Top 3 Podium */}
      <section
        aria-label="Top three podium"
        data-testid="leaderboard-podium"
        className={`grid gap-2 sm:gap-3 items-end ${
          podiumOrder.length === 3
            ? 'grid-cols-3'
            : podiumOrder.length === 2
              ? 'grid-cols-2'
              : 'grid-cols-1 max-w-xs mx-auto'
        }`}
      >
        {podiumOrder.map(({ entry, config }) => {
          const Icon = config.icon;
          const isMe = entry.id === currentParticipantId;
          const pct = Math.round((entry.completedCount / entry.totalChallenges) * 100);

          return (
            <div
              key={entry.id}
              data-testid={`podium-rank-${entry.rank}`}
              style={{ backgroundColor: config.bg, borderColor: config.border }}
              className={`rounded-2xl sm:rounded-3xl border p-2.5 sm:p-4 flex flex-col justify-between items-center text-center shadow-xs ${config.pedestalHeight} ${
                isMe ? 'ring-2 ring-[#218F87]' : ''
              }`}
            >
              {/* Small Achievement Badge */}
              <div className="flex items-center justify-center gap-1">
                <span
                  style={{ backgroundColor: config.iconBg, color: config.iconColor }}
                  className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shadow-2xs shrink-0"
                  aria-hidden="true"
                >
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                </span>
                <span className="font-mono text-[11px] sm:text-xs font-extrabold text-[#172E4D] tabular-nums">
                  {config.badgeLabel}
                </span>
              </div>

              {/* Avatar + Name */}
              <div className="my-2 w-full min-w-0 flex flex-col items-center">
                <div
                  className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl bg-white/85 text-[#172E4D] font-display font-extrabold text-xs sm:text-sm flex items-center justify-center shadow-2xs"
                  aria-hidden="true"
                >
                  {getParticipantInitials(entry.name)}
                </div>
                <p className="mt-1.5 font-display text-xs sm:text-sm font-extrabold text-[#172E4D] truncate w-full">
                  {entry.name}
                  {isMe ? ' (You)' : ''}
                </p>
              </div>

              {/* Score + Mini Progress Bar */}
              <div className="w-full space-y-1">
                <p className="font-mono text-sm sm:text-base font-extrabold text-[#172E4D] tabular-nums">
                  {entry.scoreLabel}
                </p>
                <div className="h-1.5 w-full rounded-full bg-white/75 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: config.barColor }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* Remaining Ranked Rows (4th+) */}
      <section
        aria-label="Remaining player rankings"
        className="rounded-3xl bg-white border border-[#172E4D]/10 shadow-xs overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#172E4D]/10 flex items-center justify-between">
          <h2 className="font-display text-base sm:text-lg font-extrabold text-[#172E4D]">
            Other Rankings
          </h2>
          <span className="text-xs font-semibold text-[#172E4D]/60 tabular-nums">
            {leaderboard.length} {leaderboard.length === 1 ? 'player' : 'players'}
          </span>
        </div>

        {rest.length === 0 ? (
          <div className="px-4 sm:px-5 py-6 text-center text-xs sm:text-sm text-[#172E4D]/65 flex flex-col items-center gap-1.5">
            <Medal className="w-5 h-5 text-[#218F87]" aria-hidden="true" />
            <span>Everyone in this game is currently on the podium!</span>
          </div>
        ) : (
          <ol className="divide-y divide-[#172E4D]/8" data-testid="leaderboard-rows">
            {rest.map((entry) => {
              const isMe = entry.id === currentParticipantId;
              const pct = Math.round((entry.completedCount / entry.totalChallenges) * 100);

              return (
                <li
                  key={entry.id}
                  data-testid={`leaderboard-row-${entry.rank}`}
                  className={`px-4 sm:px-5 py-3.5 ${isMe ? 'bg-[#CFE5D7]/30' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-xs sm:text-sm font-extrabold text-[#218F87] w-9 shrink-0 tabular-nums">
                        {entry.rankLabel}
                      </span>
                      <span
                        className="w-7 h-7 rounded-xl bg-[#F4F6F8] text-[#172E4D] font-display font-bold text-[11px] flex items-center justify-center shrink-0"
                        aria-hidden="true"
                      >
                        {getParticipantInitials(entry.name)}
                      </span>
                      <span className="font-semibold text-sm text-[#172E4D] truncate">
                        {entry.name}
                      </span>
                      {isMe && (
                        <span className="text-xs font-bold text-[#218F87] shrink-0">· You</span>
                      )}
                    </div>

                    <span className="font-mono text-xs sm:text-sm font-extrabold text-[#172E4D] tabular-nums shrink-0">
                      {entry.scoreLabel}
                    </span>
                  </div>

                  <div className="mt-2 pl-11.5">
                    <div
                      className="h-1.5 w-full rounded-full bg-[#F4F6F8] overflow-hidden"
                      role="progressbar"
                      aria-valuenow={entry.completedCount}
                      aria-valuemin={0}
                      aria-valuemax={entry.totalChallenges}
                      aria-label={`${entry.name} completed ${entry.scoreLabel}`}
                    >
                      <div
                        className="h-full rounded-full bg-[#218F87] transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
