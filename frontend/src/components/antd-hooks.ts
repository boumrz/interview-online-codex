import { useCallback, useState } from "react";

export function useDisclosure(initial = false): [boolean, { open: () => void; close: () => void; toggle: () => void }] {
  const [opened, setOpened] = useState(initial);
  const open = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);
  const toggle = useCallback(() => setOpened((value) => !value), []);
  return [opened, { open, close, toggle }];
}
