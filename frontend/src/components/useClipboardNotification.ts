import { App } from "antd";
import { useCallback } from "react";

type ClipboardNotice = {
  success: string;
  failure: string;
};

export function useClipboardNotification() {
  const { notification } = App.useApp();

  return useCallback(async (value: string, notice: ClipboardNotice) => {
    try {
      await navigator.clipboard.writeText(value);
      notification.success({
        message: "Скопировано",
        description: notice.success,
        placement: "top",
      });
      return true;
    } catch {
      notification.error({
        message: "Не удалось скопировать",
        description: notice.failure,
        placement: "top",
      });
      return false;
    }
  }, [notification]);
}
