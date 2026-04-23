# D3. スコア・おじゃま計算テーブル

## 1. スコア計算式(全体)

連鎖1周(= D2 の `resolving` 1周)ごとに以下を計算:

```
multiplier = max(1, chainBonus + connectionBonus + colorBonus)
chainScore = 10 × popCount × multiplier
```

| 変数 | 意味 |
|---|---|
| `popCount` | その連鎖で消えた通常色ぷよの総数(おじゃま巻き込みは**含めない**) |
| `chainBonus` | 連鎖ボーナス(§ 2) |
| `connectionBonus` | 連結ボーナス(§ 3) — そのターンに消えた**全クラスタ**の合計 |
| `colorBonus` | 色数ボーナス(§ 4) — そのターンに消えた**色の種類数** |
| `multiplier` | 乗数。ゼロ除算回避のため最小 1 |

---

## 2. 連鎖ボーナス表

ぷよぷよ通(Tsuu)準拠。連鎖2以降は 8 → 16 → 32 の 2倍進行 → 5連鎖以降は **+32 加算**。

| 連鎖 | chainBonus | 連鎖 | chainBonus |
|---:|---:|---:|---:|
| 1 | **0** | 11 | 256 |
| 2 | **8** | 12 | 288 |
| 3 | **16** | 13 | 320 |
| 4 | **32** | 14 | 352 |
| 5 | **64** | 15 | 384 |
| 6 | 96 | 16 | 416 |
| 7 | 128 | 17 | 448 |
| 8 | 160 | 18 | 480 |
| 9 | 192 | 19 | **512** |
| 10 | 224 | 20以上 | 512 で打ち止め |

**疑似コード**:
```typescript
function chainBonus(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 8;
  if (n === 3) return 16;
  if (n === 4) return 32;
  return Math.min(64 + (n - 5) * 32, 512);
}
```

---

## 3. 連結ボーナス表

**クラスタごと**に計算し、そのターンに消えた全クラスタ分を合計する。

| クラスタサイズ | bonus |
|---:|---:|
| 4 | **0** |
| 5 | **2** |
| 6 | **3** |
| 7 | **4** |
| 8 | **5** |
| 9 | **6** |
| 10 | **7** |
| 11以上 | **10**(打ち止め) |

**疑似コード**:
```typescript
function connectionBonusOfCluster(size: number): number {
  if (size < 4) return 0;
  if (size >= 11) return 10;
  return [0, 2, 3, 4, 5, 6, 7][size - 4];
}

function connectionBonusTotal(clusters: Cluster[]): number {
  return clusters.reduce((s, c) => s + connectionBonusOfCluster(c.size), 0);
}
```

---

## 4. 色数ボーナス表

そのターンに消えた**通常色の種類数**で決定(おじゃまはカウントしない)。

| 色数 | bonus |
|---:|---:|
| 1 | **0** |
| 2 | **3** |
| 3 | **6** |
| 4 | **12** |
| 5 | **24** |

```typescript
function colorBonus(colorsCount: number): number {
  return [0, 0, 3, 6, 12, 24][colorsCount] ?? 24;
}
```

---

## 5. 同時消しの扱い(重要)

同じ `chainCount` 内で**複数のクラスタが同時に消える**ケース:
- 各クラスタは独立に連結ボーナスに寄与
- 色数ボーナスは**ユニークな色の数**(例: 赤4個×2クラスタ同時 → 色数=1)
- `popCount` は全消去の合計

**例**: 赤4個 + 青5個 が同時、1連鎖目
```
popCount = 4 + 5 = 9
chainBonus = 0
connectionBonus = 0(赤4) + 2(青5) = 2
colorBonus = 3(2色)
multiplier = max(1, 0 + 2 + 3) = 5
chainScore = 10 × 9 × 5 = 450
```

---

## 6. おじゃま換算

### 6.1 基本式
```
accumulated = leftoverScore + chainScore
generated   = floor(accumulated / RATE)
leftoverScore = accumulated mod RATE
```

### 6.2 RATE(換算レート)
| モード | RATE |
|---|---|
| 対戦(2〜4人) | **70** |
| ソロ | おじゃま送信なし(RATE 適用外) |

### 6.3 leftoverScore の持続
- **マッチ開始時に 0 で初期化**
- **連鎖の各周で更新**
- **resolving 終了後も保持**(次の設置・次の連鎖にも繰り越す)
- マッチ終了まで破棄しない

---

## 7. 相殺(オフセット)ロジック

### 7.1 処理順序(決定論)
各 `resolving` 周の**確定フレーム**で以下を順に実行:

```typescript
function onChainResolved(self: PlayerState, match: MatchState) {
  // 1. 当連鎖のスコアを計算
  const chainScore = 10 * self.chain.popCount *
                     Math.max(1, chainBonus(self.chainCount)
                                 + connectionBonusTotal(self.chain.clusters)
                                 + colorBonus(self.chain.colorsCount));
  self.score += chainScore;

  // 2. おじゃま換算
  self.leftoverScore += chainScore;
  let generated = Math.floor(self.leftoverScore / 70);
  self.leftoverScore %= 70;

  // 3. 自分の受信予告で相殺
  const offset = Math.min(self.pendingGarbage, generated);
  self.pendingGarbage -= offset;
  generated -= offset;

  // 4. 残余を相手へ送信
  if (generated > 0) {
    const target = selectTarget(self, match);
    if (target !== null) {
      target.pendingGarbage += generated;
      self.sentGarbage += generated;
    }
  }
}
```

### 7.2 ターゲット選定(決定論)
```typescript
function selectTarget(self: PlayerState, match: MatchState): PlayerState | null {
  const candidates = match.players.filter(p =>
    p.id !== self.id && p.status === 'playing'
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.pendingGarbage !== b.pendingGarbage)
      return a.pendingGarbage - b.pendingGarbage;   // 受信が少ない
    if (a.score !== b.score)
      return a.score - b.score;                     // スコアが少ない
    return a.slotIndex - b.slotIndex;               // 部屋入室順
  });

  return candidates[0];
}
```

### 7.3 同フレーム複数送信の競合
複数プレイヤーが**同一フレーム**で連鎖確定した場合の処理順は **playerSlot の昇順**で逐次実行する(全クライアントで同一結果)。

---

## 8. 予告ぷよ表示換算

### 8.1 段階アイコン
| アイコン | 個数単位 |
|---|---:|
| 小玉 | **1** |
| 大玉 | **6** |
| 岩 | **30** |
| 星 | **180** |
| 月 | **360** |
| 王冠 | **720** |
| 彗星 | **1440** |

### 8.2 表示分解(貪欲法)
```typescript
function displayOjama(count: number): Icon[] {
  const units = [
    { name: '彗星', v: 1440 },
    { name: '王冠', v: 720 },
    { name: '月',   v: 360 },
    { name: '星',   v: 180 },
    { name: '岩',   v: 30 },
    { name: '大玉', v: 6 },
    { name: '小玉', v: 1 },
  ];
  const result: Icon[] = [];
  for (const u of units) {
    const n = Math.floor(count / u.v);
    for (let i = 0; i < n; i++) result.push({ kind: u.name });
    count %= u.v;
  }
  return result;
}
```

**例**: `count = 50` → 岩×1 + 大玉×3 + 小玉×2 = 6個表示

### 8.3 表示上の上限
- 上部バーは **1列 × 最大 6 アイコン**
- アイコン総数が 6 を超える場合、**大きい順に 6 個まで表示**し残りは内部値のみ保持
- 表示 6 個を超えるケースでは、一番右に「+」印を付ける

---

## 9. ソフトドロップ・ハードドロップ

本家の通ルールに合わせ、**ソフトドロップによるスコア加算は無し**(ハードドロップは仕様上存在しない)。

スコアは**連鎖のみ**で加算される。

---

## 10. 計算例集(検証用)

### ケース 1: 単発 1連鎖 4個(最小ケース)
| 項目 | 値 |
|---|---|
| popCount | 4 |
| chainBonus | 0(1連鎖) |
| connectionBonus | 0(4連結) |
| colorBonus | 0(1色) |
| multiplier | max(1, 0) = **1** |
| chainScore | 10 × 4 × 1 = **40** |
| garbage | floor((0+40)/70) = **0** |
| leftover 更新後 | **40** |

### ケース 2: 単発 1連鎖 5個連結
| 項目 | 値 |
|---|---|
| popCount | 5 |
| connectionBonus | 2 |
| multiplier | max(1, 2) = **2** |
| chainScore | 10 × 5 × 2 = **100** |
| garbage | floor((0+100)/70) = **1** |
| leftover | **30** |

### ケース 3: 2色同時 1連鎖(赤4+青4)
| 項目 | 値 |
|---|---|
| popCount | 8 |
| connectionBonus | 0 + 0 = 0 |
| colorBonus | 3 |
| multiplier | max(1, 3) = **3** |
| chainScore | 10 × 8 × 3 = **240** |
| garbage | floor(240/70) = **3** |
| leftover | **30** |

### ケース 4: 典型的 5連鎖(各連鎖 4個単色)
leftover は 0 スタートとする。

| 連鎖 | chainBonus | multiplier | chainScore | 累積 | 新 leftover | garbage |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 1 | 40 | 40 | 40 | 0 |
| 2 | 8 | 8 | 320 | 360 | 10 | 5 |
| 3 | 16 | 16 | 640 | 650 | 20 | 9 |
| 4 | 32 | 32 | 1280 | 1300 | 40 | 18 |
| 5 | 64 | 64 | 2560 | 2600 | 10 | 37 |
| **総計** | | | **4840** | | | **69** |

### ケース 6: 相殺成立
```
自分: pendingGarbage = 20
自分が 3連鎖完走 → generated = 15
→ offset = min(20, 15) = 15
→ pendingGarbage = 5、送信量 = 0
```

### ケース 7: 相殺 + 逆襲
```
自分: pendingGarbage = 10
自分が 5連鎖完走 → generated = 69
→ offset = min(10, 69) = 10
→ pendingGarbage = 0、送信量 = 59
→ target の pendingGarbage += 59
```

---

## 11. 完全疑似コード(連鎖1周のスコア処理)

```typescript
interface ChainTick {
  chainIndex: number;          // 1始まり
  clusters: Cluster[];         // そのターンに消えた通常色クラスタ
  ojamaClearedCount: number;   // 巻き込まれたおじゃま数(スコア非関与)
}

function processChainTick(self: PlayerState, match: MatchState, tick: ChainTick) {
  // --- スコア ---
  const popCount = tick.clusters.reduce((s, c) => s + c.size, 0);
  const colors = new Set(tick.clusters.map(c => c.color)).size;

  const bC = chainBonus(tick.chainIndex);
  const bConn = connectionBonusTotal(tick.clusters);
  const bCol = colorBonus(colors);
  const mult = Math.max(1, bC + bConn + bCol);

  const chainScore = 10 * popCount * mult;
  self.score += chainScore;

  // --- おじゃま換算 ---
  self.leftoverScore += chainScore;
  let generated = Math.floor(self.leftoverScore / 70);
  self.leftoverScore %= 70;

  // --- 相殺 ---
  const offset = Math.min(self.pendingGarbage, generated);
  self.pendingGarbage -= offset;
  generated -= offset;

  // --- 送信 ---
  if (generated > 0) {
    const target = selectTarget(self, match);
    if (target !== null) {
      target.pendingGarbage += generated;
      self.sentGarbage += generated;
    }
  }

  // --- 演出用のイベント記録 ---
  self.lastChainDisplay = {
    chain: tick.chainIndex,
    score: chainScore,
    generated: generated + offset,
    offset,
  };
}
```

---

## 12. 数値レンジの確認

| 項目 | 最大想定値 | 型 |
|---|---:|---|
| popCount(1連鎖) | ~30 | `int32` |
| multiplier | 512 + 10 + 24 = **546** | `int32` |
| chainScore(1連鎖) | 10 × 30 × 546 ≈ **164,000** | `int32` |
| score(マッチ中) | 19連鎖完走 × 数回 ≈ 10⁶ オーダー | `int32` |
| pendingGarbage | 数千オーダー | `int32` |
| leftoverScore | 0〜69 | `int32` |

→ **すべて JavaScript の `number` (53bit) で安全**。

---

## 13. テストケース

### 13.1 ボーナス計算
| # | 入力 | 期待 |
|---|---|---:|
| TS-01 | `chainBonus(1)` | 0 |
| TS-02 | `chainBonus(5)` | 64 |
| TS-03 | `chainBonus(19)` | 512 |
| TS-04 | `chainBonus(25)` | 512(打ち止め) |
| TS-05 | `connectionBonusOfCluster(4)` | 0 |
| TS-06 | `connectionBonusOfCluster(11)` | 10 |
| TS-07 | `connectionBonusOfCluster(20)` | 10 |
| TS-08 | `colorBonus(1)` | 0 |
| TS-09 | `colorBonus(5)` | 24 |

### 13.2 スコア計算(統合)
| # | 内容 | 期待 chainScore |
|---|---|---:|
| TSI-01 | 単発 1連鎖 4個 1色 | 40 |
| TSI-02 | 単発 1連鎖 5個 1色 | 100 |
| TSI-03 | 2色同時 1連鎖(4+4) | 240 |
| TSI-04 | 5連鎖目 4個1色 | 2560 |
| TSI-05 | 3色同時 4連鎖目(4+4+4) | 10 × 12 × (32+0+6) = 4560 |

### 13.3 おじゃま換算
| # | 内容 | 期待 garbage | 期待 leftover |
|---|---|---:|---:|
| TG-01 | leftover=0、chainScore=40 | 0 | 40 |
| TG-02 | leftover=40、chainScore=320 | 5 | 10 |
| TG-03 | leftover=69、chainScore=1 | 1 | 0 |
| TG-04 | leftover=0、chainScore=140 | 2 | 0 |

### 13.4 相殺
| # | pending前 | generated | 期待 pending後 | 期待 送信量 |
|---|---:|---:|---:|---:|
| TO-01 | 20 | 15 | 5 | 0 |
| TO-02 | 10 | 69 | 0 | 59 |
| TO-03 | 0 | 10 | 0 | 10 |
| TO-04 | 50 | 0 | 50 | 0 |

### 13.5 ターゲット選定
| # | 候補(id, pending, score, slot) | 期待ターゲット |
|---|---|---|
| TT-01 | [(B, 5, 1000, 1), (C, 10, 500, 2)] | B(pending少) |
| TT-02 | [(B, 10, 500, 1), (C, 10, 200, 2)] | C(同pending→score少) |
| TT-03 | [(B, 10, 500, 1), (C, 10, 500, 2)] | B(同スコア→slot小) |
| TT-04 | 全員 `spectating` | null |

### 13.6 予告ぷよ表示
| # | count | 期待アイコン分解 |
|---|---:|---|
| TD-01 | 1 | 小玉×1 |
| TD-02 | 6 | 大玉×1 |
| TD-03 | 50 | 岩×1, 大玉×3, 小玉×2 |
| TD-04 | 1500 | 彗星×1, 岩×2 |

### 13.7 決定論
| # | 内容 | 期待 |
|---|---|---|
| TDet-01 | 同一 seed・同一入力で 100試行 → `(score, pendingGarbage, sentGarbage)` | 完全一致 |
| TDet-02 | 同一 seed・同一入力で `pickTarget` の選出順 | 完全一致 |
