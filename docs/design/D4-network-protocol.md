# D4. 通信プロトコル詳細

## 1. 概要

### 1.1 同期モデル
**決定論的ロックステップ + 入力遅延**:
- サーバーは**入力の中継**のみ。ゲームロジックは全クライアントで同一実行
- 入力遅延 **3 フレーム**(= 約 50ms)で RTT を隠蔽
- 盤面ハッシュを定期送信してデシンク検出

### 1.2 トランスポート
| 項目 | 採用 |
|---|---|
| ライブラリ | **Colyseus**(Node.js + WebSocket) |
| シリアライズ | **MessagePack**(バイナリ、Colyseus 既定) |
| 暗号化 | WSS(TLS 終端はホスト側) |
| 接続単位 | クライアント 1 セッション = 1 Colyseus `client.id` |

### 1.3 ルーム構成
```
LobbyRoom        ... マッチメイキング、ルーム一覧、クイックマッチのマッチング
MatchRoom        ... 実試合(2〜4人)、試合中は LobbyRoom から切り離される
```

---

## 2. メッセージ体系(型定義)

### 2.1 共通型
```typescript
type PlayerId   = string;     // server 生成 (e.g., "p_a8f3b2")
type RoomId     = string;     // server 生成 (e.g., "r_9c2e")
type Frame      = number;     // int32, マッチ開始から 0 始まり
type ColorMode  = 4 | 5;
type Capacity   = 2 | 3 | 4;

type InputAction =
  | 'MOVE_L' | 'MOVE_R'
  | 'ROT_L'  | 'ROT_R'
  | 'SOFT_START' | 'SOFT_END';
```

### 2.2 C→S: LobbyRoom
```typescript
type LobbyC2S =
  | { t: 'JOIN_LOBBY'; nickname: string }
  | { t: 'CREATE_ROOM'; capacity: Capacity; colorMode: ColorMode; isPrivate: boolean; name?: string }
  | { t: 'JOIN_ROOM';   roomId: RoomId; joinCode?: string }
  | { t: 'QUICK_MATCH'; capacity: Capacity; colorMode: ColorMode }
  | { t: 'CANCEL_QUICK_MATCH' }
  | { t: 'LEAVE_LOBBY' };
```

### 2.3 S→C: LobbyRoom
```typescript
type LobbyS2C =
  | { t: 'LOBBY_JOINED'; playerId: PlayerId }
  | { t: 'LOBBY_STATE';  rooms: RoomSummary[] }
  | { t: 'ROOM_CREATED'; roomId: RoomId; joinCode?: string }
  | { t: 'JOIN_ROOM_OK'; roomId: RoomId; matchRoomUrl: string }
  | { t: 'JOIN_ROOM_REJECTED'; reason: 'FULL' | 'NOT_FOUND' | 'MATCH_IN_PROGRESS' | 'BAD_CODE' }
  | { t: 'QUICK_MATCH_FOUND'; roomId: RoomId; matchRoomUrl: string }
  | { t: 'ERROR'; code: string; message: string };

interface RoomSummary {
  roomId: RoomId;
  name: string;
  capacity: Capacity;
  colorMode: ColorMode;
  players: number;
  isPrivate: boolean;
  status: 'lobby' | 'countdown' | 'running';
}
```

### 2.4 C→S: MatchRoom
```typescript
type MatchC2S =
  | { t: 'MATCH_JOIN'; nickname: string; characterId: string }
  | { t: 'SET_READY'; ready: boolean }
  | { t: 'MATCH_ACK' }
  | { t: 'INPUT'; frame: Frame; actions: InputAction[] }
  | { t: 'STATE_HASH'; frame: Frame; hash: string }
  | { t: 'PING'; clientMs: number }
  | { t: 'LEAVE_MATCH' };
```

### 2.5 S→C: MatchRoom
```typescript
type MatchS2C =
  | { t: 'MATCH_ROOM_STATE'; players: MatchPlayer[]; config: MatchConfig }
  | { t: 'COUNTDOWN_START';  durationFrames: 180; serverStartMs: number }
  | { t: 'COUNTDOWN_CANCEL'; reason: string }
  | { t: 'MATCH_START';      seed: number; dropQueue: [PuyoColor, PuyoColor][]; playerOrder: PlayerId[]; startFrameMs: number }
  | { t: 'MATCH_BEGIN' }
  | { t: 'INPUT_BATCH'; frame: Frame; inputs: Record<PlayerId, InputAction[]> }
  | { t: 'PLAYER_ELIMINATED'; playerId: PlayerId; atFrame: Frame }
  | { t: 'PLAYER_DISCONNECTED'; playerId: PlayerId; atFrame: Frame }
  | { t: 'PLAYER_RECONNECTED';  playerId: PlayerId; atFrame: Frame }
  | { t: 'MATCH_END'; winnerId: PlayerId | null; stats: MatchStats }
  | { t: 'DESYNC_DETECTED'; frame: Frame; hashes: Record<PlayerId, string> }
  | { t: 'PONG'; clientMs: number; serverMs: number }
  | { t: 'ERROR'; code: string; message: string };
```

---

## 3. ロビー・フロー

### 3.1 ロビー入室 → ルーム作成 → 参加者待ち
```
Client A            LobbyRoom          MatchRoom(r_1)      Client B
  │  JOIN_LOBBY(nick=A)  │                                       │
  ├────────────────────▶│                                       │
  │  LOBBY_JOINED        │                                       │
  │◀────────────────────┤                                       │
  │                      │                                       │
  │  CREATE_ROOM         │                                       │
  ├────────────────────▶│  (create MatchRoom r_1)                │
  │  ROOM_CREATED(r_1)   │                                       │
  │◀────────────────────┤                                       │
  │ (MatchRoomへ移動)                                            │
  │  MATCH_JOIN ────────────────────▶│                           │
  │  MATCH_ROOM_STATE                │                           │
  │◀────────────────────────────────┤                           │
  │                      │   JOIN_ROOM(r_1)        │             │
  │                      │◀──────────────────────────────────────┤
  │                      │   JOIN_ROOM_OK                        │
  │                      ├──────────────────────────────────────▶│
  │                                   MATCH_JOIN ◀───────────────┤
  │     MATCH_ROOM_STATE(AとB) ◀────────────────────────────────┤
```

### 3.2 READY・カウントダウン・開始
```
ClientA                MatchRoom                         ClientB
  │  SET_READY(true) ─────▶│                                 │
  │  MATCH_ROOM_STATE ◀────┤────────────────────────────────▶│
  │                         │◀──── SET_READY(true) ───────────┤
  │  (満員 + 全員READY判定) │                                │
  │  COUNTDOWN_START(180f) ◀──────────────────────────────▶ │
  │    --- 3 秒経過 ---                                      │
  │  MATCH_START(seed, dropQueue, order, startMs) ◀────────▶│
  │  MATCH_ACK ────────────▶│                                │
  │                         │◀───── MATCH_ACK ───────────────┤
  │  MATCH_BEGIN ◀─────────────────────────────────────────▶│
  │  === frame 0 からのゲームループ開始 ===                  │
```

---

## 4. マッチ中のフレーム進行プロトコル

### 4.1 基本ループ(クライアント側)
```
各描画フレーム:
  1. localFrame 到達まで rAF 繰り返し
  2. 現在フレーム F の INPUT_BATCH が到着しているか確認
     - 到着済: simulator.advanceFrame(F, batch)、localFrame++
     - 未着:  stall(描画のみ継続、論理は進めない)
  3. 今打った入力を INPUT(F + 3) として server に送信
  4. 60 フレーム毎に STATE_HASH(F) を送信
```

### 4.2 基本ループ(サーバー側)
```
各フレーム F に対して:
  受信バッファ[F] = {}

  INPUT 受信イベント (playerId, F, actions):
    受信バッファ[F][playerId] = actions
    if 受信バッファ[F] が全員分揃った:
      全員に INPUT_BATCH(F, 受信バッファ[F]) を送信
      受信バッファ.delete(F)

  タイムアウト監視:
    F に対して最初の入力到着から 200ms 経過しても未到着の playerId がある:
      その playerId は空配列 [] で扱い、INPUT_BATCH を確定送信
      連続 30 フレーム空入力 → PLAYER_DISCONNECTED 扱い
```

### 4.3 初期 3 フレームの扱い
`MATCH_BEGIN` 後の F=0,1,2 は入力なしで進行。プレイヤーは実質 F=3 から操作可能。

---

## 5. 入力表現の詳細

### 5.1 イベント化
キー押下/解放をイベントとして扱う:

| キー | イベント |
|---|---|
| ← / → 押下 | `MOVE_L` / `MOVE_R`(DAS/ARR はクライアント側で生成)|
| Z / X 押下 | `ROT_L` / `ROT_R` |
| ↓ 押下 | `SOFT_START` |
| ↓ 解放 | `SOFT_END` |

### 5.2 1フレームに複数アクション
```typescript
{ t: 'INPUT', frame: 42, actions: ['ROT_R', 'MOVE_L'] }
```
**適用順序**: 配列順(決定論)。

---

## 6. デシンク検出

### 6.1 ハッシュ送信
- クライアントは **60 フレームごと**に `STATE_HASH` を送信
- 対象: 全プレイヤーの `(board cells, score, pendingGarbage, phase)` を連結して FNV-1a などで 64bit ハッシュ化

### 6.2 サーバー側判定
```typescript
onStateHash(playerId, frame, hash):
  hashes[frame][playerId] = hash
  if all players submitted for frame:
    unique = new Set(Object.values(hashes[frame]))
    if unique.size > 1:
      broadcast DESYNC_DETECTED { frame, hashes[frame] }
```

### 6.3 クライアント側対応
- `DESYNC_DETECTED` 受信で即座に `finished` へ遷移
- 「通信エラー」を表示

### 6.4 軽減策
- `Math.random`, `Date.now`, `Map` の反復順序等に依存しない
- すべての RNG は共有シード起点の `Xorshift32`
- 浮動小数点演算を `simulator` から排除

---

## 7. 切断・再接続

### 7.1 切断の検知
- Colyseus の `onLeave` で WebSocket 切断を取得
- `consented=true`(明示退出): 即 `PLAYER_DISCONNECTED`
- `consented=false`(通信断): **5 秒の再接続猶予**

### 7.2 再接続メッセージ
```typescript
{ t: 'RECONNECT', reconnectionToken: string }
| { t: 'RECONNECT_OK'; currentFrame: Frame; recentBatches: { frame: Frame; inputs: Record<PlayerId, InputAction[]> }[] }
| { t: 'RECONNECT_REJECTED'; reason: 'TIMEOUT' | 'MATCH_ENDED' | 'UNKNOWN_TOKEN' }
```

### 7.3 再接続フロー
サーバーは**直近 300 フレーム分**(= 5 秒)の `INPUT_BATCH` を保持し、再接続時にスナップショット送信。

---

## 8. マッチ中のプレイヤー管理

| タイミング | 扱い |
|---|---|
| 明示 LEAVE | 即 `PLAYER_DISCONNECTED` ブロードキャスト |
| 5秒猶予中 | 他プレイヤーは入力を待たずに進行(空入力扱い) |
| 猶予超過 | 確定離脱、`status='dead'` |
| 生存者 ≤ 1 | `MATCH_END` ブロードキャスト |

---

## 9. エラーコード一覧

| code | 意味 |
|---|---|
| `LOBBY_FULL` | 同時接続上限 |
| `NICK_TAKEN` | 同一ニックネーム衝突 |
| `ROOM_NOT_FOUND` | ルーム ID 無効 |
| `ROOM_FULL` | 定員到達 |
| `ROOM_IN_MATCH` | 試合中のためルーム参加不可 |
| `BAD_JOIN_CODE` | プライベートルームの合言葉不一致 |
| `NOT_IN_MATCH` | マッチ中でないのに試合メッセージを送信 |
| `FRAME_TOO_OLD` | サーバー想定 frame よりも古すぎる入力 |
| `FRAME_TOO_FUTURE` | 100f以上先の入力 |
| `DESYNC_DETECTED` | ハッシュ不一致 |
| `RECONNECT_TIMEOUT` | 5秒猶予超過 |
| `RATE_LIMIT` | スパム |

---

## 10. マッチメイキング(クイックマッチ)

### 10.1 キュー管理
```typescript
queues: Map<`${Capacity}:${ColorMode}`, PlayerId[]>

onQuickMatch(playerId, cap, color):
  queue = queues.get(`${cap}:${color}`)
  queue.push(playerId)
  if queue.length >= cap:
    selected = queue.splice(0, cap)
    roomId = createMatchRoom(cap, color, selected)
    for p in selected:
      send(p, 'QUICK_MATCH_FOUND', { roomId, ... })
```

### 10.2 長時間待機
60 秒待ってマッチ成立しない場合、クライアント側でキャンセルを促すトーストを出す。

---

## 11. ハートビート(PING/PONG)

- クライアントは **5 秒ごと**に `PING(clientMs)` を送信
- サーバーは `PONG(clientMs, serverMs)` で返す
- 15秒 PING が無ければサーバー側で強制切断

---

## 12. セキュリティ・不正対策(最低限)

| 項目 | 対策 |
|---|---|
| 入力スパム | 1秒あたり 120 INPUT を上限でレート制限 |
| 不正フレーム | `FRAME_TOO_OLD`/`FRAME_TOO_FUTURE` で弾く |
| ニックネーム悪用 | 長さ 1〜12、絵文字・制御文字除外 |
| ルーム乱立 | 1 client あたり同時作成 1 ルームまで |

---

## 13. 数値パラメータまとめ

| 項目 | 値 |
|---|---|
| 入力遅延 | 3 フレーム(50ms @60fps) |
| サーバー入力タイムアウト | 200ms |
| 空入力許容連続数 | 6 フレーム → 警告、30 フレーム → 切断扱い |
| ハッシュ送信間隔 | 60 フレーム(1秒) |
| 再接続猶予 | 5 秒 |
| 再接続用 batch 履歴保持 | 300 フレーム(5 秒) |
| PING 間隔 | 5 秒 |
| PING 欠落タイムアウト | 15 秒 |
| マッチメイキングタイムアウト | 60 秒 |
| カウントダウン長 | 180 フレーム(3 秒) |
| MATCH_START の `dropQueue` 初期送信量 | 1024 組 |

---

## 14. テストケース

### 14.1 プロトコル単体
| # | 内容 | 期待 |
|---|---|---|
| TP-01 | 未入室の client が INPUT 送信 | `NOT_IN_MATCH` |
| TP-02 | frame = -1 の INPUT | `FRAME_TOO_OLD` |
| TP-03 | frame = currentFrame + 200 の INPUT | `FRAME_TOO_FUTURE` |
| TP-04 | 1 client が 1 秒で 200 INPUT 送信 | `RATE_LIMIT` で一部破棄 |

### 14.2 ロビー遷移
| # | 内容 | 期待 |
|---|---|---|
| TL-01 | 同時入室 + CREATE_ROOM → 別 client が JOIN_ROOM | 正常参加 |
| TL-02 | ルーム定員到達後に JOIN_ROOM | `ROOM_FULL` |
| TL-03 | QUICK_MATCH(cap=2,4色) を 2 client がほぼ同時実行 | 両者マッチ成立 |
| TL-04 | QUICK_MATCH 中に CANCEL | キュー除外 |

### 14.3 試合進行
| # | 内容 | 期待 |
|---|---|---|
| TM-01 | MATCH_START 後に 1 client だけ ACK しない | `MATCH_BEGIN` が送られず停滞 → timeout |
| TM-02 | 1 client が INPUT 送信を止める | 200ms 後にサーバーが空入力で INPUT_BATCH 送信、試合継続 |
| TM-03 | 1 client が 10 秒切断 → 再接続 | `PLAYER_DISCONNECTED`、5 秒超過で確定 |
| TM-04 | 1 client が 3 秒切断 → 再接続 | `RECONNECT_OK`、試合継続 |
| TM-05 | STATE_HASH が 4/4 一致 | DESYNC 非発火 |
| TM-06 | STATE_HASH が 3/4 一致 | `DESYNC_DETECTED` ブロードキャスト、マッチ強制終了 |

### 14.4 決定論
| # | 内容 | 期待 |
|---|---|---|
| TD-01 | 同一 seed + 同一 INPUT 列で 2 独立クライアントが simulate | 最終盤面ハッシュ一致 |
| TD-02 | 入力到着順が前後しても、INPUT_BATCH が frame 順で消費 | 結果一致 |
