import React, { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { Box, Button, Container, Group, Modal, Stack, Text } from "components/antd-compat";
import { IconTrash } from "components/antd-icons";
import { Navigate } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import { useAdminDeleteUserMutation, useAdminUpdateUserRoleMutation, useAdminUsersQuery } from "../services/api";
import type { AdminUser } from "../types";
import { AdminUsersSection } from "./dashboard/AdminUsersSection";
import { PersonalWorkspaceHeader } from "./workspace/PersonalWorkspaceHeader";
import styles from "./workspace/PersonalWorkspacePage.module.css";

const EMPTY_USERS: AdminUser[] = [];

export function AdminPage() {
  const auth = useAppSelector((state) => state.auth);
  const { notification } = App.useApp();
  const isAdmin = auth.user?.role === "admin";
  const identity = `${auth.token ?? ""}:${auth.user?.id ?? ""}:${auth.user?.role ?? ""}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const mountedRef = useRef(true);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const { data: users = EMPTY_USERS, isLoading, isFetching, isError, refetch } = useAdminUsersQuery(undefined, {
    skip: !auth.token || !isAdmin,
    refetchOnMountOrArgChange: true,
  });
  const [updateRole, updateRoleState] = useAdminUpdateUserRoleMutation();
  const [deleteUser, deleteState] = useAdminDeleteUserMutation();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setRoleDrafts({});
    setDeleteTarget(null);
    setDeleteError("");
  }, [identity]);

  useEffect(() => {
    const currentRoles = new Map(users.map((user) => [user.id, user.role]));
    setRoleDrafts((prev) => {
      const entries = Object.entries(prev);
      const retained = entries.filter(([id, role]) => currentRoles.has(id) && currentRoles.get(id) !== role);
      return retained.length === entries.length ? prev : Object.fromEntries(retained);
    });
  }, [users]);

  const isCurrent = () => mountedRef.current && identityRef.current === identity && localStorage.getItem("auth_token") === auth.token;
  const showError = (title: string) => {
    if (isCurrent()) notification.error({ title, placement: "top", role: "alert", duration: 5 });
  };
  const saveRole = async (user: AdminUser) => {
    const role = (roleDrafts[user.id] ?? user.role).trim().toLowerCase();
    if (!isAdmin || user.isSystemAdmin || !role || role === user.role || updateRoleState.isLoading) return;
    try {
      await updateRole({ userId: user.id, role }).unwrap();
      if (isCurrent()) setRoleDrafts((prev) => ({ ...prev, [user.id]: role }));
    } catch { showError("Не удалось обновить роль пользователя"); }
  };
  const confirmDelete = async () => {
    if (!isAdmin || !deleteTarget || deleteState.isLoading || deleteTarget.isSystemAdmin || deleteTarget.id === auth.user?.id) return;
    setDeleteError("");
    try {
      await deleteUser({ userId: deleteTarget.id }).unwrap();
      if (isCurrent()) setDeleteTarget(null);
    } catch {
      if (isCurrent()) setDeleteError("Не удалось удалить пользователя");
      showError("Не удалось удалить пользователя");
    }
  };

  if (!auth.token) return <Navigate to="/login" replace />;
  if (auth.user && !isAdmin) return <Navigate to="/workspace/personal/interviews" replace />;

  return (
    <Box className={styles.page}>
      <PersonalWorkspaceHeader contextLabel="Администрирование" />
      <main aria-label="Администрирование пользователей">
        <Container size="xl" className={styles.content}>
          {!auth.user ? <Text role="status">Загрузка профиля...</Text> : (
            <AdminUsersSection
              users={users} currentUserId={auth.user.id} roleDrafts={roleDrafts}
              onRoleDraftChange={(id, role) => setRoleDrafts((prev) => ({ ...prev, [id]: role }))}
              onSaveRole={saveRole}
              onDeleteUser={(user) => { if (isAdmin && !user.isSystemAdmin && user.id !== auth.user?.id) { setDeleteError(""); setDeleteTarget(user); } }}
              onRefresh={() => { void refetch(); }}
              isUpdatingRole={updateRoleState.isLoading} isDeleting={deleteState.isLoading}
              isLoading={isLoading} isFetching={isFetching} isError={isError}
            />
          )}
        </Container>
      </main>
      <Modal opened={isAdmin && Boolean(deleteTarget)} onClose={() => { if (!deleteState.isLoading) setDeleteTarget(null); }} title="Удалить пользователя?" centered>
        <Stack>
          <Text>Пользователь @{deleteTarget?.nickname} будет удалён. Это действие нельзя отменить.</Text>
          {deleteError ? <Text role="alert" c="var(--app-error)">{deleteError}</Text> : null}
          <Group justify="flex-end">
            <Button variant="subtle" disabled={deleteState.isLoading} onClick={() => setDeleteTarget(null)}>Отмена</Button>
            <Button variant="light" color="red" leftSection={<IconTrash size={16} aria-hidden="true" />} loading={deleteState.isLoading} disabled={deleteState.isLoading} onClick={() => { void confirmDelete(); }}>Удалить</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
