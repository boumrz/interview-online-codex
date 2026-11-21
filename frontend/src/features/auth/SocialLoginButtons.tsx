import React, { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { GithubFilled } from "@ant-design/icons";
import { store } from "../../app/store";
import { getApiErrorMessage } from "../../services/apiErrors";
import { readAuthorizationUrl, socialRequest, SOCIAL_INVITATION_RETURN_KEY } from "../../services/socialAuth";
import styles from "./SocialLoginButtons.module.css";

type Props = {
  disabled: boolean;
  invitationReturn: boolean;
  roomReturn: boolean;
  roomContextId?: string;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
};

export function SocialLoginButtons({ disabled, invitationReturn, roomReturn, roomContextId, onError, onBusyChange }: Props) {
  const [available, setAvailable] = useState(false);
  const [starting, setStarting] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    socialRequest<unknown>("/providers", controller.signal).then((data) => {
      if (controller.signal.aborted || !data || typeof data !== "object"
        || !("providers" in data) || !Array.isArray(data.providers)) return;
      setAvailable(data.providers.includes("github"));
    }).catch(() => {});
    const cancel = () => { attempt.current?.abort(); attempt.current = null; };
    const onPageHide = () => { cancel(); setStarting(false); onBusyChange(false); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      controller.abort();
      cancel();
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  const start = async () => {
    if (disabled || attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    const token = store.getState().auth.token;
    const storedToken = localStorage.getItem("auth_token");
    const currentLocation = window.location.href;
    const current = () => !controller.signal.aborted && attempt.current === controller
      && store.getState().auth.token === token && localStorage.getItem("auth_token") === storedToken
      && window.location.href === currentLocation;
    setStarting(true);
    onBusyChange(true);
    onError("");
    try {
      const data = await socialRequest<unknown>("/github/start", controller.signal, { roomReturn, roomContextId });
      if (!current()) return;
      const url = readAuthorizationUrl(data);
      // Only this fixed, non-secret path survives navigation to the provider.
      sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY);
      if (invitationReturn) sessionStorage.setItem(SOCIAL_INVITATION_RETURN_KEY, "1");
      window.location.assign(url);
    } catch (error) {
      if (current()) onError(getApiErrorMessage(error, "Не удалось начать вход. Попробуйте ещё раз."));
    } finally {
      if (attempt.current === controller && !controller.signal.aborted) {
        attempt.current = null;
        setStarting(false);
        onBusyChange(false);
      }
    }
  };

  if (!available) return null;
  return (
    <Button block size="large" className={styles.providerButton} disabled={disabled || starting}
      aria-label="Войти через GitHub" loading={starting} onClick={() => void start()}>
      <GithubFilled aria-hidden="true" style={{ fontSize: 20 }} />
      <span className={styles.providerLabel}>Войти через GitHub</span>
    </Button>
  );
}
