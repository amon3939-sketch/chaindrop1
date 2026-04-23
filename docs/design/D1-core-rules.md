# D1. コアルール完全仕様

## 1. 座標系とフィールド

### 1.1 サイズ
- **幅**: 6 列(`x = 0..5`、左が 0)
- **高**: 14 行(`y = 0..13`、**下が 0**)
  - `y = 0..11`: 可視領域(12段)
  - `y = 12`: 隠し行(判定用・描画しない)
  - `y = 13`: おじゃまオーバーフロー・バッファ

### 1.2 型定義
```typescript
type PuyoColor = 'R' | 'G' | 'B' | 'Y' | 'P';
type CellKind = PuyoColor | 'X' | null;   // X = おじゃま、null = 空
type Cell = { kind: CellKind };

interface Board {
  readonly width: 6;
  readonly height: 14;
  cells: Cell[][];   // cells[y][x]、下が y=0
}
```

### 1.3 出現位置(組ぷよ spawn)
- **軸ぷよ**: `(x=2, y=12)`(隠し行)
- **子ぷよ**: `(x=2, y=11)`(可視最上段)
- **初期回転**: `0`(子ぷよが軸の真下)

---

## 2. ぷよの色とセル種別

| 種別 | 記号 | 連結判定 | 連鎖で消える | 隣接色消去で巻き込まれ | 重力 |
|---|---|---|---|---|---|
| 通常色(R/G/B/Y/P) | `R` 等 | ○ | ○(4個以上) | — | ○ |
| おじゃま | `X` | × | × | ○ | ○ |
| 空 | `null` | — | — | — | — |

### 2.1 色数モード
- **4色モード**: `R, G, B, Y` を使用
- **5色モード**: `R, G, B, Y, P` を使用
- モード設定 `colorCount: 4 | 5` はマッチ開始時に確定

---

## 3. 組ぷよ(ツモ)

### 3.1 構造
```typescript
interface Piece {
  axisX: number;
  axisY: number;
  rotation: 0 | 1 | 2 | 3;  // 子ぷよの位置
  colors: [PuyoColor, PuyoColor];  // [0]=軸, [1]=子
}
```

### 3.2 子ぷよの相対位置
| rotation | 子ぷよの位置(軸基準) | 意味 |
|---|---|---|
| **0**(初期) | `(0, -1)` | 軸の **下** |
| 1 | `(-1, 0)` | 軸の **左** |
| 2 | `(0, +1)` | 軸の **上** |
| 3 | `(+1, 0)` | 軸の **右** |

CW 回転(X): `0 → 1 → 2 → 3 → 0`
CCW 回転(Z): `0 → 3 → 2 → 1 → 0`

### 3.3 ツモ列生成(決定論)
```typescript
function generateDropQueue(seed: number, count: number, colorCount: 4 | 5): [PuyoColor, PuyoColor][] {
  const rng = new Xorshift32(seed);
  const pool: PuyoColor[] = colorCount === 4 ? ['R','G','B','Y'] : ['R','G','B','Y','P'];
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push([pool[rng.nextInt(pool.length)], pool[rng.nextInt(pool.length)]]);
  }
  return result;
}
```

**初手保証**(本家準拠): 最初の2組は使用色を 3 色以内に制限 → 暴発防止。

---

## 4. 回転システム

### 4.1 通常回転
`rotation` を ±1(mod 4)に変化させ、子ぷよの位置を再計算。移動先が壁/ぷよでなければ成功。

### 4.2 壁キック(Wall Kick)

| 遷移 | 子の移動先(相対) | キック補正(軸の移動) |
|---|---|---|
| 0→1(下→左) | (-1, 0) | 軸 **+1 x**(右へ) |
| 1→2(左→上) | (0, +1) | 軸 **-1 y**(下へ)※ y=0 なら失敗 |
| 2→3(上→右) | (+1, 0) | 軸 **-1 x**(左へ) |
| 3→0(右→下) | (0, -1) | 軸 **+1 y**(上へ) |
| 0→3(下→右) | (+1, 0) | 軸 **-1 x**(左へ) |
| 3→2(右→上) | (0, +1) | 軸 **-1 y**(下へ) |
| 2→1(上→左) | (-1, 0) | 軸 **+1 x**(右へ) |
| 1→0(左→下) | (0, -1) | 軸 **+1 y**(上へ) |

キック後も失敗なら クイックターン判定へ。

### 4.3 クイックターン(180°回転)
**条件**: `rotation=0 または 2` で、**両脇**(`x-1`, `x+1`)が**共に壁 or ぷよ**、かつ回転入力。

**動作**: 両脇塞がりで回転キーが押されたら即 180° と扱う(0↔2)。

### 4.4 回転中の重力停止
回転操作成功時、**落下タイマーをリセット**(回転猶予)。

---

## 5. 落下・ソフトドロップ

### 5.1 フレームレート
固定 **60 FPS**。全タイマーはフレーム数で管理。

### 5.2 落下速度テーブル
| 状態 | 間隔(フレーム/1マス) |
|---|---|
| 通常落下 | **30**(= 0.5秒) |
| ソフトドロップ(↓押下) | **2** |

### 5.3 接地判定・ロック遅延
- 接地 = 軸 or 子のすぐ下が床 or ぷよで、それ以上落下できない
- ロック遅延 N = 15 フレーム
- 移動・回転が成功するたびにタイマーリセット(最大リセット回数 8回)

### 5.4 ちぎり(Split Drop)
設置時、軸ぷよ・子ぷよそれぞれに対して独立に重力を適用する。軸か子かに関係なく、設置位置のすぐ下に空のセルがある場合はそのぷよは落下する。

- 設置位置で両方とも真下が埋まっている → ちぎり演出なし、即座に resolving フェーズへ
- 片方または両方が落下する必要がある → ちぎり演出(**12フレーム固定**)→ 再度重力適用 → resolving
- ちぎり演出中は次の組ぷよ spawn を待機

実装は設置直後に **列単位の重力(applyGravity)** を一律に呼ぶ形で統一。

---

## 6. 設置処理

### 6.1 アルゴリズム
```
onLock(piece, board):
  board[piece.axisY][piece.axisX] = { kind: piece.colors[0] }
  board[childY][childX] = { kind: piece.colors[1] }
  applyGravity(board)      // ちぎり処理
  state = 'resolving'      // 連鎖判定フェーズへ
```

### 6.2 重力処理
```
applyGravity(board):
  for x in 0..5:
    下から順に null を除去して上詰め
```

---

## 7. 連鎖判定アルゴリズム

### 7.1 メインループ
```
resolveChain(board) -> { chainCount, events[] }:
  chainCount = 0
  events = []
  while true:
    clusters = findClusters(board)
    popCluster = clusters.filter(c => c.size >= 4 && c.color is normal)
    if popCluster.isEmpty():
      break

    toRemove = Set of all cells in popCluster
    for cell in toRemove.copy():
      for adj in neighbors4(cell):
        if board[adj].kind == 'X':
          toRemove.add(adj)               // おじゃま巻き込み

    chainCount++
    events.push({ chain: chainCount, cleared: popCluster })

    for cell in toRemove:
      board[cell.y][cell.x] = { kind: null }

    applyGravity(board)

  return { chainCount, events }
```

### 7.2 クラスタ検出(BFS)
走査範囲を **`y=0..11`** に限定(= `y=12, 13` は連結判定対象外):

```
findClusters(board):
  visited = 6x14 bool grid
  clusters = []
  for y in 0..11, x in 0..5:   // y>=12 は連結判定に含めない
    if visited[y][x]: continue
    cell = board[y][x]
    if cell.kind is not a normal color:
      visited[y][x] = true; continue

    cluster = []
    queue = [(x, y)]
    while queue.notEmpty():
      (cx, cy) = queue.pop()
      if visited[cy][cx]: continue
      visited[cy][cx] = true
      if board[cy][cx].kind != cell.kind: continue
      cluster.push((cx, cy))
      for (nx, ny) in neighbors4(cx, cy):
        if 0<=nx<6 && 0<=ny<=11 && !visited[ny][nx]:
          queue.push((nx, ny))

    clusters.push({ color: cell.kind, cells: cluster, size: cluster.length })

  return clusters
```

**重要**:
- **`y >= 12` は連結判定から除外**(本家準拠 + オーバーフローバッファ)
- おじゃまはクラスタ化しない

### 7.3 neighbors4
```
neighbors4(x, y) = [(x+1,y), (x-1,y), (x,y+1), (x,y-1)]
```

---

## 8. スコア・演出タイミング(概要、詳細は D3)

各連鎖の間に **最低 25フレーム**の演出時間を挟む(消去アニメ 15f + 落下 10f)。

---

## 9. 窒息判定(負け条件)

### 9.1 判定タイミング
**新しい組ぷよを spawn する瞬間**に判定。

### 9.2 判定条件
子ぷよ生成位置 `(x=2, y=11)` が空でない場合 → GAME OVER。
- 軸の生成位置 `(x=2, y=12)` は隠し行のため、おじゃまバッファ等で埋まっていることがある → 窒息判定に含めない

```typescript
function trySpawn(board: Board): 'OK' | 'DEATH' {
  if (board.cells[11][2].kind !== null) return 'DEATH';
  return 'OK';
}
```

### 9.3 おじゃま落下後の扱い
おじゃま落下で `(x=2, y=11)` が埋まっても、次の spawn 時まで敗北にしない。

---

## 10. おじゃまぷよ落下仕様

### 10.1 発生契機
- 自分の `state='waitGarbage'` 進入時、`pendingGarbage > 0` ならおじゃま降下

### 10.2 落下ルール

#### 盤面の拡張
- 論理的な盤面高さを **y=0..13**(14行)に拡張
  - `y=0..11`: 可視12段
  - `y=12`: 隠し行
  - `y=13`: おじゃまオーバーフロー・バッファ(新設)
- `y=12` および `y=13` のセルは**連鎖判定の対象外**
- 重力は `y=0..13` 全域で働く

#### 落下アルゴリズム
```
dropOjama(board, count, rng):
  MAX_PER_WAVE = 30
  dropCount = min(count, MAX_PER_WAVE)
  remaining = count - dropCount

  fullRows = floor(dropCount / 6)
  extras = dropCount % 6

  placements: int[6] = [fullRows, fullRows, fullRows, fullRows, fullRows, fullRows]
  selectedCols = rng.sample([0..5], extras)
  for x in selectedCols: placements[x] += 1

  for x in 0..5:
    placeOjamaInColumn(board, x, placements[x], rng)

  pendingGarbage = remaining

placeOjamaInColumn(board, x, n, rng):
  for i in 1..n:
    topY = 列 x で最も高い非空セルの1つ上
    if topY <= 13:
      board[topY][x] = { kind: 'X' }
    else:
      redistributeOjama(board, x, 1, rng)

redistributeOjama(board, fromX, n, rng):
  候補列 = [0..5] のうち fromX 以外で、最上段が y <= 13 の列
  if 候補列.isEmpty():
    return   // 完全満杯 = 破棄

  for i in 1..n:
    targetX = rng.pick(候補列)
    placeOjamaInColumn(board, targetX, 1, rng)
```

#### 重要な振る舞い
1. **y=13 到達時の挙動**: 列が `y=13` まで埋まっていて、さらに 1個落とそうとする場合、**その1個は他列へ再配分**される
2. **y=13 のぷよは消えない**: 隣接ぷよが連鎖で消えても、`y >= 12` にあるぷよは巻き込み消去の対象外。重力で `y <= 11` に落ちてきて初めて消去対象となる
3. **落下による再重力**: 既に `y=13` にあるぷよも、下のセルが連鎖で空けば通常の重力で落ちる

### 10.3 予告ぷよ換算表(表示用)
| 個数 | アイコン |
|---|---|
| 1 | 小玉 |
| 6 | 大玉 |
| 30 | 岩 |
| 180 | 星 |
| 360 | 月 |
| 720 | 王冠 |
| 1440 | 彗星 |

---

## 11. フェーズ遷移(サマリ)

| From | イベント | To |
|---|---|---|
| `spawn` | spawn成功 | `falling` |
| `spawn` | spawn失敗(窒息) | `dead` |
| `falling` | ロック完了(落差あり) | `chigiri` |
| `falling` | ロック完了(落差なし) | `resolving` |
| `chigiri` | 12f経過 | `resolving` |
| `resolving` | 連鎖なし(clusters 空) | `waitGarbage` |
| `resolving` | 連鎖あり → 次周回 | `resolving` |
| `waitGarbage` | `pendingGarbage > 0` | (おじゃま落下演出) → `spawn` |
| `waitGarbage` | `pendingGarbage == 0` | `spawn` |

詳細フレーム表は D2 参照。

---

## 12. テストケース列挙(M1 で実装)

### 12.1 クラスタ検出
| # | 内容 | 期待 |
|---|---|---|
| T1-01 | 同色4個の横並び | 1クラスタ(size=4) |
| T1-02 | 同色4個の縦並び | 1クラスタ(size=4) |
| T1-03 | L字4個 | 1クラスタ(size=4) |
| T1-04 | 同色3個 | 消去されない |
| T1-05 | 異色混在(全て3個以下) | 消去されない |
| T1-06 | 同色5個が隣接 | 1クラスタ(size=5) |
| T1-07 | 同色だが斜めのみ隣接 | 2クラスタ |
| T1-08 | 隠し行(y=12)に同色4個 | クラスタ化されない |
| T1-09 | 可視と隠し行にまたがる同色4個(可視3+y=12で1) | 可視3個のみ → 消えない |
| T1-10 | おじゃま4個が隣接 | 消えない |
| T1-11 | y=13 にある通常色ぷよ | クラスタ化されない |
| T1-12 | y=13 のおじゃまと y=11 の通常色の消去 | y=13 おじゃまは隣接巻き込み対象外 |

### 12.2 連鎖
| # | 内容 | 期待 |
|---|---|---|
| T2-01 | 1連鎖のみ(4個1セット) | chainCount=1 |
| T2-02 | 2連鎖 | chainCount=2 |
| T2-03 | 同時消し | chainCount=1、両方消える |
| T2-04 | 19連鎖想定盤面 | chainCount=19 |
| T2-05 | 連鎖中におじゃま巻き込み | おじゃまも消える、chainは継続 |

### 12.3 重力・ちぎり
| # | 内容 | 期待 |
|---|---|---|
| T3-01 | 途中の null を埋める | 上のぷよが下詰め |
| T3-02 | 組ぷよ設置で軸と子の高さ違い | ちぎり発生、12F後に再評価 |
| T3-03 | 全列が均等な高さ | 変化なし |

### 12.4 回転・壁キック
| # | 内容 | 期待 |
|---|---|---|
| T4-01 | 中央で右回転 | 成功、rotation 変化 |
| T4-02 | x=5 で右回転(壁) | 軸が x=4 へキック |
| T4-03 | x=0 で左回転(壁) | 軸が x=1 へキック |
| T4-04 | 両脇塞がりで回転 | クイックターン(180°) |
| T4-05 | 下が塞がりで下回転 | 軸を +1 持ち上げ |

### 12.5 窒息
| # | 内容 | 期待 |
|---|---|---|
| T5-01 | (x=2, y=11) にぷよあり、spawn 試行 | **DEATH** |
| T5-02 | (x=2, y=11) 空、(x=2, y=12) にぷよあり | **OK**(spawn可)|
| T5-03 | (x=2, y=11) 空、(x=2, y=13) にオーバーフロー | **OK**(spawn可)|
| T5-04 | (x=2, y=11) 空、それ以外全セル埋 | **OK**(spawn可)|

### 12.6 おじゃま落下
| # | 内容 | 期待 |
|---|---|---|
| T6-01 | count=6 | 全列1個ずつ |
| T6-02 | count=30 | 全列5個ずつ |
| T6-03 | count=35 | 30降下、5繰越 |
| T6-04 | count=3、同一シード | 選ばれる列が毎回同じ |
| T6-05 | 列が `y=13` まで埋まっている状態で追加落下 | 別列に再配分 |
| T6-06 | 全列 `y=13` まで埋まっている状態で追加落下 | 超過分は破棄 |
| T6-07 | y=13 のおじゃまの上で下の連鎖が起きる | 重力で y<=11 に落ち、次連鎖から消去対象化 |

### 12.7 決定論テスト
| # | 内容 | 期待 |
|---|---|---|
| T7-01 | 同一シード・同一入力列 → 最終盤面ハッシュ一致 | 1000試行でも完全一致 |

---

## 13. 実装ファイル割当(`packages/shared/src/rules/`)

| ファイル | 責務 |
|---|---|
| `board.ts` | `Board` 型、初期化、セル操作、ハッシュ化 |
| `piece.ts` | `Piece` 型、子ぷよ位置計算、移動判定 |
| `rotate.ts` | 回転、壁キック、クイックターン |
| `gravity.ts` | 列単位の重力、ちぎり判定 |
| `cluster.ts` | クラスタ検出(BFS) |
| `chain.ts` | 連鎖ループ、イベント生成 |
| `spawn.ts` | 出現、窒息判定 |
| `ojama.ts` | おじゃま落下、予告ぷよ換算 |
| `rng.ts` | Xorshift32、sample、nextInt |
| `simulator.ts` | フェーズ state machine、1フレーム進行 |

テストは各ファイルに対応して `*.test.ts`。
