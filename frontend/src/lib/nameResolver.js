// frontend/src/lib/nameResolver.js
const API = process.env.REACT_APP_API_URL || '';

const cache = new Map();

export async function getCharacterName(id) {
  if (!id && id !== 0) return '';
  if (cache.has(String(id))) return cache.get(String(id));

  const res = await fetch(`${API}/api/characters/${encodeURIComponent(id)}`);
  if (!res.ok) return `ID:${id}`;
  const { name } = await res.json();
  const value = name || `ID:${id}`;
  cache.set(String(id), value);
  return value;
}

export async function getCharacterNamesBulk(ids = []) {
  const missing = ids.filter((id) => !cache.has(String(id)));
  if (missing.length) {
    const q = missing.map((id) => encodeURIComponent(id)).join(',');
    const res = await fetch(`${API}/api/characters?ids=${q}`);
    if (res.ok) {
      const list = await res.json(); // [{id, name}]
      list.forEach(({ id, name }) =>
        cache.set(String(id), name || `ID:${id}`)
      );
    }
  }
  return ids.map((id) => cache.get(String(id)) || `ID:${id}`);
}
