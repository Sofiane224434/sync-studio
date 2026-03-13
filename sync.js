"use strict";

/**
 * Hook post-commit : copie les fichiers configurÃ©s vers tous les autres projets connectÃ©s.
 * AppelÃ© via .git/hooks/post-commit â†’ node "./node_modules/sync-studio/sync.js"
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

if (process.env.SYNC_IN_PROGRESS === "1") process.exit(0);

const noPromptEnv = { ...process.env, GCM_INTERACTIVE: "never", GIT_TERMINAL_PROMPT: "0" };

// cwd = racine du projet (git exÃ©cute les hooks depuis la racine)
const root = path.resolve(process.cwd());
const registryPath = path.join(os.homedir(), ".sync-center", "projects.json");

function pushSource() {
  try { execSync("git push origin HEAD", { cwd: root, stdio: "inherit", env: noPromptEnv }); } catch (e) {
    console.error(`[sync] push source: ${e.message}`);
  }
}

let raw;
try { raw = JSON.parse(fs.readFileSync(registryPath, "utf8")); } catch (_) { pushSource(); process.exit(0); }

const projects = (Array.isArray(raw.projects) ? raw.projects : []).map((p) =>
  typeof p === "string"
    ? { path: path.resolve(p), entries: [] }
    : { path: path.resolve(String(p.path || "")), entries: Array.isArray(p.entries) ? p.entries : [] }
);

const thisProject = projects.find((p) => p.path === root);

if (!thisProject || !thisProject.entries.length) {
  pushSource();
  process.exit(0);
}

const others = projects
  .filter((p) => p.path !== root)
  .map((p) => p.path)
  .filter((p) => fs.existsSync(path.join(p, ".git")));

if (!others.length) {
  console.log("[sync] aucun autre projet connectÃ©.");
  pushSource();
  process.exit(0);
}

const repoFiles = new Map();
let synced = 0;

for (const entry of thisProject.entries) {
  const from = (entry.from || "").trim();
  const to = (entry.to || "").trim();
  if (!from || !to) continue;

  const src = path.resolve(root, from);
  if (!fs.existsSync(src)) continue;

  for (const target of others) {
    const dest = path.resolve(target, to);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`[sync] ${from} â†’ ${path.basename(target)}/${to}`);
      synced++;
      if (!repoFiles.has(target)) repoFiles.set(target, []);
      repoFiles.get(target).push(to);
    } catch (e) {
      console.error(`[sync] erreur copie vers ${path.basename(target)}: ${e.message}`);
    }
  }
}

pushSource();

if (!synced) process.exit(0);

for (const [repoRoot, files] of repoFiles) {
  try {
    for (const f of files) {
      try { execSync(`git add "${f}"`, { cwd: repoRoot, stdio: "pipe" }); } catch (_) {}
    }
    try { execSync("git diff --cached --quiet", { cwd: repoRoot }); continue; } catch (_) {}
    execSync('git commit -m "sync: auto"', {
      cwd: repoRoot,
      env: { ...noPromptEnv, SYNC_IN_PROGRESS: "1" },
      stdio: "inherit",
    });
    execSync("git push origin HEAD", { cwd: repoRoot, stdio: "inherit", env: noPromptEnv });
    console.log(`[sync] pushed â†’ ${path.basename(repoRoot)}`);
  } catch (e) {
    console.error(`[sync] commit/push ${path.basename(repoRoot)}: ${e.message}`);
  }
}
