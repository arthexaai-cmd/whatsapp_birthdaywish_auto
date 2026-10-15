// IPC: the birthday-card editor. Thin glue over src/core/cardLayout.js,
// cardImage.js and cardRender.js. The renderer never supplies a file path: it
// asks for a picture dialog (main picks the file) and refers to the stored
// picture by name only.

import { ipcMain, dialog } from "electron";
import { getAllSettings, getSetting, setSetting, listContacts } from "../../src/core/db.js";
import { normalizeCardConfig, validateCardConfig } from "../../src/core/cardLayout.js";
import { importBackground } from "../../src/core/cardImage.js";
import { renderCard } from "../../src/core/cardRender.js";
import { cardName, namePostfixFrom } from "../../src/core/messages.js";
import { cardPaths } from "../cardPaths.js";

const toDataUrl = (jpeg) => `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;

export function registerCardsIpc(db) {
  const config = () => normalizeCardConfig(getSetting(db, "cardConfig"));
  const save = (c) => {
    setSetting(db, "cardConfig", c);
    return c;
  };

  ipcMain.handle("cards:getConfig", () => config());

  // Style + box + name options. The picture itself is only ever changed by
  // pickImage / useSample, so the renderer can't point the card at another file.
  ipcMain.handle("cards:saveConfig", (event, incoming) => save(validateCardConfig({ ...incoming, image: config().image })));

  ipcMain.handle("cards:pickImage", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose your birthday picture",
      properties: ["openFile"],
      filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const { image } = await importBackground(result.filePaths[0], cardPaths().cardsDir);
    return save({ ...config(), image });
  });

  ipcMain.handle("cards:useSample", () => save({ ...config(), image: "starter" }));

  // Preview with the draft (unsaved) settings and a sample name, using the very
  // same renderer as the real send.
  ipcMain.handle("cards:renderPreview", async (event, { config: draft, sample }) => {
    const c = validateCardConfig({ ...draft, image: config().image });
    const name = String(sample?.name ?? "").slice(0, 120);
    const person = { name, firstName: name.split(/\s+/)[0] ?? "", salutation: String(sample?.salutation ?? "").slice(0, 50) };
    const text = cardName(person, c, namePostfixFrom(getAllSettings(db)));
    return toDataUrl(await renderCard({ config: c, text, ...cardPaths() }));
  });

  // Small card for a contact in the Home review list, using the saved settings.
  ipcMain.handle("cards:renderForContact", async (event, contactId) => {
    const c = config();
    if (!c.image) return null;
    const contact = listContacts(db).find((x) => x.id === contactId);
    if (!contact) return null;
    const text = cardName(contact, c, namePostfixFrom(getAllSettings(db)));
    return toDataUrl(await renderCard({ config: c, text, maxSide: 360, ...cardPaths() }));
  });
}
