import type { MatchState } from '@chaindrop/shared';
import { useEffect, useRef, useState } from 'react';
import { InputSystem } from '../input/InputSystem';
import { FieldRenderer } from '../renderer/FieldRenderer';
import { PixiApp } from '../renderer/PixiApp';
import { FrameScheduler } from '../simulator/FrameScheduler';
import { LocalMatchSource } from '../simulator/LocalMatchSource';

export interface MatchResult {
  score: number;
  maxChain: number;
  frame: number;
}

interface Props {
  seed?: number;
  colorMode?: 4 | 5;
  onEnd: (result: MatchResult) => void;
  onQuit: () => void;
}

export function MatchScene({ seed, colorMode = 4, onEnd, onQuit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState({ score: 0, chain: 0, maxChain: 0 });

  // Refs used for cleanup + for the Escape handler so it sees latest handlers.
  const onEndRef = useRef(onEnd);
  const onQuitRef = useRef(onQuit);
  onEndRef.current = onEnd;
  onQuitRef.current = onQuit;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const actualSeed = seed ?? Math.floor(Math.random() * 0xffffffff);
    const source = new LocalMatchSource({ seed: actualSeed, colorMode });
    const input = new InputSystem();
    input.attach(window);

    const pixi = new PixiApp({ canvas, autoFit: true });

    let renderer: FieldRenderer | null = null;
    let scheduler: FrameScheduler | null = null;
    let cancelled = false;
    let matchEnded = false;

    const onEscape = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      onQuitRef.current();
    };
    window.addEventListener('keydown', onEscape);

    pixi
      .init()
      .then(() => {
        if (cancelled) {
          pixi.destroy();
          return;
        }
        renderer = new FieldRenderer();
        pixi.worldContainer.addChild(renderer.container);

        source.onMatchEnd(() => {
          if (matchEnded) return;
          matchEnded = true;
          const p = source.match.players[0];
          onEndRef.current({
            score: p?.score ?? 0,
            maxChain: p?.maxChain ?? 0,
            frame: source.match.frame,
          });
        });

        scheduler = new FrameScheduler({
          source,
          input,
          onFrameAdvanced: (match: MatchState) => {
            const p = match.players[0];
            if (!p) return;
            setHud({ score: p.score, chain: p.chainCount, maxChain: p.maxChain });
          },
          onRender: (match, alpha) => {
            const p = match.players[0];
            if (!p || !renderer) return;
            renderer.update(p, alpha);
          },
        });
        scheduler.start();
      })
      .catch((err) => {
        // Initialization failed (e.g. no WebGL). Fall back to title.
        console.error('[MatchScene] PixiApp init failed:', err);
        onQuitRef.current();
      });

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onEscape);
      scheduler?.dispose();
      renderer?.destroy();
      pixi.destroy();
      input.dispose();
      source.dispose();
    };
  }, [seed, colorMode]);

  return (
    <div className="scene match-scene">
      <canvas ref={canvasRef} className="match-canvas" />
      <div className="match-overlay">
        <div className="overlay-panel score-panel">
          <div className="panel-label">SCORE</div>
          <div className="panel-value digital">{hud.score.toLocaleString()}</div>
        </div>
        <div className="overlay-panel chain-panel">
          <div className="panel-label">CHAIN</div>
          <div className="panel-value">
            {hud.chain} <span className="panel-sub">/ {hud.maxChain}</span>
          </div>
        </div>
      </div>
      <div className="keyhint">←/→: 移動 Z/X: 回転 ↓: ソフトドロップ Esc: ポーズ</div>
    </div>
  );
}
