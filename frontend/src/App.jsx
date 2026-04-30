import React, { useEffect, useState } from 'react';
import GameContainer from './components/GameContainer';
import AdminPage from './components/AdminPage';

const ADMIN_PATH_PATTERN = /^\/admin(?:\/|$)/;
const ROOT_PATH_PATTERN = /^\/(?:#\/)?$/;

function resolveRoutePath() {
  if (typeof window === 'undefined') return '/';

  const pathname = window.location.pathname || '/';
  const rawHash = window.location.hash || '';
  const hashPath = rawHash
    ? (rawHash.startsWith('#/') ? rawHash.slice(1) : `/${rawHash.slice(1)}`)
    : '/';

  if (ADMIN_PATH_PATTERN.test(pathname) || ADMIN_PATH_PATTERN.test(hashPath)) {
    return '/admin';
  }

  if (ROOT_PATH_PATTERN.test(pathname)) {
    return '/';
  }

  return pathname;
}

const App = () => {
  const [pathname, setPathname] = useState(resolveRoutePath());

  useEffect(() => {
    const handlePathChange = () => setPathname(resolveRoutePath());
    window.addEventListener('popstate', handlePathChange);
    window.addEventListener('hashchange', handlePathChange);
    return () => {
      window.removeEventListener('popstate', handlePathChange);
      window.removeEventListener('hashchange', handlePathChange);
    };
  }, []);

  if (ADMIN_PATH_PATTERN.test(pathname)) {
    return <AdminPage />;
  }

  return (
    <div style={{ padding: '1rem' }}>
      <GameContainer />
    </div>
  );
};

export default App;
