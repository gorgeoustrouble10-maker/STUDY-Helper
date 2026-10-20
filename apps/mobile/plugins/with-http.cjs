const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");
module.exports = (config) => {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:networkSecurityConfig"] =
      "@xml/network_security_config";
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      const directory = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, "network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">121.43.32.47</domain></domain-config>
</network-security-config>\n`,
      );
      return mod;
    },
  ]);
};
