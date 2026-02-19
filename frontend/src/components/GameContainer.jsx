// src/components/GameContainer.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { initSocket } from '../socket';
import {
  createSession,
  joinSession,
  fetchRooms,
  fetchVersions,
  joinRoom,
  onLobbyUpdate,
  onGameStart,
  onUpdate,
  fetchState,
  fetchPrioritizedCards,
} from '../api';
import LobbyView   from './LobbyView';
import ReaderView  from './ReaderView';
import EndScreen   from './EndScreen';
import './GameContainer.css';

const VALID_SCREENS = ['welcome', 'create', 'join', 'lobby'];

const GameContainer = () => {
  // ===== socket init =====
  useEffect(() => {
    const socket = initSocket();
    return () => socket.disconnect();
  }, []);

  // ===== UI state =====
  const [screen,       setScreen]       = useState('welcome');
  const [sessionId,    setSessionId]    = useState('');
  const [name,         setName]         = useState('');
  const [player,       setPlayer]       = useState(null);
  const [lobby,        setLobby]        = useState(null);
  const [gameState,    setGameState]    = useState(null);
  const [roomList,     setRoomList]     = useState([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [versions,     setVersions]     = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [initialImage, setInitialImage] = useState(null);
  const [welcomeCards, setWelcomeCards] = useState([]);

  // ===== 履歴 =====
  const [roundsLocal, setRoundsLocal] = useState([]); // A: フロント蓄積
  const [roundsFinal, setRoundsFinal] = useState([]); // B: サーバ取得（空なら roundsLocal）

  // ===== マウント時リセット =====
  useEffect(() => {
    setScreen('welcome');
    setPlayer(null);
    setLobby(null);
    setGameState(null);
    setSessionId('');
    setRoundsLocal([]);
    setRoundsFinal([]);
  }, []);

  // ===== 画面フォールバック =====
  useEffect(() => {
    if (!VALID_SCREENS.includes(screen)) {
      setScreen('welcome');
      return;
    }
    if (screen === 'lobby' && (!player || !lobby)) {
      setScreen('welcome');
    }
  }, [screen, player, lobby]);

  // ===== サーバのイベント購読（ロビー） =====
  useEffect(() => {
    onLobbyUpdate((data) => setLobby(data));
    onGameStart(() => setLobby(prev => ({ ...(prev || {}), started: true })));
  }, []);

  useEffect(() => {
    const loadVersions = async () => {
      try {
        const { versions: v } = await fetchVersions();
        const next = Array.isArray(v) && v.length > 0 ? v : ['ポケモン', 'サンリオ', 'ちいかわ'];
        setVersions(next);
        if (!selectedVersion && next.length > 0) {
          setSelectedVersion(next[0]);
        }
      } catch (e) {
        console.error(e);
        const fallback = ['ポケモン', 'サンリオ', 'ちいかわ'];
        setVersions(fallback);
        if (!selectedVersion) {
          setSelectedVersion(fallback[0]);
        }
      }
    };
    loadVersions();
  }, []);

  // ===== タイトル背景用のキャラ画像 =====
  useEffect(() => {
    let cancelled = false;
    const loadWelcomeCards = async () => {
      try {
        const { cards } = await fetchPrioritizedCards(14);
        if (cancelled) return;
        const next = Array.isArray(cards) ? cards.filter((card) => card?.imageUrl) : [];
        setWelcomeCards(next);
      } catch (e) {
        console.error('welcome cards fetch failed:', e);
        if (!cancelled) setWelcomeCards([]);
      }
    };
    loadWelcomeCards();
    return () => {
      cancelled = true;
    };
  }, []);

  const welcomeBackgroundCards = useMemo(() => {
    return (welcomeCards || []).slice(0, 12).map((card, idx) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const left = 14 + col * 24 + (row % 2 === 0 ? -2 : 2);
      const top = 14 + row * 27 + (idx % 3 - 1) * 2;
      const duration = 8 + (idx % 4) * 2.2;
      const delay = -1.1 * (idx % 6);
      const size = 76 + (idx % 5) * 10;
      const rotate = (idx % 2 === 0 ? -1 : 1) * (4 + (idx % 3));
      const opacity = 0.24 + (idx % 4) * 0.08;

      return {
        key: `${card.id || idx}-${idx}`,
        imageUrl: card.imageUrl,
        positionStyle: { left: `${left}%`, top: `${top}%` },
        floatStyle: {
          '--float-duration': `${duration}s`,
          '--float-delay': `${delay}s`,
        },
        imageStyle: {
          '--card-size': `${size}px`,
          '--card-tilt': `${rotate}deg`,
          '--card-opacity': String(opacity),
        },
      };
    });
  }, [welcomeCards]);

  const isWelcomeScreen = screen === 'welcome';
  const goToAdminPage = () => {
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', '/admin');
    window.dispatchEvent(new Event('popstate'));
  };

  // ===== サーバのイベント購読（ゲーム進行・結果） =====
  useEffect(() => {
    // 状態更新（進行中の数値など）
    onUpdate('update',       (data) => setGameState(data));
    onUpdate('sessionState', (data) => setGameState(data));

    // A: ラウンド終了 → summary をローカルに追記（重複防止）
    onUpdate('roundResult',  ({ summary }) => {
      if (!Array.isArray(summary) || summary.length === 0) return;
      setRoundsLocal(prev => {
        const keyOf = (it) =>
          `${it.round ?? ''}:${it.playerId ?? ''}:${it.target ?? ''}:${it.chosen ?? ''}:${it.correct ? 1 : 0}`;
        const has = new Set(prev.map(keyOf));
        const uniqAdds = summary.filter(it => !has.has(keyOf(it)));
        return uniqAdds.length ? [...prev, ...uniqAdds] : prev;
      });
    });

    // ★ 最終結果：これが来たら即 finished にしつつ B を実行
    onUpdate('gameFinished', async (finalState) => {
      setGameState(finalState);
      try {
        const resp = await fetch(`/api/session/${finalState.id}/history`);
        if (resp.ok) {
          const { history } = await resp.json();
          setRoundsFinal(Array.isArray(history) && history.length ? history : roundsLocal);
        } else {
          setRoundsFinal(roundsLocal);
        }
      } catch {
        setRoundsFinal(roundsLocal);
      }
    });

    // フェーズ遷移：ズレ防止のため最新 state を取得
    onUpdate('phaseChange',  async (data) => {
      try {
        if (sessionId && player?.id) {
          const fresh = await fetchState(sessionId, player.id);
          setGameState(fresh);
        } else {
          setGameState(prev => ({ ...(prev || {}), phase: data?.phase }));
        }
      } catch (e) {
        console.error('fetchState on phaseChange failed:', e);
        setGameState(prev => ({ ...(prev || {}), phase: data?.phase }));
      }
    });
  }, [sessionId, player?.id, roundsLocal]);

  // ===== B: 終了検知→サーバ履歴を再取得（gameFinished が拾えなかった場合の保険） =====
  useEffect(() => {
    const fetchHistory = async () => {
      if (!gameState?.finished || !sessionId) return;
      try {
        const resp = await fetch(`/api/session/${sessionId}/history`);
        if (resp.ok) {
          const { history } = await resp.json();
          if (Array.isArray(history) && history.length > 0) {
            setRoundsFinal(history);
            return;
          }
        }
        setRoundsFinal(roundsLocal);
      } catch (e) {
        console.error('history fetch failed', e);
        setRoundsFinal(roundsLocal);
      }
    };
    fetchHistory();
  }, [gameState?.finished, sessionId, roundsLocal]);

  useEffect(() => {
    const syncGameState = async () => {
      if (!lobby?.started || !sessionId || !player?.id || gameState) return;
      try {
        const fresh = await fetchState(sessionId, player.id);
        setGameState(fresh);
      } catch (e) {
        console.error('initial fetchState failed:', e);
      }
    };
    syncGameState();
  }, [lobby?.started, sessionId, player?.id, gameState]);

  // ===== Actions =====
  const handleCreate = async () => {
    if (!name.trim()) { alert('名前を入力してね'); return; }
    try {
      const { sessionId: id, player: pl, lobby: lb, targetImageUrl } = await createSession(name.trim(), selectedVersion);
      setSessionId(id);
      setPlayer(pl);
      setLobby(lb);
      setInitialImage(targetImageUrl || null);
      setRoundsLocal([]);
      setRoundsFinal([]);
      joinRoom(id, pl?.id, pl?.name || name.trim());
      setScreen('lobby');
    } catch (e) {
      console.error(e);
      alert('セッション作成に失敗したわ…');
    }
  };

  const handleJoin = async () => {
    if (!selectedRoom || !name.trim()) { alert('ルームと名前を選んでね'); return; }
    try {
      const { player: pl, lobby: lb, targetImageUrl } = await joinSession(selectedRoom, name.trim());
      setSessionId(selectedRoom);
      setPlayer(pl);
      setLobby(lb);
      setInitialImage(targetImageUrl || null);
      setRoundsLocal([]);
      setRoundsFinal([]);
      joinRoom(selectedRoom, pl?.id, pl?.name || name.trim());
      setScreen('lobby');
    } catch (e) {
      console.error(e);
      alert('参加に失敗したわ…');
    }
  };

  const fetchRoomList = async () => {
    try {
      const { rooms } = await fetchRooms();
      setRoomList(rooms || []);
    } catch (e) {
      console.error(e);
      setRoomList([]);
      alert('ルーム一覧の取得に失敗したわ…');
    }
  };

  // ===== 1) 終了画面 =====
  if (gameState?.finished) {
    return (
      <EndScreen
        pairScore={gameState.pairScore}
        rounds={roundsFinal}                 // サーバ優先（空ならフロント蓄積）
        totalRounds={gameState.totalRounds}
        myPlayerId={player?.id}             // 自分の行だけ表示
        onRestart={() => window.location.reload()} // 「タイトルに戻る」
      />
    );
  }

  // ===== 2) 準備中 =====
  if (player && lobby && lobby.started && !gameState) {
    return (
      <div className="game-container">
        <p>ゲームを準備中…少し待っててね！</p>
      </div>
    );
  }

  // ===== 3) ロビー =====
  if (screen === 'lobby' && player && lobby && !lobby.started) {
    return (
      <div className="game-container">
        <LobbyView
          sessionId={sessionId}
          player={player}
          lobby={lobby}
          onBack={()   => {
            setPlayer(null);
            setLobby(null);
            setSessionId('');
            setRoundsLocal([]);
            setRoundsFinal([]);
            setScreen('welcome');
          }}
        />
      </div>
    );
  }

  // ===== 4) ゲーム中 =====
  if (gameState && lobby?.started) {
    const pairScore    = gameState?.pairScore ?? 0;
    const currentRound = gameState?.currentRound ?? 0;
    const totalRounds  = gameState?.totalRounds ?? 5;
    const players      = gameState?.players ?? [];

    return (
      <div className="game-screen">
        <div className="game-header">
          <div className="game-header-left">
            <div className="session-info">
              <div className="session-id">
                <span className="session-id-label"> セッションID</span>
                <span className="session-id-value">{sessionId}</span>
              </div>
            </div>
          </div>

          <div className="game-header-center">
            <div className="kpis">
              <div className="kpi-box kpi-score">
                <div className="kpi-label">ペアスコア</div>
                <div className="kpi-value">{pairScore}</div>
              </div>
              <div className="kpi-box kpi-round">
                <div className="kpi-label">ラウンド</div>
                <div className="kpi-value">
                  {currentRound}<span className="kpi-suffix">/{totalRounds}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="game-header-right">
            <ul className="player-inline">
              {players.map(p => (
                <li key={p.id ?? p.name} className="player-chip">
                  <span className="player-name">{p.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="game-content">
          <ReaderView
            session={sessionId}
            player={player}
            state={gameState}
            initialImage={initialImage}
          />
        </div>
      </div>
    );
  }

  // ===== 5) welcome / create / join =====
  return (
    <div className={`game-container ${isWelcomeScreen ? 'is-welcome-screen' : ''}`}>
      {screen === 'welcome' && (
        <>
          <div className="welcome-bg-layer welcome-bg-layer--full" aria-hidden="true">
            {welcomeBackgroundCards.map((card) => (
              <div key={card.key} className="welcome-bg-item" style={card.positionStyle}>
                <div className="welcome-bg-float" style={card.floatStyle}>
                  <img
                    src={card.imageUrl}
                    alt=""
                    style={card.imageStyle}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="welcome-screen">
            <h1>かわいいポイントみつけます！</h1>
            <h2>I'm a Cutie Finder</h2>
            <div className="welcome-buttons">
              <button className="primary-button" onClick={() => setScreen('create')}>
                <span className="icon">🎨</span> 新しいルームを作る
              </button>
              <button
                className="primary-button"
                onClick={() => { setScreen('join'); fetchRoomList(); }}
              >
                <span className="icon">🎮</span> ルームに参加
              </button>
              <button className="secondary-button admin-link-button" onClick={goToAdminPage}>
                <span className="icon">📊</span> データ管理ページ
              </button>
            </div>
          </div>
        </>
      )}

      {screen === 'create' && (
        <div className="create-room-screen">
          <h2><span className="icon">🎨</span> 新しいルームを作る</h2>
          <div className="input-container">
            <label>プレイヤー名</label>
            <input
              type="text"
              placeholder="名前を入力してね"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={10}
            />
            <p className="input-hint">※10文字まで</p>
          </div>
          <div className="input-container">
            <label>バージョン</label>
            <select
              value={selectedVersion}
              onChange={e => setSelectedVersion(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v} value={v}>{v}バージョン</option>
              ))}
            </select>
          </div>
          <div className="button-group">
            <button className="secondary-button" onClick={() => setScreen('welcome')}>
              <span className="icon">←</span> 戻る
            </button>
            <button className="primary-button" onClick={handleCreate}>
              <span className="icon">✨</span> ルームを作成
            </button>
          </div>
        </div>
      )}

      {screen === 'join' && (
        <div className="join-room-screen">
          <h2><span className="icon">🎮</span> ルームに参加</h2>
          <div className="input-container">
            <label>プレイヤー名</label>
            <input
              type="text"
              placeholder="名前を入力してね"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={10}
            />
          </div>
          <div className="input-container">
            <label>参加するルーム</label>
            <div className="room-select-container">
              <select
                value={selectedRoom}
                onChange={e => setSelectedRoom(e.target.value)}
                className="room-select"
              >
                <option value="">ルームを選んでね</option>
                {roomList.map(room => (
                  <option key={room} value={room}>ルーム: {room}</option>
                ))}
              </select>
              <button className="refresh-button" onClick={fetchRoomList} title="ルーム一覧を更新">
                <span className="icon">🔄</span>
              </button>
            </div>
            <p className="input-hint">
              {roomList.length === 0 ? "参加できるルームがありません" : `${roomList.length}個のルームが見つかりました`}
            </p>
          </div>
          <div className="button-group">
            <button className="secondary-button" onClick={() => setScreen('welcome')}>
              <span className="icon">←</span> 戻る
            </button>
            <button className="primary-button" onClick={handleJoin}>
              <span className="icon">👋</span> 参加する
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameContainer;
