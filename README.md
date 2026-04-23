# ChainDrop

落ちもの連鎖バトルゲーム。ソロプレイに加えて、最大 4 人まで同時にオンライン対戦できる。

> **Status**: 開発基盤 M0 セットアップ中

## 概要

- 6 × 12 のフィールドで組ぷよを操作し、同色 4 つ以上繋げて消す
- 連鎖でおじゃまぷよを相手に送る通ルール
- **ソロ**: Endless / Score Attack
- **オンライン**: 1v1 / 1v1v1 / 1v1v1v1(最大 4 人)
- 10 キャラクターから選択、イメージカラーで UI が変化

設計詳細は [docs/design/](./docs/design/) を参照。

## Quick Start

### 前提

- Node.js 22.x(`.nvmrc` で固定)
- pnpm 9.x(Corepack 経由)

### Setup

```bash
git clone https://github.com/<you>/chaindrop.git
cd chaindrop
nvm use && corepack enable
pnpm install
```

### Run

```bash
pnpm dev
```

- Client: http://localhost:5173
- Server: ws://localhost:2567

### Commands

| Script | What it does |
|--------|--------------|
| `pnpm dev` | Start client and server in parallel |
| `pnpm test` | Run all tests |
| `pnpm lint` | Check code style |
| `pnpm lint:fix` | Auto-fix code style |
| `pnpm typecheck` | TypeScript check across all packages |
| `pnpm build` | Production build |
| `pnpm preflight` | Run the same checks as CI |

## プロジェクト構成

```
chaindrop/
├── packages/
│   ├── shared/          # 純粋なゲームルール(I/Oなし、決定論)
│   ├── client/          # React + PixiJS フロントエンド
│   └── server/          # Colyseus サーバー
├── docs/
│   └── design/          # D1〜D10 詳細設計
└── scripts/             # ビルドヘルパー
```

## 開発マイルストーン

- **M0**: 開発基盤(現在) — monorepo、CI/CD、型チェック
- **M1**: コアルール(shared/rules/)実装 + ユニットテスト
- **M2**: ソロプレイ完成
- **M3**: ローカル 2 人対戦(おじゃま送受信・相殺)
- **M4**: サーバー + オンライン 1v1
- **M5**: 4 人対戦・観戦
- **M6**: UI 仕上げ・アセット・デプロイ

## ライセンス

MIT(予定)

## クレジット

使用素材の一覧は [docs/ASSETS.md](./docs/ASSETS.md)(M6 以降に整備)。
