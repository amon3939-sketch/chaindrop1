import { useCallback, useState } from 'react';
import { type MatchResult, MatchScene } from './scenes/MatchScene';
import { ResultScene } from './scenes/ResultScene';
import { TitleScene } from './scenes/TitleScene';

type SceneKind = 'title' | 'match' | 'result';

export function App() {
  const [scene, setScene] = useState<SceneKind>('title');
  const [matchKey, setMatchKey] = useState(0);
  const [result, setResult] = useState<MatchResult | null>(null);

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

  switch (scene) {
    case 'title':
      return <TitleScene onStart={startMatch} />;
    case 'match':
      return <MatchScene key={matchKey} onEnd={handleEnd} onQuit={handleQuit} />;
    case 'result':
      if (!result) return <TitleScene onStart={startMatch} />;
      return <ResultScene result={result} onRestart={startMatch} onTitle={handleQuit} />;
  }
}
