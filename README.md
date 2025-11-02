# FreePick

Googleカレンダーから空き時間を自動抽出するサービスです。

## 機能

- **Googleカレンダー連携**: Googleカレンダーと連携して予定を自動取得
- **複数カレンダー対応**: 複数のカレンダーを選択して空き時間を一括確認
- **柔軟な条件設定**:
  - 期間指定（開始日〜終了日）
  - 業務時間設定（開始時刻〜終了時刻）
  - 枠の長さ設定（15分〜240分）
  - 予定前後のバッファ時間設定（別々に設定可能）
  - 曜日選択（特定の曜日を除外）
  - 終日予定の無視設定
- **表示オプション**:
  - 連続した空き時間をまとめて表示
  - 30分単位のスロット表示
- **テキスト出力**: 空き時間をテキスト形式で出力し、コピー可能

## 技術スタック

### フロントエンド
- React 19
- TypeScript
- Tailwind CSS 4
- shadcn/ui
- tRPC (型安全なAPI通信)
- Wouter (ルーティング)

### バックエンド
- Node.js
- Express 4
- tRPC 11
- Drizzle ORM
- MySQL/TiDB

### 認証
- Manus OAuth
- Google OAuth 2.0

## セットアップ

### 前提条件
- Node.js 22.x
- pnpm

### インストール

```bash
# 依存関係のインストール
pnpm install

# 環境変数の設定
# .env ファイルを作成し、以下の変数を設定してください：
# - DATABASE_URL
# - GOOGLE_CLIENT_ID
# - GOOGLE_CLIENT_SECRET
# - JWT_SECRET
# - その他必要な環境変数

# データベースのマイグレーション
pnpm db:push

# 開発サーバーの起動
pnpm dev
```

### Google OAuth設定

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクトを作成
2. Google Calendar APIを有効化
3. OAuth 2.0クライアントIDを作成
4. リダイレクトURIを設定: `http://localhost:3000/api/oauth/google/callback`
5. クライアントIDとシークレットを環境変数に設定

## 使い方

1. アプリにログイン
2. Googleカレンダーと連携
3. 確認したいカレンダーを選択
4. 期間と条件を設定
5. 「空き時間を確認」をクリック
6. 結果をテキストでコピー

## ライセンス

MIT

## 作者

yuriagtz
