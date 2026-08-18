#!/usr/bin/env node
import { loginAntigravity } from "../src/auth/oauth.js";

console.log("=== Google Antigravity OAuth Login for DSH ===\n");
console.log("Starting OAuth authentication flow...");

try {
  const creds = await loginAntigravity();
  console.log("\n=============================================");
  console.log(" Google Antigravity login successful!");
  if (creds.email) console.log(` Account: ${creds.email}`);
  if (creds.projectId) console.log(` Project: ${creds.projectId}`);
  console.log(" Credentials saved to ~/.dsh/antigravity-auth.json");
  console.log("=============================================\n");
  process.exit(0);
} catch (err) {
  console.error("\n Login failed:", err.message);
  process.exit(1);
}
