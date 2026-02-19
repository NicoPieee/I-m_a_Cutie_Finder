import React from 'react';

const PlayerList = ({ players }) => {
  return (
    <div>
      <h3>参加中のプレイヤー</h3>
      <ul>
        {players.map(p => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default PlayerList;
