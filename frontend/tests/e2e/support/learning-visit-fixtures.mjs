const currentLearningVersion = 2;
const learningModules = [
  "onboarding",
  "personal_interviews",
  "team_interviews",
  "library",
  "candidates",
  "tracks",
  "team_settings",
  "room",
];
const modulesSql = learningModules.map((module) => `('${module}')`).join(", ");

function assertIsolatedFixture(schema, visited) {
  if (typeof schema !== "string" || !/^[a-z_]+_e2e_[a-f0-9]{32}$/.test(schema) || typeof visited !== "boolean") {
    throw new Error("E2E_LEARNING_VISITS_REQUIRE_ISOLATED_SCHEMA");
  }
}

/** Install once so suite transitions can suppress onboarding for unrelated tests without locking users. */
export function installLearningVisitFixtureSql(schema, visited) {
  assertIsolatedFixture(schema, visited);
  return `
    CREATE TABLE ${schema}.e2e_learning_visit_mode (
      singleton boolean PRIMARY KEY CHECK (singleton),
      visited boolean NOT NULL
    );
    INSERT INTO ${schema}.e2e_learning_visit_mode VALUES (true, ${visited});
    CREATE FUNCTION ${schema}.e2e_seed_learning_visits() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (SELECT visited FROM ${schema}.e2e_learning_visit_mode WHERE singleton) THEN
        INSERT INTO ${schema}.learning_progress_versions (user_id, module, version, state_json)
        SELECT NEW.id, modules.name, ${currentLearningVersion},
          json_build_object('module', modules.name, 'version', ${currentLearningVersion},
            'offerSeen', true, 'skipped', modules.name = 'onboarding')::text
        FROM (VALUES ${modulesSql}) AS modules(name)
        ON CONFLICT (user_id, module, version) DO NOTHING;
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER e2e_learning_visits AFTER INSERT ON ${schema}.users
      FOR EACH ROW EXECUTE FUNCTION ${schema}.e2e_seed_learning_visits();
  `;
}

/** Visit state applies to accounts created by the next suite. */
export function setLearningVisitFixtureModeSql(schema, visited) {
  assertIsolatedFixture(schema, visited);
  return `UPDATE ${schema}.e2e_learning_visit_mode SET visited = ${visited} WHERE singleton;`;
}
