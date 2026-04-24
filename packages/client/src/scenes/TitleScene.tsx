import { useEffect } from 'react';

interface Props {
  onStart: () => void;
}

export function TitleScene({ onStart }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart]);

  return (
    <div className="scene title-scene">
      <div className="title-content">
        <h1 className="title-logo">ChainDrop</h1>
        <p className="title-sub">落ちもの連鎖バトル</p>
        <button type="button" className="title-start" onClick={onStart}>
          PRESS ENTER TO START
        </button>
      </div>
      <div className="keyhint">Enter / Space: START</div>
    </div>
  );
}
