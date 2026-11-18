import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const composeFile = resolve(root, "docker-compose.dev.yml");
let children = [];
let stopping = false;

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`)));
  });
}

function start(name, args) {
  // pnpm is a .cmd shim on Windows. Node cannot reliably execute that shim
  // directly from every PowerShell/Node installation (spawn EINVAL). Invoke
  // cmd.exe explicitly rather than `shell: true`, which emits a Node warning.
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec ?? "cmd.exe") : pnpm;
  const commandArgs = windows ? ["/d", "/s", "/c", [pnpm, ...args].join(" ")] : args;
  const child = spawn(command, commandArgs, { cwd: root, stdio: "inherit" });
  children.push(child);
  child.once("error", (error) => {
    console.error(`[${name}] could not start (${pnpm} ${args.join(" ")}): ${error.message}`);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[${name}] stopped unexpectedly (${signal ?? code ?? "unknown"}). Stopping local development.`);
      void shutdown(code && code !== 0 ? code : 1);
    }
  });
}

async function stopChildTree(child) {
  if (!child.pid) return;
  try { child.kill("SIGINT"); } catch { /* already stopped */ }
  // Windows does not consistently forward Ctrl+C to subprocess trees spawned
  // from npm. Give watch servers time to close, then end only this tree.
  if (process.platform === "win32") {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    await new Promise((resolveKill) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("exit", resolveKill);
      killer.once("error", resolveKill);
    });
  }
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(stopChildTree));
  children = [];
  process.exit(exitCode);
}

async function redisTarget() {
  const defaults = { host: "127.0.0.1", port: 6379 };
  const envPath = resolve(root, ".env.local");
  if (!existsSync(envPath)) return defaults;
  const contents = await readFile(envPath, "utf8");
  const values = Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const matched = /^(REDIS_HOST|REDIS_PORT)=(.*)$/.exec(line.trim());
    return matched ? [[matched[1], matched[2].trim()]] : [];
  }));
  const port = Number(values.REDIS_PORT ?? defaults.port);
  return { host: values.REDIS_HOST || defaults.host, port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : defaults.port };
}

function isReachable(host, port) {
  return new Promise((resolveReachable) => {
    const socket = createConnection({ host, port });
    const done = (value) => { socket.removeAllListeners(); socket.destroy(); resolveReachable(value); };
    socket.setTimeout(700, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function isLocalHost(host) { return host === "127.0.0.1" || host === "localhost" || host === "::1"; }

async function isResearchServiceHealthy() {
  try {
    const response = await fetch("http://127.0.0.1:8010/health", {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body && body.status === "ok";
  } catch {
    return false;
  }
}

async function infraUp() {
  const target = await redisTarget();
  const redisReady = await isReachable(target.host, target.port);
  const researchReady = await isResearchServiceHealthy();
  if (redisReady && researchReady) {
    console.log(`Redis is already reachable at ${target.host}:${target.port}; Research Service is already reachable at 127.0.0.1:8010.`);
    return;
  }
  if (!redisReady && (!isLocalHost(target.host) || target.port !== 6379)) {
    throw new Error(`Redis at ${target.host}:${target.port} is unavailable. Docker development infrastructure only manages the unchanged local default 127.0.0.1:6379.`);
  }
  const services = redisReady ? ["searxng", "research-service"] : ["redis", "searxng", "research-service"];
  if (redisReady) console.log(`Redis is already reachable at ${target.host}:${target.port}; Docker Redis was not started.`);
  await run("docker", ["compose", "-f", composeFile, "up", "-d", ...services]);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isReachable(target.host, target.port) && await isResearchServiceHealthy()) {
      console.log("Started local Redis, SearXNG and Research Service with Docker. Run `pnpm infra:down` when they are no longer needed.");
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error("Docker infrastructure did not become ready: Redis or Research Service health check failed.");
}

async function infraDown() {
  await run("docker", ["compose", "-f", composeFile, "down"]);
}

async function main() {
  const command = process.argv[2];
  if (command === "--help" || command === "-h") {
    console.log("Usage: pnpm dev | pnpm dev:all | pnpm infra:up | pnpm infra:down");
    return;
  }
  if (command === "infra:up") return infraUp();
  if (command === "infra:down") return infraDown();
  if (command && command !== "--with-infra") throw new Error(`Unknown command: ${command}`);
  if (command === "--with-infra") await infraUp();
  process.on("SIGINT", () => { void shutdown(0); });
  process.on("SIGTERM", () => { void shutdown(0); });
  start("turbo", ["exec", "turbo", "run", "dev", "--filter=web", "--filter=widget"]);
  start("api", ["--filter", "@workspace/api", "start:dev"]);
  start("worker", ["--filter", "@workspace/api", "start:worker:dev"]);
}

main().catch((error) => { console.error(`Local development setup failed: ${error.message}`); process.exitCode = 1; });
