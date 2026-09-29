<div align="center">

<img src="assets/logo.svg" width="112" height="112" alt="Zen Tidy logo">

# Zen Tidy

**One click and your messy unpinned tabs are sorted into named folders.**

Arc's Tidy, for [Zen Browser](https://zen-browser.app). Works offline, with undo. AI is optional.

![Zen](https://img.shields.io/badge/Zen-mod-065F46)
![Sine](https://img.shields.io/badge/installs%20with-Sine-10B981)
![AI optional](https://img.shields.io/badge/AI-optional-F5B83D)
![Version](https://img.shields.io/badge/version-0.1.0-F5B83D)

</div>

---

## What it does

You have 25 unpinned tabs. Click **✨ Tidy**. Half a second later they're in folders:

```
✨ Lisbon                  flights search, Kayak, Booking.com, Tripadvisor, Wikipedia
✨ GitHub · zen-browser    the repo, an issue, a pull request
✨ React useEffect         two react.dev pages, a Stack Overflow question
✨ MDN                     WebSocket, CSS grid
✨ Amazon                  two chargers
   Gmail                   (a loner: stays unpinned)
```

A toast says **"Tidied 15 tabs into 5 folders · Undo"**. Undo puts every tab back exactly where it was.

## Features

- **One click, no setup.** No account and no rules to write. Grouping runs on your computer and works offline.
- **Smart local grouping:**
  - Groups by site; big sites split further, e.g. one GitHub org, or Google Docs vs Sheets.
  - Follows opener chains: tabs you opened from a search or an article stay with it.
  - Matches similar titles across sites, so "Lisbon flights" and "Hotels in Lisbon" end up together.
  - Works with titles in any language.
- **Readable folder names**: "Google Docs", "Jira", "React useEffect", "Kiralık Daire".
- **Undo** for everything, including duplicate tabs Tidy closed.
- **Untidy** a folder to send its tabs back to unpinned, or untidy all Tidy folders in a space at once.
- **Tidy tab titles** turns "(3) Lo-fi beats to study to - YouTube" into "Lo-fi beats to study to", locally or with AI.
- **Optional:**
  - AI grouping with Claude, any OpenAI-compatible API, or a local Ollama model.
  - Close duplicate tabs while tidying.
  - Add tabs to a matching folder you already have.
  - Auto-tidy when unpinned tabs pile up.

## Install

You need [Zen Browser](https://zen-browser.app) and the [Sine](https://github.com/CosmoCreeper/Sine) mod manager.

1. Install Sine by following the instructions in [its repository](https://github.com/CosmoCreeper/Sine).
2. In Sine's settings, allow **unofficial/unsafe JS mods**. Tidy needs JavaScript to move tabs. The code is short and readable in [`mod/`](mod).
3. In Sine, install from this repository's URL:
   ```
   https://github.com/hajorda/ZenTidy
   ```
4. Restart Zen.

## Use it

| To… | Do this |
| --- | --- |
| Tidy the current space | Click **✨** on the line above your unpinned tabs (it appears on hover), or press **Ctrl+Alt+Y** (**Cmd+Option+Y** on macOS) |
| Undo | **Undo** in the toast, or right-click the space name → **Undo last tidy** |
| Tidy another space | Right-click that space's name → **Tidy tabs** |
| Send a folder's tabs back to unpinned | Right-click a ✨ folder → **Untidy (back to unpinned tabs)** |
| Untidy everything in a space | Right-click the space name → **Untidy all Tidy folders** |
| Shorten tab titles in a folder | Right-click the folder → **Tidy tab titles** |

Folders made by Tidy have a small ✨ after their name.

> [!NOTE]
> Zen keeps folders in the pinned part of the sidebar, so tidied tabs become pinned. That means Zen's "close unpinned tabs" button no longer clears them. Use **Untidy** to send them back to unpinned.

## Settings

Open Sine → Zen Tidy.

| Setting | Default | |
| --- | --- | --- |
| Smallest folder | 2 tabs | Groups smaller than this stay unpinned |
| Most folders per tidy | 6 | The biggest groups win |
| Add to matching existing folders | Off | A new GitHub tab joins your existing folder with the same GitHub tabs, or one with the same name |
| Close duplicate tabs | Off | Keeps the tab you're on, or the most recently used copy. Never closes a tab playing sound or in picture-in-picture |
| Keyboard shortcut | `accel+alt+Y` | `accel` means Ctrl, or Cmd on macOS |
| Group with AI | Off | See below |
| Auto-tidy | Off | Tidies when unpinned tabs reach 10–30, at most once every 10 minutes, with a toast you can undo |

## AI grouping (optional)

Local grouping handles everyday tabs well. AI helps when your tabs share a *task* rather than a site or keywords, for example "plan the team offsite" across a calendar, a hotel page and a Google Doc.

| Provider | Setup |
| --- | --- |
| **Claude** | Choose *Claude* under **Group with AI**, then right-click a space name → **Set Tidy AI key…** and paste an [Anthropic API key](https://console.anthropic.com/). The default model is `claude-opus-5-5`; set another in **Model** if you like. |
| **OpenAI-compatible** | Choose *OpenAI-compatible*, set **Model** (required) and, if it's not OpenAI itself, **API address** (e.g. `https://openrouter.ai/api/v1`). Set the key the same way. |
| **Ollama** | Install [Ollama](https://ollama.com), run `ollama pull llama3.2`, and choose *Ollama*. Everything stays on your computer; no key needed. |

**What's sent:**
- **Sent:** each tab's title and hostname (e.g. `Hotels in Lisbon (booking.com)`).
- **Never sent:** full URLs, page content or cookies.

**Where the key lives:** Zen's password manager (Settings → Passwords, under `chrome://zen-tidy`), never in plain settings.

**If the AI fails** (no key, offline, rate limit, a strange answer), Tidy says why in the toast and groups locally instead.

## How local grouping works

1. **Collect** the space's unpinned tabs. A split view counts as one item. Essentials and Glance are skipped.
2. **Link tabs that belong together:**
   - the same site bucket,
   - opener chains (skipping pages that opened lots of tabs),
   - search pages grouped by their query.
3. **Merge by title similarity.** Clusters with similar titles (TF-IDF cosine similarity) merge, up to 15 tabs per folder.
4. **Name** each folder:
   - a known site name, or a title ending every tab shares ("… - Jira"),
   - otherwise the words the titles share most.

All of this lives in [`mod/core.uc.js`](mod/core.uc.js), and it's tested against realistic tab sets in [`test/fixtures.js`](test/fixtures.js).

## Development

```sh
npm test   # grouping quality, AI providers (mocked), and a full tidy/undo simulation
```

| Path | What's there |
| --- | --- |
| [`mod/core.uc.js`](mod/core.uc.js) | Grouping, naming, duplicates, AI prompts and response checking. No browser APIs |
| [`mod/ai.uc.js`](mod/ai.uc.js) | Claude, OpenAI-compatible and Ollama calls |
| [`mod/zen-adapter.uc.js`](mod/zen-adapter.uc.js) | **Every** call into Zen internals |
| [`mod/tidy.uc.js`](mod/tidy.uc.js) | Button, shortcut, menus, tidy, undo, untidy, titles, auto-tidy |
| [`mod/userChrome.css`](mod/userChrome.css) | The ✨ button and folder badge |

**Debugging:** in the Browser Toolbox console, `ZenTidy.tidy()`, `ZenTidy.undo()` and `ZenTidy.settings()` are available. Log lines start with `[Zen Tidy]`.

**When Zen updates:** everything Tidy relies on is listed at the top of [`mod/zen-adapter.uc.js`](mod/zen-adapter.uc.js) (checked against Zen's source on 2026-09-29). That is the one file to fix.

## Roadmap

- [x] One-click tidy with local grouping, undo, untidy
- [x] AI grouping (Claude, OpenAI-compatible, Ollama)
- [x] Duplicates, existing folders, tidy titles, auto-tidy
- [ ] Preview before applying (optional)
- [ ] Remember folder names you rename, to improve future grouping
- [ ] Sine marketplace listing

## Contributing

Issues and pull requests are welcome. Run `npm test` first, and keep Zen-specific calls in `mod/zen-adapter.uc.js`. If a grouping looks wrong, adding the tab set to `test/fixtures.js` is the most useful bug report.
