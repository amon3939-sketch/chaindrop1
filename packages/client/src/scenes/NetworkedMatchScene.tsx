/**
 * NetworkedMatchScene — 1v1 lockstep match driven by Colyseus.
 *
 * Cousin of `MatchScene`, but the simulator is fed by a
 * `NetworkedMatchSource` that exchanges INPUT / INPUT_BATCH /
 * STATE_HASH with the server (see D4 §4).
 *
 * Two `FieldRenderer` + `NextRenderer` pairs are mounted side-by-side
 * — the local player on the left, the opponent on the right — by
 * translating each renderer's Pixi container into its half of the
 * 1280×720 internal coord space.
 */

import type { MatchState, PlayerId, PuyoColor } from '@chaindrop/shared';
import type { Room } from 'colyseus.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InputSystem } from '../input/InputSystem';
import { FieldRenderer } from '../renderer/FieldRenderer';
import { NextRenderer } from '../renderer/NextRenderer';
import { PixiApp } from '../renderer/PixiApp';
import { PuyoSheet } from '../renderer/PuyoTexture';
import { FIELD_ORIGIN_X } from '../renderer/layout';
import { FrameScheduler } from '../simulator/FrameScheduler';
import { NetworkedMatchSource } from '../simulator/NetworkedMatchSource';

/**
 * Where each player's field lands on the 1280-wide internal canvas.
 * The renderer instances all draw at FIELD_ORIGIN_X internally, so the
 * `containerOffset` here is the horizontal shift applied to their
 * parent Container to slide each into its own half of the screen.
 */
const LEFT_FIELD_X = 200;
const RIGHT_FIELD_X = 840;
const LEFT_OFFSET = LEFT_FIELD_X - FIELD_ORIGIN_X;
const RIGHT_OFFSET = RIGHT_FIELD_X - FIELD_ORIGIN_X;

const ASSET_BASE = import.meta.env.BASE_URL;

export interface NetworkedMatchResult {
  winnerId: PlayerId | null;
  myPlayerId: PlayerId;
  frame: number;
  score: number;
  maxChain: number;
}

interface PlayerHud {
  nickname: string;
  score: number;
  chain: number;
  maxChain: number;
}

interface Props {
  room: Room<unknown>;
  myPlayerId: PlayerId;
  playerOrder: readonly PlayerId[];
  nicknamesByPlayerId: Record<PlayerId, string>;
  seed: number;
  colorMode: 4 | 5;
  dropQueue: readonly (readonly [PuyoColor, PuyoColor])[];
  onEnd: (result: NetworkedMatchResult) => void;
  onQuit: () => void;
}

export function NetworkedMatchScene({
  room,
  myPlayerId,
  playerOrder,
  nicknamesByPlayerId,
  seed,
  colorMode,
  dropQueue,
  onEnd,
  onQuit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [huds, setHuds] = useState<Record<PlayerId, PlayerHud>>(() => {
    const out: Record<PlayerId, PlayerHud> = {};
    for (const id of playerOrder) {
      out[id] = { nickname: nicknamesByPlayerId[id] ?? id, score: 0, chain: 0, maxChain: 0 };
    }
    return out;
  });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const onEndRef = useRef(onEnd);
  const onQuitRef = useRef(onQuit);
  onEndRef.current = onEnd;
  onQuitRef.current = onQuit;

  // Stable identity of who's left vs right, computed once so it
  // doesn't churn between renders.
  const myIndex = Math.max(0, playerOrder.indexOf(myPlayerId));
  const opponentIndex = myIndex === 0 ? 1 : 0;
  const opponentId = playerOrder[opponentIndex];

  const handleQuit = useCallback(() => {
    onQuitRef.current();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const source = new NetworkedMatchSource({
      room,
      playerOrder,
      myPlayerId,
      seed,
      colorMode,
      dropQueue,
    });
    const input = new InputSystem();
    input.attach(window);
    const pixi = new PixiApp({ canvas, autoFit: true });

    let cancelled = false;
    let scheduler: FrameScheduler | null = null;
    let sheet: PuyoSheet | null = null;
    let leftField: FieldRenderer | null = null;
    let rightField: FieldRenderer | null = null;
    let leftNext: NextRenderer | null = null;
    let rightNext: NextRenderer | null = null;
    let matchEnded = false;

    const onEscape = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      onQuitRef.current();
    };
    window.addEventListener('keydown', onEscape);

    Promise.all([pixi.init(), PuyoSheet.load(ASSET_BASE)])
      .then(([_, loadedSheet]) => {
        if (cancelled) {
          loadedSheet.destroy();
          pixi.destroy();
          return;
        }
        sheet = loadedSheet;
        leftField = new FieldRenderer(loadedSheet);
        rightField = new FieldRenderer(loadedSheet);
        leftField.container.x = LEFT_OFFSET;
        rightField.container.x = RIGHT_OFFSET;
        pixi.worldContainer.addChild(leftField.container);
        pixi.worldContainer.addChild(rightField.container);

        leftNext = new NextRenderer(loadedSheet);
        rightNext = new NextRenderer(loadedSheet);
        leftNext.container.x = LEFT_OFFSET;
        rightNext.container.x = RIGHT_OFFSET;
        pixi.worldContainer.addChild(leftNext.container);
        pixi.worldContainer.addChild(rightNext.container);

        source.onMatchEnd((winnerId) => {
          if (matchEnded) return;
          matchEnded = true;
          const mine = source.match.players.find((p) => p.id === myPlayerId);
          onEndRef.current({
            winnerId,
            myPlayerId,
            frame: source.match.frame,
            score: mine?.score ?? 0,
            maxChain: mine?.maxChain ?? 0,
          });
        });

        scheduler = new FrameScheduler({
          source,
          input,
          onFrameAdvanced: (match: MatchState) => {
            const next: Record<PlayerId, PlayerHud> = {};
            for (const p of match.players) {
              next[p.id] = {
                nickname: nicknamesByPlayerId[p.id] ?? p.id,
                score: p.score,
                chain: p.chainCount,
                maxChain: p.maxChain,
              };
            }
            setHuds(next);
          },
          onRender: (match) => {
            if (!leftField || !rightField) return;
            const myPlayer = match.players[myIndex];
            const oppPlayer = match.players[opponentIndex];
            if (myPlayer) leftField.update(myPlayer);
            if (oppPlayer) rightField.update(oppPlayer);
            leftNext?.update(match, myIndex);
            rightNext?.update(match, opponentIndex);
          },
        });
        scheduler.start();
        setStatusMsg(null);
      })
      .catch((err) => {
        console.error('[NetworkedMatchScene] init failed:', err);
        if (!cancelled) {
          setStatusMsg('対戦の初期化に失敗しました');
          onQuitRef.current();
        }
      });

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onEscape);
      scheduler?.dispose();
      leftField?.destroy();
      rightField?.destroy();
      leftNext?.destroy();
      rightNext?.destroy();
      sheet?.destroy();
      pixi.destroy();
      input.dispose();
      source.dispose();
    };
    // The Colyseus room handle, seed, and player roster are baked in
    // at scene-mount time; we deliberately don't restart on identity
    // changes of nicknamesByPlayerId (which can come from React
    // re-renders without changing semantics).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, myPlayerId, seed, colorMode]);

  const me = huds[myPlayerId];
  const opp = opponentId ? huds[opponentId] : undefined;

  return (
    <div className="scene match-scene networked-match-scene">
      <canvas ref={canvasRef} className="match-canvas" />

      <div className="vs-overlay vs-overlay-left">
        <div className="vs-name">{me?.nickname ?? myPlayerId}</div>
        <div className="vs-score">{me?.score.toLocaleString() ?? '0'}</div>
        <div className="vs-chain">
          CHAIN {me?.chain ?? 0} / {me?.maxChain ?? 0}
        </div>
      </div>

      <div className="vs-overlay vs-overlay-right">
        <div className="vs-name">{opp?.nickname ?? opponentId ?? '-'}</div>
        <div className="vs-score">{opp?.score.toLocaleString() ?? '0'}</div>
        <div className="vs-chain">
          CHAIN {opp?.chain ?? 0} / {opp?.maxChain ?? 0}
        </div>
      </div>

      {statusMsg && <div className="vs-status-banner">{statusMsg}</div>}
      <button type="button" className="vs-quit" onClick={handleQuit}>
        退出
      </button>
      <div className="keyhint">←/→: 移動 Z/X: 回転 ↓: ソフトドロップ Esc: 退出</div>
    </div>
  );
}
