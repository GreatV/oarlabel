// External help links and app metadata used by the Help menu and About dialog.

export const APP_VERSION = "0.1.0";

const REPO = "https://github.com/GreatV/oarlabel";

export const LINKS = {
  repo: REPO,
  docs: `${REPO}#readme`,
  faq: `${REPO}/blob/main/docs/FAQ.md`,
  issues: `${REPO}/issues`,
  releases: `${REPO}/releases`,
} as const;
