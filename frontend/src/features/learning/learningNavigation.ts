import { getLearningSurface, type LearningSurface } from "./onboardingSteps";

export type ContextSurface = LearningSurface | "personal-candidates";

export function contextLearningSurface(pathname: string): ContextSurface | undefined {
  if (pathname === "/workspace/personal/candidates") return "personal-candidates";
  return getLearningSurface(pathname);
}

function changesTeam(action: string) {
  return action === "workspace-team-option" || action === "workspace-team-submit" || action === "workspace-team-form";
}

export function contextLearningDestination(action: string, surface?: ContextSurface): ContextSurface | undefined {
  if (!surface) return undefined;
  const personal = surface.startsWith("personal-");
  const team = surface.startsWith("team-");
  if ((personal || team) && changesTeam(action)) return "team-interviews";
  switch (action) {
    case "personal-library-link":
      if (personal && surface !== "personal-library") return "personal-library";
      break;
    case "team-library-link":
      if (team && surface !== "team-library") return "team-library";
      break;
    case "team-tracks-link":
      if (team && surface !== "team-tracks") return "team-tracks";
      break;
    case "team-candidates-link":
      if (team && surface !== "team-candidates") return "team-candidates";
      break;
    case "interview-create":
      if (surface === "personal-interviews") return "personal-create";
      if (surface === "team-interviews") return "team-create";
      break;
    case "interview-enter":
      if (surface === "personal-interviews" || surface === "team-interviews") return "room";
      break;
    case "interview-form":
    case "interview-submit":
      if (surface === "personal-create" || surface === "team-create") return "room";
      break;
  }
  return undefined;
}

export function contextLearningArrival({ action, from, fromTeamId, to, toTeamId }: {
  action: string;
  from?: ContextSurface;
  fromTeamId?: string;
  to?: ContextSurface;
  toTeamId?: string;
}) {
  if (!to || contextLearningDestination(action, from) !== to) return false;
  if (!to.startsWith("team-")) return true;
  return Boolean(toTeamId && (changesTeam(action) ? toTeamId !== fromTeamId : toTeamId === fromTeamId));
}

export function onboardingRecoveryPath(completedSteps: number) {
  return completedSteps >= 1 && completedSteps <= 4 ? "/workspace/personal/library" : "/workspace/personal/interviews";
}

export const roomRecoveryStep = {
  title: "Откройте комнату, чтобы продолжить",
  description: "Выберите доступное интервью или создайте новое. В комнате обучение продолжится с сохранённого шага.",
  anchors: ["interview-enter", "interview-create", "interview-form", "workspace-switcher"],
} as const;
