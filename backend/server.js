/* eslint-disable no-console */
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const TOTAL_ROUNDS_FIXED = 5;
const MAX_PLAYERS = 2;

// ====== 環境変数 ======
const PORT = process.env.PORT || 4000;
// 本番フロント（Render のフロントURLに合わせてね）＋ローカル開発用
const FRONTEND_ORIGINS = process.env.FRONTEND_ORIGIN
  ? String(process.env.FRONTEND_ORIGIN)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  : [
      'https://yuru-karuta-jgf3.onrender.com',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
// 画像URLをhttps固定で組み立てるためのベース
// 例: https://yuru-karuta.onrender.com
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || null;

// ====== DB接続（任意） ======
const hasDb = !!process.env.DATABASE_URL;
const pool = hasDb
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

// ====== 画像関連 ======
const IMAGE_ROOT = path.join(__dirname, 'images');

function encodePathSegments(relPath) {
  return String(relPath)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function makeCardId(version, filenameNoExt) {
  return `${version}::${filenameNoExt}`;
}

function buildImageCatalog() {
  const result = {
    versions: [],
    cardsByVersion: {},
    cardsById: {},
    allCards: [],
  };

  if (!fs.existsSync(IMAGE_ROOT)) return result;

  try {
    const versionDirs = fs
      .readdirSync(IMAGE_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const version of versionDirs) {
      const dirAbs = path.join(IMAGE_ROOT, version);
      const files = fs
        .readdirSync(dirAbs, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .filter((f) => /\.(png|jpe?g|webp)$/i.test(f));

      const cards = files.map((file) => {
        const filenameNoExt = file.replace(/\.(png|jpe?g|webp)$/i, '');
        const relPath = `${version}/${file}`;
        const id = makeCardId(version, filenameNoExt);
        return {
          id,
          version,
          name: filenameNoExt,
          relPath,
        };
      });

      result.versions.push(version);
      result.cardsByVersion[version] = cards;
      for (const card of cards) result.cardsById[card.id] = card;
      result.allCards.push(...cards);
    }
  } catch (e) {
    console.error('[images] scan failed:', e);
  }

  return result;
}

let IMAGE_CATALOG = buildImageCatalog();

function getAllowedVersions() {
  return IMAGE_CATALOG.versions;
}

function getCardsByVersion(version) {
  if (version && IMAGE_CATALOG.cardsByVersion[version]) {
    return IMAGE_CATALOG.cardsByVersion[version];
  }
  return IMAGE_CATALOG.allCards;
}

function getImageUrlAbs(req, relPath) {
  const safeRel = `/images/${encodePathSegments(relPath)}`;
  if (PUBLIC_BASE_URL) {
    return `${String(PUBLIC_BASE_URL).replace(/\/$/, '')}${safeRel}`;
  }
  if (!req) {
    return `http://localhost:${PORT}${safeRel}`;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}${safeRel}`;
}

function toPublicCard(req, card) {
  if (!card) return null;
  return {
    id: card.id,
    version: card.version,
    name: card.name,
    imageUrl: getImageUrlAbs(req, card.relPath),
  };
}

// 静的配信（キャッシュ可）
const appStatic = express.static(IMAGE_ROOT, { immutable: true, maxAge: '30d' });

// ====== テーブル作成 ======
async function ensureTables() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hint_logs (
      id SERIAL PRIMARY KEY,
      session_id  TEXT,
      round       INT,
      author_id   TEXT,
      opponent_id TEXT,
      target_char TEXT,
      clues       JSONB,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guess_logs (
      id SERIAL PRIMARY KEY,
      session_id  TEXT,
      round       INT,
      player_id   TEXT,
      target_char TEXT,
      chosen_card TEXT,
      correct     BOOLEAN,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // ★ 推論メモ保存テーブル
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guess_steps (
      id SERIAL PRIMARY KEY,
      session_id    TEXT NOT NULL,
      round         INT,
      player_id     TEXT NOT NULL,
      hint_index    INT  NOT NULL,
      hint_text     TEXT,
      selected_char TEXT NOT NULL,
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // よく使うクエリのためのインデックス（存在しなければ）
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_guess_logs_session_created
      ON guess_logs (session_id, created_at);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_guess_session_round
      ON guess_logs (session_id, round);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_guess_steps_sess_round
      ON guess_steps (session_id, round);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_guess_steps_char
      ON guess_steps (selected_char);
  `);
  // 空/NULL ヒントを除く部分インデックス（優先ピックの集計で効く）
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_guess_steps_selected_char_nonempty_hint
      ON guess_steps (selected_char)
      WHERE NULLIF(BTRIM(hint_text), '') IS NOT NULL;
  `);
}

// ====== App / HTTP / Socket ======
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: FRONTEND_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
);
app.use('/images', appStatic);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_ORIGINS, methods: ['GET', 'POST'], credentials: true },
});

// ====== ルーム/セッション ======
/**
 * room = {
 *   id, players: [{id, name, socketId, ready, score}],
 *   started, finished,
 *   phase: 'reader'|'guesser',
 *   currentRound, totalRounds, pairScore,
 *   assignments: { [pid]: { writeTarget, opponentId } },
 *   cluesBy:     { [pid]: string[] },
 *   guessesBy:   { [pid]: { cardId, correct, scored } },
 *   cardsFor:    { [pid]: string[] },
 *   pendingClues:   Set<playerId>,
 *   pendingGuesses: Set<playerId>,
 *   history: []
 * }
 */
const rooms = new Map();
const socketToPlayer = new Map(); // socket.id -> { roomId, playerId }

function createRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function createPlayerId() {
  return Math.random().toString(36).slice(2, 10);
}
function sampleOne(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}
function getActivePlayers(room, ioInstance = io) {
  return room.players.filter(
    (p) => p.socketId && ioInstance.sockets.sockets.get(p.socketId)
  );
}

function normalizeHiragana(input) {
  const text = String(input || '').trim().normalize('NFKC');
  if (!text) return '';
  if (!/^[ぁ-ゖー゛゜]+$/.test(text)) return '';
  return text;
}

function normalizeAdminFilter(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'all' || lower === 'all_versions' || text === '全バージョン') return null;
  return text;
}

function parseAdminLimit(input, fallback, max) {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function pickRoundCard(room) {
  const poolCards = getCardsByVersion(room.selectedVersion);
  return sampleOne(poolCards);
}

// ====== 公開状態 ======
function publicState(room) {
  return {
    id: room.id,
    selectedVersion: room.selectedVersion,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
    })),
    started: room.started,
    finished: room.finished,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    pairScore: room.pairScore,
  };
}
function stateForPlayer(room, playerId) {
  const pub = publicState(room);
  return {
    ...pub,
    myAssignment: room.assignments?.[playerId] || null,
  };
}

// ====== ラウンド制御 ======
async function startRound(room, reqLike) {
  const active = getActivePlayers(room);
  if (active.length < 2) {
    room.cluesBy = {};
    room.assignments = {};
    room.pendingClues = new Set();
    io.to(room.id).emit('update', publicState(room));
    return;
  }

  const roundCard = pickRoundCard(room);
  if (!roundCard) {
    console.error(`No cards found for version: ${room.selectedVersion}`);
    return;
  }

  room.cluesBy = {};
  room.assignments = {};
  room.pendingClues = new Set(active.map((p) => p.id));

  for (const pl of active) {
    const opponent = active.find((x) => x.id !== pl.id);
    room.assignments[pl.id] = {
      writeTarget: roundCard.id,
      writeTargetName: roundCard.name,
      writeTargetImageUrl: getImageUrlAbs(reqLike, roundCard.relPath),
      opponentId: opponent?.id || null,
    };
  }

  for (const pl of active) {
    const sock = io.sockets.sockets.get(pl.socketId);
    if (sock) sock.emit('update', stateForPlayer(room, pl.id));
  }
  io.to(room.id).emit('lobbyUpdate', publicState(room));
}

async function tryStartGame(room) {
  if (room.started) return;
  if (room.players.length !== 2) return;
  const active = getActivePlayers(room);
  if (active.length !== 2) return;

  room.started = true;
  room.finished = false;
  room.currentRound = 1;
  room.pairScore = 0;
  room.history = [];

  io.to(room.id).emit('gameStart', publicState(room));
  await startRound(room);
}

function finishRoundNow(room) {
  const active = getActivePlayers(room);
  if (active.length < 2) return;

  const p1 = active[0]?.id;
  const p2 = active[1]?.id;
  const clue1 = normalizeHiragana(room.cluesBy?.[p1]);
  const clue2 = normalizeHiragana(room.cluesBy?.[p2]);
  const matched = !!clue1 && !!clue2 && clue1 === clue2;
  if (matched) room.pairScore += 1;

  const summary = active.map((pl) => {
    const assignment = room.assignments?.[pl.id] || {};
    return {
      playerId: pl.id,
      playerName: pl.name,
      correct: matched,
      target: assignment.writeTarget || null,
      targetName: assignment.writeTargetName || '',
      targetImageUrl: assignment.writeTargetImageUrl || '',
      clue: normalizeHiragana(room.cluesBy?.[pl.id]),
      round: room.currentRound,
    };
  });

  io.to(room.id).emit('roundResult', {
    summary,
    pairScore: room.pairScore,
    matched,
    clues: { [p1]: clue1, [p2]: clue2 },
  });

  if (Array.isArray(room.history)) {
    room.history.push(...summary);
  }

  const NEXT_DELAY_MS = 5000; // 5秒で次ラウンドへ
  setTimeout(() => {
    room.currentRound += 1;
    if (room.currentRound > room.totalRounds) {
      room.finished = true;
      io.to(room.id).emit('update', publicState(room));
      io.to(room.id).emit('gameFinished', publicState(room));
      return;
    }
    // 非同期だがここは fire-and-forget でOK
    startRound(room).catch((e) => console.error('startRound error:', e));
  }, NEXT_DELAY_MS);
}

// ====== REST ======
app.get('/api/rooms', (req, res) => {
  const data = Array.from(rooms.values()).map((r) => ({
    id: r.id,
    selectedVersion: r.selectedVersion,
    started: r.started,
    finished: r.finished,
    players: r.players.map((p) => ({ id: p.id, name: p.name })),
  }));
  res.json(data);
});

app.post('/api/rooms', (req, res) => {
  const roomId = createRoomId();
  const requestedVersion = String(req.body?.version || '').trim();
  const versions = getAllowedVersions();
  const selectedVersion = versions.includes(requestedVersion) ? requestedVersion : versions[0] || '';

  if (!selectedVersion) {
    return res.status(400).json({ error: 'no image versions found' });
  }

  const room = {
    id: roomId,
    selectedVersion,
    players: [],
    started: false,
    finished: false,
    currentRound: 0,
    totalRounds: TOTAL_ROUNDS_FIXED,
    pairScore: 0,
    assignments: {},
    cluesBy: {},
    pendingClues: new Set(),
    history: [],
  };
  rooms.set(roomId, room);
  res.json({ roomId, selectedVersion, totalRounds: TOTAL_ROUNDS_FIXED });
});

app.post('/api/rooms/:id/join', async (req, res) => {
  const { name, playerId, socketId } = req.body || {};
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });

  const exists = room.players.find((p) => p.id === playerId);
  if (!exists && room.players.length >= MAX_PLAYERS) {
    return res.status(400).json({ error: 'room is full (2 players only)' });
  }

  const pid = playerId || createPlayerId();
  const player = {
    id: pid,
    name: String(name || 'Player'),
    socketId: String(socketId || ''),
    score: 0,
  };
  if (!room.players.find((p) => p.id === pid)) room.players.push(player);

  io.to(room.id).emit('lobbyUpdate', publicState(room));
  await tryStartGame(room);
  res.json({ roomId: room.id, player });
});

app.post('/api/rooms/:id/ready', async (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  await tryStartGame(room);
  res.json(publicState(room));
});

app.post('/api/rooms/:id/cancelReady', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  res.json(publicState(room));
});

app.get('/api/session/:id/state', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });

  const pid = String(req.query.playerId || '');
  if (!pid) return res.json(publicState(room));
  res.json(stateForPlayer(room, pid));
});

app.get('/api/session/:id/cards', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });

  const cards = getCardsByVersion(room.selectedVersion).map((card) => toPublicCard(req, card));
  res.json({ cards, selectedVersion: room.selectedVersion });
});

app.get('/api/versions', (req, res) => {
  res.json({ versions: getAllowedVersions() });
});

// === Admin: 「どこが」集計/ログ
app.get('/api/admin/hints', async (req, res) => {
  if (!pool) return res.status(501).json({ error: 'db not configured' });

  const versionFilter = normalizeAdminFilter(req.query.version);
  const characterFilter = normalizeAdminFilter(req.query.character);
  const summaryLimit = parseAdminLimit(req.query.summaryLimit, 0, 5000);
  const recentLimit = parseAdminLimit(req.query.recentLimit, 160, 1000);

  // hint_logs.clues は jsonb（文字列/配列どちらでも安全に取り出す）
  const HINT_TEXT_SQL = `NULLIF(BTRIM(CASE
    WHEN jsonb_typeof(clues) = 'array' THEN clues->>0
    ELSE clues #>> '{}'
  END), '')`;

  const baseFilters = [
    "target_char LIKE '%::%'",
    `${HINT_TEXT_SQL} IS NOT NULL`,
  ];
  const baseValues = [];
  let idx = 1;

  if (versionFilter) {
    baseFilters.push(`split_part(target_char, '::', 1) = $${idx++}`);
    baseValues.push(versionFilter);
  }
  if (characterFilter) {
    baseFilters.push(`split_part(target_char, '::', 2) = $${idx++}`);
    baseValues.push(characterFilter);
  }

  const whereClause = baseFilters.join(' AND ');
  const summaryLimitClause = summaryLimit > 0 ? `LIMIT ${summaryLimit}` : '';
  const recentLimitClause = recentLimit > 0 ? `LIMIT ${recentLimit}` : '';

  const charactersFilters = [
    "target_char LIKE '%::%'",
    `${HINT_TEXT_SQL} IS NOT NULL`,
  ];
  const charactersValues = [];
  let cIdx = 1;
  if (versionFilter) {
    charactersFilters.push(`split_part(target_char, '::', 1) = $${cIdx++}`);
    charactersValues.push(versionFilter);
  }
  const charactersWhereClause = charactersFilters.join(' AND ');

  try {
    const [summaryResult, recentResult, metaResult, versionsResult, charactersResult] =
      await Promise.all([
        pool.query(
          `WITH base AS (
             SELECT
               split_part(target_char, '::', 1) AS version,
               split_part(target_char, '::', 2) AS character_name,
               ${HINT_TEXT_SQL} AS where_text
             FROM hint_logs
             WHERE ${whereClause}
           )
           SELECT
             version,
             character_name,
             where_text,
             COUNT(*)::int AS cnt
           FROM base
           GROUP BY version, character_name, where_text
           ORDER BY version ASC, character_name ASC, cnt DESC, where_text ASC
           ${summaryLimitClause}`,
          baseValues
        ),
        pool.query(
          `SELECT
             id,
             session_id,
             round,
             split_part(target_char, '::', 1) AS version,
             split_part(target_char, '::', 2) AS character_name,
             ${HINT_TEXT_SQL} AS where_text,
             created_at
           FROM hint_logs
           WHERE ${whereClause}
           ORDER BY created_at DESC
           ${recentLimitClause}`,
          baseValues
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total_hints,
             COUNT(DISTINCT split_part(target_char, '::', 2))::int AS unique_characters,
             COUNT(DISTINCT ${HINT_TEXT_SQL})::int AS unique_keywords
           FROM hint_logs
           WHERE ${whereClause}`,
          baseValues
        ),
        pool.query(
          `SELECT DISTINCT split_part(target_char, '::', 1) AS version
           FROM hint_logs
           WHERE target_char LIKE '%::%'
           ORDER BY version ASC`
        ),
        pool.query(
          `SELECT DISTINCT split_part(target_char, '::', 2) AS character_name
           FROM hint_logs
           WHERE ${charactersWhereClause}
           ORDER BY character_name ASC`,
          charactersValues
        ),
      ]);

    const loggedVersions = (versionsResult.rows || [])
      .map((r) => String(r.version || '').trim())
      .filter(Boolean);
    const versions = Array.from(new Set([...getAllowedVersions(), ...loggedVersions]));

    const metaRow = metaResult.rows?.[0] || {};
    const summary = (summaryResult.rows || []).map((r) => ({
      version: String(r.version || ''),
      characterName: String(r.character_name || ''),
      whereText: String(r.where_text || ''),
      count: Number(r.cnt || 0),
    }));
    const recent = (recentResult.rows || []).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      round: r.round,
      version: String(r.version || ''),
      characterName: String(r.character_name || ''),
      whereText: String(r.where_text || ''),
      createdAt: r.created_at,
    }));
    const characters = (charactersResult.rows || [])
      .map((r) => String(r.character_name || '').trim())
      .filter(Boolean);

    return res.json({
      ok: true,
      filters: {
        version: versionFilter,
        character: characterFilter,
      },
      fetchedAt: new Date().toISOString(),
      versions,
      characters,
      meta: {
        totalHints: Number(metaRow.total_hints || 0),
        uniqueCharacters: Number(metaRow.unique_characters || 0),
        uniqueKeywords: Number(metaRow.unique_keywords || 0),
      },
      summary,
      recent,
    });
  } catch (e) {
    console.error('GET /api/admin/hints error:', e);
    return res.status(500).json({ error: 'admin query failed' });
  }
});

// === 互換API（バージョン別カード）
app.get('/api/cards/next', async (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const version = String(req.query.version || '').trim();
  const excludeParam = (req.query.exclude || '').toString().trim();
  const excludeIds = new Set(
    excludeParam
      ? excludeParam.split(',').map((s) => s.trim()).filter(Boolean)
      : []
  );

  const poolCards = getCardsByVersion(version).filter((card) => !excludeIds.has(card.id));
  const cards = poolCards
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.max(0, limit))
    .map((card) => toPublicCard(req, card));

  res.json({ cards, selectedVersion: version || null });
});

// === 推論メモの保存（ON）
app.post('/api/session/:id/step', async (req, res) => {
  const sessionId = req.params.id;
  const { playerId, hintIndex, hintText, characterId } = req.body || {};
  if (!pool) return res.status(501).json({ error: 'db not configured' });

  if (!playerId || !Number.isFinite(Number(hintIndex)) || !characterId) {
    return res.status(400).json({ error: 'playerId, hintIndex, characterId are required' });
  }

  const room = rooms.get(sessionId);
  const round =
    room && Number.isFinite(Number(room.currentRound)) ? Number(room.currentRound) : null;

  const selectedChar = String(characterId);

  try {
    await pool.query(
      `INSERT INTO guess_steps (session_id, round, player_id, hint_index, hint_text, selected_char)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sessionId, round, String(playerId), Number(hintIndex), String(hintText || ''), selectedChar]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /step insert error:', e);
    return res.status(500).json({ error: 'insert failed' });
  }
});

// === 推論メモの削除（OFF / 2度目クリックで外す）
app.delete('/api/session/:id/step', async (req, res) => {
  const sessionId = req.params.id;
  const { playerId, hintIndex, characterId } = req.body || {};
  if (!pool) return res.status(501).json({ error: 'db not configured' });

  if (!playerId || !Number.isFinite(Number(hintIndex)) || !characterId) {
    return res.status(400).json({ error: 'playerId, hintIndex, characterId are required' });
  }

  const room = rooms.get(sessionId);
  const round =
    room && Number.isFinite(Number(room.currentRound)) ? Number(room.currentRound) : null;

  const selectedChar = String(characterId);

  try {
    await pool.query(
      `DELETE FROM guess_steps
        WHERE session_id = $1
          AND (round = $2 OR ($2 IS NULL AND round IS NULL))
          AND player_id = $3
          AND hint_index = $4
          AND selected_char = $5`,
      [sessionId, round, String(playerId), Number(hintIndex), selectedChar]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /step error:', e);
    return res.status(500).json({ error: 'delete failed' });
  }
});

// === 推論メモの一覧
app.get('/api/session/:id/steps', async (req, res) => {
  const sessionId = req.params.id;
  if (!pool) return res.status(501).json({ error: 'db not configured' });

  const q = [];
  const vals = [sessionId];
  let idx = 2;

  if (req.query.playerId) {
    q.push(`player_id = $${idx++}`);
    vals.push(String(req.query.playerId));
  }
  if (req.query.round) {
    q.push(`round = $${idx++}`);
    vals.push(Number(req.query.round));
  }

  const where = q.length ? `AND ${q.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT id, session_id, round, player_id, hint_index, hint_text, selected_char, created_at
         FROM guess_steps
        WHERE session_id = $1 ${where}
        ORDER BY created_at ASC, id ASC`,
      vals
    );
    return res.json({
      steps: rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        round: r.round,
        playerId: r.player_id,
        hintIndex: r.hint_index,
        hintText: r.hint_text,
        characterId: String(r.selected_char),
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    console.error('GET /steps error:', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

// === “キャラ→ヒント”集計（セッション内）
app.get('/api/session/:id/steps/summary', async (req, res) => {
  const sessionId = req.params.id;
  if (!pool) return res.status(501).json({ error: 'db not configured' });

  try {
    const { rows } = await pool.query(
      `SELECT selected_char,
              json_agg(json_build_object('hintIndex', hint_index, 'hintText', hint_text)
                       ORDER BY hint_index ASC) AS hints
         FROM guess_steps
        WHERE session_id = $1
        GROUP BY selected_char
        ORDER BY selected_char ASC`,
      [sessionId]
    );

    const map = {};
    for (const r of rows) {
      const cardId = String(r.selected_char);
      map[cardId] = {
        characterId: cardId,
        name: cardId,
        hints: (r.hints || []).map((h) => ({
          hintIndex: h.hintIndex,
          hintText: h.hintText,
        })),
      };
    }
    return res.json({ summary: map });
  } catch (e) {
    console.error('GET /steps/summary error:', e);
    return res.status(500).json({ error: 'summary failed' });
  }
});

// === 推測の確定
app.post('/api/session/:id/guess', async (req, res) => {
  res.status(410).json({ error: 'guess phase disabled in current game mode' });
});

// ====== 履歴API（DB優先 / フォールバック）
app.get('/api/session/:id/history', async (req, res) => {
  const sessionId = req.params.id;

  const room = rooms.get(sessionId);
  if (!room) return res.status(404).json({ error: 'room not found' });
  return res.json({ history: Array.isArray(room.history) ? room.history : [], source: 'memory' });
});

// ====== Socket.IO ======
io.on('connection', (socket) => {
  socket.on('bindToRoom', async ({ roomId, playerId, name }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    socket.join(roomId);

    const ex = room.players.find((p) => p.id === playerId);
    if (ex) {
      ex.socketId = socket.id;
      if (name) ex.name = name;
    } else if (room.players.length < MAX_PLAYERS) {
      room.players.push({
        id: playerId,
        name: name || 'Player',
        socketId: socket.id,
        score: 0,
      });
    } else {
      socket.emit('roomError', { message: 'room is full' });
      return;
    }

    socketToPlayer.set(socket.id, { roomId, playerId });
    io.to(roomId).emit('lobbyUpdate', publicState(room));

    await tryStartGame(room);

    if (room.started) {
      socket.emit('gameStart', publicState(room));
      socket.emit('update', stateForPlayer(room, playerId));
    }
  });

  socket.on('fetchLobby', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) socket.emit('lobbyUpdate', publicState(room));
  });

  // 読み手：ヒント送信
  socket.on('clues', async ({ sessionId, authorId, clues }) => {
    const room = rooms.get(sessionId);
    if (!room || !room.started || room.finished) return;
    if (!room.pendingClues?.has(authorId)) return;

    const firstClue = Array.isArray(clues) ? clues[0] : clues;
    room.cluesBy[authorId] = normalizeHiragana(firstClue);
    if (room.pendingClues) room.pendingClues.delete(authorId);

    if (pool) {
      const oppId = room.assignments[authorId]?.opponentId;
      const target = String(room.assignments[authorId]?.writeTarget || '');
      try {
        await pool.query(
          'INSERT INTO hint_logs (session_id, round, author_id, opponent_id, target_char, clues) VALUES ($1,$2,$3,$4,$5,$6)',
          [room.id, room.currentRound, authorId, oppId, target, JSON.stringify(room.cluesBy[authorId])]
        );
      } catch (e) {
        console.error('DB hint_logs insert error:', e);
      }
    }

    // 両者揃ったら即ラウンド判定
    if (room.pendingClues && room.pendingClues.size === 0) {
      try {
        finishRoundNow(room);
      } catch (e) {
        console.error('finishRoundNow error:', e);
      }
    }
  });

  // 取り手からの明示的なヒント取得要求
  socket.on('fetchClues', ({ sessionId, playerId }) => {
    const room = rooms.get(sessionId);
    if (!room) return;
    const oppId = room.assignments[playerId]?.opponentId;
    if (!oppId) return;
    const clues = room.cluesBy?.[oppId] || [];
    socket.emit('clues', { from: oppId, to: playerId, clues });
  });

  socket.on('disconnect', () => {
    const info = socketToPlayer.get(socket.id);
    if (!info) return;
    const { roomId, playerId } = info;
    socketToPlayer.delete(socket.id);

    const room = rooms.get(roomId);
    if (!room) return;

    const pl = room.players.find((p) => p.id === playerId);
    if (pl && pl.socketId === socket.id) pl.socketId = '';

    io.to(roomId).emit('lobbyUpdate', publicState(room));

    // 5秒後、誰も繋がっていなければ部屋解散
    setTimeout(() => {
      const r = rooms.get(roomId);
      if (!r) return;
      const someoneConnected = r.players.some(
        (p) => p.socketId && io.sockets.sockets.get(p.socketId)
      );
      if (!someoneConnected) {
        rooms.delete(roomId);
        io.to(roomId).emit('roomClosed', { roomId });
      }
    }, 5000);
  });
});

// ====== キャラ名補助API ======
app.get('/api/characters/:id', (req, res) => {
  const id = String(req.params.id || '');
  const name = id;
  res.json({ id, name });
});
app.get('/api/characters', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  res.json(ids.map((id) => ({ id, name: id })));
});

// ====== Health & Root ======
app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});

// ★ DBヘルスチェック追加
app.get('/healthz/db', async (req, res) => {
  if (!pool) return res.status(501).json({ ok: false, reason: 'db not configured' });
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    console.error('[db] healthz failed:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/', (req, res) => {
  res.status(200).send('Yuru_Karuta_backend is up ✅');
});

// ====== 起動 ======
(async () => {
  try {
    await ensureTables();
  } catch (e) {
    console.error('ensureTables error:', e);
  }

  // ★ 起動時に一度だけDBチェック（ここがポイント）
  if (pool) {
    try {
      await pool.query('SELECT 1');
      console.log('[db] connected OK');
    } catch (e) {
      console.error('[db] connection failed', e);
    }
  } else {
    console.log('[db] no DATABASE_URL, skipping DB setup');
  }

  server.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
    const origins = Array.isArray(FRONTEND_ORIGINS)
      ? FRONTEND_ORIGINS.join(', ')
      : String(FRONTEND_ORIGINS);
    console.log(`Allowed origins: ${origins}`);
  });
})();
