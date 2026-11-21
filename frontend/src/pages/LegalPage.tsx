import React, { useEffect } from "react";
import { CodeOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { ThemeToggleButton } from "../features/theme/ThemeToggleButton";
import styles from "./LegalPage.module.css";

const OPERATOR_NAME = "Желтов Роман Геннадьевич";
const OPERATOR_EMAIL = "boumrz@gmail.com";

export function OperatorContact() {
  return (
    <p>
      Оператор сервиса: {OPERATOR_NAME}.<br />
      Связь по вопросам сервиса и персональных данных: <a href={`mailto:${OPERATOR_EMAIL}`}>{OPERATOR_EMAIL}</a>.
    </p>
  );
}

export function PublicDocumentLinks({ currentPath }: { currentPath?: string }) {
  return (
    <nav className={styles.documentLinks} aria-label="Документы сервиса">
      {currentPath !== "/privacy" && <Link to="/privacy">Политика конфиденциальности</Link>}
      {currentPath !== "/terms" && <Link to="/terms">Условия использования</Link>}
    </nav>
  );
}

export function LegalPage({ title, path, children }: React.PropsWithChildren<{ title: string; path: string }>) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — InterHub`;
    window.scrollTo(0, 0);
    return () => { document.title = previous; };
  }, [title]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} to="/" aria-label="InterHub — главная">
            <span className={styles.brandMark}><CodeOutlined aria-hidden="true" /></span>
            InterHub
          </Link>
          <ThemeToggleButton />
        </div>
      </header>
      <main className={styles.content}>
        <Link className={styles.backLink} to="/">На главную</Link>
        <article className={styles.article}>
          <h1>{title}</h1>
          <p className={styles.updated}>Редакция от 18 ноября 2026 года</p>
          {children}
        </article>
        <footer className={styles.footer}><PublicDocumentLinks currentPath={path} /></footer>
      </main>
    </div>
  );
}
