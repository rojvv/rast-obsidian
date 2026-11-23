# Rast for Obsidian

Check Kurdish (Sorani) spelling in your notes with underlined issues and click-or-tap corrections. Requires Obsidian **1.8.7+** and internet access.

## Use

1. Open a note in **Live Preview** or **Source mode**.
2. Search for **Rast** in the command palette and run **Check current note** or **Check selected text**.
3. Hover over or tap an underline to apply a suggestion or ignore it.

Enable optional automatic checking in **Settings → Rast**. It is off by default.

## Privacy

Checks send your note or selection—including Markdown, properties, and code—to `wsbapp-ku.rast.krd`. Automatic checking sends the active note as you type and switch notes. Only your setting and a service session ID are saved locally.

Read the [Rast privacy policy](https://rast.krd/privacy).

## Install manually

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/rojvv/rast-obsidian/releases/latest).
2. Place them in your vault’s `.obsidian/plugins/rast/` folder, creating it if needed.
3. Restart Obsidian and enable **Rast** in **Settings → Community plugins**.

[MIT license](LICENSE)
