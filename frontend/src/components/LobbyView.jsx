// src/components/LobbyView.jsx
import React from 'react';
import './LobbyView.css';

export default function LobbyView({ sessionId, player, lobby, onBack }) {
  const meId = player?.id;
  const players = Array.isArray(lobby?.players) ? lobby.players : [];

  return (
    <div className="lobby-bg">
      <div className="lobby-container">
        <h2 className="lobby-title">ロビー</h2>
        <p className="lobby-session">
          セッションID: <span className="lobby-session-id">{sessionId}</span>
        </p>

        <ul className="lobby-list">
          {players.map((p) => {
            const isMe = p.id === meId;
            return (
              <li key={p.id} className="lobby-item">
                <span>
                  {p.name}{isMe ? '（あなた）' : ''}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="lobby-actions">
          <button className="lobby-btn lobby-btn-back" onClick={onBack}>← 戻る</button>
        </div>

        {!lobby?.started && (
          <div className="lobby-started">※ 2人そろうと自動でゲーム開始！</div>
        )}
      </div>
    </div>
  );
}
