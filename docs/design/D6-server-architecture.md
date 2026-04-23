# D6. サーバーアーキテクチャ

## 1. 設計原則

| # | 原則 | 理由 |
|---|---|---|
| 1 | **ゲームロジックを持たない** | Server は入力中継に徹し、決定論はクライアント側で担保 |
| 2 | **単一プロセス前提** | 個人運用・月 $5 以下、クラスタリングは不要 |
| 3 | **Colyseus の機能を活用** | Room 管理・再接続・State Schema を自作しない |
| 4 | **永続ストアを最小化** | DB 無し。再起動で消える状態だけ |
| 5 | **観測可能性** | 構造化ログ + Colyseus Monitor で状態を可視化 |

---

## 2. 技術スタック

| 層 | 採用 | 備考 |
|---|---|---|
| ランタイム | **Node.js 22 LTS** | |
| 言語 | TypeScript(strict) | |
| フレームワーク | **Colyseus 0.16+** | Room ベース、WebSocket 内包 |
| HTTP | `express` | ヘルスチェック・Monitor 配信 |
| シリアライズ | MessagePack(Colyseus 既定) | |
| ロギング | `pino` | 構造化 JSON ログ |
| バリデーション | `zod` | 受信メッセージのスキーマ検証 |
| テスト | Vitest + `@colyseus/testing` | |
| コンテナ | Docker | Fly.io/Railway デプロイ用 |

---

## 3. ディレクトリ構成

```
packages/server/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── rooms/
│   │   ├── LobbyRoom.ts
│   │   ├── MatchRoom.ts
│   │   └── schemas/
│   │       ├── LobbyState.ts
│   │       └── MatchState.ts
│   ├── matchmaking/
│   │   └── QuickMatchQueue.ts
│   ├── match/
│   │   ├── InputRelay.ts
│   │   ├── ReconnectBuffer.ts
│   │   └── HashChecker.ts
│   ├── protocol/
│   ├── middleware/
│   │   ├── rateLimit.ts
│   │   └── validate.ts
│   ├── util/
│   │   ├── ids.ts
│   │   ├── rng.ts
│   │   └── logger.ts
│   └── admin/
│       └── health.ts
├── test/
│   ├── LobbyRoom.test.ts
│   ├── MatchRoom.test.ts
│   └── InputRelay.test.ts
├── Dockerfile
├── fly.toml
└── package.json
```

---

## 4. エントリーポイント

```typescript
// src/index.ts
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import express from 'express';
import { createServer } from 'http';
import { LobbyRoom } from './rooms/LobbyRoom';
import { MatchRoom } from './rooms/MatchRoom';
import { config } from './config';
import { logger } from './util/logger';

const app = express();

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

if (config.monitor.enabled) {
  app.use('/monitor', basicAuth(config.monitor.credentials), monitor());
}

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('lobby', LobbyRoom);
gameServer.define('match', MatchRoom).filterBy(['roomId']);

gameServer.listen(config.port);
logger.info({ port: config.port }, 'server listening');
```

### 4.1 環境変数
| 変数 | 既定 | 意味 |
|---|---|---|
| `PORT` | 2567 | WebSocket/HTTP ポート |
| `ALLOWED_ORIGINS` | `*` | CORS |
| `MONITOR_ENABLED` | `false` | `/monitor` を有効化 |
| `MONITOR_USER`/`MONITOR_PASS` | — | Basic 認証 |
| `LOG_LEVEL` | `info` | pino ログレベル |
| `MAX_ROOMS` | 100 | 同時作成可能ルーム数の上限 |

---

## 5. LobbyRoom

### 5.1 責務
- ロビーに入室したプレイヤーへ**ルーム一覧**を配信
- `CREATE_ROOM` / `JOIN_ROOM` / `QUICK_MATCH` の受付
- 実際の試合は **MatchRoom** を新規作成して、join URL を返す

### 5.2 State
```typescript
class RoomSummarySchema extends Schema {
  @type('string')  roomId = '';
  @type('string')  name = '';
  @type('number')  capacity = 2;
  @type('number')  colorMode = 4;
  @type('number')  players = 0;
  @type('boolean') isPrivate = false;
  @type('string')  status: 'lobby'|'countdown'|'running' = 'lobby';
}

class LobbyState extends Schema {
  @type({ map: RoomSummarySchema }) rooms = new MapSchema<RoomSummarySchema>();
}
```

### 5.3 実装骨子
```typescript
class LobbyRoom extends Room<LobbyState> {
  maxClients = 200;
  private quickMatchQueue = new QuickMatchQueue();

  onCreate() {
    this.setState(new LobbyState());
    this.setPatchRate(500);

    this.onMessage('JOIN_LOBBY',   (c, m) => this.onJoinLobby(c, m));
    this.onMessage('CREATE_ROOM',  (c, m) => this.onCreateRoom(c, m));
    this.onMessage('JOIN_ROOM',    (c, m) => this.onJoinRoom(c, m));
    this.onMessage('QUICK_MATCH',  (c, m) => this.onQuickMatch(c, m));
    this.onMessage('CANCEL_QUICK_MATCH', (c) => this.quickMatchQueue.remove(c.sessionId));

    this.clock.setInterval(() => this.pruneDeadRooms(), 30_000);
  }
}
```

### 5.4 MatchRoom とのライフサイクル連動
プロセス内 EventEmitter で MatchRoom ↔ LobbyRoom を連動:
```typescript
// util/lobbyBus.ts
export const lobbyBus = new EventEmitter();
// MatchRoom 側
lobbyBus.emit('room:update', { roomId, players: this.players.size, status: 'running' });
// LobbyRoom 側
lobbyBus.on('room:update', (p) => this.state.rooms.get(p.roomId)?.assign(p));
```

---

## 6. MatchRoom

### 6.1 責務
- プレイヤーの入退室管理(最大 capacity)
- READY 状態、カウントダウン
- `MATCH_START` でシード・ドロップキュー配信
- **入力中継**(InputRelay)
- デシンク検出(HashChecker)
- 再接続対応

### 6.2 State
```typescript
class MatchPlayerSchema extends Schema {
  @type('string') playerId = '';
  @type('string') nickname = '';
  @type('string') characterId = '';
  @type('number') slotIndex = 0;
  @type('boolean') ready = false;
  @type('boolean') connected = true;
}

class MatchRoomState extends Schema {
  @type(MatchConfigSchema) config = new MatchConfigSchema();
  @type({ map: MatchPlayerSchema }) players = new MapSchema<MatchPlayerSchema>();
  @type('string') status: 'lobby'|'countdown'|'running'|'finished' = 'lobby';
}
```

### 6.3 骨子
```typescript
class MatchRoom extends Room<MatchRoomState> {
  maxClients = 4;
  autoDispose = false;

  private inputRelay!: InputRelay;
  private hashChecker!: HashChecker;
  private reconnectBuffer!: ReconnectBuffer;

  onCreate(opts: MatchCreateOptions) {
    this.setState(new MatchRoomState());
    this.state.config.assign(opts);
    this.maxClients = opts.capacity;
    this.roomId = opts.roomId;

    this.onMessage('SET_READY',   (c, m) => this.onSetReady(c, m));
    this.onMessage('MATCH_ACK',   (c) => this.onMatchAck(c));
    this.onMessage('INPUT',       (c, m) => this.onInput(c, m));
    this.onMessage('STATE_HASH',  (c, m) => this.hashChecker.submit(c, m));
    this.onMessage('PING',        (c, m) => c.send('PONG', { clientMs: m.clientMs, serverMs: Date.now() }));
    this.onMessage('LEAVE_MATCH', (c) => c.leave(1000, 'consented'));
  }

  onJoin(client: Client, opts: MatchJoinOptions) {
    if (this.state.status !== 'lobby')
      return client.leave(4001, 'MATCH_IN_PROGRESS');

    const slot = this.assignSlot();
    const player = new MatchPlayerSchema().assign({
      playerId: client.sessionId,
      nickname: sanitize(opts.nickname),
      characterId: opts.characterId,
      slotIndex: slot,
    });
    this.state.players.set(client.sessionId, player);
  }

  async onLeave(client: Client, consented: boolean) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;

    if (this.state.status === 'running') {
      p.connected = false;
      try {
        await this.allowReconnection(client, 5);
        p.connected = true;
        this.sendReconnectSnapshot(client);
      } catch {
        this.markEliminated(client.sessionId, 'DISCONNECT');
      }
    } else {
      this.state.players.delete(client.sessionId);
      this.cancelCountdownIfNeeded();
    }
  }
}
```

### 6.4 READY → カウントダウン → 開始
```typescript
private checkAllReady() {
  const all = Array.from(this.state.players.values());
  const full = all.length === this.state.config.capacity;
  const ready = all.every(p => p.ready && p.connected);
  if (full && ready) this.startCountdown();
}

private startCountdown() {
  this.state.status = 'countdown';
  this.broadcast('COUNTDOWN_START', { durationFrames: 180, serverStartMs: Date.now() });
  this.countdownTimer = this.clock.setTimeout(() => this.beginMatch(), 3000);
}

private beginMatch() {
  this.matchSeed = generateMatchSeed();
  this.dropQueue = generateDropQueue(this.matchSeed, 1024, this.state.config.colorMode);
  const playerOrder = Array.from(this.state.players.values())
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map(p => p.playerId);

  this.broadcast('MATCH_START', {
    seed: this.matchSeed,
    dropQueue: this.dropQueue,
    playerOrder,
    startFrameMs: Date.now() + 200,
  });

  this.inputRelay = new InputRelay(playerOrder, (frame, batch) => {
    this.broadcast('INPUT_BATCH', { frame, inputs: batch });
    this.reconnectBuffer.record(frame, batch);
  });
  this.reconnectBuffer = new ReconnectBuffer(300);
  this.hashChecker = new HashChecker(playerOrder, (frame, hashes) => {
    this.broadcast('DESYNC_DETECTED', { frame, hashes });
    this.endMatch(null);
  });
}
```

---

## 7. InputRelay(入力中継の核心)

### 7.1 責務
- 全プレイヤーから frame F の INPUT を集約
- 揃い次第 `INPUT_BATCH` をブロードキャスト
- タイムアウト(200ms)で揃わない場合、空入力で埋めて確定

### 7.2 実装
```typescript
export class InputRelay {
  private buffers = new Map<Frame, Map<PlayerId, InputAction[]>>();
  private firstArrivalAt = new Map<Frame, number>();
  private frameTimers = new Map<Frame, Delayed>();
  private missCounts = new Map<PlayerId, number>();
  private currentFrame = 0;

  submit(playerId: PlayerId, frame: Frame, actions: InputAction[]) {
    if (!this.running) return;
    let m = this.buffers.get(frame);
    if (!m) {
      m = new Map();
      this.buffers.set(frame, m);
      this.firstArrivalAt.set(frame, Date.now());
      this.frameTimers.set(frame, clock.setTimeout(() => this.forceFlush(frame), 200));
    }
    if (m.has(playerId)) return;
    m.set(playerId, actions);
    if (m.size === this.cfg.playerOrder.length) this.flush(frame);
  }

  private flush(frame: Frame) {
    const m = this.buffers.get(frame);
    if (!m) return;

    const out: Record<PlayerId, InputAction[]> = {};
    for (const pid of this.cfg.playerOrder) {
      const actions = m.get(pid);
      if (actions === undefined) {
        out[pid] = [];
        this.incrementMiss(pid);
      } else {
        out[pid] = actions;
        this.missCounts.set(pid, 0);
      }
    }

    if (frame >= this.currentFrame) this.currentFrame = frame + 1;
    this.onBatchReady(frame, out);
  }

  private incrementMiss(pid: PlayerId) {
    const n = (this.missCounts.get(pid) ?? 0) + 1;
    this.missCounts.set(pid, n);
    if (n >= 30) {
      this.onPlayerTimeout(pid);
      this.missCounts.set(pid, 0);
    }
  }
}
```

### 7.3 特性
- **揃えば即送信**(低遅延、通常パス)
- **タイムアウト 200ms で強制送信**
- **連続 30 フレーム欠落**で切断判定

---

## 8. HashChecker(デシンク検出)

```typescript
export class HashChecker {
  private buffer = new Map<Frame, Map<PlayerId, string>>();

  submit(client: Client, msg: { frame: Frame; hash: string }) {
    let m = this.buffer.get(msg.frame);
    if (!m) { m = new Map(); this.buffer.set(msg.frame, m); }
    m.set(client.sessionId, msg.hash);

    if (m.size === this.playerOrder.length) {
      const hashes = Object.fromEntries(m);
      const unique = new Set(Object.values(hashes));
      if (unique.size > 1) this.onMismatch(msg.frame, hashes);
      this.buffer.delete(msg.frame);
    }
  }
}
```

---

## 9. 再接続

### 9.1 Colyseus の `allowReconnection`
```typescript
async onLeave(client, consented) {
  const p = this.state.players.get(client.sessionId);
  if (!p || this.state.status !== 'running') return;

  p.connected = false;
  this.broadcast('PLAYER_DISCONNECTED', { playerId: client.sessionId });

  try {
    const newClient = await this.allowReconnection(client, 5);
    p.connected = true;
    this.broadcast('PLAYER_RECONNECTED', { playerId: newClient.sessionId });
    this.sendReconnectSnapshot(newClient);
  } catch {
    this.markEliminated(client.sessionId, 'DISCONNECT');
  }
}
```

### 9.2 ReconnectBuffer
```typescript
export class ReconnectBuffer {
  private ring: Array<{ frame: Frame; inputs: Record<PlayerId, InputAction[]> } | null>;
  private head = 0;

  constructor(private capacity: number) {
    this.ring = new Array(capacity).fill(null);
  }

  record(frame: Frame, inputs: Record<PlayerId, InputAction[]>) {
    this.ring[this.head] = { frame, inputs };
    this.head = (this.head + 1) % this.capacity;
  }

  range(from: Frame, to: Frame) {
    return this.ring
      .filter((e): e is NonNullable<typeof e> => e !== null && e.frame >= from && e.frame < to)
      .sort((a, b) => a.frame - b.frame);
  }
}
```

---

## 10. マッチメイキング

### 10.1 QuickMatchQueue
```typescript
export class QuickMatchQueue {
  private queues = new Map<string, { sessionId: string; enqueuedAt: number }[]>();

  enqueue(sessionId: string, cfg: { capacity: Capacity; colorMode: ColorMode }): { matched: boolean; players?: string[] } {
    const key = `${cfg.capacity}:${cfg.colorMode}`;
    const q = this.queues.get(key) ?? [];
    if (q.find(e => e.sessionId === sessionId)) return { matched: false };
    q.push({ sessionId, enqueuedAt: Date.now() });

    if (q.length >= cfg.capacity) {
      const selected = q.splice(0, cfg.capacity).map(e => e.sessionId);
      this.queues.set(key, q);
      return { matched: true, players: selected };
    }
    this.queues.set(key, q);
    return { matched: false };
  }
}
```

---

## 11. レート制限・バリデーション

### 11.1 トークンバケット
```typescript
class RateLimiter {
  private buckets = new WeakMap<Client, { tokens: number; lastRefill: number }>();

  allow(client: Client, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(client) ?? { tokens: 60, lastRefill: now };
    const elapsed = (now - b.lastRefill) / 1000;
    b.tokens = Math.min(60, b.tokens + elapsed * 60);
    b.lastRefill = now;
    if (b.tokens < cost) { this.buckets.set(client, b); return false; }
    b.tokens -= cost;
    this.buckets.set(client, b);
    return true;
  }
}
```

### 11.2 zod でペイロード検証
```typescript
const InputMsgSchema = z.object({
  frame: z.number().int().nonnegative(),
  actions: z.array(z.enum(['MOVE_L','MOVE_R','ROT_L','ROT_R','SOFT_START','SOFT_END'])).max(8),
});
```

---

## 12. ロギング

### 12.1 構造化ログ(pino)
```typescript
logger.info({ roomId, playerId, event: 'match_start' }, 'match started');
logger.warn({ frame, player: pid }, 'input timeout');
logger.error({ err, roomId }, 'unexpected match error');
```

### 12.2 ログレベル運用
- **info**: マッチ開始/終了、切断、入退室
- **warn**: 入力タイムアウト、欠落、レート制限ヒット
- **error**: 例外、デシンク検出、ディスパッチ失敗

---

## 13. デプロイ

### 13.1 Dockerfile
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY pnpm-lock.yaml package.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm -F server build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/server/node_modules ./node_modules
EXPOSE 2567
CMD ["node", "dist/index.js"]
```

### 13.2 Fly.io(推奨)
```toml
app = "chaindrop-server"
primary_region = "nrt"

[http_service]
  internal_port = 2567
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

### 13.3 CORS・セキュリティヘッダ
```typescript
app.use(cors({ origin: config.allowedOrigins, credentials: true }));
app.disable('x-powered-by');
```

---

## 14. テスト

### 14.1 単体(Vitest)
- `InputRelay`: 集約・タイムアウト・欠落カウント
- `ReconnectBuffer`: ring buffer の境界
- `HashChecker`: 一致/不一致
- `QuickMatchQueue`: enqueue/マッチ成立/キャンセル

### 14.2 ルーム統合(`@colyseus/testing`)
```typescript
describe('MatchRoom', () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => colyseus = await boot(appConfig));
  afterAll(() => colyseus.shutdown());

  it('starts match when all players ready', async () => {
    const room = await colyseus.createRoom('match', { capacity: 2, colorMode: 4, roomId: 'r1' });
    const c1 = await colyseus.connectTo(room, { nickname: 'A' });
    const c2 = await colyseus.connectTo(room, { nickname: 'B' });

    c1.send('SET_READY', { ready: true });
    c2.send('SET_READY', { ready: true });

    await new Promise(r => setTimeout(r, 200));
    expect(room.state.status).toBe('countdown');
  });
});
```

### 14.3 負荷テスト
- 4 clients × 10 rooms 同時接続
- 目標: 単一インスタンスで 32 同時プレイヤー

---

## 15. スケール考慮(将来)

| 規模 | 対応策 |
|---|---|
| 〜32人(8ルーム) | 単一インスタンス、現構成のまま |
| 〜200人(50ルーム) | Colyseus の redis-driver を有効化、複数 process |
| それ以上 | Colyseus Cloud 検討 |

---

## 16. エッジケース対応表

| ケース | 対応 |
|---|---|
| 同一 nickname で LobbyRoom 入室 | 自動でサフィックス追加 |
| CREATE_ROOM 後に作成者が離脱 | MatchRoom は存続、空室なら 60 秒後 autoDispose |
| MATCH_ACK が届かない client がいる | 10 秒タイムアウトで ERROR → マッチ中止 |
| 4 人中 1 人が切断 → 再接続失敗 | 生存者で続行、`status='dead'` 扱い |
| LobbyRoom 自体の再起動 | 全 client 再接続が必要 |
