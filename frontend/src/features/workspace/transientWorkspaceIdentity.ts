type CreatedTeamIdentity = {
  id: string;
  name: string;
};

const createdTeamNames = new Map<string, string>();
const keyFor = (accountId: string, teamId: string) => `${accountId}:TEAM:${teamId}`;

export function rememberCreatedTeam(accountId: string, team: CreatedTeamIdentity) {
  if (!accountId || !team.id || !team.name) return;
  createdTeamNames.set(keyFor(accountId, team.id), team.name);
}

export const getCreatedTeamName = (accountId: string, teamId: string) =>
  createdTeamNames.get(keyFor(accountId, teamId));

export const forgetCreatedTeamName = (accountId: string, teamId: string) => {
  createdTeamNames.delete(keyFor(accountId, teamId));
};
