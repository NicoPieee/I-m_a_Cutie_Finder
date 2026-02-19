// src/components/GuesserView.jsx（完全版）
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { requestCards, sendGuess, sendMarkStep, deleteMarkStep } from '../api';
import { initSocket } from '../socket';
import './GuesserView.css';

export default function GuesserView({ session, player, state }) {
  const myId = player?.id;

  const [cards, setCards] = useState([]);
  const [currentClues, setCurrentClues] = useState([]);
  const [revealedCount, setRevealedCount] = useState(0);

  const [finalGuessMode, setFinalGuessMode] = useState(false);
  const [hasGuessed, setHasGuessed] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [panelResult, setPanelResult] = useState(null);
  const [toast, setToast] = useState(null);

  // マーキング配列（0:ヒント1, 1:ヒント2, 2:ヒント3）
  const [markByHint, setMarkByHint] = useState({ 0: [], 1: [], 2: [] });
  const [activeMark, setActiveMark] = useState(0);

  const hasClues = currentClues.length > 0;
  const allHintsRevealed = revealedCount >= currentClues.length && hasClues;

  const shuffle = useCallback((arr) => {
    const a = [...(arr || [])];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }, []);

  const normalizeUrl = useCallback((url) => {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)) {
        return url.replace(/^https:\/\//i, 'http://');
      }
      return url;
    }
    return url;
  }, []);

  // socket: ヒント受信
  useEffect(() => {
    const socket = initSocket();
    const onClues = (payload) => {
      if (!payload) return;
      const { to, clues } = payload;
      if (to !== myId) return;
      if (!Array.isArray(clues)) return;

      setCurrentClues(clues);
      setRevealedCount(1);
      setFinalGuessMode(false);
      setHasGuessed(false);
      setSelectedCard(null);
      setPanelResult(null);
      setMarkByHint({ 0: [], 1: [], 2: [] });
      setActiveMark(0);
    };
    socket?.on?.('clues', onClues);
    return () => socket?.off?.('clues', onClues);
  }, [myId]);

  // socket: 回答結果
  useEffect(() => {
    const socket = initSocket();
    const onResult = ({ to, correct }) => {
      if (to && to !== myId) return;
      setPanelResult({ correct });
      setToast({ text: correct ? '🎉 正解！' : '💥 不正解…', kind: correct ? 'ok' : 'ng' });
      const t = setTimeout(() => setToast(null), 1500);
      return () => clearTimeout(t);
    };
    socket?.on?.('guessResult', onResult);
    return () => socket?.off?.('guessResult', onResult);
  }, [myId]);

  // 盤面取得
  const isGuesserPhase = useMemo(() => state?.phase === 'guesser', [state?.phase]);
  useEffect(() => {
    const fetchCards = async () => {
      try {
        if (!session || !myId) return;
        const { cards: fetched } = await requestCards(session, { for: myId });
        setCards(shuffle(fetched || []).slice(0, 10));
      } catch (err) {
        console.error(err);
        alert('カードの取得に失敗したわ…');
      }
    };

    setCurrentClues([]);
    setRevealedCount(0);
    setFinalGuessMode(false);
    setHasGuessed(false);
    setSelectedCard(null);
    setPanelResult(null);
    setToast(null);
    setMarkByHint({ 0: [], 1: [], 2: [] });
    setActiveMark(0);

    if (isGuesserPhase) {
      fetchCards();
      const socket = initSocket();
      socket?.emit?.('fetchClues', { sessionId: session, playerId: myId });
    }
  }, [session, myId, isGuesserPhase, state?.currentRound, shuffle]);

  // UI操作
  const handleNextHint = () => {
    if (!hasClues) return;
    setRevealedCount((n) => {
      const next = Math.min(n + 1, currentClues.length);
      setActiveMark(Math.max(0, next - 1));
      return next;
    });
  };

  const toggleArrayItem = (arr, item) => {
    if (arr.includes(item)) return arr.filter((x) => x !== item);
    return [...arr, item];
  };

  const handleCardClick = (cardId) => {
    if (!hasClues) return;

    if (finalGuessMode) {
      if (hasGuessed) return;
      setHasGuessed(true);
      setSelectedCard(cardId);
      sendGuess(session, myId, cardId);
      return;
    }

    // ===== マーキング（ON/OFF） =====
    if (activeMark > revealedCount - 1) return;

    setMarkByHint((prev) => {
      const before = prev[activeMark] || [];
      const wasMarked = before.includes(cardId);
      const next = { ...prev };
      next[activeMark] = toggleArrayItem(before, cardId);

      const hintText = currentClues[activeMark];
      if (wasMarked) {
        deleteMarkStep(session, myId, activeMark + 1, cardId)
          .catch((e) => console.warn('deleteMarkStep failed:', e?.message));
      } else {
        sendMarkStep(session, myId, activeMark + 1, hintText, cardId)
          .catch((e) => console.warn('sendMarkStep failed:', e?.message));
      }

      return next;
    });
  };

  const getCardShadow = (cardId) => {
    const isH1 = (markByHint[0] || []).includes(cardId);
    const isH2 = (markByHint[1] || []).includes(cardId);
    const isH3 = (markByHint[2] || []).includes(cardId);

    const layers = [];
    if (isH1) layers.push('0 0 0 2px #FFD400');
    if (isH2) layers.push('0 0 0 4px #FF8C00');
    if (isH3) layers.push('0 0 0 6px #E53935');
    if (selectedCard === cardId) layers.push('0 0 0 3px #4caf50');

    return layers.length ? layers.join(', ') : undefined;
  };

  const markLabel = (idx) => `ヒント${idx + 1}`;
  const markCount = (idx) => (markByHint[idx] ? markByHint[idx].length : 0);

  return (
    <div className="guesser-shell">
      {toast && (
        <div
          className={`result-toast ${toast.kind === 'ok' ? 'ok' : 'ng'}`}
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            background: toast.kind === 'ok' ? '#11a36a' : '#c62828',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 12,
            boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
            zIndex: 9999,
            fontWeight: 700
          }}
        >
          {toast.text}
        </div>
      )}

      <section className="left-pane">
        <div className="panel card-board">
          <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>候補カード</h3>
            {!finalGuessMode && hasClues && (
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                マーキング対象：<strong>{markLabel(activeMark)}</strong>
                <span style={{ marginLeft: 8 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#FFD400', borderRadius: 2, marginRight: 4 }} />{markCount(0)}
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#FF8C00', borderRadius: 2, margin: '0 4px 0 12px' }} />{markCount(1)}
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#E53935', borderRadius: 2, marginLeft: 12 }} />{markCount(2)}
                </span>
              </div>
            )}
          </div>

          <div className="board-grid">
            {cards.map((card) => (
              <div
                key={card.id}
                className={`card-item${hasGuessed ? ' disabled' : ''}`}
                onClick={() => handleCardClick(card.id)}
                aria-label={card.name}
                style={{
                  boxShadow: getCardShadow(card.id),
                  pointerEvents: hasGuessed ? 'none' : 'auto',
                  opacity: hasClues ? 1 : 0.9,
                  transition: 'box-shadow 120ms ease',
                  position: 'relative'
                }}
              >
                <div className="card-thumb">
                  <img src={normalizeUrl(card.imageUrl)} alt={card.name} />
                </div>

                {/* ここでカード下の常時表示の名前を削除（ホバー時ツールチップのみ表示） */}

                {/* ホバー時にフルネーム表示するツールチップ */}
                <div className="card-tooltip" role="tooltip">
                  {card.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="right-pane">
        <div className="panel clues-panel">
          <h3 className="panel-title">ヒント</h3>
          <ul className="clues-list">
            {currentClues.slice(0, revealedCount).map((clue, idx) => {
              const isActive = activeMark === idx;
              const color = idx === 0 ? '#FFD400' : idx === 1 ? '#FF8C00' : '#E53935';
              return (
                <li
                  key={idx}
                  className="clue-item"
                  onClick={() => setActiveMark(idx)}
                  style={{
                    cursor: 'pointer',
                    borderLeft: `6px solid ${color}`,
                    background: isActive ? 'rgba(0,0,0,0.05)' : undefined,
                    paddingLeft: 10,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span>ヒント{idx + 1}：{clue}</span>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>選択中: {markCount(idx)}枚</span>
                </li>
              );
            })}
            {!hasClues && <li className="clue-item" style={{ opacity: .75 }}>相手のヒントはまだ届いていないわ…</li>}
          </ul>

          <div className="controls">
            {!allHintsRevealed && !finalGuessMode && !hasGuessed && (
              <button className="btn next" onClick={handleNextHint} disabled={!hasClues}>次のヒントへ</button>
            )}
            {allHintsRevealed && !finalGuessMode && !hasGuessed && (
              <button className="btn primary" onClick={() => setFinalGuessMode(true)}>正解だと思うゆるキャラを選ぶ</button>
            )}
          </div>

          {panelResult && (
            <div className={`result-box ${panelResult.correct ? 'correct' : 'incorrect'}`}>
              {panelResult.correct ? '🎉 正解！' : '💥 不正解…'}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
