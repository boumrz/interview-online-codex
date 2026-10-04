// Imported before E2E fixture code, including when a suite is launched directly.
const runId = process.env.E2E_ISOLATED_RUN_ID;
const schema = process.env.E2E_ISOLATED_SCHEMA;
const database = process.env.E2E_ISOLATED_DATABASE;
if (!/^[a-f0-9]{32}$/.test(runId ?? "")
    || !/^[a-z_]+_e2e_[a-f0-9]{32}$/.test(schema ?? "")
    || !/^[A-Za-z0-9_]+$/.test(database ?? "")
    || database === "interview_online") {
  throw new Error("E2E_ISOLATED_RUN_REQUIRED: use npm run e2e:<suite>; fixtures require a temporary PostgreSQL schema");
}

function isolatedUrl(name, path) {
  let url;
  try { url = new URL(process.env[name]); } catch { throw new Error(`E2E_${name}_ISOLATED_URL_REQUIRED`); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || !url.port || ["8080", "5173"].includes(url.port)
      || url.username || url.password || url.search || url.hash || url.pathname !== path) {
    throw new Error(`E2E_${name}_UNSAFE_TARGET`);
  }
  return url;
}

const api = isolatedUrl("E2E_API_URL", "/api");
const web = isolatedUrl("E2E_BASE_URL", "/");
const proofUrls = [`${api.href}/test-fixtures/e2e-isolation`, `${web.origin}/api/test-fixtures/e2e-isolation`];
if (process.env.E2E_SECOND_API_URL !== undefined) {
  proofUrls.push(`${isolatedUrl("E2E_SECOND_API_URL", "/api").href}/test-fixtures/e2e-isolation`);
}
for (const url of proofUrls) {
  let proof;
  try {
    const response = await fetch(url, {
      headers: { "X-Interhub-E2E-Run": runId },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("NO_PROOF");
    proof = await response.json();
  } catch {
    throw new Error("E2E_ISOLATED_API_PROOF_REQUIRED: API and frontend proxy must belong to the isolated runner");
  }
  if (proof.runId !== runId || proof.schema !== schema || proof.database !== database) {
    throw new Error("E2E_ISOLATED_API_PROOF_MISMATCH");
  }
}
