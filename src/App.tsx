import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BingoGridView } from './components/BingoGridView';
import { CelebrationBurst } from './components/CelebrationBurst';
import { ChallengeSheet } from './components/ChallengeSheet';
import { CreateGameView } from './components/CreateGameView';
import { GameShell, type GameTab } from './components/GameShell';
import { HomeView } from './components/HomeView';
import { JoinGameView } from './components/JoinGameView';
import { LeaderboardView } from './components/LeaderboardView';
import { PlayersView } from './components/PlayersView';
import { ProgressView } from './components/ProgressView';
import {
  connectGameWebSocket,
  createNewGame,
  fetchGameState,
  fetchSession,
  joinExistingGame,
  leaveCurrentGame,
  uploadChallengePhoto,
  type GameStatePayload,
} from './services/api';
import { TOTAL_CHALLENGES, type ChallengeDefinition } from './shared/challenges';
import { isValidJoiningCode, type GameRecord } from './shared/gameLogic';
import { playSuccessChime } from './utils/celebration';

type AppScreen =
  | { view: 'loading' }
  | { view: 'home' }
  | { view: 'created'; game: GameRecord }
  | { view: 'join'; prefillCode: string; lockCode: boolean }
  | { view: 'playing' };

export default function App() {
  const [screen, setScreen] = useState<AppScreen>({ view: 'loading' });
  const [gameState, setGameState] = useState<GameStatePayload | null>(null);
  const [activeTab, setActiveTab] = useState<GameTab>('play');
  const [selectedChallenge, setSelectedChallenge] = useState<ChallengeDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [celebrationCount, setCelebrationCount] = useState(0);
  const [celebrationMsg, setCelebrationMsg] = useState<string | undefined>(undefined);

  // Restore active participant session on page load (or handle ?code= / ?autostart=1)
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlCode = (params.get('code') || '').trim();
      const autostart = params.get('autostart') === '1';

      try {
        const existingSession = await fetchSession();
        if (cancelled) return;

        if (existingSession) {
          setGameState(existingSession);
          setScreen({ view: 'playing' });
          return;
        }

        if (autostart) {
          const game = await createNewGame();
          const joined = await joinExistingGame(game.joiningCode, 'Player 1');
          if (cancelled) return;
          setGameState(joined);
          setScreen({ view: 'playing' });
          return;
        }

        if (isValidJoiningCode(urlCode)) {
          setScreen({ view: 'join', prefillCode: urlCode, lockCode: false });
          return;
        }

        setScreen({ view: 'home' });
      } catch {
        if (!cancelled) {
          setScreen({ view: 'home' });
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshState = useCallback(async (joiningCode: string) => {
    try {
      const fresh = await fetchGameState(joiningCode);
      setGameState(fresh);
    } catch {
      // ignore transient refresh error
    }
  }, []);

  const [wsConnected, setWsConnected] = useState(false);

  // Subscribe to real-time WebSocket updates for the active game room
  useEffect(() => {
    if (screen.view !== 'playing' || !gameState) {
      setWsConnected(false);
      return;
    }
    const code = gameState.game.joiningCode;
    const disconnect = connectGameWebSocket(
      code,
      () => {
        refreshState(code);
      },
      (connected) => {
        setWsConnected(connected);
      },
    );
    return disconnect;
  }, [screen.view, gameState?.game.joiningCode, refreshState]);

  // Efficient polling fallback only when WebSocket realtime connection is unavailable
  useEffect(() => {
    if (screen.view !== 'playing' || !gameState || wsConnected) return;
    const code = gameState.game.joiningCode;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshState(code);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [screen.view, gameState?.game.joiningCode, wsConnected, refreshState]);

  const handleCreateGame = async () => {
    setHomeError(null);
    setIsCreating(true);
    try {
      const game = await createNewGame();
      setScreen({ view: 'created', game });
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : 'Unable to create game.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinSubmit = async (joiningCode: string, name: string) => {
    const joined = await joinExistingGame(joiningCode, name);
    setGameState(joined);
    setActiveTab('play');
    setScreen({ view: 'playing' });
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleUploadPhoto = async (challengeId: number, blob: Blob) => {
    if (!gameState) return;
    const result = await uploadChallengePhoto(gameState.game.joiningCode, challengeId, blob);
    setGameState(result.state);

    const myCompleted = result.state.submissions.filter(
      (s) => s.participantId === result.state.participant.id,
    ).length;
    const isFullBoard = myCompleted === TOTAL_CHALLENGES;

    playSuccessChime(isFullBoard);
    setCelebrationMsg(
      isFullBoard
        ? 'FULL BINGO! 9/9!'
        : result.replaced
          ? 'Photo updated!'
          : 'Challenge completed!',
    );
    setCelebrationCount((c) => c + 1);
  };

  const handleLeaveGame = async () => {
    await leaveCurrentGame();
    setGameState(null);
    setSelectedChallenge(null);
    setActiveTab('play');
    setScreen({ view: 'home' });
  };

  if (screen.view === 'loading') {
    return (
      <main className="min-h-[100dvh] bg-[#F4F6F8] flex flex-col items-center justify-center p-6">
        <Loader2 className="w-8 h-8 text-[#218F87] animate-spin" aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-[#172E4D]/70">Loading Human Bingo...</p>
      </main>
    );
  }

  if (screen.view === 'home') {
    return (
      <HomeView
        onCreateGame={handleCreateGame}
        onJoinGame={() => setScreen({ view: 'join', prefillCode: '', lockCode: false })}
        isCreating={isCreating}
        errorMessage={homeError}
      />
    );
  }

  if (screen.view === 'created') {
    return (
      <CreateGameView
        game={screen.game}
        onStartPlaying={(code) =>
          setScreen({ view: 'join', prefillCode: code, lockCode: true })
        }
        onBack={() => setScreen({ view: 'home' })}
      />
    );
  }

  if (screen.view === 'join') {
    return (
      <JoinGameView
        initialCode={screen.prefillCode}
        lockCode={screen.lockCode}
        onJoinSubmit={handleJoinSubmit}
        onBack={() => setScreen({ view: 'home' })}
      />
    );
  }

  if (!gameState) {
    return null;
  }

  const isExpired = gameState.game.status === 'expired';
  const mySelectedSubmission = selectedChallenge
    ? gameState.submissions.find(
        (s) =>
          s.challengeId === selectedChallenge.id &&
          s.participantId === gameState.participant.id,
      )
    : undefined;
  const personalCompletedCount = new Set(
    gameState.submissions
      .filter((s) => s.participantId === gameState.participant.id)
      .map((s) => s.challengeId),
  ).size;

  const handleOpenMyGrid = () => {
    setSelectedChallenge(null);
    setActiveTab('play');
  };

  return (
    <>
      <CelebrationBurst triggerKey={celebrationCount} message={celebrationMsg} />

      <GameShell
        game={gameState.game}
        participant={gameState.participant}
        personalCompletedCount={personalCompletedCount}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenMyGrid={handleOpenMyGrid}
        onLeaveGame={handleLeaveGame}
      >
        {activeTab === 'play' && (
          <BingoGridView
            joiningCode={gameState.game.joiningCode}
            participantId={gameState.participant.id}
            participantName={gameState.participant.name}
            submissions={gameState.submissions}
            isExpired={isExpired}
            onSelectChallenge={setSelectedChallenge}
          />
        )}

        {activeTab === 'players' && (
          <PlayersView
            participants={gameState.participants}
            submissions={gameState.submissions}
            currentParticipantId={gameState.participant.id}
            isExpired={isExpired}
            onSelectOwnChallenge={setSelectedChallenge}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressView
            progress={gameState.progress}
            participants={gameState.participants}
            submissions={gameState.submissions}
            currentParticipantId={gameState.participant.id}
          />
        )}

        {activeTab === 'leaderboard' && (
          <LeaderboardView
            leaderboard={gameState.leaderboard}
            currentParticipantId={gameState.participant.id}
          />
        )}
      </GameShell>

      <ChallengeSheet
        challenge={selectedChallenge}
        mySubmission={mySelectedSubmission}
        isExpired={isExpired}
        onClose={() => setSelectedChallenge(null)}
        onViewMyGrid={handleOpenMyGrid}
        onConfirmUpload={handleUploadPhoto}
      />
    </>
  );
}
