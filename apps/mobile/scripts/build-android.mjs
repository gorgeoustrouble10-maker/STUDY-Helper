import { spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const java =
  process.env.JAVA_HOME ||
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
const sdk =
  process.env.ANDROID_HOME ||
  path.join(process.env.HOME, "Library/Android/sdk");
const privateDir = path.join(root, ".credentials");
fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
const passwordFile = path.join(privateDir, "store-password");
if (!fs.existsSync(passwordFile))
  fs.writeFileSync(passwordFile, randomBytes(32).toString("hex"), {
    mode: 0o600,
  });
const env = {
  ...process.env,
  JAVA_HOME: java,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  STUDY_STORE_PASSWORD: fs.readFileSync(passwordFile, "utf8").trim(),
  STUDY_KEYSTORE: path.join(privateDir, "upload.jks"),
};
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!fs.existsSync(env.STUDY_KEYSTORE))
  run(path.join(java, "bin/keytool"), [
    "-genkeypair",
    "-keystore",
    env.STUDY_KEYSTORE,
    "-storepass:env",
    "STUDY_STORE_PASSWORD",
    "-keypass:env",
    "STUDY_STORE_PASSWORD",
    "-alias",
    "studyhelper",
    "-keyalg",
    "RSA",
    "-keysize",
    "3072",
    "-validity",
    "10000",
    "-dname",
    "CN=Study Helper, O=Personal Garden, C=CN",
  ]);
if (!process.argv.includes("--skip-prebuild"))
  run(process.execPath, [
    "node_modules/expo/bin/cli",
    "prebuild",
    "--platform",
    "android",
    "--no-install",
  ]);
fs.writeFileSync(
  path.join(root, "android/local.properties"),
  `sdk.dir=${sdk}\n`,
);
run(
  "./gradlew",
  [
    ":app:assembleRelease",
    "--no-daemon",
    "--info",
    "--console=plain",
    "--max-workers=3",
    "-Dorg.gradle.internal.http.connectionTimeout=15000",
    "-Dorg.gradle.internal.http.socketTimeout=15000",
    "-PreactNativeArchitectures=arm64-v8a",
    "-Pandroid.ndkVersion=27.1.12297006",
  ],
  path.join(root, "android"),
);
const version = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"))
  .expo.version;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Invalid application version");
const artifact = path.resolve(
  root,
  `../../artifacts/study-helper-${version}.apk`,
);
fs.mkdirSync(path.dirname(artifact), { recursive: true });
const temporaryArtifact = artifact + ".tmp";
fs.copyFileSync(
  path.join(root, "android/app/build/outputs/apk/release/app-release.apk"),
  temporaryArtifact,
);
run(path.join(sdk, "build-tools/37.0.0/apksigner"), [
  "verify",
  "--verbose",
  temporaryArtifact,
]);
fs.renameSync(temporaryArtifact, artifact);
fs.writeFileSync(
  artifact + ".sha256",
  `${createHash("sha256").update(fs.readFileSync(artifact)).digest("hex")}  ${path.basename(artifact)}\n`,
);
console.log(`APK: ${artifact}`);
