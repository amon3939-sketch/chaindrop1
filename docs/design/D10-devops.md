# D10. 開発環境・CI/CD

## 1. 方針

| # | 方針 | 理由 |
|---|---|---|
| 1 | **monorepo** (pnpm workspaces) | client/server/shared を 1 リポジトリで共有型・依存管理 |
| 2 | **単一のフォーマッタ/リンタ** | 設定ファイル増殖を避ける |
| 3 | **CI が通らないと merge 不可** | 壊れた main を作らない |
| 4 | **デプロイは push-to-deploy** | 手順を文書化せず、workflow を読めばわかる状態に |
| 5 | **ローカルで CI と同じコマンドが走る** | 「ローカルで通って CI で落ちる」を減らす |

---

## 2. リポジトリ構成

```
chaindrop/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── deploy-client.yml
│   │   └── deploy-server.yml
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
├── packages/
│   ├── shared/
│   ├── client/
│   └── server/
├── docs/
│   ├── design/
│   ├── characters/
│   └── ASSETS.md
├── scripts/
├── .editorconfig
├── .gitignore
├── .gitattributes
├── .nvmrc
├── .npmrc
├── biome.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── LICENSE
└── README.md
```

---

## 3. ツールチェーン

| 項目 | 採用 | バージョン |
|---|---|---|
| ランタイム | **Node.js** | 22 LTS |
| パッケージマネージャ | **pnpm** | 9.x |
| 言語 | **TypeScript** | 5.5+ |
| ビルドツール | **Vite** | 6.x |
| フレームワーク | **React** | 18.x |
| ゲーム描画 | **PixiJS** | 8.x |
| 通信 | **Colyseus** | 0.16+ |
| Lint/Format | **Biome** | 1.9+ |
| テスト | **Vitest** | 2.x |
| E2E | **Playwright** | 1.47+ |
| バリデーション | **zod** | 3.x |
| ロガー | **pino** | 9.x(server)|

---

## 4. パッケージ構成と依存

### 4.1 `package.json`(ルート)
```json
{
  "name": "chaindrop",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev":         "pnpm -r --parallel dev",
    "build":       "pnpm -r build",
    "test":        "pnpm -r test",
    "lint":        "biome check .",
    "lint:fix":    "biome check --write .",
    "format":      "biome format --write .",
    "typecheck":   "pnpm -r typecheck",
    "preflight":   "pnpm lint && pnpm typecheck && pnpm test && pnpm build",
    "prepare":     "simple-git-hooks"
  }
}
```

### 4.2 `pnpm-workspace.yaml`
```yaml
packages:
  - 'packages/*'
```

### 4.3 依存方向の強制
- `shared` は**何にも依存しない**
- `client` と `server` は `shared` を参照
- `client` と `server` は**相互依存禁止**

---

## 5. TypeScript 設定

### 5.1 `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  }
}
```

### 5.2 Project References
各 package を TS Project References で繋ぐ:
- ビルド順が自動解決
- `tsc --build` でインクリメンタルビルド

---

## 6. コードスタイル(Biome)

### 6.1 採用理由
Biome はフォーマット+Linter を単一ツールで提供、Rust 製で 10〜100倍高速。

### 6.2 `biome.json`
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "files": {
    "ignore": ["node_modules", "dist", "build", "coverage", "**/*.generated.*"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "useExhaustiveDependencies": "warn",
        "noUnusedVariables": "error"
      },
      "style": {
        "useImportType": "error",
        "useConst": "error",
        "noNonNullAssertion": "warn"
      },
      "suspicious": {
        "noExplicitAny": "error",
        "noConsoleLog": "warn"
      }
    }
  }
}
```

---

## 7. テスト設定

### 7.1 Vitest
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
      },
    },
  },
});
```

### 7.2 テスト種別と配置
| 種別 | 場所 | ツール |
|---|---|---|
| 純粋関数 | `src/**/*.test.ts` | Vitest |
| 統合 | `test/integration/**` | Vitest + mock |
| サーバールーム | `test/**/*.test.ts` | Vitest + `@colyseus/testing` |
| E2E | `test/e2e/**` | Playwright |

---

## 8. Git 運用・ブランチ戦略

### 8.1 ブランチ
```
main              ← 常にデプロイ可能な状態
  └─ feat/...     ← 新機能
  └─ fix/...      ← バグ修正
  └─ chore/...    ← ビルド設定・依存更新
  └─ docs/...     ← ドキュメントのみ
  └─ refactor/... ← 挙動変更なしのリファクタ
```

**原則**:
- 直接 push 禁止(main はブランチ保護)
- 1 PR = 1 論理変更
- マージは **Squash merge**

### 8.2 ブランチ保護
- Require pull request before merging
- Require status checks to pass: `CI / lint-typecheck-test-build`
- Do not allow bypassing

---

## 9. コミット規約(Conventional Commits)

### 9.1 形式
```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 用途 |
|---|---|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `docs` | ドキュメント |
| `style` | フォーマット変更 |
| `refactor` | リファクタ |
| `perf` | パフォーマンス改善 |
| `test` | テストのみ |
| `chore` | ビルド・依存・設定 |

### 9.2 例
```
feat(rules): implement chain resolution algorithm with tests

Based on D1 §7. Handles garbage clustering and gravity.
Chain bonus table per D3.

Closes #12
```

---

## 10. Pre-commit フック

**simple-git-hooks**(軽量)採用。

### 10.1 pre-commit
- `lint-staged` → 変更ファイルのみに対し `biome check --write`
- 重い `typecheck`/`test` はかけない

### 10.2 commit-msg
- Conventional Commits 形式か簡易検証

---

## 11. GitHub Actions(CI)

### 11.1 `ci.yml`
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-typecheck-test-build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test -- --coverage
      - run: pnpm build
```

---

## 12. デプロイ(CD)

### 12.1 クライアント: GitHub Pages

`deploy-client.yml`:
```yaml
name: Deploy Client
on:
  push:
    branches: [main]
    paths:
      - 'packages/client/**'
      - 'packages/shared/**'
      - 'pnpm-lock.yaml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -F client build
        env:
          VITE_SERVER_URL: ${{ secrets.SERVER_URL_PRODUCTION }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: packages/client/dist }
      - uses: actions/deploy-pages@v4
```

### 12.2 サーバー: Fly.io

`deploy-server.yml`:
```yaml
name: Deploy Server
on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only -c packages/server/fly.toml
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 12.3 ロールバック手順
- クライアント: GitHub Pages の過去 artifact を re-deploy
- サーバー: `flyctl releases list` → `flyctl deploy --image <previous>`

---

## 13. 環境変数管理

### 13.1 クライアント
| 変数 | 例 | 備考 |
|---|---|---|
| `VITE_SERVER_URL` | `wss://chaindrop-server.fly.dev` | 本番 WebSocket |
| `VITE_DEBUG` | `false` | URL param `?debug=1` で上書き可 |

### 13.2 サーバー
| 変数 | 例 | 備考 |
|---|---|---|
| `PORT` | `2567` | |
| `ALLOWED_ORIGINS` | `https://<user>.github.io` | カンマ区切り |
| `LOG_LEVEL` | `info` | |
| `MONITOR_ENABLED` | `true` | |
| `MONITOR_USER`/`PASS` | — | GitHub Secrets / Fly secrets |

---

## 14. バージョニング

### 14.1 方針
- Semver(`v1.2.3`)
- プロトコル非互換で major
- **プロトコル互換性**を client と server で管理:
  - `shared/protocol/version.ts` に `PROTOCOL_VERSION = 1` を持つ
  - `MATCH_JOIN` 時に互換性チェック

### 14.2 タグ作成
```bash
git switch main && git pull
pnpm version <major|minor|patch> --no-git-tag-version
git commit -am "chore(release): v$(jq -r .version package.json)"
git tag "v$(jq -r .version package.json)"
git push && git push --tags
```

---

## 15. ドキュメント運用

### 15.1 場所
```
docs/
├── design/             // D1〜D10 の成果物
├── characters/         // キャラデザインシート
├── ASSETS.md           // 素材取得先・クレジット
└── ARCHITECTURE.md     // 鳥瞰図
```

### 15.2 README
リポジトリ Root の README.md に:
- プロジェクト概要
- ライブプレイ URL
- スクリーンショット
- ローカル起動手順
- ライセンス
- 使用素材クレジット

---

## 16. ローカル開発フロー

### 16.1 初回セットアップ
```bash
nvm use                        # .nvmrc の v22
corepack enable
pnpm install
```

### 16.2 日常の起動
```bash
pnpm dev                       # 両方同時に起動
pnpm -F client dev             # 個別起動
pnpm -F server dev
```

### 16.3 コミット前の確認
```bash
pnpm preflight   # lint + typecheck + test + build
```

### 16.4 よく使うコマンド
| コマンド | 内容 |
|---|---|
| `pnpm dev` | 全 package 並行起動 |
| `pnpm test` | 全テスト |
| `pnpm -F shared test --watch` | shared のテストを監視 |
| `pnpm lint:fix` | 自動修正 |
| `pnpm build` | 本番ビルド |
| `pnpm preflight` | CI 相当の一括チェック |

---

## 17. テレメトリ・ログ(本番)

### 17.1 サーバー
- **構造化ログ**(pino)→ stdout → Fly.io の `flyctl logs` で確認
- エラーレポート: 最初は手動確認
- メトリクス: Fly.io 標準ダッシュボード

### 17.2 クライアント
- コンソールログのみ(`?debug=1` で冗長化)
- クラッシュ時の簡易レポート: localStorage に保存
- 外部収集は**初期版スコープ外**

---

## 18. M0: 開発基盤構築

D1〜D10 の実装マイルストーンに入る前に、**M0** として以下を整備する:

| 作業 | 完了条件 |
|---|---|
| monorepo 初期化 | `pnpm install` が通る |
| TypeScript 設定 | 各 package で `pnpm typecheck` がエラー 0 |
| Biome 設定 | `pnpm lint` がエラー 0 |
| Vitest 動作確認 | ダミーテストで `pnpm test` が通る |
| GitHub Actions CI | main 保護が有効、CI が PR で走る |
| GitHub Pages 設定 | プレースホルダ HTML がデプロイされ表示 |
| Fly.io アプリ作成 | `fly launch` → hello world で起動 |
| Docker 疎通 | `docker build && docker run` で server が 2567 で応答 |
| シークレット設定 | Fly/GitHub 両方に必要な値を投入 |

M0 は **1〜2 日** を目安。以降は M1(コアルール実装)に進む。
