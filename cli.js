#!/usr/bin/env node
"use strict";

/**
 * EntrÃ©e principale du binaire `sync-studio`.
 * Usage: npx sync-studio   (ouvre l'UI hub)
 *        npm run sync      (idem, via devDependency)
 */

const path = require("node:path");
const { spawn } = require("node:child_process");

const serverPath = path.join(__dirname, "server.js");
const currentProject = process.cwd();

const child = spawn(process.execPath, [serverPath, "--current", currentProject], {
  stdio: "inherit",
  cwd: __dirname,
  env: process.env,
});

child.on("exit", (code) => process.exit(code || 0));
