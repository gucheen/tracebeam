import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv[2];
const version = input?.replace(/^v/, "");
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!version || !semverPattern.test(version)) {
  console.error("Usage: pnpm version:set <version> (for example: 0.2.0 or v0.2.0)");
  process.exit(1);
}

const packageJsonPath = path.join(projectRoot, "package.json");
const tauriConfigPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(projectRoot, "src-tauri", "Cargo.toml");

const [packageJsonSource, tauriConfigSource, cargoTomlSource] = await Promise.all([
  readFile(packageJsonPath, "utf8"),
  readFile(tauriConfigPath, "utf8"),
  readFile(cargoTomlPath, "utf8"),
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

await Promise.all([
  writeFile(packageJsonPath, nextPackageJson),
  writeFile(tauriConfigPath, nextTauriConfig),
  writeFile(cargoTomlPath, nextCargoToml),
]);

console.log(`Tracebeam version updated to ${version}`);
