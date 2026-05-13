/**
 * LobbyScene — pick a nickname, browse the room list, create or join
 * a match room. M3a stops here once the player is in a match room:
 * the next transition is `MatchLobbyScene` (waiting for opponents +
 * READY toggle).
 */

import type { Capacity, ColorMode, RoomSummary } from '@chaindrop/shared/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type LobbyRoomHandle, colyseus, onLobbyMessage } from '../network/colyseusClient';

interface Props {
  initialNickname?: string;
  /** Called once we successfully obtained a match room id. */
  onJoinMatch: (roomId: string, nickname: string) => void;
  onBack: () => void;
}

export function LobbyScene({ initialNickname, onJoinMatch, onBack }: Props) {
  const [nickname, setNickname] = useState(initialNickname ?? '');
  const [joined, setJoined] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<Capacity>(2);
  const [colorMode, setColorMode] = useState<ColorMode>(4);
  const [busy, setBusy] = useState(false);
  const roomRef = useRef<LobbyRoomHandle | null>(null);

  const cleanup = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.leave();
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const connect = useCallback(async () => {
    if (!nickname.trim()) {
      setError('ニックネームを入力してください');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const room = (await colyseus.joinOrCreate('lobby', {})) as LobbyRoomHandle;
      roomRef.current = room;
      onLobbyMessage(room, (msg) => {
        switch (msg.t) {
          case 'LOBBY_JOINED':
            setJoined(true);
            break;
          case 'LOBBY_STATE':
            setRooms(msg.rooms);
            break;
          case 'ROOM_CREATED':
            // Once the room is created the lobby state update will
            // surface it; we immediately try to join it so the user
            // jumps straight into the waiting room.
            void joinMatch(msg.roomId);
            break;
          case 'JOIN_ROOM_OK':
            onJoinMatch(msg.matchRoomUrl, nickname);
            break;
          case 'JOIN_ROOM_REJECTED':
            setError(`join rejected: ${msg.reason}`);
            break;
          case 'ERROR':
            setError(`${msg.code}: ${msg.message}`);
            break;
        }
      });
      // Re-render the room list as the schema map updates.
      const lobbyState = room.state as { rooms?: Map<string, unknown> };
      if (
        lobbyState.rooms &&
        typeof (lobbyState.rooms as Map<string, unknown>).forEach === 'function'
      ) {
        // The schema map syncs in the background; the LOBBY_STATE
        // snapshot above primes the initial render and subsequent
        // changes arrive via the same message.
      }
      room.send('JOIN_LOBBY', { nickname });
    } catch (err) {
      console.error(err);
      setError('サーバに接続できませんでした');
    } finally {
      setBusy(false);
    }
  }, [nickname, onJoinMatch]);

  const createRoom = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    setBusy(true);
    room.send('CREATE_ROOM', {
      capacity,
      colorMode,
      isPrivate: false,
    });
  }, [capacity, colorMode]);

  const joinMatch = useCallback((roomId: string) => {
    const room = roomRef.current;
    if (!room) return;
    room.send('JOIN_ROOM', { roomId });
  }, []);

  return (
    <div className="scene lobby-scene">
      <div className="lobby-header">
        <h2>ロビー</h2>
        <button
          type="button"
          className="lobby-back"
          onClick={() => {
            void cleanup();
            onBack();
          }}
        >
          戻る
        </button>
      </div>

      {!joined ? (
        <div className="lobby-connect">
          <label className="lobby-field">
            <span>ニックネーム</span>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
            />
          </label>
          <button type="button" disabled={busy} onClick={() => void connect()}>
            接続
          </button>
        </div>
      ) : (
        <>
          <div className="lobby-create">
            <label className="lobby-field">
              <span>人数</span>
              <select
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value) as Capacity)}
              >
                <option value={2}>2 人</option>
                <option value={3}>3 人</option>
                <option value={4}>4 人</option>
              </select>
            </label>
            <label className="lobby-field">
              <span>色数</span>
              <select
                value={colorMode}
                onChange={(e) => setColorMode(Number(e.target.value) as ColorMode)}
              >
                <option value={4}>4 色</option>
                <option value={5}>5 色</option>
              </select>
            </label>
            <button type="button" disabled={busy} onClick={createRoom}>
              ルーム作成
            </button>
          </div>

          <div className="lobby-rooms">
            <h3>ルーム一覧</h3>
            {rooms.length === 0 ? (
              <p className="lobby-empty">ルームはまだありません</p>
            ) : (
              <ul>
                {rooms.map((r) => (
                  <li key={r.roomId}>
                    <span className="lobby-room-name">{r.name || r.roomId}</span>
                    <span className="lobby-room-meta">
                      {r.players}/{r.capacity} · {r.colorMode}色 · {r.status}
                    </span>
                    <button
                      type="button"
                      disabled={busy || r.status !== 'lobby' || r.players >= r.capacity}
                      onClick={() => joinMatch(r.roomId)}
                    >
                      入る
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
