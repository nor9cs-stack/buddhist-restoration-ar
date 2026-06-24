"use client";

import CloudBorder from "./CloudBorder";
import styles from "./StartScreen.module.css";

type StartScreenProps = {
  disabled?: boolean;
  message?: string;
  onStart: () => void;
};

export default function StartScreen({
  disabled = false,
  message,
  onStart
}: StartScreenProps) {
  return (
    <main className="museum-page">
      <CloudBorder />
      <section className={styles.center} aria-label="AR scan start">
        <p className={styles.kicker}>数字修复展厅</p>
        <h1 className={styles.title}>佛像修复</h1>
        <button
          className={styles.startButton}
          type="button"
          onClick={onStart}
          disabled={disabled}
        >
          开始扫描
        </button>
        {message ? <p className={styles.message}>{message}</p> : null}
      </section>
    </main>
  );
}
