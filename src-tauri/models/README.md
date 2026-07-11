# Bundled models

ONNX model files placed in this directory are bundled into the app via the
`bundle.resources` glob in `tauri.conf.json` and resolved at runtime from the
resource directory (see `src/models.rs` → `candidate_paths`).

Most models are downloaded on demand to the user's cache directory at runtime,
so this directory is usually empty during development. Bundled entries (those
with `"bundled": true` in `model-config.default.json`) are intended to be
populated here as part of a release packaging step.

This placeholder file only exists so the `models/*` resource glob matches at
build time; it carries no model data.
