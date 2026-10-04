import React, { useLayoutEffect, useRef, useState } from "react";
import { useAppSelector } from "../../app/hooks";
import { useRemoveHrManagerMutation } from "../../services/api";
import type { HrManager } from "../../types";
import type { HrAction } from "./TopBar";
import { RoomInterviewPanel } from "./RoomInterviewPanel";

type Props = {
  inviteCode: string;
  title: string;
  canManage: boolean;
  teamId?: string;
  ownerToken?: string;
  interviewerToken?: string;
};

/** Reuses the room's revision-aware editor without opening a realtime session. */
export function InterviewListDetailsAction(props: Props) {
  const auth = useAppSelector(state => state.auth);
  const identity = `${auth.user?.id ?? ""}:${props.teamId ?? "PERSONAL"}:${props.inviteCode}`;
  return <ListDetailsSession key={identity} {...props} identity={identity} token={auth.token} />;
}

function ListDetailsSession({ identity, token, inviteCode, title, canManage, teamId, ownerToken, interviewerToken }: Props & { identity: string; token: string | null }) {
  const [removeManager] = useRemoveHrManagerMutation();
  const [pending, setPending] = useState<ReadonlyMap<string, HrAction>>(new Map());
  const [error, setError] = useState("");
  const generation = useRef(1);
  const [authorityGeneration, setAuthorityGeneration] = useState(1);
  const request = useRef<{ abort: () => void } | null>(null);
  const active = useRef(true);
  useLayoutEffect(() => {
    request.current?.abort();
    request.current = null;
    setPending(new Map());
    setError("");
    active.current = true;
    generation.current += 1;
    setAuthorityGeneration(generation.current);
    return () => {
      active.current = false;
      generation.current += 1;
      request.current?.abort();
    };
  }, [token, canManage]);
  const current = (value: number) => active.current && generation.current === value;
  const remove = async (manager: HrManager): Promise<boolean> => {
    if (!canManage || manager.isOwner || request.current) return false;
    const captured = generation.current;
    setError("");
    setPending(new Map([[manager.userId, "remove"]]));
    const mutation = removeManager({ inviteCode, userId: manager.userId, ownerToken, interviewerToken });
    request.current = mutation;
    try {
      await mutation.unwrap();
      return current(captured);
    } catch {
      if (current(captured)) setError("Не удалось снять роль нанимающего. Повторите попытку.");
      return false;
    } finally {
      if (current(captured)) setPending(new Map());
      if (request.current === mutation) request.current = null;
    }
  };
  return <RoomInterviewPanel
    triggerLabel="Сведения"
    triggerAriaLabel={`Редактировать сведения интервью ${title}`}
    inviteCode={inviteCode}
    identityKey={identity}
    canManageRoom={canManage}
    isTeamRoom={Boolean(teamId)}
    teamId={teamId}
    authorityGeneration={authorityGeneration}
    isCurrentAuthority={current}
    pendingHrActions={pending}
    onRemoveHr={remove}
    removalError={error}
    ownerToken={ownerToken}
    interviewerToken={interviewerToken}
  />;
}
