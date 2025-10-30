# Google Calendar API統合メモ

## 必要な手順

### Google Cloud Projectセットアップ
1. Google Cloud Consoleでプロジェクト作成
2. Google Calendar APIを有効化
3. OAuth Consent Screenの設定
4. OAuth Clientの作成（Web Application）
5. Client IDとClient Secretを取得
6. テストユーザーの追加（開発中）
7. 必要なスコープの追加

### 必要なスコープ
- `https://www.googleapis.com/auth/calendar.readonly` - カレンダーイベントの読み取り
- `https://www.googleapis.com/auth/calendar.events.readonly` - イベント詳細の読み取り

### 実装に必要なパッケージ
- `googleapis` - Google APIのNode.jsクライアント

### 認証フロー
1. ユーザーをGoogleの認証URLにリダイレクト
2. ユーザーが許可後、コールバックURLにリダイレクト
3. 認証コードを使ってアクセストークンを取得
4. アクセストークンを使ってCalendar APIを呼び出し

### APIエンドポイント
- Events List: `GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`
  - パラメータ: timeMin, timeMax, singleEvents, orderBy

## 実装方針
1. データベースにユーザーのGoogleトークンを保存
2. トークンのリフレッシュ処理を実装
3. カレンダーイベント取得機能を実装
4. 空き時間抽出ロジックを実装
