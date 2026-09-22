// One-time interactive QR pairing. Run this manually on the laptop:
//   npm run login
// Scan the QR with WhatsApp > Linked devices > Link a device. The session
// is then persisted under BOT_HOME/session and reused by every future run
// -- no QR needed again unless you log the linked device out.

import { config } from "../src/config.js";
import { createClient } from "../src/whatsapp.js";

async function main() {
  console.log(`[login] session will be stored at: ${config.paths.sessionDir}`);
  const client = await createClient({ sessionDir: config.paths.sessionDir, interactive: true });
  console.log("[login] WhatsApp session is ready and authenticated.");
  const info = client.info;
  if (info?.wid?.user) console.log(`[login] linked as: +${info.wid.user}`);
  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error("[login] failed:", err);
  process.exit(1);
});
