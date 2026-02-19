import React, { useEffect, useState } from 'react';
import GameContainer from './components/GameContainer';
import AdminPage from './components/AdminPage';

function getPathname() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

const ADMIN_PATH_PATTERN = /^\/admin(?:\/|$)/;

const App = () => {
  const [pathname, setPathname] = useState(getPathname());

  useEffect(() => {
    const handlePathChange = () => setPathname(getPathname());
    window.addEventListener('popstate', handlePathChange);
    return () => window.removeEventListener('popstate', handlePathChange);
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
