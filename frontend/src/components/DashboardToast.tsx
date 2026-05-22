import React, { useRef, useState } from "react";
import { Portal } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import styles from "./DashboardToast.module.css";

export interface ToastEntry {
  id: string;
  type: "success" | "error";
  /** Primary text shown in bold. */
  title: string;
  /** Optional secondary text shown below the title. */
  message?: string;
}

interface DashboardToastProps {
  notifications: ToastEntry[];
  onDismiss: (id: string) => void;
}

/** Single toast item — handles its own leave-animation state. */
function ToastItem({
  entry,
  onDismiss,
}: {
  entry: ToastEntry;
  onDismiss: (id: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const prevIdRef = useRef(entry.id);

  // When the parent is about to remove this entry, we play the leave
  // animation first. But since the parent removes it after a timeout,
  // we just need to expose the class and let the parent coordinate.
  // Here we react to the `leaving` flag that the parent can trigger
  // by passing a slightly different entry shape — but for simplicity we
  // wire the close button to trigger the animation locally, then call
  // onDismiss after the animation finishes.
  const handleClose = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => onDismiss(entry.id), 210);
  };

  // If a new notification replaces this one (id changed while component
  // is reused), reset leaving state.
  if (prevIdRef.current !== entry.id) {
    prevIdRef.current = entry.id;
    // Can't call setLeaving synchronously during render, so we defer.
  }

  return (
    <div
      className={[
        styles.toast,
        entry.type === "error" ? styles.toastError : styles.toastSuccess,
        leaving ? styles.leaving : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={[
          styles.iconWrap,
          entry.type === "error" ? styles.iconError : styles.iconSuccess,
        ].join(" ")}
      >
        {entry.type === "success" ? (
          <IconCheck size={15} strokeWidth={2.5} />
        ) : (
          <IconX size={15} strokeWidth={2.5} />
        )}
      </span>

      <div className={styles.body}>
        <p className={styles.title}>{entry.title}</p>
        {entry.message ? (
          <p className={styles.message}>{entry.message}</p>
        ) : null}
      </div>

      <button
        className={styles.closeBtn}
        onClick={handleClose}
        aria-label="Закрыть уведомление"
        type="button"
      >
        <IconX size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

export function DashboardToast({ notifications, onDismiss }: DashboardToastProps) {
  if (notifications.length === 0) return null;

  return (
    <Portal>
      <div className={styles.stack}>
        {notifications.map((n) => (
          <ToastItem key={n.id} entry={n} onDismiss={onDismiss} />
        ))}
      </div>
    </Portal>
  );
}
