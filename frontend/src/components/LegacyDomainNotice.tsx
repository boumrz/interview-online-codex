import React from "react";
import styles from "./LegacyDomainNotice.module.css";

const LEGACY_DOMAIN = process.env.VITE_LEGACY_PUBLIC_DOMAIN ?? "interview.domiknote.ru";
const NEW_DOMAIN = process.env.VITE_NEW_PUBLIC_DOMAIN ?? "interview.vtools.tech";
const SHUTDOWN_DATE = process.env.VITE_LEGACY_DOMAIN_SHUTDOWN_DATE ?? "2026-07-26";
const FORCE_NOTICE = process.env.VITE_SHOW_LEGACY_DOMAIN_NOTICE === "true";

function formatShutdownDate(value: string): string {
  if (value === "2026-07-26") return "26 июля 2026 года";
  return value;
}

function shouldShowLegacyDomainNotice(): boolean {
  if (typeof window === "undefined") return false;

  const hostname = window.location.hostname.trim().toLowerCase();
  if (hostname === LEGACY_DOMAIN.toLowerCase()) return true;
  if (FORCE_NOTICE) return true;

  const params = new URLSearchParams(window.location.search);
  if (
    params.get("legacyDomainNotice") === "1" ||
    params.get("showLegacyDomainNotice") === "1"
  ) {
    return true;
  }

  try {
    return window.localStorage.getItem("showLegacyDomainNotice") === "1";
  } catch {
    return false;
  }
}

function buildNewDomainUrl(): string {
  if (typeof window === "undefined") return `https://${NEW_DOMAIN}/`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return new URL(currentPath || "/", `https://${NEW_DOMAIN}`).toString();
}

export function LegacyDomainNotice() {
  if (!shouldShowLegacyDomainNotice()) return null;

  const shutdownDate = formatShutdownDate(SHUTDOWN_DATE);
  const newDomainUrl = buildNewDomainUrl();

  return (
    <section className={styles.notice} data-testid="legacy-domain-notice">
      <div className={styles.content}>
        <div className={styles.copy}>
          <p className={styles.title}>Домен interview.domiknote.ru скоро будет отключен</p>
          <p className={styles.text}>
            С {shutdownDate} этот адрес перестанет работать. Перейдите на новый домен,
            чтобы продолжить пользоваться инструментом.
          </p>
        </div>
        <a className={styles.action} href={newDomainUrl} data-testid="legacy-domain-notice-link">
          Перейти на interview.vtools.tech
        </a>
      </div>
    </section>
  );
}
