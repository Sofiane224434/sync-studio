#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const hubDir = __dirname;
const registryPath = path.join(hubDir, "projects.json");
const uiPath = path.join(hubDir, "ui.html");

const currentArgIndex = process.argv.indexOf("--current");
const currentProject = currentArgIndex >= 0 ? path.resolve(process.argv[currentArgIndex + 1] || "") : "";

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) reject(new Error("Payload trop volumineux"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function openBrowser(url) {
  const opts = { detached: true, stdio: "ignore" };
  if (process.platform === "win32") { spawn("cmd", ["/c", "start", "", url], opts).unref(); return; }
  if (process.platform === "darwin") { spawn("open", [url], opts).unref(); return; }
  spawn("xdg-open", [url], opts).unref();
}

function readRegistry() {
  const raw = fs.existsSync(registryPath)
    ? parseJson(fs.readFileSync(registryPath, "utf8"), { projects: [] })
    : { projects: [] };
  return [...new Set((Array.isArray(raw.projects) ? raw.projects : []).map((p) => path.resolve(String(p || ""))))].filter(
    (p) => fs.existsSync(path.join(p, ".git")) && fs.existsSync(path.join(p, ".sync", "config.template.json"))
  );
}

function readProjectState(projectPath) {
  const cfgPath = path.join(projectPath, ".sync", "config.json");
  const tplPath = path.join(projectPath, ".sync", "config.template.json");
  const source = fs.existsSync(cfgPath)
    ? parseJson(fs.readFileSync(cfgPath, "utf8"), { entries: [] })
    : parseJson(fs.readFileSync(tplPath, "utf8"), { entries: [] });
  return (Array.isArray(source.entries) ? source.entries : [])
    .filter((e) => e && typeof e.from === "string")
    .map((e) => e.from.trim())
    .filter(Boolean);
}

function listFiles(projectPath) {
  const root = path.resolve(projectPath);
  const ignoredDirs = new Set([".git", "node_modules", ".sync", ".idea", ".vscode", "dist", "build"]);
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (!rel) continue;
      if (entry.isDirectory()) { if (!ignoredDirs.has(entry.name)) walk(full); continue; }
      if (!entry.isFile()) continue;
      out.push(rel);
      if (out.length >= 4000) return;
    }
  };
  walk(root);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

if (!fs.existsSync(uiPath)) {
  console.error(`[sync-studio] Interface introuvable: ${uiPath}`);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const projects = readRegistry().map((p) => ({ path: p, name: path.basename(p) }));
    sendJson(res, 200, { currentProject, projects });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/files") {
    const projectPath = path.resolve(String(url.searchParams.get("projectPath") || ""));
    if (!readRegistry().includes(projectPath)) { sendJson(res, 400, { error: "Projet inconnu" }); return; }
    sendJson(res, 200, { files: listFiles(projectPath) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const projectPath = path.resolve(String(url.searchParams.get("projectPath") || ""));
    if (!readRegistry().includes(projectPath)) { sendJson(res, 400, { error: "Projet inconnu" }); return; }
    sendJson(res, 200, { selectedFiles: readProjectState(projectPath) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/save") {
    try {
      const projects = readRegistry();
      const body = parseJson(await readBody(req), null);
      const projectPath = path.resolve(String(body?.projectPath || ""));
      if (!projects.includes(projectPath)) throw new Error("Projet inconnu");
      const files = Array.isArray(body?.files) ? body.files : [];
      const selected = [...new Set(files.map((f) => String(f || "").trim()).filter(Boolean))];
      if (!selected.length) throw new Error("Sélectionne au moins un fichier");
      const config = { mode: "global", entries: selected.map((f) => ({ from: f, to: f })) };
      const cfgPath = path.join(projectPath, ".sync", "config.json");
      fs.writeFileSync(cfgPath, `${JSON.stringify(config, null, 2)}\n`);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/close") {
    sendJson(res, 200, { ok: true });
    setTimeout(() => server.close(() => process.exit(0)), 120);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(uiPath, "utf8"));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const appUrl = `http://127.0.0.1:${port}`;
  console.log(`[sync-studio] Interface disponible: ${appUrl}`);
  console.log("[sync-studio] Clique Fermer dans la page ou Ctrl+C pour quitter.");
  openBrowser(appUrl);
});
