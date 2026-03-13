"use strict";

/**
 * Tourne automatiquement lors de `npm install sync-studio` dans un projet.
 * - Enregistre le projet dans ~/.sync-center/projects.json
 * - Configure le hook git post-commit
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

function parseJson(text, fallback) {
  try {
    const clean = String(text || "").replace(/^\uFEFF/, "");
    return JSON.parse(clean);
  } catch (_) {
    return fallback;
  }
}

// INIT_CWD = rÃ©pertoire depuis lequel `npm install` a Ã©tÃ© lancÃ© (variable npm)
const selfDir = path.resolve(__dirname);
const projectRoot = path.resolve(
  process.env.INIT_CWD || process.env.npm_config_local_prefix || process.cwd()
);

// Ne pas s'auto-enregistrer quand on tourne dans sync-studio lui-mÃªme
if (projectRoot === selfDir) process.exit(0);

// Ne travailler que sur des repos git
if (!fs.existsSync(path.join(projectRoot, ".git"))) {
  process.exit(0);
}

try {
  const centerDir = path.join(os.homedir(), ".sync-center");
  const registryPath = path.join(centerDir, "projects.json");

  fs.mkdirSync(centerDir, { recursive: true });

  // Lire le registre existant + migrer l'ancien format (strings â†’ objets)
  let raw = { projects: [] };
  raw = parseJson(fs.readFileSync(registryPath, "utf8"), raw);
  if (!Array.isArray(raw.projects)) raw.projects = [];

  raw.projects = raw.projects.map((p) =>
    typeof p === "string"
      ? { path: path.resolve(p), entries: [] }
      : { path: path.resolve(String(p.path || "")), entries: Array.isArray(p.entries) ? p.entries : [] }
  );

  const already = raw.projects.find((p) => p.path === projectRoot);
  if (!already) {
    raw.projects.push({ path: projectRoot, entries: [] });
    fs.writeFileSync(registryPath, `${JSON.stringify(raw, null, 2)}\n`);
    console.log(`[sync-studio] Projet enregistrÃ©: ${path.basename(projectRoot)}`);
  } else {
    console.log(`[sync-studio] DÃ©jÃ  connectÃ©: ${path.basename(projectRoot)}`);
  }

  // Supprimer core.hooksPath s'il pointait vers l'ancien .sync/hooks
  try {
    const cur = execSync("git config core.hooksPath", { cwd: projectRoot, stdio: "pipe" }).toString().trim();
    if (cur.includes(".sync/hooks")) {
      execSync("git config --unset core.hooksPath", { cwd: projectRoot, stdio: "pipe" });
    }
  } catch (_) {}

  // Ã‰crire le hook post-commit
  const hookDir = path.join(projectRoot, ".git", "hooks");
  const hookPath = path.join(hookDir, "post-commit");
  const hookLine = `node "./node_modules/sync-studio/sync.js"`;
  const hookContent = `#!/bin/sh\n${hookLine} || true\n`;

  fs.mkdirSync(hookDir, { recursive: true });

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf8");
    if (!existing.includes("sync-studio")) {
      fs.writeFileSync(hookPath, existing.trimEnd() + "\n" + hookLine + " || true\n");
    }
  } else {
    fs.writeFileSync(hookPath, hookContent);
    try { execSync(`chmod +x "${hookPath}"`, { stdio: "pipe" }); } catch (_) {}
  }

  console.log(`[sync-studio] Hook post-commit configurÃ© âœ“`);
} catch (e) {
  // Ne jamais bloquer l'installation
  console.warn(`[sync-studio] Avertissement setup: ${e.message}`);
}
