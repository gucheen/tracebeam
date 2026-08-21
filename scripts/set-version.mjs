import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv[2];
const version = input?.replace(/^v/, "");
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!version || !semverPattern.test(version)) {
  console.error("Usage: pnpm version:set <version> (for example: 0.2.0 or v0.2.0)");
  process.exit(1);
}

const execFileAsync = promisify(execFile);

async function runGit(args) {
  return execFileAsync("git", args, { cwd: projectRoot });
}

const { stdout: status } = await runGit(["status", "--porcelain"]);
if (status.trim()) {
  console.error("version:set requires a clean Git working tree");
  process.exit(1);
}

const packageJsonPath = path.join(projectRoot, "package.json");
const tauriConfigPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(projectRoot, "src-tauri", "Cargo.toml");
const cargoLockPath = path.join(projectRoot, "src-tauri", "Cargo.lock");
const versionPaths = [
  "package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
];

const [packageJsonSource, tauriConfigSource, cargoTomlSource, cargoLockSource] = await Promise.all([
  readFile(packageJsonPath, "utf8"),
  readFile(tauriConfigPath, "utf8"),
  readFile(cargoTomlPath, "utf8"),
  readFile(cargoLockPath, "utf8"),
]);

const packageJson = JSON.parse(packageJsonSource);
const tauriConfig = JSON.parse(tauriConfigSource);

function replaceJsonVersion(source, currentVersion, fileName) {
  if (typeof currentVersion !== "string") {
    throw new Error(`${fileName} does not contain a string version`);
  }

  const oldValue = `"version": "${currentVersion}"`;
  const newValue = `"version": "${version}"`;
  if (!source.includes(oldValue)) {
    throw new Error(`Could not locate the formatted version field in ${fileName}`);
  }

  return source.replace(oldValue, newValue);
}

const cargoPackageVersion = /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m;
if (!cargoPackageVersion.test(cargoTomlSource)) {
  throw new Error("Could not locate [package].version in src-tauri/Cargo.toml");
}

const cargoLockPackageVersion = /(\[\[package\]\]\r?\nname = "tracebeam"\r?\nversion = ")[^"]+("\r?$)/m;
if (!cargoLockPackageVersion.test(cargoLockSource)) {
  throw new Error("Could not locate the tracebeam package version in src-tauri/Cargo.lock");
}

const nextPackageJson = replaceJsonVersion(
  packageJsonSource,
  packageJson.version,
  "package.json",
);
const nextTauriConfig = replaceJsonVersion(
  tauriConfigSource,
  tauriConfig.version,
  "src-tauri/tauri.conf.json",
);
const nextCargoToml = cargoTomlSource.replace(
  cargoPackageVersion,
  `$1${version}$2`,
);
const nextCargoLock = cargoLockSource.replace(
  cargoLockPackageVersion,
  `$1${version}$2`,
);

await Promise.all([
  writeFile(packageJsonPath, nextPackageJson),
  writeFile(tauriConfigPath, nextTauriConfig),
  writeFile(cargoTomlPath, nextCargoToml),
  writeFile(cargoLockPath, nextCargoLock),
]);

await runGit(["add", "--", ...versionPaths]);
const { stdout: staged } = await runGit([
  "diff", "--cached", "--name-only", "--", ...versionPaths,
]);
if (!staged.trim()) {
  console.log(`Tracebeam is already at version ${version}`);
  process.exit(0);
}

const message = `Bump version to ${version}`;
await runGit(["commit", "-m", message, "--", ...versionPaths]);
console.log(`Tracebeam version updated to ${version} and committed as "${message}"`);
