// src/socket.js
import { io } from 'socket.io-client';

let socket = null;

export const initSocket = () => {
  if (!socket) {
    // Render 本番: .env に REACT_APP_API_URL=https://yuru-karuta.onrender.com を必ず設定
    const raw = (process.env.REACT_APP_API_URL || '').trim().replace(/\/$/, '');
    const isLocal =
      typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)/.test(window.location.hostname);
    const url = raw || (isLocal ? 'http://localhost:4000' : undefined); // dev は 4000 に自動接続

    socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => console.log('Socket connected!'));
    socket.on('connect_error', (err) =>
      console.error('Socket connection error:', err)
    );
  }
  return socket;
};

export const getSocket = () => socket || initSocket();

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
