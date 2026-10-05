import React, { useEffect, useRef, useState } from "react";
import { Button, Space } from "antd";
import { store } from "../../app/store";
import { getApiErrorMessage } from "../../services/apiErrors";
import { readAuthorizationUrl, socialRequest, SOCIAL_INVITATION_RETURN_KEY, SocialProvider } from "../../services/socialAuth";
import styles from "./SocialLoginButtons.module.css";

type Props = {
  disabled: boolean;
  invitationReturn: boolean;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
};

export function SocialLoginButtons({ disabled, invitationReturn, onError, onBusyChange }: Props) {
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [starting, setStarting] = useState<SocialProvider | null>(null);
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    socialRequest<unknown>("/providers", controller.signal).then((data) => {
      if (controller.signal.aborted || !data || typeof data !== "object"
        || !("providers" in data) || !Array.isArray(data.providers)) return;
      const configured = data.providers;
      setProviders(["google", "vk"].filter((provider) => configured.includes(provider)) as SocialProvider[]);
    }).catch(() => {});
    const cancel = () => { attempt.current?.abort(); attempt.current = null; };
    const onPageHide = () => { cancel(); setStarting(null); onBusyChange(false); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      controller.abort();
      cancel();
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  const start = async (provider: SocialProvider) => {
    if (disabled || attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    const token = store.getState().auth.token;
    const storedToken = localStorage.getItem("auth_token");
    const currentLocation = window.location.href;
    const current = () => !controller.signal.aborted && attempt.current === controller
      && store.getState().auth.token === token && localStorage.getItem("auth_token") === storedToken
      && window.location.href === currentLocation;
    setStarting(provider);
    onBusyChange(true);
    onError("");
    try {
      const data = await socialRequest<unknown>(`/${provider}/start`, controller.signal, {});
      if (!current()) return;
      const url = readAuthorizationUrl(data, provider);
      // Only this fixed, non-secret path survives navigation to the provider.
      sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY);
      if (invitationReturn) sessionStorage.setItem(SOCIAL_INVITATION_RETURN_KEY, "1");
      window.location.assign(url);
    } catch (error) {
      if (current()) onError(getApiErrorMessage(error, "Не удалось начать вход. Попробуйте ещё раз."));
    } finally {
      if (attempt.current === controller && !controller.signal.aborted) {
        attempt.current = null;
        setStarting(null);
        onBusyChange(false);
      }
    }
  };

  if (!providers.length) return null;
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {providers.map((provider) => (
        <Button block size="large" key={provider} className={styles.providerButton} disabled={disabled || Boolean(starting)}
          aria-label={`Войти через ${provider === "google" ? "Google" : "VK ID"}`}
          loading={starting === provider} onClick={() => void start(provider)}>
          <img src={provider === "google" ? "/auth/google-g.png" : "/auth/vk-id.svg"}
            alt="" aria-hidden="true" width={20} height={20} />
          <span className={provider === "google" ? styles.googleLabel : undefined}>
            Войти через {provider === "google" ? "Google" : "VK ID"}
          </span>
        </Button>
      ))}
    </Space>
  );
}
