# I'm a Cutie Finder

かわいいキャラ画像を使った、2人協力型の推理ゲームです。1人が読み手として3つのヒントを出し、もう1人が手札から正解のキャラクターを当てます。ラウンドごとに役割が入れ替わります。

## 現在の実装でできること

- 2人でルームを作成して参加できる
- 5ラウンド固定で進行する
- 読み手は各ラウンドで3つのヒントを入力する
- 当て手はヒントを見ながら候補カードをマーキングできる
- 回答結果とスコアをリアルタイムで同期する
- 終了後にラウンド履歴を確認できる
- 管理画面からヒントデータを参照できる

## 技術スタック

### バックエンド
- Node.js
- Express 4.19
- Socket.IO 4.7
- PostgreSQL 8.11 系クライアント

### フロントエンド
- React 19.1
- Socket.IO Client 4.7
- react-scripts 5.0

## 対応データ

画像は backend/images 以下のバージョン別フォルダから読み込みます。現在のデータセットは次の3系統です。

- サンリオ
- ちいかわ
- ポケモン

## 起動方法

### 前提条件

- Node.js
- npm

### 1. バックエンド

```bash
cd backend
npm install
npm start
```

バックエンドは既定で http://localhost:4000 で起動します。

### 2. フロントエンド

別ターミナルで実行します。

```bash
cd frontend
npm install
npm start
```

フロントエンドは既定で http://localhost:3000 で起動します。

## 環境変数

### backend/.env

```env
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
PUBLIC_BASE_URL=http://localhost:4000
WAITING_ROOM_TIMEOUT_MS=120000
```

- PORT: バックエンドの待受ポート
- FRONTEND_ORIGIN: CORS と Socket.IO の許可オリジン。カンマ区切りで複数指定可
- DATABASE_URL: ヒント・回答・マーキングログの保存に使う PostgreSQL 接続文字列
- PUBLIC_BASE_URL: 画像URLを絶対URLで組み立てたい場合のベースURL
- WAITING_ROOM_TIMEOUT_MS: ルーム待機タイムアウト。未設定時は 120000

### frontend/.env

```env
REACT_APP_API_URL=http://localhost:4000
```

- REACT_APP_API_URL: バックエンド API と Socket.IO の接続先

## 使い方

1. フロントエンドを開き、1人目がルームを作成する
2. 2人目が同じルームに参加する
3. 両者が準備完了にするとゲーム開始
4. 読み手は3つのヒントを入力する
5. 当て手はカードを選んで回答する
6. 結果後、次のラウンドで役割が交代する

## 主な画面

- ロビー画面
- 読み手画面
- 当て手画面
- 結果画面
- 管理画面（/admin）

## 主な API

### ルーム・セッション

- GET /api/rooms
- POST /api/rooms
- POST /api/rooms/:id/join
- POST /api/rooms/:id/ready
- POST /api/rooms/:id/cancelReady
- GET /api/session/:id/state
- GET /api/session/:id/cards
- POST /api/session/:id/guess
- GET /api/session/:id/history

### カード・データ

- GET /api/versions
- GET /api/cards/next
- GET /api/characters
- GET /api/characters/:id

### マーキング・管理

- POST /api/session/:id/step
- DELETE /api/session/:id/step
- GET /api/session/:id/steps
- GET /api/session/:id/steps/summary
- GET /api/admin/hints

### ヘルスチェック

- GET /healthz
- GET /healthz/db

## プロジェクト構成

```text
README.md
backend/
  characterStore.js
  package.json
  server.js
  images/
    サンリオ/
    ちいかわ/
    ポケモン/
frontend/
  package.json
  public/
    index.html
  src/
    api.js
    App.jsx
    characterMap.js
    index.css
    index.js
    socket.js
    components/
      AdminPage.jsx
      CardGrid.jsx
      ClueInput.jsx
      EndScreen.jsx
      GameContainer.jsx
      GuesserView.jsx
      LobbyView.jsx
      PlayerList.jsx
      ReaderView.jsx
      ScoreBoard.jsx
    lib/
      nameResolver.js
```

## 補足

- バックエンドは DATABASE_URL がある場合のみ PostgreSQL に接続します
- フロントエンドはローカル開発時に API URL を省略すると http://localhost:4000 を使います
- 本番環境では FRONTEND_ORIGIN と REACT_APP_API_URL の設定を一致させてください

## ライセンス

MIT
