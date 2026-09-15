# Tebrox Plugins

Small static catalogue for public Minecraft plugins maintained by Tebrox-Development.

## How it works

- `plugins.json` is the curated source of truth for which projects are public.
- `app.js` reads GitHub Releases directly in the browser.
- The newest stable release, direct JAR download and total JAR downloads are detected automatically.
- If GitHub release data is temporarily unavailable, configured fallback versions are still shown.
- No framework, package manager or build step is required.

## Add another plugin

Add another object to `plugins.json`.

Required fields:

- `name`
- `repo` (`owner/repository`)
- `description`
- `type`
- `status`
- `platforms`
- `compatibility`
- `fallbackVersion`
- `links.source`

Optional fields include `image`, `links.wiki`, `links.issues`, `links.spigot` and `links.modrinth`.

## GitHub Pages

1. Make this repository **public**.
2. Open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Run the `Deploy GitHub Pages` workflow if it does not start automatically.

The default address will then be similar to:

`https://tebrox-development.github.io/Plugins/`

A custom domain such as `plugins.example.com` can be added later under **Settings → Pages → Custom domain**.

## Notes

GitHub's unauthenticated REST API has a rate limit. This site makes one release-list request per configured plugin per visitor. For a small public catalogue this is normally sufficient. If the catalogue grows substantially, release metadata can later be cached during deployment instead.
