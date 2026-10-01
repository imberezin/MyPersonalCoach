import type { ReactNode } from "react";
import styles from "./ui.module.css";

interface ChipProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** A small toggle for picking one of a few quick values. Selected is a soft green, never a score. */
export function Chip({ selected, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={selected ? `${styles.chip} ${styles.chipSelected}` : styles.chip}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
