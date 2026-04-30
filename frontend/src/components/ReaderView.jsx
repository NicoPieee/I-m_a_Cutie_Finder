// src/components/ReaderView.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import ClueInput from './ClueInput';
import { initSocket } from '../socket';
import './ReaderView.css';

export default function ReaderView({ session, player, state, initialImage }) {
  const myId = player?.id || '';
  const targetName = useMemo(() => state?.myAssignment?.writeTargetName || '', [state?.myAssignment]);
  const targetImageUrl = useMemo(() => {
    const raw = state?.myAssignment?.writeTargetImageUrl || initialImage || '';
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/images/')) {
      const envBase = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');
      if (envBase) return `${envBase}${raw}`;
      if (typeof window !== 'undefined' && window.location.port === '3000') {
        return `http://localhost:4000${raw}`;
      }
    }
    return raw;
  }, [state?.myAssignment, initialImage]);

  const [imageUrl, setImageUrl]       = useState(targetImageUrl || '');
  const [submitted, setSubmitted]     = useState(false);
  const [roundResult, setRoundResult] = useState(null); // 結果表示用
  const sendingRef = useRef(false);                    // 二重送信防止

  useEffect(() => {
    setImageUrl(targetImageUrl || '');
  }, [targetImageUrl]);

  useEffect(() => {
    setSubmitted(false);
    setRoundResult(null); // ラウンド変更時にリセット
    sendingRef.current = false;
  }, [state?.currentRound]);

  // roundResult イベントをリッスン
  useEffect(() => {
    const socket = initSocket?.() || window.socket;
    if (!socket) return;

    const handleRoundResult = (payload) => {
      setRoundResult(payload);
    };

    socket.on('roundResult', handleRoundResult);
    return () => socket.off('roundResult', handleRoundResult);
  }, []);

  // ヒント送信
  const handleSubmitClues = (word) => {
    if (sendingRef.current || submitted) return; // 多重送信防止
    sendingRef.current = true;

    const socket = initSocket?.() || window.socket;
    socket?.emit?.('clues', {
      sessionId: session,
      authorId: myId,
      clues: [word],
      timestamp: Date.now(),
    });

    setSubmitted(true);

    // 念のため数百msでロック解除（Socket送達で十分だが、UI固まり回避用）
    setTimeout(() => { sendingRef.current = false; }, 400);
  };

  return (
    <div className="reader-view">
      {!submitted ? (
        <ClueInput
          targetImage={imageUrl}
          targetName={targetName}
          onSubmit={handleSubmitClues}
        />
      ) : roundResult ? (
        // 結果が来たら表示
        (() => {
          const summary = roundResult.summary || [];
          const matched = roundResult.matched ?? false;
          const myResult = summary.find((r) => r.playerId === myId) || null;
          const otherResult = summary.find((r) => r.playerId !== myId) || null;
          const myClue = myResult?.clue || '-';
          const otherClue = otherResult?.clue || '-';
          const myName =
            myResult?.playerName ||
            state?.players?.find((p) => p.id === myId)?.name ||
            'あなた';
          const otherName =
            otherResult?.playerName ||
            state?.players?.find((p) => p.id === otherResult?.playerId)?.name ||
            '相手';

          return (
            <div className="round-result-display">
              <div className="result-target">
                <img src={imageUrl} alt={targetName} className="result-target-image" />
                <p className="result-target-name">{targetName}</p>
              </div>

              <div className="result-clues">
                <div className="clue-row">
                  <span className="clue-label">{myName}の答え</span>
                  <span className="clue-value">{myClue}</span>
                </div>
                <div className="clue-row">
                  <span className="clue-label">{otherName}の答え</span>
                  <span className="clue-value">{otherClue}</span>
                </div>
              </div>

              <div className={`result-verdict ${matched ? 'matched' : 'no-match'}`}>
                {matched ? '一致！' : '不一致．．．'}
              </div>

              <p className="result-auto-next">次のラウンドへ…</p>
            </div>
          );
        })()
      ) : (
        // 送信後、結果待ち
        <div className="reader-view-submitted">
          <ClueInput
            targetImage={imageUrl}
            targetName={targetName}
            onSubmit={handleSubmitClues}
            disabled={true}
            waitingMessage="相手の送信を待ってるよ〜"
          />
        </div>
      )}
    </div>
  );
}
