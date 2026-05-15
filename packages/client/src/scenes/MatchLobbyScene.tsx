/**
 * MatchLobbyScene — placeholder waiting room a player sees after
 * joining a match. M3a stops at the point MATCH_BEGIN arrives; the
 * full networked match scene (input forwarding, simulator sync) is
 * M3b. Until then we just acknowledge the start and display a stub.
 */

import type { MatchPlayer } from '@chaindrop/shared/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type MatchRoomHandle, colyseus, onMatchMessage } from '../network/colyseusClient';

interface Props {
  roomId: string;
  nickname: string;
  characterId?: string;
  onLeave: () => void;
}

type Phase = 'connecting' | 'lobby' | 'countdown' | 'running';

export function MatchLobbyScene({ roomId, nickname, characterId = 'default', onLeave }: Props) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [players, setPlayers] = useState<MatchPlayer[]>([]);
  const [capacity, setCapacity] = useState<number>(2);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const roomRef = useRef<MatchRoomHandle | null>(null);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.leave();
      } catch {
        /* ignore */
      }
    }
    onLeave();
  }, [onLeave]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const room = (await colyseus.joinById(roomId, {
          nickname,
          characterId,
        })) as MatchRoomHandle;
        if (cancelled) {
          await room.leave();
          return;
        }
        roomRef.current = room;
        setPhase('lobby');

        // Room state lives in `MATCH_ROOM_STATE` messages the server
        // broadcasts whenever the player roster, config, or status
        // changes (see server/src/rooms/state.ts for the rationale
        // behind hand-rolling state sync instead of relying on the
        // Colyseus schema patch stream).
        onMatchMessage(room, (msg) => {
          switch (msg.t) {
            case 'MATCH_ROOM_STATE': {
              const sorted = [...msg.players].sort((a, b) => a.slotIndex - b.slotIndex);
              setPlayers(sorted);
              setCapacity(msg.config.capacity);
              if (msg.status === 'lobby') setPhase('lobby');
              if (msg.status === 'countdown') setPhase('countdown');
              if (msg.status === 'running') setPhase('running');
              break;
            }
            case 'COUNTDOWN_START':
              setPhase('countdown');
              setCountdownMs(Date.now() + (msg.durationFrames / 60) * 1000);
              break;
            case 'COUNTDOWN_CANCEL':
              setPhase('lobby');
              setCountdownMs(null);
              break;
            case 'MATCH_START':
              setPhase('running');
              setCountdownMs(null);
              // M3b: hand this seed + dropQueue + playerOrder to the
              // networked match scene. For now we just acknowledge.
              room.send('MATCH_ACK', {});
              break;
            case 'ERROR':
              setError(`${msg.code}: ${msg.message}`);
              break;
          }
        });
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('マッチに接続できませんでした');
      }
    })();

    return () => {
      cancelled = true;
      const room = roomRef.current;
      if (room) {
        room.leave().catch(() => {});
      }
    };
  }, [roomId, nickname, characterId]);

  const toggleReady = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = !ready;
    setReady(next);
    room.send('SET_READY', { ready: next });
  }, [ready]);

  return (
    <div className="scene match-lobby-scene">
      <div className="lobby-header">
        <h2>マッチ待機室 [{roomId}]</h2>
        <button type="button" className="lobby-back" onClick={() => void leave()}>
          退出
        </button>
      </div>

      {phase === 'connecting' && <p>接続中…</p>}

      {phase !== 'connecting' && (
        <>
          <p className="match-lobby-status">
            {players.length} / {capacity} 人 · {phase === 'lobby' && '全員 READY で開始'}
            {phase === 'countdown' && 'カウントダウン中…'}
            {phase === 'running' && 'マッチ進行中'}
          </p>

          <ul className="match-lobby-players">
            {Array.from({ length: capacity }, (_, slot) => {
              const p = players.find((q) => q.slotIndex === slot);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: each slot has a fixed position; rows never reorder, only their player changes
                <li key={slot} className={p ? '' : 'empty'}>
                  <span className="match-lobby-slot">#{slot + 1}</span>
                  <span className="match-lobby-name">{p ? p.nickname : '募集中…'}</span>
                  <span className="match-lobby-status-tag">
                    {p ? (p.ready ? 'READY' : '待機') : '—'}
                  </span>
                </li>
              );
            })}
          </ul>

          {phase === 'lobby' && (
            <div className="match-lobby-actions">
              <button type="button" onClick={toggleReady}>
                {ready ? 'READY 解除' : 'READY'}
              </button>
            </div>
          )}

          {phase === 'countdown' && (
            <p className="match-lobby-countdown">
              開始まで {Math.max(0, countdownMs ? Math.ceil((countdownMs - Date.now()) / 1000) : 0)}{' '}
              秒
            </p>
          )}

          {phase === 'running' && (
            <div className="match-lobby-running">
              <p>マッチ開始（M3b で実プレイ対応予定）</p>
              <p>
                seed と dropQueue は受信済み — クライアント側のゲームロジック実装は次のステップです
              </p>
            </div>
          )}
        </>
      )}

      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
