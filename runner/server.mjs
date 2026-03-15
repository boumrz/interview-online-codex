import express from "express";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 7070);
const EXEC_TIMEOUT_MS = Number(process.env.EXEC_TIMEOUT_MS || 4000);
const OUTPUT_LIMIT = Number(process.env.OUTPUT_LIMIT || 8000);

app.post("/api/execute", async (req, res) => {
  const language = String(req.body?.language || "").toLowerCase();
  const code = String(req.body?.code || "");

  if (!code.trim()) {
    return res.status(400).json({
      stdout: "",
      stderr: "Code is empty",
      exitCode: 2,
      timedOut: false
    });
  }

  const runnerConfig = resolveRunner(language);
  if (!runnerConfig) {
    return res.status(400).json({
      stdout: "",
      stderr: `Language '${language}' is not supported by isolated runner`,
      exitCode: 2,
      timedOut: false
    });
  }

  const workspace = await mkdtemp(path.join(tmpdir(), "io-isolated-"));
  const sourceFile = path.join(workspace, runnerConfig.filename);

  try {
    await writeFile(sourceFile, code, "utf8");
    const result = await executeCommand(runnerConfig.command, workspace);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      stdout: "",
      stderr: `Runner internal error: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 3,
      timedOut: false
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`isolated-runner started on :${PORT}`);
});

function resolveRunner(language) {
  if (language === "javascript" || language === "typescript") {
    return { filename: "main.js", command: ["node", "main.js"] };
  }
  if (language === "python") {
    return { filename: "main.py", command: ["python3", "main.py"] };
  }
  return null;
}

function executeCommand(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: {
        PATH: process.env.PATH || ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, EXEC_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > OUTPUT_LIMIT) {
        stdout = stdout.slice(0, OUTPUT_LIMIT);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > OUTPUT_LIMIT) {
        stderr = stderr.slice(0, OUTPUT_LIMIT);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut ? "Execution timed out" : stderr,
        exitCode: timedOut ? 124 : Number(code ?? 1),
        timedOut
      });
    });
  });
}
