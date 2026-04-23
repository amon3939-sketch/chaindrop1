# D8. アセット仕様書

## 1. 基本方針

| # | 方針 | 理由 |
|---|---|---|
| 1 | **アセット ID でコードから参照**(パス直書きしない) | 差し替え容易、タイポ耐性 |
| 2 | **manifest を単一の真実源**(SSOT) | ロード漏れ・命名ゆらぎを排除 |
| 3 | **色違いはプログラム派生を優先** | 一貫性+工数削減 |
| 4 | **命名は `category_name_variant.ext`** | 検索性、ソート順 |
| 5 | **すべてのアセットにライセンス情報を付与** | 公開配布に必要 |
| 6 | **プログラマ仮素材を M1-M5 で先行投入** | アート完成待ちでブロックしない |

---

## 2. 命名規則と配置

### 2.1 ディレクトリ
```
packages/client/public/assets/
├── puyo/
│   ├── base/
│   └── colored/             // ビルド時に生成
├── character/
│   ├── kiria/
│   ├── boltz/
│   └── .../ (計10キャラ)
├── ui/
│   ├── frames/
│   ├── buttons/
│   ├── icons/
│   └── ojama/
├── effects/
├── backgrounds/
├── fonts/
├── audio/
│   ├── bgm/
│   ├── se/
│   └── voice/
└── credits/
    └── licenses.json
```

### 2.2 ファイル名規則
```
<category>_<name>[_<state>][_<variant>].<ext>

例:
puyo_red_normal.svg
puyo_blue_pop_f3.png
char_kiria_portrait_chain.png
ui_button_primary_hover.png
ui_ojama_comet.svg
audio_bgm_match.ogg
audio_voice_kiria_chain5.ogg
```

### 2.3 アセット ID(コード参照用)
ドット区切り:
```typescript
'puyo.red.normal'
'char.kiria.portrait.chain'
'ui.ojama.comet'
'audio.voice.kiria.chain5'
```

---

## 3. ぷよスプライト仕様

### 3.1 サイズと解像度
| 用途 | 表示サイズ | アセット原寸 |
|---|---|---|
| 自フィールド(Main) | 40 × 40 px | **80 × 80 px** |
| 小フィールド(4人時) | 16 × 16 px | 同じアセットを縮小描画 |
| 3人時中サイズ | 24 × 24 px | 同上 |

SVG の場合は viewBox=`0 0 80 80` で作成。

### 3.2 形状
- 基本: 丸みのあるブロブ
- 80×80 キャンバスに対し、**外接円 ≈ 76×76**
- 設置位置: **中心 (40, 40)**、下端が 76

### 3.3 色指定
| 色 | Primary | Highlight | Shadow |
|---|---|---|---|
| R(Red) | `#ff4a6b` | `#ffb3c1` | `#b8213a` |
| G(Green) | `#6ce048` | `#c0ff9c` | `#3c8820` |
| B(Blue) | `#4a9bff` | `#b3d9ff` | `#1c5cb8` |
| Y(Yellow) | `#ffd23a` | `#fff0a0` | `#b88b00` |
| P(Purple) | `#c864ff` | `#e8b3ff` | `#7020a8` |
| X(Ojama) | `#9ca3af` | `#d1d5db` | `#4b5563` |

**派生方法**:
- ベース SVG は **1色(Red)のみ作成**
- ビルド時に色トークン置換で G/B/Y/P を生成

### 3.4 表情ステート
| ステート | ID サフィックス | 用途 |
|---|---|---|
| 通常 | `normal` | 着地後・落下中 |
| 連結 | `linked` | 同色隣接あり(目が隣接方向を向く)|
| 消滅前 | `pop_pre` | 消える 3 フレーム前 |
| 消滅中 | `pop_f1` 〜 `pop_f4` | 消去アニメ(4フレーム)|
| ピンチ | `danger` | 窒息ライン接近時 |
| 勝利 | `happy` | マッチ勝利演出時 |

**おじゃまの特殊性**: `normal` と `pop_f1..f4` のみ。

### 3.5 連結方向スプライト
`linked` は隣接セルがある方向に目を向ける。
```
UP=1, RIGHT=2, DOWN=4, LEFT=8
→ 4 基本形 + 水平反転・垂直反転で 8 形を生成
```

---

## 4. キャラクター立ち絵仕様

### 4.1 10キャラ × 5 状態 = 50 枚

| 状態 ID | 用途 | サイズ | ポーズ |
|---|---|---|---|
| `portrait_normal` | マッチ・ロビー通常時 | 480 × 720 px | ニュートラル |
| `portrait_chain` | 連鎖 3 以上発動時 | 480 × 720 px | 攻撃的・元気よく |
| `portrait_danger` | 窒息ライン接近時 | 480 × 720 px | 焦り・冷や汗 |
| `portrait_win` | 勝利時 | 480 × 720 px | ガッツポーズ・笑顔 |
| `portrait_lose` | 敗北時 | 480 × 720 px | ダウン |

**小サイズ版**: `portrait_normal` を 160×240 に縮小してビルド時生成。

### 4.2 構図ガイド
- 基本: 上半身〜腰まで(バストアップ)
- 透明背景 PNG
- 顔の位置: 上から 1/4 あたりに目がくる

### 4.3 キャラデザインシート(テンプレート)

```yaml
character_id: kiria
display_name: Kiria / キリア
motif: 魔法少女
personality: 元気・おてんば・主人公格
age_impression: 12-14 歳
image_color:
  primary: "#ff4a6b"
  accent: "#ffb3c1"
appearance:
  hair: 長めのウェーブ、ピンクがかったオレンジ
  eyes: 大きめ、赤紫
  outfit:
    top: 白と赤のコルセット風
    bottom: 赤い短いスカート
    accessories: 大きい魔法ステッキ
voice_style: ハキハキした中〜高音
```

### 4.4 一貫性の保ち方(AI 生成時)

**Option A: Midjourney**
- `--cref <ref_url> --cw 100` でキャラ参照固定

**Option B: Stable Diffusion + LoRA**
- キャラ毎に 10〜20 枚の初期生成を行い、LoRA を訓練

**Option C: ControlNet + Pose**
- ベース立ち絵 1 枚を作り、ControlNet(OpenPose)で姿勢だけ変えて各状態を生成

**推奨: C → B** の順で検討。

### 4.5 ファイル一覧(例)
```
character/kiria/
  portrait_normal.png
  portrait_chain.png
  portrait_danger.png
  portrait_win.png
  portrait_lose.png
  portrait_small_normal.png     // ビルド時生成
  select_icon.png               // 120×120 サムネ
  metadata.yaml
  voice_manifest.json
```

---

## 5. UI素材仕様

### 5.1 フレーム・パネル
| アセット | サイズ | 用途 |
|---|---|---|
| `ui.frame.field_main` | 280 × 520 | 自フィールドを囲む |
| `ui.frame.field_small` | 112 × 208 | 他プレイヤーフィールド |
| `ui.frame.next` | 96 × 240 | NEXT 表示 |
| `ui.panel.score` | 280 × 80 | スコアパネル |
| `ui.panel.bg` | 9-slice | 汎用パネル |

### 5.2 ボタン
3 状態(normal / hover / pressed)× 3 種類(primary / secondary / danger):
- サイズ: 240 × 64(M)、320 × 80(L)
- 9-slice で可変幅対応

### 5.3 予告ぷよアイコン(7段階)
| アイコン ID | サイズ | 個数換算 |
|---|---|---|
| `ui.ojama.small` | 32×32 | 1 |
| `ui.ojama.large` | 40×40 | 6 |
| `ui.ojama.rock` | 48×48 | 30 |
| `ui.ojama.star` | 48×48 | 180 |
| `ui.ojama.moon` | 48×48 | 360 |
| `ui.ojama.crown` | 56×56 | 720 |
| `ui.ojama.comet` | 64×64 | 1440 |

### 5.4 アイコン(小物)
サイズ統一: **32×32**、SVG 優先。
```
ui.icon.ready / not_ready / lock / crown_winner
ui.icon.colormode_4 / colormode_5
ui.icon.capacity_2,3,4
ui.icon.connection_good/warn/bad
ui.icon.pause
```

### 5.5 背景
| アセット | サイズ | 用途 |
|---|---|---|
| `bg.title` | 1920×1080 | タイトル画面 |
| `bg.lobby` | 1920×1080 | ロビー画面 |
| `bg.match.default` | 1280×720 | マッチ画面 |
| `bg.match.variants` | 1280×720 × 数点 | ステージバリエーション |

---

## 6. エフェクト素材

### 6.1 連鎖テキスト
**推奨実装**: 素材でなく **フォント+エフェクトの動的生成**(PixiJS `Text` + `OutlineFilter`)。

### 6.2 消去パーティクル
- 色別: R/G/B/Y/P のキラキラ粒子
- サイズ: 16×16、1 スプライトシートに 4 フレーム

### 6.3 その他
| アセット | 用途 |
|---|---|
| `effects.countdown_3/2/1/go` | 3秒カウントダウン |
| `effects.ready_banner` | READY 状態バナー |
| `effects.winner_banner` | 勝者表示 |
| `effects.bad_end_vignette` | 敗北時の暗転オーバーレイ |

---

## 7. フォント仕様

### 7.1 使用フォント(4 種)
| 役割 | フォント | ライセンス |
|---|---|---|
| Body / UI(日英) | **Zen Maru Gothic** | OFL |
| Body 太字 | **Zen Maru Gothic Bold** | OFL |
| Score(等幅数字) | **JetBrains Mono** or **DSEG7 Classic** | OFL |
| Logo | **Gugi** | OFL |

### 7.2 配布
- self-host(プライバシー + オフライン耐性)
- WOFF2 形式でサブセット化

---

## 8. 音素材仕様

### 8.1 BGM(8 トラック)
| ID | 用途 | ループ | 長さ目安 |
|---|---|---|---|
| `audio.bgm.title` | タイトル | ○ | 2-3分 |
| `audio.bgm.lobby` | ロビー/ルーム | ○ | 2-3分 |
| `audio.bgm.solo_endless` | ソロ エンドレス | ○ | 3-4分 |
| `audio.bgm.solo_scoreattack` | スコアアタック | ○ | 2-3分 |
| `audio.bgm.match_normal` | 対戦・平常 | ○ | 2-3分 |
| `audio.bgm.match_pinch` | 対戦・ピンチ | ○ | 2-3分 |
| `audio.bgm.win_jingle` | 勝利 | ✗ | 5-8秒 |
| `audio.bgm.lose_jingle` | 敗北 | ✗ | 5-8秒 |

**形式**: OGG Vorbis、目標 ~2-3MB/曲

### 8.2 SE(18 種)
| ID | 用途 |
|---|---|
| `audio.se.piece_move` | 左右移動 |
| `audio.se.piece_rotate` | 回転 |
| `audio.se.piece_land` | 着地(設置直前)|
| `audio.se.piece_lock` | 設置確定 |
| `audio.se.pop_1`〜`pop_7` | 連鎖数ごとの消去音 |
| `audio.se.ojama_warning` | 予告ぷよ到着 |
| `audio.se.ojama_drop` | おじゃま落下 |
| `audio.se.menu_cursor/confirm/cancel` | メニュー操作 |
| `audio.se.countdown_tick/go` | カウントダウン |
| `audio.se.bad_end` | 敗北効果音 |

**形式**: OGG Vorbis、目標 ~50KB/音

### 8.3 連鎖ボイス(10キャラ × 5種 = 50 ファイル)
| ID | 用途 |
|---|---|
| `audio.voice.<char>.chain1` | 1連鎖(or 2連鎖) |
| `audio.voice.<char>.chain3` | 3連鎖 |
| `audio.voice.<char>.chain5` | 5連鎖以上 |
| `audio.voice.<char>.win` | 勝利時 |
| `audio.voice.<char>.lose` | 敗北時 |

**生成方針**:
- **AIボイス**: VOICEVOX / にじボイス / Style-Bert-VITS2
- キャラ毎に話者プリセットを 1 つ決めて固定

---

## 9. AI生成パイプライン

### 9.1 生成 → 採用までのフロー
```
1. [デザインシート作成]    docs/design/characters/<id>.yaml
2. [AI生成]               → 候補 5〜10 枚
3. [選定]                 1 枚確定
4. [修正]                 Photoshop/Figma で微調整
5. [切り抜き・透過]       背景除去
6. [リサイズ・書き出し]   規定サイズ、PNG
7. [ライセンス記録]       licenses.json に登録
8. [manifest.ts 更新]     ID 登録
```

### 9.2 プロンプトテンプレート(キャラクター)
```
Character reference: {character_id}

Description:
  - Subject: {motif}, {personality}
  - Hair: {hair_description}
  - Eyes: {eye_description}
  - Outfit: {outfit_description}

Composition:
  - Bust-up portrait, upper body visible down to waist
  - Transparent background
  - Centered, facing slightly off-axis (3/4 view)

State: {state_name}
  - Expression: {expression_for_state}
  - Pose: {pose_for_state}

Style:
  - Anime game character art
  - Cel-shaded with soft gradient highlights
  - Clean vector-like lineart (2-3px)

Exclude: backgrounds, text, watermarks, copyrighted characters
```

### 9.3 品質チェックリスト
- [ ] 透過背景か
- [ ] 規定サイズを満たす
- [ ] ファイルサイズ目標内
- [ ] 輪郭のクリーンさ
- [ ] 色がパレットと整合
- [ ] 著作権上問題ない

---

## 10. マニフェスト(`manifest.ts`)

### 10.1 構造
```typescript
export const ASSET_MANIFEST = {
  common: {
    'ui.button.primary.normal': { path: 'ui/buttons/primary_normal.png', license: 'internal' },
    'ui.icon.ready':            { path: 'ui/icons/ready.svg', license: 'internal' },
  },
  puyo: {
    'puyo.red.normal':   { path: 'puyo/colored/red_normal.svg', license: 'internal' },
    'puyo.red.pop_f1':   { path: 'puyo/colored/red_pop_f1.svg', license: 'internal' },
  },
  character: {
    'char.kiria.normal': { path: 'character/kiria/portrait_normal.png', license: 'ai_generated_mj_v6' },
  },
  audio: {
    'audio.bgm.title':   { path: 'audio/bgm/title.ogg', license: 'maou_soul_free' },
  },
} as const;
```

---

## 11. ライセンス管理

### 11.1 `credits/licenses.json`
```json
{
  "licenses": {
    "internal":            { "name": "Project internal", "attribution": "" },
    "ai_generated_mj_v6":  { "name": "AI (Midjourney v6)", "attribution": "CC BY 4.0" },
    "maou_soul_free":      { "name": "魔王魂", "url": "https://maou.audio/" },
    "otologic":            { "name": "OtoLogic", "url": "https://otologic.jp/" },
    "voicevox_zundamon":   { "name": "VOICEVOX:ずんだもん" }
  },
  "assets": {
    "audio.bgm.title": { "license": "maou_soul_free", "source_url": "https://..." }
  }
}
```

### 11.2 CI 検証
GitHub Actions で以下を自動チェック:
- manifest に登録された全アセットが licenses.json にエントリがあるか
- public/assets/ に存在しないファイルを参照していないか

---

## 12. 最適化・配信

### 12.1 画像
| 種類 | 形式 | 備考 |
|---|---|---|
| シンプル/ベクタ | SVG | viewBox 固定 |
| 写実/ぼかし | PNG | 8bit パレット化 |
| 立ち絵 | PNG | 透過、256色可 |

原則 1 ファイル **< 500KB**。

### 12.2 音声
- OGG Vorbis(全ブラウザ対応)
- BGM: 目標 ~2-3MB/曲
- SE: 目標 ~50KB/音

### 12.3 キャッシュ戦略
- 静的ファイルに **content hash** を埋め込み
- CDN キャッシュ 1 年(hash で bust)
- `index.html` は no-cache

### 12.4 初回ロード削減
- タイトル時点でロードするのは `common` + 背景 + フォントのみ
- 残りは遅延ロード
- 進捗バーを表示

---

## 13. 制作優先度とマイルストーン対応

| 優先 | 内容 | M |
|---|---|---|
| 1 | 仮素材でぷよ+フィールド枠 | M1 |
| 2 | 仮 UI(ボタン、パネル、スコア) | M2 |
| 3 | 仮キャラ(1キャラだけでも)| M2 |
| 4 | 本番ぷよスプライト | M6 前半 |
| 5 | キャラ 10体 × 5 状態 | M6 中盤 |
| 6 | BGM・SE 差し替え | M6 中盤 |
| 7 | キャラボイス | M6 後半 |
| 8 | エフェクト強化・背景バリエーション | M6 後半 |

### 13.1 仮素材(プログラマアート)の最小セット
- ぷよ: 色円 + 目 2点(CSS/Canvas 直描画)
- キャラ: シルエットのみ or 単色四角
- UI: 矩形+テキストのプレーンスタイル
- 音: 無音 or sin 波のビープ

**設計原則**: 仮素材で遊べる状態まで持っていき、差し替えは manifest 書き換えだけで済むようにする。
