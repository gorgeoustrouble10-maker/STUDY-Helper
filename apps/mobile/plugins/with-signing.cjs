const { withAppBuildGradle } = require("expo/config-plugins");
module.exports = (config) =>
  withAppBuildGradle(config, (mod) => {
    let source = mod.modResults.contents;
    const releaseAt = source.indexOf("release {");
    if (releaseAt < 0) throw new Error("Release build configuration missing");
    const prefix = source.slice(0, releaseAt);
    let suffix = source
      .slice(releaseAt)
      .replace(
        "signingConfig signingConfigs.debug",
        "signingConfig signingConfigs.studyRelease",
      );
    source = prefix + suffix;
    source = source.replace(
      "signingConfigs {",
      `signingConfigs {
        studyRelease {
            storeFile file(System.getenv("STUDY_KEYSTORE") ?: "../../.credentials/upload.jks")
            storePassword System.getenv("STUDY_STORE_PASSWORD") ?: ""
            keyAlias "studyhelper"
            keyPassword System.getenv("STUDY_STORE_PASSWORD") ?: ""
        }`,
    );
    mod.modResults.contents = source;
    return mod;
  });
