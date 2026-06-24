import styles from "./CloudBorder.module.css";

export default function CloudBorder() {
  return (
    <div className={styles.cloudBorder} aria-hidden="true">
      <span className={`${styles.corner} ${styles.topLeft}`} />
      <span className={`${styles.corner} ${styles.topRight}`} />
      <span className={`${styles.corner} ${styles.bottomLeft}`} />
      <span className={`${styles.corner} ${styles.bottomRight}`} />
    </div>
  );
}
