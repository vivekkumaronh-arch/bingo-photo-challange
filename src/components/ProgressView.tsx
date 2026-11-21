import { Camera, CheckCircle2, Sparkles, Users } from 'lucide-react';
import { getChallengeById, TOTAL_CHALLENGES } from '../shared/challenges';
import {
  computeChallengeCompletionStats,
  computeOverallGameProgress,
  getParticipantInitials,
  type GameProgressSummary,
  type ParticipantRecord,
  type PhotoSubmissionRecord,
} from '../shared/gameLogic';
import { ChallengeIcon } from './ChallengeIcon';

interface ProgressViewProps {
  progress: GameProgressSummary;
  participants: ParticipantRecord[];
  submissions: PhotoSubmissionRecord[];
  currentParticipantId: string;
}

export function ProgressView({
  progress,
  participants,
  submissions,
  currentParticipantId,
}: ProgressViewProps) {
  const overall = computeOverallGameProgress(progress.totalPlayers, progress.challengesCompleted);
  const challengeStats = computeChallengeCompletionStats(participants, submissions);
  const myProgress = progress.participants.find((p) => p.id === currentParticipantId);
  const myCompleted = myProgress?.completedCount ?? 0;

  return (
    <div className="space-y-4">
      {/* Top 4 Game Statistics */}
      <section aria-label="Game statistics" className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="rounded-2xl bg-[#CFE5D7] border border-[#97C9AA] p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#172E4D]/75">
              Total Participants
            </p>
            <span className="w-7 h-7 rounded-xl bg-white/80 text-[#218F87] flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" aria-hidden="true" />
            </span>
          </div>
          <p
            data-testid="stat-total-players"
            className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-[#172E4D] tabular-nums"
          >
            {progress.totalPlayers}
          </p>
        </div>

        <div className="rounded-2xl bg-[#FAD3CA] border border-[#F28B78] p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#172E4D]/75">
              Total Photos
            </p>
            <span className="w-7 h-7 rounded-xl bg-white/80 text-[#9E3320] flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4" aria-hidden="true" />
            </span>
          </div>
          <p
            data-testid="stat-photos-uploaded"
            className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-[#172E4D] tabular-nums"
          >
            {progress.photosUploaded}
          </p>
        </div>

        <div className="rounded-2xl bg-[#F9E7AE] border border-[#EBD182] p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#172E4D]/75">
              Challenges Done
            </p>
            <span className="w-7 h-7 rounded-xl bg-white/80 text-[#7D5A08] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            </span>
          </div>
          <p
            data-testid="stat-challenges-completed"
            className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-[#172E4D] tabular-nums"
          >
            {progress.challengesCompleted}
          </p>
        </div>

        <div className="rounded-2xl bg-[#DCD3F0] border border-[#BAAAE2] p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#172E4D]/75">
              Overall Progress
            </p>
            <span className="w-7 h-7 rounded-xl bg-white/80 text-[#49357B] flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
            </span>
          </div>
          <p
            data-testid="stat-overall-progress"
            className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-[#172E4D] tabular-nums"
          >
            {overall.percent}%
          </p>
        </div>
      </section>

      {/* C. Overall Shared Game Progress Indicator */}
      <section
        aria-label="Overall game progress"
        className="rounded-3xl bg-white border border-[#172E4D]/10 p-4 sm:p-5 shadow-xs"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#218F87]">
              Shared Game Progress
            </p>
            <h2 className="font-display text-base sm:text-xl font-extrabold text-[#172E4D] leading-tight mt-0.5">
              Overall Group Completion
            </h2>
          </div>

          <div className="text-right tabular-nums shrink-0">
            <span
              data-testid="overall-progress-fraction"
              className="font-mono text-base sm:text-lg font-extrabold text-[#172E4D] whitespace-nowrap"
            >
              {overall.completedSubmissions} / {overall.possibleSubmissions}
            </span>
            <p className="text-[11px] font-semibold text-[#172E4D]/60 whitespace-nowrap">
              photos submitted
            </p>
          </div>
        </div>

        <div
          className="mt-3.5 h-4 w-full rounded-full bg-[#F4F6F8] overflow-hidden p-0.5 border border-[#172E4D]/8"
          role="progressbar"
          aria-valuenow={overall.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall game completion percentage"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#218F87] via-[#4BB2A8] to-[#F28B78] transition-all duration-300"
            style={{ width: `${overall.percent}%` }}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#172E4D]/70 tabular-nums">
          <span>
            Group completion: <strong className="text-[#172E4D]">{overall.percent}%</strong>
          </span>
          <span>
            Your personal score:{' '}
            <strong className="text-[#218F87]">
              {myCompleted}/{TOTAL_CHALLENGES}
            </strong>
          </span>
        </div>
      </section>

      {/* Two-column split on desktop, stacked on mobile: B (Most Completed Challenges) + A (Participant Activity) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* B. Most Completed Challenges */}
        <section
          aria-label="Most completed challenges"
          className="rounded-3xl bg-white border border-[#172E4D]/10 shadow-xs overflow-hidden"
        >
          <div className="px-4 sm:px-5 py-3.5 border-b border-[#172E4D]/10 flex items-center justify-between gap-2">
            <h2 className="font-display text-base sm:text-lg font-extrabold text-[#172E4D]">
              Most Completed Challenges
            </h2>
            <span className="text-xs font-semibold text-[#172E4D]/60 tabular-nums">
              {TOTAL_CHALLENGES} cards
            </span>
          </div>

          <ul className="divide-y divide-[#172E4D]/8" data-testid="most-completed-challenges">
            {challengeStats.map((stat) => {
              const challenge = getChallengeById(stat.challengeId);
              if (!challenge) return null;

              return (
                <li key={stat.challengeId} className="px-4 sm:px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        style={{ backgroundColor: challenge.cardBg, color: challenge.accentText }}
                        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border border-[#172E4D]/8"
                        aria-hidden="true"
                      >
                        <ChallengeIcon name={challenge.iconName} className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-bold text-[#172E4D] truncate">
                          {challenge.numberLabel}. {challenge.title}
                        </p>
                        <p className="text-[11px] text-[#172E4D]/60 truncate">
                          {challenge.shortHint}
                        </p>
                      </div>
                    </div>

                    <span className="font-mono text-xs font-bold text-[#172E4D] tabular-nums shrink-0">
                      {stat.submissionsCount}/{progress.totalPlayers}
                    </span>
                  </div>

                  <div className="mt-2 h-1.5 w-full rounded-full bg-[#F4F6F8] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${stat.completionPercent}%`,
                        backgroundColor: challenge.cardBorder,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* A. Participant Activity */}
        <section
          aria-label="Participant activity"
          className="rounded-3xl bg-white border border-[#172E4D]/10 shadow-xs overflow-hidden"
        >
          <div className="px-4 sm:px-5 py-3.5 border-b border-[#172E4D]/10 flex items-center justify-between gap-2">
            <h2 className="font-display text-base sm:text-lg font-extrabold text-[#172E4D]">
              Participant Activity
            </h2>
            <span className="text-xs font-semibold text-[#172E4D]/60 tabular-nums">
              {progress.totalPlayers} {progress.totalPlayers === 1 ? 'player' : 'players'}
            </span>
          </div>

          <ul className="divide-y divide-[#172E4D]/8" data-testid="participant-activity-list">
            {progress.participants.map((p) => {
              const pct = Math.round((p.completedCount / TOTAL_CHALLENGES) * 100);
              const isMe = p.id === currentParticipantId;

              return (
                <li
                  key={p.id}
                  className={`px-4 sm:px-5 py-3 ${isMe ? 'bg-[#CFE5D7]/25' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span
                        className="w-8 h-8 rounded-xl bg-[#D5E4F5] text-[#1E4C7A] font-display font-extrabold text-xs flex items-center justify-center shrink-0"
                        aria-hidden="true"
                      >
                        {getParticipantInitials(p.name)}
                      </span>
                      <span className="font-semibold text-xs sm:text-sm text-[#172E4D] truncate">
                        {p.name}
                      </span>
                      {isMe && (
                        <span className="text-xs font-bold text-[#218F87] shrink-0">· You</span>
                      )}
                    </div>

                    <span className="font-mono text-xs sm:text-sm font-bold text-[#172E4D] tabular-nums shrink-0">
                      {p.completedCount}/{TOTAL_CHALLENGES}
                    </span>
                  </div>

                  <div
                    className="mt-2 h-2 w-full rounded-full bg-[#F4F6F8] overflow-hidden"
                    role="progressbar"
                    aria-valuenow={p.completedCount}
                    aria-valuemin={0}
                    aria-valuemax={TOTAL_CHALLENGES}
                    aria-label={`${p.name} progress`}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          p.completedCount === TOTAL_CHALLENGES ? '#F28B78' : '#218F87',
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
