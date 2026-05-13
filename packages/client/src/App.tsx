import { useCallback, useState } from 'react';
import { LobbyScene } from './scenes/LobbyScene';
import { MatchLobbyScene } from './scenes/MatchLobbyScene';
import { type MatchResult, MatchScene } from './scenes/MatchScene';
import { ResultScene } from './scenes/ResultScene';
import { TitleScene } from './scenes/TitleScene';

type SceneKind = 'title' | 'match' | 'result' | 'lobby' | 'matchLobby';

export function App() {
  const [scene, setScene] = useState<SceneKind>('title');
  const [matchKey, setMatchKey] = useState(0);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [nickname, setNickname] = useState('');
  const [matchRoomId, setMatchRoomId] = useState('');

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
        />
      );
  }
}
