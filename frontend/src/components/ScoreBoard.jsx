// src/components/ScoreBoard.jsx
import React from 'react';
import './ScoreBoard.css';

const ScoreBoard = ({ pairScore, currentRound, totalRounds }) => (
  <div className="scoreboard">
    <h3>ペアスコア: {pairScore}pt</h3>
    <p>ラウンド: {currentRound}/{totalRounds}</p>
  </div>
);

export default ScoreBoard;
