import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// One owner tracks the isolated backend, frontend and suite process groups.
export function createOwnedRuntime() {
  const processes = [];

  function start(command, args, options) {
    const child = spawn(command, args, { stdio: "inherit", ...options, detached: process.platform !== "win32" });
    const state = { child, finished: false, code: undefined, error: undefined };
    child.once("exit", (code) => { state.finished = true; state.code = code ?? 1; });
    child.once("error", (error) => { state.finished = true; state.error = error; });
    processes.push(state);
    return state;
  }

  function signal(state, name) {
    if (!state.child.pid || (process.platform === "win32" && state.finished)) return;
    try {
      if (process.platform === "win32") state.child.kill(name);
      else process.kill(-state.child.pid, name);
    } catch (error) { if (error.code !== "ESRCH") throw error; }
  }

  function interrupt() { for (const state of processes) signal(state, "SIGTERM"); }

  async function stop() {
    interrupt();
    const deadline = Date.now() + 5_000;
    while (processes.some((state) => !state.finished) && Date.now() < deadline) await delay(50);
    for (const state of processes) signal(state, "SIGKILL");
    await Promise.all(processes.filter((state) => !state.finished).map((state) =>
      new Promise((resolve) => state.child.once("exit", resolve))));
  }
  return { start, interrupt, stop };
}
