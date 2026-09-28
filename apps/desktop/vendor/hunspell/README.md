# Hunspell dictionaries (vendored)

`en-US-10-1.bdic` from Electron's `hunspell_dictionaries.zip` for v44.4.5
(https://github.com/electron/electron/releases/download/v44.4.5/hunspell_dictionaries.zip), with the
zip's combined `LICENSE`. Chromium's spellchecker (Hunspell: Linux, and Windows for languages Windows
can't check) would otherwise download it from Google's CDN; SpaceAIO ships it instead and downloads
none (D-066). Replace with the file from a newer Electron release if Chromium asks for another version.
