import React, { useEffect, useState, useMemo } from 'react';
import './EndScreen.css';
import { getCharacterNamesBulk } from '../lib/nameResolver';

function normalizeRounds(rounds) {
  if (Array.isArray(rounds)) return rounds;
  if (!rounds || typeof rounds !== 'object') return [];
  if (Array.isArray(rounds.summary)) return rounds.summary;
  const vals = Object.values(rounds);
  if (vals.length && typeof vals[0] === 'object') return vals;
  return [];
}

function coerceRoundItem(item, index) {
  const targetChar =
    item.targetChar ?? item.target ?? item.target_card ?? item.targetCardId ?? item.targetId ?? null;
  const targetName = item.targetName ?? item.target_name ?? '';
  const targetImageUrl = item.targetImageUrl ?? item.target_image_url ?? item.imageUrl ?? '';
  const clue = item.clue ?? '';
  const correct =
    typeof item.correct === 'boolean' ? item.correct : !!item.scored;
  const roundNum = item.round ?? item.roundIndex ?? index + 1;
  const playerId = item.playerId ?? item.player_id ?? null;
  const playerName = item.playerName ?? item.player_name ?? '';
  return { roundNum, targetChar, targetName, targetImageUrl, clue, correct, playerId, playerName };
}

export default function EndScreen({
  pairScore,
  rounds,
  totalRounds,
  myPlayerId,     // 自分のID
  onRestart,
  onLeave,
}) {
  const [nameMap, setNameMap] = useState({});

  // 受け取り → 正規化
  const raw = useMemo(() => normalizeRounds(rounds).map(coerceRoundItem), [rounds]);

  // ラウンド毎に整理（両者の回答を含める）
  const roundsData = useMemo(() => {
    if (!raw.length) return [];
    
    const byRound = {};
    raw.forEach(item => {
      const rKey = item.roundNum;
      if (!byRound[rKey]) {
        byRound[rKey] = {
          roundNum: rKey,
          targetChar: item.targetChar,
          targetName: item.targetName,
          targetImageUrl: item.targetImageUrl || '',
          clues: {},
          playerNames: {},
          matched: item.correct,
        };
      }
      if (!byRound[rKey].targetImageUrl && item.targetImageUrl) {
        byRound[rKey].targetImageUrl = item.targetImageUrl;
      }
      if (!byRound[rKey].targetName && item.targetName) {
        byRound[rKey].targetName = item.targetName;
      }
      byRound[rKey].clues[item.playerId] = item.clue;
      byRound[rKey].playerNames[item.playerId] = item.playerName;
    });
    
    return Object.values(byRound).sort((a, b) => a.roundNum - b.roundNum);
  }, [raw]);

  // 名前解決
  const targetIds = useMemo(
    () => roundsData.map(r => (r.targetChar != null ? String(r.targetChar) : null)).filter(Boolean),
    [roundsData]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (targetIds.length === 0) { setNameMap({}); return; }
      try {
        const names = await getCharacterNamesBulk(targetIds);
        if (cancelled) return;
        const m = {};
        targetIds.forEach((id, i) => (m[id] = names[i] ?? ''));
        setNameMap(m);
      } catch {
        if (!cancelled) setNameMap({});
      }
    })();
    return () => { cancelled = true; };
  }, [targetIds]);

  const finalPair   = typeof pairScore === 'number' ? pairScore : 0;
  const totalCorrect = roundsData.filter(r => r.matched).length;
  const accuracy = roundsData.length > 0 ? Math.round((totalCorrect / roundsData.length) * 100) : 0;

  return (
    <div className="endscreen-bg">
      <div className="endscreen-container">
        <div className="endscreen-header">
          <h1 className="endscreen-title">🎉 ゲーム終了！</h1>
        </div>

        <div className="score-board">
          <div className="score-display">
            <div className="score-label">ペアスコア</div>
            <div className="score-value">{finalPair}</div>
            <div className="score-subtitle">/ {totalRounds}</div>
          </div>
          <div className="accuracy-display">
            <div className="accuracy-label">一致率</div>
            <div className="accuracy-value">{accuracy}%</div>
            <div className="accuracy-detail">{totalCorrect} / {roundsData.length}</div>
          </div>
        </div>

        <div className="rounds-summary">
          <h2 className="rounds-title">結果！</h2>
          {roundsData.length === 0 ? (
            <div className="round-card empty">履歴がありません。</div>
          ) : (
            roundsData.map((round, idx) => {
              const id = round.targetChar != null ? String(round.targetChar) : '-';
              const charName = round.targetName || nameMap[id] || (id !== '-' ? `📍 ${id}` : '-');
              const myClue = round.clues[myPlayerId] || '-';
              const myName = round.playerNames[myPlayerId] || 'あなた';
              const otherEntries = Object.entries(round.clues)
                .filter(([pid]) => String(pid) !== String(myPlayerId));
              const otherClues = otherEntries.map(([, clue]) => clue).join(', ') || '-';
              const otherName = otherEntries.length > 0 
                ? (round.playerNames[otherEntries[0][0]] || '相手')
                : '相手';

              return (
                <div key={idx} className={`round-card ${round.matched ? 'matched' : 'no-match'}`}>
                  <div className="round-header">
                    <span className="round-number">ラウンド {round.roundNum}</span>
                    <span className={`result-badge ${round.matched ? 'correct' : 'incorrect'}`}>
                      {round.matched ? '一致！' : '不一致．．．'}
                    </span>
                  </div>

                  <div className="character-section">
                    {round.targetImageUrl && (
                      <img src={round.targetImageUrl} alt={round.targetName} className="char-image" />
                    )}
                    <p className="char-name">{charName}</p>
                  </div>

                  <div className="clues-section">
                    <div className="clue-item my-clue">
                      <span className="clue-owner">{myName}</span>
                      <span className="clue-text">{myClue}</span>
                    </div>
                    <div className="clue-item other-clue">
                      <span className="clue-owner">{otherName}</span>
                      <span className="clue-text">{otherClues}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="action-buttons">
          {typeof onRestart === 'function'
            ? <button onClick={onRestart} className="btn-restart">タイトルに戻る</button>
            : <button onClick={() => window.location.reload()} className="btn-restart">タイトルに戻る</button>}
          {typeof onLeave === 'function' && (
            <button onClick={onLeave} className="btn-leave">終了する</button>
          )}
        </div>
      </div>
    </div>
  );
}
