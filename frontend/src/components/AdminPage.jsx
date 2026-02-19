import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAdminHints } from '../api';
import './AdminPage.css';

const ALL_VALUE = '__all__';

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function navigate(pathname) {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', pathname);
  window.dispatchEvent(new Event('popstate'));
}

const EMPTY_DATA = {
  versions: [],
  characters: [],
  meta: {
    totalHints: 0,
    uniqueCharacters: 0,
    uniqueKeywords: 0,
  },
  summary: [],
  recent: [],
  fetchedAt: null,
};

export default function AdminPage() {
  const [version, setVersion] = useState(ALL_VALUE);
  const [character, setCharacter] = useState(ALL_VALUE);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const payload = await fetchAdminHints({
          version: version !== ALL_VALUE ? version : '',
          character: character !== ALL_VALUE ? character : '',
          summaryLimit: 0,
          recentLimit: 160,
        });
        setData({
          ...EMPTY_DATA,
          ...payload,
          meta: { ...EMPTY_DATA.meta, ...(payload?.meta || {}) },
          summary: Array.isArray(payload?.summary) ? payload.summary : [],
          recent: Array.isArray(payload?.recent) ? payload.recent : [],
          versions: Array.isArray(payload?.versions) ? payload.versions : [],
          characters: Array.isArray(payload?.characters) ? payload.characters : [],
        });
      } catch (e) {
        console.error('admin fetch failed:', e);
        setError('管理データの取得に失敗しました。APIとDB接続を確認してね。');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [version, character]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(() => {
      loadData({ silent: true });
    }, 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, loadData]);

  const versionOptions = useMemo(() => [ALL_VALUE, ...data.versions], [data.versions]);
  const characterOptions = useMemo(() => [ALL_VALUE, ...data.characters], [data.characters]);

  useEffect(() => {
    if (character === ALL_VALUE) return;
    if (!data.characters.includes(character)) {
      setCharacter(ALL_VALUE);
    }
  }, [character, data.characters]);

  const hasSummaryRows = data.summary.length > 0;
  const hasRecentRows = data.recent.length > 0;

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <section className="admin-panel admin-header">
          <div>
            <p className="admin-eyebrow">Admin Dashboard</p>
            <h1 className="admin-title">どこがデータ管理</h1>
            <p className="admin-subtitle">全バージョンの「どこが」集計をリアルタイムで確認</p>
          </div>
          <div className="admin-header-actions">
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => navigate('/')}
            >
              ゲームへ戻る
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={() => loadData()}
            >
              今すぐ更新
            </button>
          </div>
        </section>

        <section className="admin-panel admin-controls">
          <label className="admin-field">
            <span>バージョン</span>
            <select
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                setCharacter(ALL_VALUE);
              }}
            >
              {versionOptions.map((v) => (
                <option key={v} value={v}>
                  {v === ALL_VALUE ? '全バージョン' : v}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-field">
            <span>キャラ</span>
            <select value={character} onChange={(e) => setCharacter(e.target.value)}>
              {characterOptions.map((c) => (
                <option key={c} value={c}>
                  {c === ALL_VALUE ? 'すべて' : c}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>10秒ごとに自動更新</span>
          </label>

          <p className="admin-updated-at">
            最終更新: {formatDateTime(data.fetchedAt)}
          </p>
        </section>

        <section className="admin-kpis">
          <article className="admin-panel admin-kpi-card">
            <p className="admin-kpi-label">ヒント件数</p>
            <p className="admin-kpi-value">{data.meta.totalHints}</p>
          </article>
          <article className="admin-panel admin-kpi-card">
            <p className="admin-kpi-label">キャラ数</p>
            <p className="admin-kpi-value">{data.meta.uniqueCharacters}</p>
          </article>
          <article className="admin-panel admin-kpi-card">
            <p className="admin-kpi-label">どこが種類数</p>
            <p className="admin-kpi-value">{data.meta.uniqueKeywords}</p>
          </article>
        </section>

        <section className="admin-panel">
          <h2 className="admin-section-title">集計（全件）</h2>
          {loading ? (
            <p className="admin-empty">読み込み中...</p>
          ) : hasSummaryRows ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>バージョン</th>
                    <th>キャラ</th>
                    <th>どこが</th>
                    <th>回数</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summary.map((row, idx) => (
                    <tr key={`${row.version}-${row.characterName}-${row.whereText}-${idx}`}>
                      <td>{row.version}</td>
                      <td>{row.characterName}</td>
                      <td>{row.whereText}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-empty">まだデータがありません。</p>
          )}
        </section>

        <section className="admin-panel">
          <h2 className="admin-section-title">最新ログ</h2>
          {hasRecentRows ? (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table-compact">
                <thead>
                  <tr>
                    <th>時刻</th>
                    <th>バージョン</th>
                    <th>キャラ</th>
                    <th>どこが</th>
                    <th>セッション</th>
                    <th>R</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>{row.version}</td>
                      <td>{row.characterName}</td>
                      <td>{row.whereText}</td>
                      <td>{row.sessionId}</td>
                      <td>{row.round ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-empty">ログがありません。</p>
          )}
        </section>

        {error && (
          <section className="admin-panel">
            <p className="admin-error">{error}</p>
          </section>
        )}
      </div>
    </div>
  );
}
