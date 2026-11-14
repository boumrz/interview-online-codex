type ParticipantSnapshotScope = {
  inviteCode: string;
  eventToken?: string | null;
  role: string;
  canManageRoom: boolean;
  participantSnapshotRevision?: number;
};

export function participantPresenceLabel(status: "active" | "away" | "unknown") {
  return status === "active" ? "В фокусе" : status === "away" ? "Вне фокуса" : "Статус неизвестен";
}

/** Concurrent state sends can reach a viewer in a different order from their roster reads. */
export function currentParticipantSnapshot<T extends ParticipantSnapshotScope>(previous: T | null, incoming: T): T {
  if (previous?.inviteCode === incoming.inviteCode &&
      previous.eventToken === incoming.eventToken &&
      previous.role === incoming.role &&
      previous.canManageRoom === incoming.canManageRoom &&
      previous.participantSnapshotRevision !== undefined &&
      (incoming.participantSnapshotRevision === undefined ||
       previous.participantSnapshotRevision > incoming.participantSnapshotRevision)) {
    return previous;
  }
  return incoming;
}
