# D5. クライアントアーキテクチャ

## 1. 設計原則

| # | 原則 | 理由 |
|---|---|---|
| 1 | **シミュレーションと描画の分離** | 60FPS 固定論理 + 可変 FPS 描画の両立、決定論の保全 |
| 2 | **単方向データフロー** | 入力 → simulator → state → renderer |
| 3 | **ネット/ローカルの対称性** | ソロ/オンラインで同じ `simulator` を使う |
| 4 | **DOM/Canvas ハイブリッド** | メニュー = React(DOM)、ゲームプレイ = PixiJS |
| 5 | **シーン単位のライフサイクル** | 入る・出る を明示的に記述 |
| 6 | **shared は client に依存しない** | `shared/rules` は副作用なし、I/Oなし |

---

## 2. レイヤー構成

```
┌────────────────────────────────────────────────────────────────┐
│  UI Layer (React, DOM)                                         │
│    - タイトル/ロビー/ルーム/リザルト/設定 画面                  │
│    - マッチ中オーバーレイ                                       │
└───────────────────────┬────────────────────────────────────────┘
                        │ subscribe
┌───────────────────────▼────────────────────────────────────────┐
│  Store (Zustand)                                               │
│    - sessionStore / lobbyStore / matchStore                    │
└──┬────────────────────┬─────────────────────────┬──────────────┘
   │ read               │ update                 │ read
┌──▼─────────┐     ┌────▼────────┐         ┌─────▼─────┐
│ Renderer   │     │ Simulator   │         │ Scene     │
│ (PixiJS)   │◀────│ (shared/    │         │ Manager   │
│            │     │  rules 呼出) │         │           │
└────────────┘     └─────▲───────┘         └─────┬─────┘
                         │                       │
                    ┌────┴────┐                  │
                    │         │                  │
               ┌────▼───┐ ┌───▼────┐       ┌─────▼─────┐
               │ Input  │ │ Net    │       │ Asset     │
               │ System │ │ Adapter│       │ Loader    │
               └────────┘ └────────┘       └───────────┘
```

---

## 3. ディレクトリ構成

```
packages/client/src/
├── main.tsx                  // エントリーポイント
├── App.tsx                   // SceneManager マウント、Providers
├── config.ts                 // 定数(FPS, レイアウト等)
│
├── store/
│   ├── session.ts
│   ├── lobby.ts
│   └── match.ts
│
├── scenes/
│   ├── SceneManager.tsx
│   ├── TitleScene.tsx
│   ├── ModeSelectScene.tsx
│   ├── CharacterSelectScene.tsx
│   ├── LobbyScene.tsx
│   ├── RoomScene.tsx
│   ├── MatchScene.tsx
│   └── ResultScene.tsx
│
├── renderer/
│   ├── PixiApp.ts
│   ├── layers/
│   │   ├── FieldLayer.ts
│   │   ├── EffectsLayer.ts
│   │   ├── CharacterLayer.ts
│   │   └── BackgroundLayer.ts
│   ├── puyo/
│   │   ├── PuyoSprite.ts
│   │   └── PuyoAnimator.ts
│   ├── ui/
│   │   ├── ChainText.ts
│   │   ├── GarbageBar.ts
│   │   └── ScoreText.ts
│   └── tween.ts
│
├── simulator/
│   ├── LocalSimulator.ts
│   ├── NetworkSimulator.ts
│   └── FrameScheduler.ts
│
├── input/
│   ├── KeyboardInput.ts
│   ├── DasArr.ts
│   └── keybindings.ts
│
├── net/
│   ├── ColyseusClient.ts
│   ├── LobbyConnection.ts
│   ├── MatchConnection.ts
│   └── protocol.ts
│
├── assets/
│   ├── manifest.ts
│   ├── AssetLoader.ts
│   └── audio/
│       └── SoundManager.ts
│
├── ui/
│   ├── components/
│   └── styles/
│
├── storage/
│   ├── localStorage.ts
│   └── schema.ts
│
└── telemetry/
    └── logger.ts
```

---

## 4. 状態管理(Zustand)

### 4.1 採用理由
- React と相性よし、Provider 不要
- Canvas 側からも `useStore.getState()` で同期アクセス可

### 4.2 ストア分割

#### sessionStore — 永続化される個人設定
```typescript
interface SessionState {
  nickname: string;
  characterId: string;
  keybindings: Record<InputAction, string>;
  audio: { bgm: number; se: number };
  lastColorMode: ColorMode;

  setNickname: (n: string) => void;
  setCharacter: (id: string) => void;
  setKeybind: (action: InputAction, key: string) => void;
  setVolume: (kind: 'bgm'|'se', v: number) => void;
}
```

#### lobbyStore — オンラインロビーの現状
```typescript
interface LobbyState {
  connection: 'disconnected' | 'connecting' | 'connected';
  rooms: RoomSummary[];
  myPlayerId: PlayerId | null;

  connect: () => Promise<void>;
  disconnect: () => void;
  refreshRooms: () => void;
}
```

#### matchStore — 試合中の state(描画用 projection)
```typescript
interface MatchStoreState {
  phase: 'idle' | 'countdown' | 'running' | 'finished';
  frame: Frame;
  players: Record<PlayerId, PlayerViewModel>;
  myPlayerId: PlayerId | null;
  latencyMs: number;
}

interface PlayerViewModel {
  playerId: PlayerId;
  nickname: string;
  characterId: string;
  slotIndex: number;
  score: number;
  pendingGarbage: number;
  status: 'playing' | 'dead' | 'spectating';
  phase: PhaseKind;
  chainCount: number;
  boardSnapshot: readonly (readonly Cell[])[];
}
```

### 4.3 simulator → store の反映
```typescript
useMatchStore.setState({
  frame: match.frame,
  players: projectPlayers(match.players),
  phase: match.status,
});
```

**注意**: `boardSnapshot` は `simulator` の内部 array を**コピー**する(参照共有すると React が再レンダしない)。

---

## 5. シーン管理

### 5.1 遷移モデル
```typescript
type SceneKind =
  | 'title' | 'modeSelect' | 'characterSelect'
  | 'lobby' | 'room' | 'match' | 'result';

interface SceneDescriptor {
  kind: SceneKind;
  params?: Record<string, unknown>;
}

const [current, setCurrent] = useState<SceneDescriptor>({ kind: 'title' });

function transitionTo(next: SceneDescriptor) {
  currentScene?.onExit?.();
  setCurrent(next);
}
```

### 5.2 シーン契約
```typescript
interface Scene {
  onEnter(params: unknown): Promise<void>;
  onExit(): void;
  render(): JSX.Element;
}
```

### 5.3 遷移時のガード
- 現在シーンが受理可能なネットワークメッセージのみを購読
- React の unmount 時に**必ず**ネットワーク購読を解除(`useEffect` の cleanup)

### 5.4 MatchScene の内部構造
```tsx
function MatchScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const pixi = new PixiApp(canvasRef.current!);
    const scheduler = new FrameScheduler(simulator, pixi);
    scheduler.start();
    return () => { scheduler.stop(); pixi.destroy(); };
  }, []);

  return (
    <div className="match-scene">
      <canvas ref={canvasRef} />
      <MatchOverlay />
    </div>
  );
}
```

---

## 6. 描画レイヤー(PixiJS)

### 6.1 レイヤー階層
```
PixiApp.stage
  ├─ BackgroundLayer      (z=0)
  ├─ CharacterLayer       (z=10)
  ├─ FieldLayer[p1..p4]   (z=20)
  ├─ EffectsLayer         (z=30)
  └─ OverlayLayer         (z=40)
```

### 6.2 FieldLayer の設計
```typescript
class FieldLayer extends PIXI.Container {
  constructor(private playerId: PlayerId, private isMain: boolean) { ... }

  update(vm: PlayerViewModel, interp: number) {
    // 1. boardSnapshot を diff して PuyoSprite を生成/破棄
    // 2. 現在落下中の組ぷよを描画
    // 3. 連鎖中のぷよは「消える途中」フレーム補間
  }
}
```

### 6.3 補間(描画の滑らかさ)
```typescript
function render(alpha: number) {
  // 落下中のぷよ y 座標を (prevY + (currY - prevY) * alpha) で描画
}
```

### 6.4 解像度とスケーリング
- 内部解像度: **1280 × 720**(固定)
- ウィンドウサイズに合わせて**等比スケール**

---

## 7. 入力システム

### 7.1 階層
```
DOM KeyEvent → KeyboardInput → DasArr → InputBuffer → Simulator or NetSend
```

### 7.2 KeyboardInput
```typescript
class KeyboardInput {
  private pressed: Set<string> = new Set();
  private pendingEvents: InputEvent[] = [];

  constructor(bindings: KeyBindings) { /* addEventListener */ }

  consume(): InputAction[] {
    const out = this.pendingEvents.flatMap(e => this.translate(e));
    this.pendingEvents = [];
    return [...out, ...this.dasArr.tick(this.pressed)];
  }
}
```

### 7.3 DAS/ARR
```typescript
class DasArr {
  private holdingDir: 'L' | 'R' | null = null;
  private holdFrames = 0;

  tick(pressed: Set<string>): InputAction[] {
    const newDir = pressed.has('ArrowLeft') ? 'L' : pressed.has('ArrowRight') ? 'R' : null;
    if (newDir !== this.holdingDir) { this.holdingDir = newDir; this.holdFrames = 0; return []; }
    if (!newDir) return [];
    this.holdFrames++;
    if (this.holdFrames === 15) return [newDir === 'L' ? 'MOVE_L' : 'MOVE_R'];      // DAS
    if (this.holdFrames > 15 && (this.holdFrames - 15) % 3 === 0)                    // ARR
      return [newDir === 'L' ? 'MOVE_L' : 'MOVE_R'];
    return [];
  }
}
```

---

## 8. ネットワーク層

### 8.1 Colyseus ラッパ
```typescript
class ColyseusClient {
  private client: Client;

  async joinLobby(nickname: string): Promise<LobbyConnection> { ... }
  async joinMatch(roomId: string): Promise<MatchConnection> { ... }
  async reconnect(token: string): Promise<MatchConnection> { ... }
}
```

### 8.2 MatchConnection
```typescript
class MatchConnection {
  sendInput(frame: Frame, actions: InputAction[]): void;
  sendStateHash(frame: Frame, hash: string): void;
  sendReady(ready: boolean): void;

  on(event: 'MATCH_START', fn: (msg: MatchStartMsg) => void): void;
  on(event: 'INPUT_BATCH', fn: (msg: InputBatchMsg) => void): void;
  on(event: 'MATCH_END', fn: (msg: MatchEndMsg) => void): void;

  getLatency(): number;
  isReconnecting(): boolean;
}
```

### 8.3 ソロ時
`MatchConnection` の代わりに `LocalMatchSource` を差し込む。**simulator はソロ/オンラインを意識しない**。

---

## 9. アセット管理

### 9.1 AssetLoader
```typescript
class AssetLoader {
  private loaded = new Map<string, unknown>();
  private progress = 0;

  async loadGroup(group: 'common' | 'match' | 'character' | 'audio'): Promise<void> { ... }
  get<T>(id: string): T { ... }
}
```

### 9.2 ロードタイミング
| グループ | 内容 | いつ |
|---|---|---|
| `common` | UI 素材、フォント | アプリ起動時 |
| `character` | 立ち絵 10キャラ分 | CharacterSelect 入る時 |
| `match` | ぷよスプライト、フィールド枠 | MatchScene 入る時 |
| `audio` | BGM/SE | Title 到達時にバックグラウンドロード |

---

## 10. ローカル永続化(localStorage)

詳細は D9 参照。

### 10.1 キー設計
| キー | 内容 |
|---|---|
| `chaindrop:profile` | ユーザープロファイル |
| `chaindrop:settings` | 設定 |
| `chaindrop:lastSession` | 再接続用 |
| `chaindrop:stats` | ローカル統計 |

---

## 11. 主要インターフェース(契約)

### 11.1 MatchSource
```typescript
interface MatchSource {
  readonly playerOrder: PlayerId[];
  readonly myPlayerId: PlayerId;
  readonly seed: number;
  readonly dropQueue: [PuyoColor, PuyoColor][];
  readonly colorMode: ColorMode;

  submitInput(frame: Frame, actions: InputAction[]): void;
  getInputBatch(frame: Frame): InputBatch | null;

  onMatchEnd(fn: (result: MatchEndResult) => void): void;
}
```

### 11.2 Simulator
```typescript
interface Simulator {
  readonly match: MatchState;
  advanceFrame(inputs: InputBatch): void;
  computeHash(): string;
}
```

### 11.3 Renderer
```typescript
interface Renderer {
  setViewModels(vms: PlayerViewModel[]): void;
  render(alpha: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
```

---

## 12. ゲームループ(FrameScheduler)

```typescript
class FrameScheduler {
  private accumulator = 0;
  private lastTs = 0;
  private raf = 0;

  start() { this.loop(performance.now()); }
  stop()  { cancelAnimationFrame(this.raf); }

  private loop(ts: number) {
    const dt = ts - this.lastTs; this.lastTs = ts;
    this.accumulator += Math.min(dt, 250);

    while (this.accumulator >= FRAME_MS) {
      const frame = this.simulator.match.frame;
      const batch = this.source.getInputBatch(frame);
      if (batch === null) break;

      const myActions = this.input.consume();
      this.source.submitInput(frame + 3, myActions);

      this.simulator.advanceFrame(batch);
      if (frame % 60 === 0 && this.net) {
        this.net.sendStateHash(frame, this.simulator.computeHash());
      }
      this.accumulator -= FRAME_MS;
    }

    this.renderer.render(this.accumulator / FRAME_MS);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }
}
```

---

## 13. エラーハンドリング・ロギング

### 13.1 エラー分類
| 種類 | 扱い |
|---|---|
| ネットワーク切断 | Toast + 接続バッジを赤に、自動再接続 |
| デシンク | 即座に ResultScene へ、エラーメッセージ |
| アセットロード失敗 | タイトルに戻し、再試行ダイアログ |
| 未捕捉 JS エラー | `window.onerror` で収集、ローカルログ保存 |

### 13.2 デバッグ機能
- `?debug=1` URL param で **デシンクモニタ**、**入力ダンプ**、**フレームハッシュ**を表示
- `?replay=<id>` でリプレイ再生(将来機能)

---

## 14. 依存関係ルール(静的検査)

| from → to | 可否 |
|---|---|
| `shared/rules` → `client/*` | ✗(絶対NG)|
| `simulator/*` → `renderer/*` | ✗ |
| `renderer/*` → `simulator/*` | ✗(ViewModel経由のみ)|
| `scenes/*` → `store/*` | ✓ |
| `store/*` → `scenes/*` | ✗ |
| `net/*` → `simulator/*` | ✗(MatchSource経由)|

---

## 15. テスト方針

| レイヤー | テスト手法 | ツール |
|---|---|---|
| `shared/rules` | 純関数ユニットテスト | Vitest |
| `simulator` | 入力列 → 最終状態のスナップショット | Vitest |
| `store` | 状態遷移のシナリオテスト | Vitest + `@testing-library/react` |
| `net adapter` | モック Colyseus サーバーとの送受信 | Vitest |
| `input` | KeyEvent 列 → InputAction 列 | Vitest |
| `renderer` | スモーク(画面が描画されるか) | Playwright |
| end-to-end | 2 ブラウザインスタンスで 1v1 を遊ぶ | Playwright |
