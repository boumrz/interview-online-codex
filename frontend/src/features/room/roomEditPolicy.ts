/** Lifecycle limits apply in addition to the server-granted room permissions. */
export function isRoomReadOnly(state: {
  status?: string | null;
  canManageRoom?: boolean;
} | null | undefined): boolean {
  return state?.status === 'frozen' ||
    (state?.status === 'finished' && !state.canManageRoom);
}
