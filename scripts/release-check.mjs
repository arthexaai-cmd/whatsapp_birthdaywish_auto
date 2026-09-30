// Guard used by the release workflow: the pushed tag (v2.1.0) must equal the
// version in package.json (2.1.0). electron-builder names the installer and
// the update feed (latest.yml) after package.json, so a mismatch would publish
// a release whose tag says one thing and whose installer says another --
// and installed apps compare the *feed* version, not the tag.
//
//   TAG=v2.1.0 node scripts/release-check.mjs

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function tagMatchesVersion(tag, version) {
  return typeof tag === "string" && typeof version === "string" && tag === `v${version}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.env.TAG ?? process.env.GITHUB_REF_NAME;
  const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (!tagMatchesVersion(tag, version)) {
    console.error(`Release tag "${tag}" does not match package.json version "${version}". Expected tag "v${version}".`);
    process.exit(1);
  }
  console.log(`Release tag ${tag} matches package.json version ${version}.`);
}
