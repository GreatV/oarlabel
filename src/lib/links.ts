// External help links and app metadata used by the 帮助 menu and About dialog.
// oarlabel builds on the oar-ocr engine; help links point at that upstream repo.

export const APP_VERSION = "0.1.0";

const REPO = "https://github.com/GreatV/oar-ocr";

export const LINKS = {
  repo: REPO,
  docs: `${REPO}/blob/master/docs/usage.md`,
  faq: `${REPO}#readme`,
  issues: `${REPO}/issues`,
  releases: `${REPO}/releases`,
} as const;
