# oarlabel

A desktop OCR / document-layout annotation tool built with [Tauri](https://tauri.app),
React, and [oar-ocr](https://github.com/GreatV/oar-ocr). It turns a folder of
images (or an imported PDF) into a browsable, annotatable workspace and exports
the result as PPOCRLabel-compatible training data.

## Features

- **Five annotation modes:** OCR text regions, layout detection, formula
  recognition, table structure recognition, and reading-order extraction.
- **AI pre-annotation:** run detection/recognition over the current image or the
  whole folder, then refine by hand. Batch runs are cancelable.
- **Canvas tools:** rectangle and polygon drawing, point editing, drag-to-move,
  undo/redo, copy/paste, cursor-anchored scroll zoom.
- **Per-image JSON annotations** stored next to each image, plus dataset export
  (`Label.txt` for detection, `crop_img/` + `rec_gt.txt` for recognition).
- **Configurable model catalog** with auto-download via oar-ocr, CPU/CUDA
  device selection, and zh-CN / en-US UI.

## Getting started

Prerequisites: [Node.js](https://nodejs.org/), a recent Rust toolchain, and the
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install          # install frontend dependencies
npm run tauri dev    # run the desktop app in development
npm run tauri build  # produce a production bundle
```

Models are resolved and downloaded automatically by oar-ocr on first use (see
the in-app **Settings → Model configuration** to inspect or override the
catalog).

## License

MIT
