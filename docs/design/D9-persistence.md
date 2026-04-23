# D9. 設定と永続化

## 1. 概要

### 1.1 方針
| # | 方針 | 理由 |
|---|---|---|
| 1 | **ブラウザ `localStorage` のみ** | サーバー依存を避ける、オフライン対応 |
| 2 | **キー単位で独立に保存** | 更新の競合を避ける、破損時の影響局所化 |
| 3 | **すべてバージョン付き**(v1, v2 ...) | スキーマ変更時にマイグレーション可能 |
| 4 | **型安全な wrapper 経由**でアクセス | 直接 `localStorage.getItem` を書かない |
| 5 | **破損/不在時はデフォルト値**で起動 | 絶対に例外を UI に投げない |
| 6 | **リセット機能を提供** | デバッグ・トラブル対応の最低限 |

### 1.2 何を保存し、何を保存しないか
| 保存する | 保存しない |
|---|---|
| ニックネーム、選択キャラ | パスワード・認証情報 |
| キーバインド、音量、DAS/ARR | 試合中の盤面状態 |
| ソロのハイスコア | 進行中のマッチの詳細ログ |
| 直近のルーム接続(再接続トークン) | ランキング情報 |
| 色数モード・定員の最終選択 | — |
| チュートリアル完了フラグ | — |

---

## 2. 永続化対象の一覧

| キー | 内容 | 寿命 | サイズ目安 |
|---|---|---|---|
| `chaindrop:profile` | ニックネーム、選択キャラ | 永続 | < 200B |
| `chaindrop:settings` | 音量、キーバインド、表示設定 | 永続 | < 1KB |
| `chaindrop:stats` | ソロ/オンラインのローカル統計 | 永続 | < 2KB |
| `chaindrop:preferences` | 直近の色数・定員、チュートリアル完了等 | 永続 | < 500B |
| `chaindrop:session` | 再接続トークン | 短命(最大 5 秒)| < 500B |

合計 **~4KB**(localStorage 上限 5MB の 0.1% 未満)。

---

## 3. ストレージ選定の根拠

| 候補 | 採用 | 理由 |
|---|---|---|
| **localStorage** | ✓ | 同期API・実装単純・小容量に最適 |
| sessionStorage | 併用 | 再接続トークン(タブ閉じで消えて OK) |
| IndexedDB | ✗ | 小容量設定には過剰 |
| Cookie | ✗ | 容量 4KB 制限 |
| OPFS | ✗ | ブラウザ対応不十分 |

---

## 4. スキーマ定義

### 4.1 `profile`
```typescript
export interface ProfileV1 {
  v: 'v1';
  nickname: string;            // 1〜12 文字
  characterId: string;         // "kiria" 等
  createdAt: string;           // ISO 8601
}

export const PROFILE_DEFAULTS: ProfileV1 = {
  v: 'v1',
  nickname: '',
  characterId: 'kiria',
  createdAt: new Date(0).toISOString(),
};
```

### 4.2 `settings`
```typescript
export interface SettingsV1 {
  v: 'v1';
  audio: {
    bgm: number;              // 0.0〜1.0
    se: number;
    voice: number;
  };
  controls: {
    keybindings: Record<BindableAction, string>;
    das: number;              // 5〜60 フレーム
    arr: number;              // 1〜30 フレーム
  };
  display: {
    screenShake: boolean;
    showFps: boolean;
    uiScale: number;          // 0.8〜1.2
    language: 'ja' | 'en';
  };
}

export type BindableAction =
  | 'MOVE_L' | 'MOVE_R' | 'SOFT_DROP' | 'ROT_L' | 'ROT_R' | 'PAUSE';

export const SETTINGS_DEFAULTS: SettingsV1 = {
  v: 'v1',
  audio:   { bgm: 0.7, se: 0.8, voice: 0.8 },
  controls: {
    keybindings: {
      MOVE_L: 'ArrowLeft', MOVE_R: 'ArrowRight', SOFT_DROP: 'ArrowDown',
      ROT_L:  'KeyZ',      ROT_R:  'KeyX',       PAUSE:     'Escape',
    },
    das: 15, arr: 3,
  },
  display: { screenShake: true, showFps: false, uiScale: 1.0, language: 'ja' },
};
```

### 4.3 `stats`
```typescript
export interface StatsV1 {
  v: 'v1';
  solo: {
    endless: { bestScore: number; bestChain: number; plays: number };
    scoreAttack: { bestScore: number; plays: number };
  };
  online: {
    totalMatches: number;
    wins: number;
    losses: number;
    disconnects: number;
    maxChain: number;
    maxGarbageSent: number;
  };
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
}
```

### 4.4 `preferences`
```typescript
export interface PreferencesV1 {
  v: 'v1';
  lastColorMode: 4 | 5;
  lastCapacity: 2 | 3 | 4;
  tutorialCompleted: boolean;
  seenCreditsAt: string | null;
  joinCodeHistory: string[];
}
```

### 4.5 `session`(sessionStorage)
```typescript
export interface SessionV1 {
  v: 'v1';
  reconnectToken: string;
  matchRoomId: string;
  expiresAt: number;
  myPlayerId: string;
}
```

---

## 5. 型安全な Wrapper(`LocalStore`)

### 5.1 定義
```typescript
export interface StoreDef<T extends { v: string }> {
  key: string;
  defaults: T;
  validate: (raw: unknown) => raw is T;
  migrate: (raw: { v: string } & Record<string, unknown>) => T | null;
  storage?: 'local' | 'session';
}

export class LocalStore<T extends { v: string }> {
  constructor(private def: StoreDef<T>) {}

  read(): T {
    try {
      const area = this.def.storage === 'session' ? sessionStorage : localStorage;
      const raw = area.getItem(this.def.key);
      if (raw === null) return this.def.defaults;

      const parsed = JSON.parse(raw);
      if (this.def.validate(parsed)) return parsed;

      const migrated = this.def.migrate(parsed);
      if (migrated && this.def.validate(migrated)) {
        this.write(migrated);
        return migrated;
      }

      logger.warn({ key: this.def.key }, 'stored data invalid, using defaults');
      return this.def.defaults;
    } catch (e) {
      logger.error({ err: e, key: this.def.key }, 'failed to read storage');
      return this.def.defaults;
    }
  }

  write(value: T): void {
    try {
      const area = this.def.storage === 'session' ? sessionStorage : localStorage;
      area.setItem(this.def.key, JSON.stringify(value));
    } catch (e) {
      logger.error({ err: e, key: this.def.key }, 'failed to write storage');
    }
  }

  clear(): void {
    const area = this.def.storage === 'session' ? sessionStorage : localStorage;
    area.removeItem(this.def.key);
  }
}
```

### 5.2 インスタンス
```typescript
export const STORAGE = {
  profile:     new LocalStore<ProfileV1>    ({ key: 'chaindrop:profile',    defaults: PROFILE_DEFAULTS,    validate: isProfileV1,    migrate: migrateProfile }),
  settings:    new LocalStore<SettingsV1>   ({ key: 'chaindrop:settings',   defaults: SETTINGS_DEFAULTS,   validate: isSettingsV1,   migrate: migrateSettings }),
  stats:       new LocalStore<StatsV1>      ({ key: 'chaindrop:stats',      defaults: STATS_DEFAULTS,      validate: isStatsV1,      migrate: migrateStats }),
  preferences: new LocalStore<PreferencesV1>({ key: 'chaindrop:preferences',defaults: PREFERENCES_DEFAULTS,validate: isPreferencesV1,migrate: migratePreferences }),
  session:     new LocalStore<SessionV1>    ({ key: 'chaindrop:session',    defaults: SESSION_DEFAULTS, validate: isSessionV1, migrate: () => null, storage: 'session' }),
};
```

### 5.3 バリデータ(zod 採用)
```typescript
import { z } from 'zod';

export const ProfileV1Schema = z.object({
  v: z.literal('v1'),
  nickname: z.string().min(1).max(12),
  characterId: z.enum(['kiria','boltz','mira','groff','noctis','lumi','rook','vesper','mocha','zeta']),
  createdAt: z.string().datetime(),
});

export const isProfileV1 = (raw: unknown): raw is ProfileV1 =>
  ProfileV1Schema.safeParse(raw).success;
```

---

## 6. バージョン管理とマイグレーション

### 6.1 命名規約
- スキーマに必ず `v: 'vN'` を持たせる
- 古いバージョンの型も `ProfileV0` のように定義を残す
- 新バージョンを出すたびに **migrate 関数**を追加

### 6.2 migrate 関数の例
```typescript
export interface SettingsV2 extends Omit<SettingsV1, 'v'> {
  v: 'v2';
  display: SettingsV1['display'] & { graphicsQuality: 'low'|'high' };
}

export function migrateSettings(raw: { v: string } & Record<string, unknown>): SettingsV2 | null {
  switch (raw.v) {
    case 'v1': {
      const old = raw as unknown as SettingsV1;
      return {
        ...old,
        v: 'v2',
        display: { ...old.display, graphicsQuality: 'high' },
      };
    }
    case 'v2':
      return raw as SettingsV2;
    default:
      return null;
  }
}
```

### 6.3 Forward-compat
ユーザーが新版で遊んだ後、古い URL でアクセスした場合:
- **migrate は null を返し、defaults で起動**
- ログに警告を残す(ただし UI には出さない)

---

## 7. Zustand 連携

### 7.1 Hydrate(起動時読み込み)
```typescript
export const useSessionStore = create<SessionState>((set) => {
  const profile = STORAGE.profile.read();
  const settings = STORAGE.settings.read();
  return {
    ...profile,
    ...settings,
    setNickname: (n) => { STORAGE.profile.write({ ...STORAGE.profile.read(), nickname: n }); set({ nickname: n }); },
    setCharacter: (id) => { /* ... */ },
    setAudio: (kind, v) => { /* ... */ },
  };
});
```

### 7.2 書き込みタイミング
**原則: 変更のたびに即書き込み**(小容量なので debounce 不要)。

ただし以下は **debounce 500ms**:
- `stats`(マッチ中は頻繁に更新される)
- UI スライダーのリアルタイム変更(音量)

### 7.3 タブ間同期(オプション)
初期版では不要。

---

## 8. デフォルト値の運用

### 8.1 ソースオブトゥルース
各スキーマファイル内に `*_DEFAULTS` 定数として定義。

### 8.2 初期設定ガイド
初回起動時(`profile.nickname === ''`)の判定:
```typescript
if (STORAGE.profile.read().nickname === '') {
  transitionTo({ kind: 'title', params: { showNicknameModal: true } });
}
```

### 8.3 Reset to Defaults
```typescript
function resetSettings() {
  if (!confirm('本当にリセットしますか?')) return;
  STORAGE.settings.write(SETTINGS_DEFAULTS);
  useSessionStore.setState(SETTINGS_DEFAULTS);
}
```

**Profile は対象外**。

---

## 9. エラーハンドリング

### 9.1 localStorage 利用不可(Private モード等)
```typescript
function isStorageAvailable(area: 'local'|'session'): boolean {
  try {
    const s = area === 'local' ? localStorage : sessionStorage;
    s.setItem('__test__', 'x'); s.removeItem('__test__');
    return true;
  } catch { return false; }
}
```
- **利用不可時はメモリ内 Map に fallback**
- UI に「設定が保存されません」バナーを表示

### 9.2 QuotaExceededError
**優先度順に削減**:
```
1. stats を reset
2. preferences.joinCodeHistory を空に
3. それでもダメなら settings を defaults に戻す(最終手段)
```

### 9.3 JSON パース失敗
- `catch` で受けて `defaults` を返す
- 破損キーは `removeItem` して次回以降クリーン化

### 9.4 バリデーション失敗
- zod で失敗 → migrate 試行 → それも失敗なら defaults
- 「データ破損、設定を既定値に戻しました」を Toast

---

## 10. プライバシーとリセット

### 10.1 保存データの透明性
- すべてブラウザ内に留まる(サーバー送信しない)
- ニックネーム以外の PII は保存しない
- トラッキング Cookie は使わない

### 10.2 リセット手段
Settings → Advanced → "Clear All Local Data":
```typescript
function clearAllLocal() {
  if (!confirm('すべてのローカルデータを削除します。')) return;
  STORAGE.profile.clear();
  STORAGE.settings.clear();
  STORAGE.stats.clear();
  STORAGE.preferences.clear();
  STORAGE.session.clear();
  location.reload();
}
```

---

## 11. テスト

### 11.1 ユニット
| # | 内容 |
|---|---|
| TSt-01 | 各スキーマの `*_DEFAULTS` が `validate` を通る |
| TSt-02 | 破損 JSON → defaults を返す |
| TSt-03 | バージョン未知 → defaults を返す |
| TSt-04 | migrate v1 → v2 がスキーマ通り変換する |
| TSt-05 | QuotaExceeded シミュレーション → 優先度通りに削減 |
| TSt-06 | localStorage 不在時にメモリ fallback が動作 |
| TSt-07 | write → read でラウンドトリップ一致 |

### 11.2 統合
| # | 内容 |
|---|---|
| TSi-01 | 初回起動で NicknameModal が出る |
| TSi-02 | ニックネーム変更 → リロードで保持 |
| TSi-03 | キーリバインド → リロードで保持 |
| TSi-04 | Settings Reset → 既定値 |
| TSi-05 | Clear All Local Data → 初回起動状態に戻る |

---

## 12. セキュリティ考慮

### 12.1 XSS 経由の改ざん
- `localStorage` は同一オリジン内の JS から自由に読み書き可能
- 対策は XSS を出さないこと(CSP、入力エスケープ)
- 設定値に重要情報を入れない

### 12.2 reconnectToken の扱い
- `sessionStorage` に置く(タブ閉じで消える)
- 有効期限 5 秒、サーバー側も検証する

---

## 13. 将来の拡張ポイント

| 項目 | 必要になった時の置換先 |
|---|---|
| リプレイ保存 | IndexedDB |
| 統計の長期履歴 | IndexedDB or サーバー |
| クラウド同期 | 認証 + サーバー API |
| 実績システム | preferences に追記 or 新規 key |
| キャラ別設定 | preferences.perCharacter |

現在の設計なら**追加は破壊的変更なしで可能**。
