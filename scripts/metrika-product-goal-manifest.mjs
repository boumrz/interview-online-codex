/**
 * Non-secret verified counter configuration. IDs are safe to commit; OAuth and
 * Management API responses must remain local to the dashboard server process.
 * If a goal ever needs a corrected meaning, create a new versioned target rather
 * than modifying or deleting this historical one.
 */
export const PRODUCT_METRIKA_GOAL_MANIFEST = Object.freeze({
  candidateJoined: Object.freeze({
    id: 585806372,
    target: "int_candidate_joined_v1",
    label: "Кандидат подключился к комнате",
  }),
  meaningfulCandidateActivity: Object.freeze({
    id: 585806373,
    target: "int_meaningful_candidate_activity_v1",
    label: "Кандидат начал работу с кодом",
  }),
  verdictSaved: Object.freeze({
    id: 585806374,
    target: "int_verdict_saved_v1",
    label: "Вердикт интервью сохранён",
  }),
});

export const PRODUCT_METRIKA_GOAL_MANIFEST_VERIFIED_AT = "2026-07-17";
