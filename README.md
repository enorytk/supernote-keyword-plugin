# Keyword Suggestor for Supernote

Keyword Suggestor adds a NOTE-toolbar action that finds up to five likely
native keywords for the page you have open. It is designed to reinforce the
vocabulary you already use instead of creating close alternatives.

## How it works

When you tap **KeywordSuggestor** in a NOTE:

1. The plugin reads the current page, including its title strokes and
   recognized text.
2. It walks the standard Supernote `Note` directory and builds a temporary
   library from the native keywords in every `.note` file it finds. The
   library is kept in memory for ten minutes so a second use is fast.
3. If an existing keyword appears anywhere on the page, it ranks those first
   and shows up to three note-and-page locations where it is already used.
4. If only one or two existing keywords match, it fills the remaining slots
   with repeated, meaningful page concepts. It can suggest a two- or three-word
   phrase when the words occur together repeatedly (for example, `budget
   planning`). Specific phrases, names, and phrases containing filing concepts
   such as `project`, `recipe`, or `career` rank above generic single words.
   With three or more familiar matches, it keeps the panel entirely within the
   existing vocabulary. Common function words, short fragments, plural forms
   of an established keyword, and keywords already applied to this page are
   excluded. A distinctive word inside an established multi-word keyword is
   also excluded, so `SR Unification` does not create a competing
   `unification` suggestion.

The review screen shows why each suggestion matched. Nothing is added until
you tap **Tap to add**. Recognition and ranking happen locally on the device;
the plugin makes no network requests and has no API key or configuration.

On first use, Supernote asks for read access to the Note folder. Approve it so
the plugin can read keywords from your existing notes. When you first tap a
suggestion, it separately asks for write access; that is the only time it can
add a native keyword.

## Install and run

This project uses the Supernote React Native plugin template. You need Node 18+
and the Android/JDK/ADB setup required by the Supernote plugin SDK.

```sh
npm install
npm test
npm run build
```

With a connected Supernote configured for plugin development, use `npm run
deploy` to install the generated `.snplg` package, then open a NOTE and tap
**KeywordSuggestor** in the toolbar.

`devconfig.json` is intentionally not committed. Create it locally if the
template cannot discover your Java, Android SDK, or ADB paths automatically.
The Android debug keystore is also intentionally excluded; let Android/Gradle
generate a local one for development instead of sharing a signing key.

## Design choices

- Suggestions are deliberately capped at five and may be empty.
- Existing keyword spelling and capitalization are preserved exactly.
- Multi-word suggestions are generated from the locally recognized page text;
  they do not trigger another OCR pass or note-library scan.
- The cross-note keyword scan skips unreadable/corrupt notes rather than
  blocking the current page.
- DOC files are not included in the library yet. The action asks the user to
  open a NOTE because page-heading support is NOTE-specific.
