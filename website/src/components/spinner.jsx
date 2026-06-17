import React from 'react';
import styles from './spinner.module.css';

export default function Spinner({meta}) {
  if (!Number.isFinite(meta.progress) && !Number.isFinite(meta.progressAlt)) {
    return null;
  }

  const progress = (meta.progress || 0) + (meta.progressAlt || 0);
  const percentage = Math.round(progress * 1000) / 10;
  const text = `Loading... ${percentage}%`;

  return (
    <div className={`${styles.spinnerContainer} ${progress >= 1 ? styles.done : ''}`}>
      <div className="spinner--text">{text}</div>
      <div className="spinner--fill" style={{width: `${percentage}%`}}>
        {text}
      </div>
    </div>
  );
}
