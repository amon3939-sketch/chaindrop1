import { useEffect } from 'react';

interface Props {
  onStart: () => void;
  onOnline: () => void;
}

export function TitleScene({ onStart, onOnline }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart();
      } else if (e.code === 'KeyO') {
        e.preventDefault();
        onOnline();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart, onOnline]);

  return (
    <div className="scene title-scene">
      <div className="title-content">
        <h1 className="title-logo">ChainDrop</h1>
        <p className="title-sub">落ちもの連鎖バトル</p>
        <button type="button" className="title-start" onClick={onStart}>
          ソロプレイ
        </button>
        <button type="button" className="title-start" onClick={onOnline}>
          オンライン
        </button>
      </div>
      <div className="keyhint">Enter: ソロ · O: オンライン</div>
    </div>
  );
}
