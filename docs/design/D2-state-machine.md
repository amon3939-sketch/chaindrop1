# D2. ゲームフェーズ状態機械

## 1. 階層構造

状態機械は**マッチ**と**プレイヤー**の 2 階層。

```
MatchState
  ├─ 'lobby'       (マッチ開始前、ルーム内)
  ├─ 'countdown'   (3,2,1 表示中)
  ├─ 'running'     ← この中で各プレイヤーが独自のフェーズを持つ
  └─ 'finished'    (リザルト画面)

PlayerState (MatchState='running' 中のみ更新)
  ├─ 'spawn'       (組ぷよ生成)
  ├─ 'falling'     (操作可能・落下中)
  ├─ 'chigiri'     (設置後の独立落下演出)
  ├─ 'resolving'   (連鎖判定・消去・重力)
  ├─ 'waitGarbage' (おじゃま落下)
  ├─ 'dead'        (敗北演出中)
  └─ 'spectating'  (観戦)
```

---

## 2. マッチ state machine

```
  lobby ─ 全員READY & 満員 ──▶ countdown ─ 180f後 ──▶ running
    ▲                              │                    │
    │                              │ 誰か離脱           │ 生存者 ≦ 1
    │                              ▼                    ▼
    └──────────────────────── (中止)              finished
                                                        │
                                                   30s or 全員退室
                                                        ▼
                                                      lobby
```

| フェーズ | 継続フレーム | 開始トリガ | 終了トリガ |
|---|---|---|---|
| `lobby` | 任意 | ルーム入室 | 全員 READY かつ満員 |
| `countdown` | **180f**(3秒) | マッチ開始決定 | 180f 経過 |
| `running` | 任意 | countdown 終了 | 生存プレイヤー ≤ 1 |
| `finished` | 最大 1800f(30秒) | running 終了 | 全員退室 or タイマー |

---

## 3. プレイヤー state machine(running 中)

### 3.1 遷移図

```
               ┌─────────────────────────────────────┐
               ▼                                     │
   ┌──────────────────┐                              │
   │      spawn       │── 窒息 ──▶ dead              │
   └────────┬─────────┘                              │
            │ spawn OK                               │
            ▼                                        │
   ┌──────────────────┐                              │
   │     falling      │                              │
   │ (操作可能)       │                              │
   └────────┬─────────┘                              │
            │ ロック                                 │
            ▼                                        │
   ┌──────────────────┐                              │
   │ (重力で落差あり) │                              │
   │      chigiri     │── 12f ──┐                    │
   └────────┬─────────┘         │                    │
            │ 落差なし          │                    │
            ▼                   ▼                    │
   ┌──────────────────┐                              │
   │    resolving     │◀──────┐                      │
   │ (連鎖1周分)      │       │ 連鎖継続             │
   └────────┬─────────┘───────┘                      │
            │ 連鎖終了                               │
            ▼                                        │
   ┌──────────────────┐                              │
   │   waitGarbage    │                              │
   │ (おじゃま落下)   │                              │
   └────────┬─────────┘                              │
            │                                        │
            └────────────────────────────────────────┘

         dead ── 60f ──▶ spectating
```

---

### 3.2 各フェーズ詳細

#### 3.2.1 `spawn`(組ぷよ生成)
| 項目 | 値 |
|---|---|
| 継続フレーム | **1f** |
| 開始処理 | ツモキューから次のペアを取り出す。軸 `(2,12)` / 子 `(2,11)` に配置 |
| 遷移先 | `(2,11)` が空 → `falling` / 埋まっている → `dead` |
| 入力受付 | 不可(次の `falling` で受付開始) |

#### 3.2.2 `falling`(落下・操作)
| 項目 | 値 |
|---|---|
| 継続フレーム | 可変(ロックまで) |
| 開始処理 | `fallTimer = 0`, `lockTimer = 0`, `lockResets = 0` |
| 終了処理 | 設置: `board` に軸と子を書き込み → 重力適用 → 落差判定 |
| 遷移先 | 落差あり → `chigiri` / なし → `resolving` |
| 入力受付 | L / R / 回転(Z, X) / ↓ (ソフトドロップ) / Esc |

**毎フレームの処理順序**:
```
1. 入力処理
   - L/R: DAS/ARR に従って軸座標を更新
   - Z/X: 回転処理、成功なら lockTimer = 0
   - ↓:   soft = true (押下中)
2. 重力処理
   - softDrop なら fallSpeed = 2f/マス、通常は 30f/マス
3. 接地判定
   - 軸または子のすぐ下が床 or 他ぷよ → 接地
4. ロック処理
   - 接地中は lockTimer++
   - 入力で位置/回転が変わったら lockTimer=0、lockResets++
   - lockTimer >= 15 または lockResets >= 8 → ロック確定
```

#### 3.2.3 `chigiri`(ちぎり演出)
| 項目 | 値 |
|---|---|
| 継続フレーム | **12f** 固定 |
| 開始処理 | 独立重力で最終位置を計算し、アニメーション開始位置と目標位置を確定 |
| 終了処理 | なし(盤面は開始時に確定) |
| 遷移先 | `resolving` |
| 入力受付 | Esc のみ |

> 設計上のポイント: **盤面状態はロック時点で確定**しておき、演出のみを 12f かける。

#### 3.2.4 `resolving`(連鎖 1 周)
| 項目 | 値 |
|---|---|
| 継続フレーム | 1 周 **25f**(消去 15f + 重力 10f)、または クラスタなし時 **1f** |
| 開始処理 | `findClusters()` 実行 |
| 終了処理 | 消去対象を null 化 → 重力適用 → 連鎖カウント++ → スコア加算 → おじゃま送信処理 |
| 遷移先 | 次周回でクラスタあり → `resolving` 再開 / なし → `waitGarbage` |
| 入力受付 | Esc のみ |

**1周の内訳**:
```
frame 0       : クラスタ検出(即時)
frame 0..14   : 消去アニメーション(15f)
frame 14      : 盤面から消去対象を null 化
frame 15..24  : 落下(重力)アニメーション(10f)
frame 24      : 連鎖確定 → スコア計算、おじゃま送信、相殺処理
frame 25      : 次周回へ
```

**送信タイミング**: 各連鎖の確定フレームで**段階的に**おじゃまを送る(1連鎖ごとに送信)。

#### 3.2.5 `waitGarbage`(おじゃま落下)
| 項目 | 値 |
|---|---|
| 継続フレーム | `pendingGarbage > 0` → **18f** / `== 0` → **0f**(スキップ) |
| 開始処理 | `dropOjama(board, pendingGarbage, rng)` を呼び、配置を確定 |
| 終了処理 | `pendingGarbage = remaining`(溢れ分の持越し) |
| 遷移先 | `spawn` |
| 入力受付 | Esc のみ |

#### 3.2.6 `dead`(敗北演出)
| 項目 | 値 |
|---|---|
| 継続フレーム | **60f**(約1秒) |
| 開始処理 | `status = 'dead'`、「ばたんきゅ〜」モーション |
| 遷移先 | `spectating` |

#### 3.2.7 `spectating`(観戦)
| 項目 | 値 |
|---|---|
| 継続フレーム | マッチ終了まで |
| 開始処理 | 自分のフィールド描画をフェード |
| 遷移先 | マッチ終了(`finished`)時 |

---

## 4. 入力受付マトリクス

| フェーズ | L/R | Z/X | ↓ | Esc |
|---|---|---|---|---|
| `countdown` | ✗ | ✗ | ✗ | ✗ |
| `spawn` | ✗ | ✗ | ✗ | ✓ |
| `falling` | ✓ | ✓ | ✓ | ✓ |
| `chigiri` | ✗ | ✗ | ✗ | ✓ |
| `resolving` | ✗ | ✗ | ✗ | ✓ |
| `waitGarbage` | ✗ | ✗ | ✗ | ✓ |
| `dead` | ✗ | ✗ | ✗ | ✓ |
| `spectating` | ✗ | ✗ | ✗ | ✓ |

**入力バッファリング**: 非受付フェーズで L/R/Z/X を受け取った場合、**次の `falling` 開始時に最初の 1 入力だけ**適用(直近 6f 以内のもののみ)。

---

## 5. 代表シナリオのタイムライン(60fps 基準)

### シナリオA: 設置→連鎖なし→おじゃまなし
```
F  0 : spawn (1f)
F  1 : falling 開始
F 61 : 設置(仮に60f後)→ onLock
F 62 : chigiri スキップ(落差なし)
F 62 : resolving 開始、findClusters → 空
F 63 : waitGarbage スキップ(pending=0)
F 63 : 次 spawn
```

### シナリオB: 設置→落差あり→3連鎖→おじゃま10個降下
```
F   0 : spawn
F   1 : falling
F  61 : onLock → 落差検知
F  62 : chigiri (12f)
F  74 : resolving 1連鎖 (25f)
F  99 : resolving 2連鎖 (25f)
F 124 : resolving 3連鎖 (25f)
F 149 : resolving 検査 → クラスタ空 (1f)
F 150 : waitGarbage 開始、10個配置
F 168 : waitGarbage 終了 (18f)
F 169 : 次 spawn
```

### シナリオC: 相殺成立(受信12個、自連鎖で8個生成)
```
F   0 : pendingGarbage = 12 (予告ぷよ表示済み)
F 149 : 連鎖終了時の送信処理
        - 自生成 garbage = 8
        - 相殺: min(12, 8) = 8
        - pendingGarbage: 12 - 8 = 4
        - 相手への送信量: 0 (全部相殺)
F 150 : waitGarbage で 4個降下 (18f)
```

---

## 6. 並行イベントの取り扱い

### 6.1 おじゃま予告の受信
- **受信タイミング**: 相手の `resolving` 各周の確定フレーム
- **反映先**: 自分の `pendingGarbage` に即座に加算(決定論的、全クライアントで同一フレームに反映)
- **表示**: 予告ぷよアイコン(上部)は即座に更新 — フェーズを問わず常時表示
- **実際の落下**: 自分が `waitGarbage` に到達するまで据え置き

### 6.2 相殺(オフセット)
相殺は `resolving` の**各周終了時**に評価:
```
onChainResolved(self):
  generated = floor((self.scoreBuffer) / 70)
  self.scoreBuffer %= 70

  offset = min(self.pendingGarbage, generated)
  self.pendingGarbage -= offset
  generated -= offset

  if generated > 0:
    target = pickTarget(match.players)
    target.pendingGarbage += generated
    self.sentGarbage += generated
```

### 6.3 相手プレイヤー死亡
- 自分の連鎖送信の対象が `spectating` になった場合、**次フレームで再ターゲティング**
- 生存者が自分のみになった瞬間、マッチは `finished` に遷移

---

## 7. エッジケース

| ケース | 挙動 |
|---|---|
| `resolving` 中に相手連鎖が到達 → `pendingGarbage` 増加 | 表示のみ更新、次 `waitGarbage` で降下 |
| `waitGarbage` 中に追加の予告ぷよが届く | 現在の落下ウェーブには含めず、次の `waitGarbage` に回す |
| 長連鎖中に相手全員が死亡 | 自分の連鎖演出は最後まで継続、`finished` 遷移はマッチエンド判定で |
| `falling` 中に相手から連鎖攻撃 | 自分のフェーズは影響を受けず継続、予告ぷよアイコンのみ更新 |
| `chigiri` 中にマッチ終了 | アニメーションは中断、スコアは確定済み |

---

## 8. 実装指針

### 8.1 固定タイムステップ
```typescript
const FRAME_MS = 1000 / 60;
let accumulator = 0;

function tick(dtMs: number) {
  accumulator += dtMs;
  while (accumulator >= FRAME_MS) {
    simulator.advanceFrame(inputsThisFrame);
    accumulator -= FRAME_MS;
  }
  renderer.draw(simulator.state, accumulator / FRAME_MS); // 補間値
}
```

### 8.2 フェーズの実装パターン
```typescript
interface PhaseHandler {
  onEnter(player: PlayerState): void;
  onUpdate(player: PlayerState, input: InputAction[]): PhaseResult;
  onExit(player: PlayerState): void;
}

type PhaseResult =
  | { kind: 'stay' }
  | { kind: 'transition'; to: PhaseKind };
```

---

## 9. テストケース

### 9.1 単体遷移テスト
| # | 開始フェーズ | 条件 | 期待遷移先 | 期待経過f |
|---|---|---|---|---|
| TS-01 | spawn | (2,11) 空 | falling | 1 |
| TS-02 | spawn | (2,11) 埋 | dead | 1 |
| TS-03 | falling | 設置、落差あり | chigiri | 可変 + 1 |
| TS-04 | chigiri | — | resolving | 12 |
| TS-05 | resolving | クラスタなし | waitGarbage | 1 |
| TS-06 | resolving | 3連鎖 | waitGarbage | 76 (25×3 + 1) |
| TS-07 | waitGarbage | pending=0 | spawn | 0 |
| TS-08 | waitGarbage | pending=5 | spawn | 18 |
| TS-09 | dead | — | spectating | 60 |

### 9.2 統合シナリオテスト
| # | 内容 | 期待総フレーム |
|---|---|---|
| TI-01 | spawn→設置(60f)→連鎖なし→pending=0→spawn | 約 62f |
| TI-02 | spawn→設置→3連鎖→pending=10→spawn | 約 168f |
| TI-03 | 対戦: A の3連鎖が B の pending に到達するフレーム一致(決定論) | ハッシュ一致 |

### 9.3 並行イベントテスト
| # | 内容 | 期待 |
|---|---|---|
| TC-01 | falling 中に pending 追加 | フェーズ遷移せず表示のみ更新 |
| TC-02 | resolving 2連鎖目で相手死亡 | 3連鎖目送信時に新ターゲット選出 |
| TC-03 | waitGarbage 中に pending 追加 | 現ウェーブに混ざらず次回に計上 |

### 9.4 入力バッファテスト
| # | 内容 | 期待 |
|---|---|---|
| TB-01 | resolving 中の 5f 前の回転入力 | 次 falling の 1f 目で適用 |
| TB-02 | resolving 中の 10f 前の回転入力 | 破棄(6f 以上前) |
