# Tebrox Plugins

Public plugin catalogue for Minecraft plugins developed and maintained by Tebrox-Development.

**Website:** https://plugins.tebrox-development.de/

## How it works

The catalogue is generated automatically during the GitHub Pages deployment.

GitHub is the source of truth:

- public organization repositories are discovered automatically
- `plugin_catalog=true` controls whether a repository is listed
- repository custom properties provide plugin type, platforms, compatibility and marketplace links
- plugin name defaults to the repository name and can be overridden with `plugin_name`
- plugin dependencies are read from `paper-plugin.yml` or `plugin.yml`
- release/version/download information is collected from GitHub and configured marketplaces
- repositories without a published release are shown as **Coming Soon**
- Coming Soon content prefers `development`, then `dev`, then the default branch

The generated `catalog.json` is created by `scripts/generate-catalog.mjs` during deployment and is consumed by `app.js`.

## Catalogue custom properties

| Property | Purpose |
| --- | --- |
| `plugin_catalog` | Include/exclude a repository from the catalogue |
| `plugin_type` | Plugin type, e.g. `Gameplay` or `Library` |
| `plugin_platforms` | Supported platforms, e.g. `Paper`, `Spigot` |
| `plugin_compatibility` | Compatibility text shown for active releases |
| `plugin_name` | Optional display-name override |
| `plugin_marketplaces` | Marketplace links in compact form |

Supported compact marketplace entries:

- `m:<slug>` — Modrinth
- `h:<owner>/<slug>` — Hangar
- `s:<resource-id>` — SpigotMC

Multiple entries are separated with `;`.

Example:

```text
m:vertexcore;h:Tebrox/VertexCore
```

## Deployment

The site is deployed through `.github/workflows/pages.yml` using GitHub Actions on the self-hosted Linux runners.

The workflow:

1. checks out the repository
2. generates `catalog.json`
3. configures GitHub Pages
4. uploads the site artifact
5. deploys it to GitHub Pages

A scheduled run refreshes catalogue data every 30 minutes.

## Custom domain

The public catalogue uses:

```text
https://plugins.tebrox-development.de/
```

GitHub Pages is configured with this custom domain in **Settings → Pages**.

Because deployment uses a custom GitHub Actions workflow, no repository `CNAME` file is required.

DNS:

```text
plugins  CNAME  tebrox-development.github.io
```

Discord support is exposed through:

```text
https://discord.tebrox-development.de
```

which redirects to the current Tebrox-Development Discord invite.
