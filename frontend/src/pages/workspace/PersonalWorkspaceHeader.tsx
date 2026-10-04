import React, { useMemo, useRef, useState } from "react";
import { Button as AntButton } from "antd";
import { Button, Container, Group, Menu, Text } from "components/antd-compat";
import { IconMenu2, IconUserCircle } from "components/antd-icons";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { clearAuth } from "../../features/auth/authSlice";
import { WorkspaceSwitcher } from "../../features/workspace/WorkspaceSwitcher";
import { ThemeToggleButton } from "../../features/theme/ThemeToggleButton";
import { api } from "../../services/api";
import styles from "./PersonalWorkspacePage.module.css";

function WorkspaceNavigation({ isHr, isAdmin }: { isHr: boolean; isAdmin: boolean }) {
  const location = useLocation();
  const items = useMemo(() => [
    { label: "Интервью", to: "/workspace/personal/interviews" },
    { label: "Библиотека", to: "/workspace/personal/library" },
    ...(isHr ? [{ label: "Кандидаты", to: "/workspace/personal/candidates" }] : []),
    ...(isAdmin ? [{ label: "Админка", to: "/dashboard/admin" }] : []),
  ], [isHr, isAdmin]);
  const navRef = useRef<HTMLElement | null>(null);
  const linkRefs = useRef(new Map<string, HTMLSpanElement>());
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [overflowOpened, setOverflowOpened] = useState(false);

  React.useLayoutEffect(() => {
    const measure = () => {
      const nav = navRef.current;
      if (!nav) return;
      const widths = items.map((item) => {
        return linkRefs.current.get(item.to)?.getBoundingClientRect().width ?? 0;
      });
      if (widths.some((width) => width <= 0)) return;

      const gap = 4;
      const overflowWidth = 48;
      let nextVisibleCount = 0;
      let occupied = 0;
      widths.forEach((width, index) => {
        const nextOccupied = occupied + (nextVisibleCount > 0 ? gap : 0) + width;
        const reserveOverflow = index < widths.length - 1 ? gap + overflowWidth : 0;
        if (nextOccupied + reserveOverflow <= nav.clientWidth) {
          nextVisibleCount += 1;
          occupied = nextOccupied;
        }
      });
      setVisibleCount((current) => current === nextVisibleCount ? current : nextVisibleCount);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (navRef.current) observer?.observe(navRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items]);

  const directItems = items.slice(0, visibleCount ?? 0);
  const overflowItems = items.slice(visibleCount ?? 0);
  const activeOverflow = visibleCount === null ? undefined : overflowItems.find(item => location.pathname === item.to);
  return (
    <nav ref={navRef} className={styles.nav} aria-label="Разделы личного раздела">
      <span className={styles.navMeasure} aria-hidden="true">
        {items.map((item) => (
          <span key={item.to} className={styles.navMeasureItem} ref={(node) => {
            if (node) linkRefs.current.set(item.to, node);
            else linkRefs.current.delete(item.to);
          }}>{item.label}</span>
        ))}
      </span>
      {directItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `${isActive ? styles.navActive : styles.navLink} app-header-control`}
        >
          {item.label}
        </NavLink>
      ))}
      {overflowItems.length > 0 ? (
        <Menu position="bottom-end" shadow="md" withinPortal opened={overflowOpened} onChange={setOverflowOpened}>
          <Menu.Target>
            <AntButton
              htmlType="button"
              type="text"
              className={`${styles.navButton} app-header-control`}
              aria-label={activeOverflow ? `Меню разделов: ${activeOverflow.label}` : "Меню разделов"}
              data-active-section={activeOverflow ? "true" : undefined}
              aria-haspopup="menu"
              aria-expanded={overflowOpened}
              onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOverflowOpened(true);
                }
              }}
            >
              <IconMenu2 size={20} stroke={2} aria-hidden="true" />
            </AntButton>
          </Menu.Target>
          <Menu.Dropdown aria-label="Дополнительные разделы">
            {overflowItems.map((item) => (
              <Menu.Item
                key={item.to}
                component={NavLink}
                to={item.to}
                className={location.pathname === item.to ? styles.overflowMenuItemActive : styles.overflowMenuItem}
                aria-current={location.pathname === item.to ? "page" : undefined}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      ) : null}
    </nav>
  );
}

export function PersonalWorkspaceHeader({ contextLabel = "Личный раздел" }: { contextLabel?: string }) {
  const auth = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  return (
      <header className={styles.header}>
        <Container size="xl" className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">IH</span>
            <div className={styles.brandText}>
              <Text className={styles.brandLabel} fw={800}>InterHub</Text>
              <Text size="xs" c="gray.5">{contextLabel}</Text>
            </div>
          </div>
          <div className={styles.workspaceChoice}>
            <WorkspaceSwitcher />
          </div>
          <WorkspaceNavigation isHr={auth.user?.isHr === true} isAdmin={auth.user?.role === "admin"} />
          <Group className={styles.userControls} gap="sm" align="center" wrap="nowrap">
            {auth.user ? <NavLink to="/profile" className={`${styles.userName} app-header-control`} aria-label={`Открыть профиль @${auth.user.nickname}`}>
              <IconUserCircle size={16} aria-hidden="true" />
              <span className={styles.userNameText}>@{auth.user?.nickname}</span>
            </NavLink> : <span className={styles.userName}>Профиль</span>}
            <Button
              variant="subtle"
              className="app-header-control"
              onClick={() => {
                dispatch(clearAuth());
                dispatch(api.util.resetApiState());
                navigate("/");
              }}
            >
              Выйти
            </Button>
            <ThemeToggleButton />
          </Group>
        </Container>
      </header>
  );
}
