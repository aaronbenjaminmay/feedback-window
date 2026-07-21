// Turns a target's Vite build output into a self-contained, Figma-importable
// plugin folder by generating that target's manifest.json from the single
// shared manifest.template.json (see package.json's build:<target> scripts).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2];

if (!target) {
  console.error("Usage: node scripts/package-plugin.js <target>");
  process.exit(1);
}

const rootDir = resolve(import.meta.dirname, "..");
const buildDir = resolve(rootDir, "builds", target);
const envFile = resolve(rootDir, `.env.${target}`);
const templateFile = resolve(rootDir, "manifest.template.json");

const readEnvValue = (filePath, key) => {
  if (!existsSync(filePath)) {
    throw new Error(`No env file for target "${target}": expected ${filePath}`);
  }

  const contents = readFileSync(filePath, "utf8");
  const match = contents
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${key}=`));

  if (!match) {
    throw new Error(`${key} not found in ${filePath}`);
  }

  return match.slice(key.length + 1).trim();
};

try {
  const apiBaseUrl = readEnvValue(envFile, "VITE_API_BASE_URL");
  const targetLabel = target.charAt(0).toUpperCase() + target.slice(1);

  const manifest = readFileSync(templateFile, "utf8")
    .replaceAll("{{TARGET_KEY}}", target)
    .replaceAll("{{TARGET_LABEL}}", targetLabel)
    .replaceAll("{{API_BASE_URL}}", apiBaseUrl);

  writeFileSync(resolve(buildDir, "manifest.json"), manifest);

  const requiredFiles = ["manifest.json", "main.js", "index.html", "FW-icon.svg"];
  const missingFiles = requiredFiles.filter(
    (fileName) => !existsSync(resolve(buildDir, fileName))
  );

  if (missingFiles.length > 0) {
    throw new Error(
      `builds/${target} is missing required plugin files: ${missingFiles.join(", ")}. Run "vite build --mode ${target}" before packaging.`
    );
  }

  console.log(`builds/${target} is ready to import into Figma (${apiBaseUrl}).`);
} catch (error) {
  console.error(`package-plugin failed for target "${target}": ${error.message}`);
  process.exit(1);
}
