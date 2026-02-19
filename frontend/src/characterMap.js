// src/characterMap.js
import raw from './yuru_gp_data.json';

/**
 * 受け取ったIDを 8 桁ゼロ埋め・文字列化して正規化する。
 * 例) 21 -> "00000021", "21" -> "00000021", "00000021" -> そのまま
 */
export function normalizeId(id) {
  if (id == null) return '';
  const s = String(id).trim();
  if (/^\d+$/.test(s)) {
    return s.padStart(8, '0');
  }
  // もし "images/00000021.png" みたいなパスが来るケースがあれば抜き出し
  const m = s.match(/(\d{1,8})(?=\D*$)/);
  if (m) return m[1].padStart(8, '0');
  return s; // 効かなければフォールバック
}

/** JSON → { '00000021': 'しまねっこ', ... } のマップを作る */
export const nameMap = Object.fromEntries(
  Object.entries(raw).map(([key, obj]) => [key, obj?.['キャラクタ名'] || ''])
);

/** IDからキャラクタ名を引く */
export function getCharacterName(id) {
  const nid = normalizeId(id);
  return nameMap[nid] || '';
}
