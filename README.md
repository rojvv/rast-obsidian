# ڕاست for Obsidian

Kurdish (Sorani) proofreading with inline underlines and hover/tap suggestions. Requires Obsidian 1.8.7+.

## Build & install

```sh
npm ci
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/rast/`. Reload Obsidian and enable ڕاست.

## Use

In editing mode, run **ڕاست: Check current note** or **Check selected text**. Hover or tap an underline to apply a suggestion. Optional automatic checking is under **Settings → ڕاست** (off by default).

Checks require internet and send the note or selection—including Markdown, properties, and code—to `wsbapp-ku.rast.krd`. Only a session ID and settings are saved locally.

[MIT license](LICENSE)
