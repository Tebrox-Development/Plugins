import { readFile, writeFile } from "node:fs/promises";

const ORG = "Tebrox-Development";
const API = "https://api.github.com";
const token = process.env.GITHUB_TOKEN || "";

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "tebrox-plugin-catalog"
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

async function request(path, { allow404 = false } = {}) {
  const url = path.startsWith("http") ? path : `${API}${path}`;

  let response = await fetch(url, { headers });

  // A repository-scoped Actions token may not be allowed to read another
  // repository. Public catalogue data can safely be retried anonymously.
  if (token && (response.status === 403 || response.status === 404)) {
    const anonymousHeaders = {
      Accept: headers.Accept,
      "User-Agent": headers["User-Agent"]
    };
    response = await fetch(url, { headers: anonymousHeaders });
  }

  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${url}`);
  }

  return response.json();
}

async function paged(path) {
  const items = [];
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await request(`${path}${separator}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return items;
}

function propertyValue(properties, name) {
  const value = properties?.[name];
  return value === null || value === undefined || value === "" ? null : value;
}

function titleFromRepo(name) {
  return name.replace(/-/g, " ");
}

async function findBanner(repo, branch) {
  const locations = [
    { dir: "docs/assets", exact: true },
    { dir: "docs/assets", exact: false },
    { dir: "assets", exact: true }
  ];

  for (const location of locations) {
    const entries = await request(
      `/repos/${repo}/contents/${location.dir}?ref=${encodeURIComponent(branch)}`,
      { allow404: true }
    );

    if (!Array.isArray(entries)) continue;

    const images = entries.filter(entry =>
      entry.type === "file" && /\.(png|webp|jpe?g)$/i.test(entry.name)
    );

    const banner = location.exact
      ? images.find(entry => /^banner\.(png|webp|jpe?g)$/i.test(entry.name))
      : images.find(entry => /-banner\.(png|webp|jpe?g)$/i.test(entry.name));

    if (banner?.download_url) return banner.download_url;
  }

  return null;
}

async function getReleaseData(repo) {
  const latest = await request(`/repos/${repo}/releases/latest`, { allow404: true });
  if (!latest) return null;

  const releases = await paged(`/repos/${repo}/releases`);
  const jar = (latest.assets || []).find(asset =>
    asset.name.toLowerCase().endsWith(".jar") &&
    !asset.name.toLowerCase().endsWith(".jar.sha256")
  );

  const totalDownloads = releases
    .filter(release => !release.draft)
    .flatMap(release => release.assets || [])
    .filter(asset => asset.name.toLowerCase().endsWith(".jar"))
    .reduce((sum, asset) => sum + (asset.download_count || 0), 0);

  return {
    version: latest.tag_name.replace(/^v/i, ""),
    releaseUrl: latest.html_url,
    downloadUrl: jar
      ? `https://github.com/${repo}/releases/latest/download/${encodeURIComponent(jar.name)}`
      : latest.html_url,
    publishedAt: latest.published_at,
    totalDownloads
  };
}

async function loadLegacy() {
  try {
    return JSON.parse(await readFile("plugins.json", "utf8"));
  } catch {
    return [];
  }
}

async function buildAutomaticEntry(repo, legacyByRepo) {
  const details = await request(`/repos/${repo.full_name}`);
  const properties = details.custom_properties || {};
  const legacy = legacyByRepo.get(repo.full_name);

  const configuredPlatforms = propertyValue(properties, "plugin_platforms");
  const topicPlatforms = (details.topics || [])
    .filter(topic => ["paper", "spigot"].includes(topic.toLowerCase()))
    .map(topic => topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase());

  const platforms = Array.isArray(configuredPlatforms)
    ? configuredPlatforms
    : configuredPlatforms
      ? String(configuredPlatforms).split(",").map(value => value.trim()).filter(Boolean)
      : legacy?.platforms || topicPlatforms;

  const image =
    await findBanner(details.full_name, details.default_branch) ||
    legacy?.image ||
    details.owner?.avatar_url ||
    "";

  return {
    name: titleFromRepo(details.name),
    repo: details.full_name,
    description: details.description || legacy?.description || "No description provided.",
    type: propertyValue(properties, "plugin_type") || legacy?.type || "Plugin",
    status: details.archived ? "Archived" : "Active",
    platforms,
    compatibility:
      propertyValue(properties, "plugin_compatibility") ||
      legacy?.compatibility ||
      "See project documentation",
    image,
    language: details.language,
    license: details.license?.spdx_id || null,
    links: {
      source: details.html_url,
      issues: details.has_issues ? `${details.html_url}/issues` : null,
      wiki: details.has_wiki ? `${details.html_url}/wiki` : null,
      spigot: propertyValue(properties, "plugin_spigot") || legacy?.links?.spigot || null,
      modrinth: propertyValue(properties, "plugin_modrinth") || legacy?.links?.modrinth || null
    },
    releaseData: await getReleaseData(details.full_name)
  };
}

async function enrichLegacy(plugin) {
  const details = await request(`/repos/${plugin.repo}`);
  const image =
    await findBanner(details.full_name, details.default_branch) ||
    plugin.image ||
    details.owner?.avatar_url ||
    "";

  return {
    ...plugin,
    name: plugin.name || titleFromRepo(details.name),
    description: plugin.description || details.description || "No description provided.",
    status: details.archived ? "Archived" : (plugin.status || "Active"),
    image,
    links: {
      ...plugin.links,
      source: details.html_url,
      issues: details.has_issues ? `${details.html_url}/issues` : null,
      wiki: details.has_wiki ? `${details.html_url}/wiki` : plugin.links?.wiki || null
    },
    releaseData: await getReleaseData(details.full_name)
  };
}

async function main() {
  const legacy = await loadLegacy();
  const legacyByRepo = new Map(legacy.map(plugin => [plugin.repo, plugin]));

  const repos = await paged(`/orgs/${ORG}/repos?type=public&sort=full_name`);
  const catalogueRepos = [];

  for (const repo of repos) {
    const details = await request(`/repos/${repo.full_name}`);
    const enabled = propertyValue(details.custom_properties, "plugin_catalog");
    if (enabled === true || String(enabled).toLowerCase() === "true") {
      catalogueRepos.push(details);
    }
  }

  let catalogue;

  if (catalogueRepos.length) {
    catalogue = await Promise.all(
      catalogueRepos.map(repo => buildAutomaticEntry(repo, legacyByRepo))
    );
    console.log(`Generated catalogue from GitHub Custom Properties: ${catalogue.length} plugin(s).`);
  } else {
    catalogue = await Promise.all(legacy.map(enrichLegacy));
    console.log(
      `No repositories with plugin_catalog=true found; using legacy plugins.json fallback (${catalogue.length} plugin(s)).`
    );
  }

  catalogue.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile("catalog.json", JSON.stringify(catalogue, null, 2) + "\n", "utf8");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
