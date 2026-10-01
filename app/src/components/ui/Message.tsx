import type { ReactNode } from "react";
import styles from "./ui.module.css";

const variantClass = {
  attention: styles.attention,
  error: styles.error,
  note: styles.note,
} as const;

interface MessageProps {
  /**
   * attention: a reply to what the person typed (soft coral, never red).
   * error: a technical problem only.
   * note: calm information.
   */
  variant: keyof typeof variantClass;
  /** Pass "alert" for a message that appears after an action. */
  role?: "alert" | "status";
  id?: string;
  children: ReactNode;
}

export function Message({ variant, role, id, children }: MessageProps) {
  return (
    <p className={`${styles.message} ${variantClass[variant]}`} role={role} id={id}>
      {children}
    </p>
  );
}
