import React, { useMemo, useState } from 'react';
import './ClueInput.css';

export default function ClueInput({
  targetImage,
  targetName,
  onSubmit,
  disabled = false,
  waitingMessage = ''
}) {
  const [value, setValue] = useState('');
  const [toast, setToast] = useState('');
  const [isComposing, setIsComposing] = useState(false);

  const canSubmit = useMemo(() => value.trim().length > 0, [value]);

  const normalizeDraft = (v) => {
    const normalized = String(v || '').normalize('NFKC');
    return normalized.replace(/[^ぁ-ゖー゛゜a-zA-Z0-9 ]/g, '');
  };

  const handleChange = (v) => {
    if (isComposing) {
      setValue(String(v || ''));
      return;
    }
    setValue(normalizeDraft(v));
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (v) => {
    setIsComposing(false);
    setValue(normalizeDraft(v));
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    // 英数が含まれていたかチェック
    const normalized = String(value || '').normalize('NFKC');
    const hasNonHiragana = /[a-zA-Z0-9 ]/.test(normalized);
    if (hasNonHiragana) {
      setToast('ひらがなだけにしてね！');
      setTimeout(() => setToast(''), 2500);
      return; // 送信しない
    }
    // ひらがなのみ送信
    const hiraganaOnly = normalized.replace(/[^ぁ-ゖー゛゜]/g, '').trim();
    if (hiraganaOnly.length > 0) {
      onSubmit?.(hiraganaOnly);
    }
  };

  return (
    <div className="clue-input">
      {/* 左：名前 → 画像（名前を上に） */}
      <figure className="target-figure">
        {targetName && (
          <figcaption className="target-figure__name" title={targetName}>
            {targetName}
          </figcaption>
        )}
        <div className="target-figure__thumb">
          {targetImage && <img src={targetImage} alt={targetName || 'target'} />}
        </div>
      </figure>

      {/* 右：入力パネル */}
      <div className="clue-panel">
        <h2 className="clue-panel__title">どこがかわいい？</h2>

        <div className="clue-input__fields">
          <label className="clue-field">
            <span className="clue-field__fixed">「</span>
            <input
              className="clue-field__input"
              type="text"
              value={value}
              placeholder="ひらがなで入力"
              onChange={(e) => handleChange(e.target.value)}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={(e) => handleCompositionEnd(e.target.value)}
              inputMode="hiragana"
              disabled={disabled}
            />
            <span className="clue-field__fixed">」が「かわいい」</span>
          </label>
        </div>

        <button
          type="button"
          className={`clue-input__submit ${canSubmit && !disabled ? 'is-active' : ''}`}
          disabled={!canSubmit || disabled}
          onClick={handleSubmit}
        >
          送信！👍
        </button>

        {waitingMessage && (
          <p className="clue-input__waiting">{waitingMessage}</p>
        )}

        {toast && <div className="clue-input__toast">{toast}</div>}
      </div>
    </div>
  );
}
