/**
 * MatchLobbyScene — the room a player sits in after joining a match
 * but before the simulator starts. Once MATCH_START arrives we
 * hand the live Colyseus Room handle, along with the seed / dropQueue
 * / playerOrder, to `NetworkedMatchScene` via the `onMatchStart`
 * prop. The room is NOT `leave()`d on that handoff — the networked
 * match scene needs it for INPUT / INPUT_BATCH / STATE_HASH.
 */

import type { MatchPlayer } from '@chaindrop/shared/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type MatchRoomHandle, colyseus, onMatchMessage } from '../network/colyseusClient';

export interface MatchStartPayload {
  room: MatchRoomHandle;
  myPlayerId: string;
  playerOrder: string[];
  seed: number;
  colorMode: 4 | 5;
  dropQueue: ReadonlyArray<readonly [string, string]>;
  nicknamesByPlayerId: Record<string, string>;
}

interface Props {
  roomId: string;
  nickname: string;
  characterId?: string;
  onLeave: () => void;
  onMatchStart: (payload: MatchStartPayload) => void;
}

type Phase = 'connecting' | 'lobby' | 'countdown' | 'running';

export function MatchLobbyScene({
  roomId,
  nickname,
  characterId = 'default',
  onLeave,
  onMatchStart,
}: Props) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [players, setPlayers] = useState<MatchPlayer[]>([]);
  const [capacity, setCapacity] = useState<number>(2);
  const [colorMode, setColorMode] = useState<4 | 5>(4);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const roomRef = useRef<MatchRoomHandle | null>(null);
  /** Set to true once we hand the room off to NetworkedMatchScene so
   *  the unmount cleanup doesn't `leave()` the room behind its back. */
  const handedOff = useRef(false);
  const playersRef = useRef<MatchPlayer[]>([]);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room && !handedOff.current) {
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

        onMatchMessage(room, (msg) => {
          switch (msg.t) {
            case 'MATCH_ROOM_STATE': {
              const sorted = [...msg.players].sort((a, b) => a.slotIndex - b.slotIndex);
              setPlayers(sorted);
              playersRef.current = sorted;
              setCapacity(msg.config.capacity);
              setColorMode(msg.config.colorMode);
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
            case 'MATCH_START': {
              setPhase('running');
              setCountdownMs(null);
              // Acknowledge — the server doesn't currently gate on
              // this, but it'll matter for M3c reconnect flows.
              room.send('MATCH_ACK', {});
              const nicknamesByPlayerId: Record<string, string> = {};
              for (const p of playersRef.current) nicknamesByPlayerId[p.playerId] = p.nickname;
              handedOff.current = true;
              onMatchStart({
                room,
                myPlayerId: room.sessionId,
                playerOrder: [...msg.playerOrder],
                seed: msg.seed,
                colorMode,
                dropQueue: msg.dropQueue,
                nicknamesByPlayerId,
              });
              break;
            }
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
      if (room && !handedOff.current) {
        room.leave().catch(() => {});
      }
    };
  }, [roomId, nickname, characterId, onMatchStart, colorMode]);

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
            {phase === 'running' && 'マッチ進行中…'}
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
              <p>対戦シーンへ遷移中…</p>
            </div>
          )}
        </>
      )}

      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
