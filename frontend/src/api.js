// src/api.js（完全版）
// server.js のエンドポイント/Socket.IO仕様に合わせた API ラッパ

import { initSocket } from './socket';

// ===== Backend Base URL =====
const RAW = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');
const IS_LOCAL =
  typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)/.test(window.location.hostname);
const API = RAW || (IS_LOCAL ? 'http://localhost:4000' : ''); // dev は自動で 4000 にフォールバック

// ===== 共通 fetch =====
async function jfetch(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${init?.method || 'GET'} ${url} failed: ${res.status} ${txt}`);
  }
  return res.json();
}

// ===== Socket helpers =====
const sock = () => initSocket();
export const joinRoom       = (sessionId, playerId, name) =>
  sock().emit('bindToRoom', { roomId: sessionId, playerId, name });
export const onLobbyUpdate  = (handler) => sock().on('lobbyUpdate', handler);
export const onGameStart    = (handler) => sock().on('gameStart',  handler);
export const onUpdate       = (event, handler) => sock().on(event, handler);

// ===== REST APIs =====
export const fetchRooms = async () => {
  const data = await jfetch(`${API}/api/rooms`);
  return { rooms: (data || []).map(r => r.id) };
};

export const fetchVersions = async () => {
  const data = await jfetch(`${API}/api/versions`);
  return { versions: Array.isArray(data?.versions) ? data.versions : [] };
};

export const createSession = async (name, version) => {
  const { roomId } = await jfetch(`${API}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version })
  });
  const joinRes = await jfetch(`${API}/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const lobby = await jfetch(`${API}/api/session/${roomId}/state`);
  return { sessionId: roomId, player: joinRes.player, lobby };
};

export const joinSession = async (sessionId, name) => {
  const joinRes = await jfetch(`${API}/api/rooms/${sessionId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const lobby = await jfetch(`${API}/api/session/${sessionId}/state`);
  return { player: joinRes.player, lobby };
};

export const setReady = (sessionId, playerId) =>
  jfetch(`${API}/api/rooms/${sessionId}/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId })
  });

export const cancelReady = (sessionId, playerId) =>
  jfetch(`${API}/api/rooms/${sessionId}/cancelReady`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId })
  });

export const requestCards = (sessionId, { for: playerId } = {}) => {
  const query = playerId ? `?for=${encodeURIComponent(playerId)}` : '';
  return jfetch(`${API}/api/session/${sessionId}/cards${query}`);
};

export const sendGuess = (sessionId, playerId, cardId) =>
  jfetch(`${API}/api/session/${sessionId}/guess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, cardId })
  });

export const fetchState = (sessionId, playerId) =>
  jfetch(`${API}/api/session/${sessionId}/state${playerId ? `?playerId=${encodeURIComponent(playerId)}` : ''}`);

// ★ マーキング追加（ON）
export const sendMarkStep = (sessionId, playerId, hintIndex, hintText, characterId) =>
  jfetch(`${API}/api/session/${sessionId}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, hintIndex, hintText, characterId })
  });

// ★ マーキング解除（OFF）
export const deleteMarkStep = (sessionId, playerId, hintIndex, characterId) =>
  jfetch(`${API}/api/session/${sessionId}/step`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, hintIndex, characterId })
  });

// 保存済みログの取得系
export const fetchMarkSteps = (sessionId, { playerId, round } = {}) => {
  const qs = new URLSearchParams();
  if (playerId) qs.set('playerId', playerId);
  if (round != null) qs.set('round', round);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return jfetch(`${API}/api/session/${sessionId}/steps${suffix}`);
};

export const fetchMarkSummary = (sessionId) =>
  jfetch(`${API}/api/session/${sessionId}/steps/summary`);

export const fetchAdminHints = ({
  version = '',
  character = '',
  summaryLimit = 0,
  recentLimit = 160,
} = {}) => {
  const qs = new URLSearchParams();
  if (version) qs.set('version', version);
  if (character) qs.set('character', character);
  if (summaryLimit != null) qs.set('summaryLimit', String(summaryLimit));
  if (recentLimit != null) qs.set('recentLimit', String(recentLimit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return jfetch(`${API}/api/admin/hints${suffix}`);
};

// ★ 優先ピック用API
export const fetchPrioritizedCards = async (limit = 10, excludeIds = []) => {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (excludeIds.length) qs.set('exclude', excludeIds.join(','));
  return jfetch(`${API}/api/cards/next?${qs.toString()}`);
};
