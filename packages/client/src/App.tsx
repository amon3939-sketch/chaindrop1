import { useCallback, useState } from 'react';
import { LobbyScene } from './scenes/LobbyScene';
import { MatchLobbyScene, type MatchStartPayload } from './scenes/MatchLobbyScene';
import { type MatchResult, MatchScene } from './scenes/MatchScene';
import { type NetworkedMatchResult, NetworkedMatchScene } from './scenes/NetworkedMatchScene';
import { ResultScene } from './scenes/ResultScene';
import { TitleScene } from './scenes/TitleScene';

type SceneKind = 'title' | 'match' | 'result' | 'lobby' | 'matchLobby' | 'networkedMatch';

export function App() {
  const [scene, setScene] = useState<SceneKind>('title');
  const [matchKey, setMatchKey] = useState(0);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [nickname, setNickname] = useState('');
  const [matchRoomId, setMatchRoomId] = useState('');
  const [networkedStart, setNetworkedStart] = useState<MatchStartPayload | null>(null);

  const startMatch = useCallback(() => {
    setMatchKey((k) => k + 1);
    setScene('match');
  }, []);

  const handleEnd = useCallback((r: MatchResult) => {
    setResult(r);
    setScene('result');
  }, []);

  const handleQuit = useCallback(() => {
    setResult(null);
    setScene('title');
  }, []);

  const goOnline = useCallback(() => {
    setScene('lobby');
  }, []);

  const handleJoinMatch = useCallback((roomId: string, nick: string) => {
    setMatchRoomId(roomId);
    setNickname(nick);
    setScene('matchLobby');
  }, []);

  const handleNetworkedMatchStart = useCallback((payload: MatchStartPayload) => {
    setNetworkedStart(payload);
    setScene('networkedMatch');
  }, []);

  const handleNetworkedMatchEnd = useCallback((r: NetworkedMatchResult) => {
    // For M3b we route both end-of-match and quit back to the title;
    // a dedicated networked-result screen lands in M3c.
    setResult({ score: r.score, maxChain: r.maxChain, frame: r.frame });
    setNetworkedStart(null);
    setScene('result');
  }, []);

  const handleNetworkedQuit = useCallback(() => {
    setNetworkedStart(null);
    setScene('title');
  }, []);

  switch (scene) {
    case 'title':
      return <TitleScene onStart={startMatch} onOnline={goOnline} />;
    case 'match':
      return <MatchScene key={matchKey} onEnd={handleEnd} onQuit={handleQuit} />;
    case 'result':
      if (!result) return <TitleScene onStart={startMatch} onOnline={goOnline} />;
      return <ResultScene result={result} onRestart={startMatch} onTitle={handleQuit} />;
    case 'lobby':
      return (
        <LobbyScene
          initialNickname={nickname}
          onJoinMatch={handleJoinMatch}
          onBack={() => setScene('title')}
        />
      );
    case 'matchLobby':
      return (
        <MatchLobbyScene
          roomId={matchRoomId}
          nickname={nickname}
          onLeave={() => setScene('lobby')}
          onMatchStart={handleNetworkedMatchStart}
        />
      );
    case 'networkedMatch':
      if (!networkedStart) return <TitleScene onStart={startMatch} onOnline={goOnline} />;
      return (
        <NetworkedMatchScene
          room={networkedStart.room}
          myPlayerId={networkedStart.myPlayerId}
          playerOrder={networkedStart.playerOrder}
          nicknamesByPlayerId={networkedStart.nicknamesByPlayerId}
          seed={networkedStart.seed}
          colorMode={networkedStart.colorMode}
          // The protocol passes drop pairs as tuples; the simulator
          // only consumes PuyoColor codes, so cast through here.
          dropQueue={
            networkedStart.dropQueue as unknown as ReadonlyArray<
              readonly [
                import('@chaindrop/shared').PuyoColor,
                import('@chaindrop/shared').PuyoColor,
              ]
            >
          }
          onEnd={handleNetworkedMatchEnd}
          onQuit={handleNetworkedQuit}
        />
      );
  }
}
