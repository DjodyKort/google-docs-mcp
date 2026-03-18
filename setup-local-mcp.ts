import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_NAME = "google-docs-mcp";
const distEntry = resolve(__dirname, "dist", "index.js");
const credentialsPath = resolve(__dirname, "credentials.json");

function loadCredentials(): { clientId: string; clientSecret: string } {
  if (!existsSync(credentialsPath)) {
    console.error(`
ERROR: credentials.json not found at:
  ${credentialsPath}

Download it from Google Cloud Console:
  1. Go to https://console.cloud.google.com/apis/credentials
  2. Open your OAuth 2.0 Client ID
  3. Click "Download JSON" and save it as credentials.json in the project root
`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(credentialsPath, "utf-8"));
  const keys = raw.installed ?? raw.web;

  if (!keys?.client_id || !keys?.client_secret) {
    console.error(
      `ERROR: credentials.json is missing client_id or client_secret.\n` +
        `Expected shape: { "installed": { "client_id": "...", "client_secret": "..." } }`
    );
    process.exit(1);
  }

  return { clientId: keys.client_id, clientSecret: keys.client_secret };
}

function run(cmd: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function runOptional(cmd: string) {
  try {
    run(cmd);
  } catch {
    // ignore — server may not exist yet
  }
}

const { clientId, clientSecret } = loadCredentials();

console.log("Building project...");
run("npm run build");

console.log("\nRemoving existing MCP server (if any)...");
runOptional(`claude mcp remove "${MCP_NAME}" -s user`);

console.log("\nRegistering local MCP server...");
run(
  `claude mcp add "${MCP_NAME}" --scope user` +
    ` -e GOOGLE_CLIENT_ID="${clientId}"` +
    ` -e GOOGLE_CLIENT_SECRET="${clientSecret}"` +
    ` -- node "${distEntry}"`
);

console.log("\nDone! Verifying...");
run(`claude mcp get "${MCP_NAME}"`);
