// backend/characterStore.js
const fs = require('fs');
const path = require('path');

// どこに置いてあっても拾えるように候補を用意
const candidates = [
  path.resolve(__dirname, 'yuru_gp_data.json'),
  path.resolve(__dirname, 'data', 'yuru_gp_data.json')
];

const filePath = candidates.find((p) => fs.existsSync(p));
if (!filePath) {
  console.warn('[characterStore] yuru_gp_data.json が見つからないよ…');
}

// IDを正規化（数字は8桁ゼロ埋め）
const normalizeId = (id) => {
  if (id == null) return '';
  const s = String(id).trim();
  const m = s.match(/(\d{1,8})(?=\D*$)/); // 末尾側の数字（1〜8桁）を拾う
  if (m) return m[1].padStart(8, '0');
  if (/^\d+$/.test(s)) return s.padStart(8, '0'); // 純数字
  return s;
};

let nameMap = {};

// キャラクタデータの読み込み
function loadCharacters() {
  if (!filePath) {
    nameMap = {};
    return nameMap;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  nameMap = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [
      normalizeId(k),
      v?.['キャラクタ名'] || ''
    ])
  );
  console.log(
    `[characterStore] loaded ${Object.keys(nameMap).length} records from ${filePath}`
  );
  return nameMap;
}

// 単体IDから名前を取得
function getName(id) {
  const nid = normalizeId(id);
  return nameMap[nid] || '';
}

// 複数IDまとめて取得
function getNamesBulk(ids = []) {
  const result = {};
  ids.forEach((id) => {
    const nid = normalizeId(id);
    result[nid] = getName(nid);
  });
  return result;
}

module.exports = {
  loadCharacters,
  getName,
  getNamesBulk,
  normalizeId,
};
