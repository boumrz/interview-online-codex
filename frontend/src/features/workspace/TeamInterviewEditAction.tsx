import React from "react";
import type { TeamInterviewListItem } from "../../types";
import { InterviewEditAction } from "./InterviewEditAction";

type Props = { accountId: string; teamId: string; interview: TeamInterviewListItem };

export function TeamInterviewEditAction(props: Props) {
  return <InterviewEditAction {...props} kind="TEAM" />;
}
