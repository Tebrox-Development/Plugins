import { writeFile } from "node:fs/promises";

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

async function getCustomProperties(repo) {
  const url = `${API}/repos/${repo}/properties/values`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": headers["User-Agent"]
    }
  });

  if (response.status === 404) return {};
  if (!response.ok) {
    throw new Error(`GitHub custom properties API ${response.status}: ${url}`);
  }

  const values = await response.json();
  return Object.fromEntries(
    values.map(entry => [entry.property_name, entry.value])
  );
}

function titleFromRepo(name) {
  return name.replace(/-/g, " ");
}

async function branchExists(repo, branch) {
  return Boolean(
    await request(
      `/repos/${repo}/branches/${encodeURIComponent(branch)}`,
      { allow404: true }
    )
  );
}

async function getContentBranch(repo, defaultBranch, comingSoon) {
  if (!comingSoon) return defaultBranch;

  for (const branch of ["development", "dev"]) {
    if (branch === defaultBranch || await branchExists(repo, branch)) {
      return branch;
    }
  }

  return defaultBranch;
}

async function fetchTextFile(repo, path, branch) {
  const file = await request(
    `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { allow404: true }
  );

  if (!file || file.type !== "file" || !file.content) return null;
  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
}

function parsePaperDependencies(content) {
  const required = [];
  const optional = [];
  const lines = content.split(/\r?\n/);
  let inDependencies = false;
  let inServer = false;
  let current = null;

  for (const line of lines) {
    if (/^dependencies:\s*$/.test(line)) {
      inDependencies = true;
      inServer = false;
      current = null;
      continue;
    }

    if (!inDependencies) continue;

    if (/^\S/.test(line) && !/^dependencies:/.test(line)) break;

    if (/^  server:\s*$/.test(line)) {
      inServer = true;
      current = null;
      continue;
    }

    if (!inServer) continue;

    if (/^  \S/.test(line) && !/^  server:/.test(line)) break;

    const dependency = line.match(/^    ([^:#][^:]*):\s*$/);
    if (dependency) {
      current = { name: dependency[1].trim(), required: true };
      required.push(current.name);
      continue;
    }

    const requiredMatch = line.match(/^      required:\s*(true|false)\s*$/i);
    if (current && requiredMatch && requiredMatch[1].toLowerCase() === "false") {
      const index = required.indexOf(current.name);
      if (index >= 0) required.splice(index, 1);
      optional.push(current.name);
      current.required = false;
    }
  }

  return { required, optional };
}

function parsePluginList(content, key) {
  const lines = content.split(/\r?\n/);
  const values = [];
  const normalizedKey = key.toLowerCase() + ":";

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.toLowerCase().startsWith(normalizedKey)) continue;

    const remainder = trimmed.slice(normalizedKey.length).trim();
    if (remainder.startsWith("[") && remainder.endsWith("]")) {
      return remainder
        .slice(1, -1)
        .split(",")
        .map(value => value.trim().replace(/^[\'"]|[\'"]$/g, ""))
        .filter(Boolean);
    }

    if (!remainder) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = lines[j].match(/^\s+-\s+(.+?)\s*$/);
        if (!item) break;
        values.push(item[1].trim().replace(/^[\'"]|[\'"]$/g, ""));
      }
    }

    break;
  }

  return values;
}
async function getPluginDependencies(repo, branch) {
  const paperPlugin = await fetchTextFile(
    repo,
    "src/main/resources/paper-plugin.yml",
    branch
  );

  if (paperPlugin) {
    return parsePaperDependencies(paperPlugin);
  }

  const pluginYml = await fetchTextFile(
    repo,
    "src/main/resources/plugin.yml",
    branch
  );

  if (pluginYml) {
    return {
      required: parsePluginList(pluginYml, "depend"),
      optional: parsePluginList(pluginYml, "softdepend")
    };
  }

  return { required: [], optional: [] };
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

async function buildAutomaticEntry(repo) {
  const details = await request(`/repos/${repo.full_name}`);
  const properties = await getCustomProperties(repo.full_name);
  const releaseData = await getReleaseData(details.full_name);
  const comingSoon = !details.archived && !releaseData;
  const contentBranch = await getContentBranch(
    details.full_name,
    details.default_branch,
    comingSoon
  );

  const configuredPlatforms = propertyValue(properties, "plugin_platforms");
  const topicPlatforms = (details.topics || [])
    .filter(topic => ["paper", "spigot"].includes(topic.toLowerCase()))
    .map(topic => topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase());

  const platforms = Array.isArray(configuredPlatforms)
    ? configuredPlatforms
    : configuredPlatforms
      ? String(configuredPlatforms).split(",").map(value => value.trim()).filter(Boolean)
      : topicPlatforms;

  const image =
    await findBanner(details.full_name, contentBranch) ||
    details.owner?.avatar_url ||
    "";
  const dependencies = await getPluginDependencies(
    details.full_name,
    contentBranch
  );

  return {
    name: propertyValue(properties, "plugin_name") || titleFromRepo(details.name),
    repo: details.full_name,
    description: details.description || "No description provided.",
    type: propertyValue(properties, "plugin_type") || "Plugin",
    status: details.archived ? "Archived" : comingSoon ? "Coming Soon" : "Active",
    contentBranch,
    platforms,
    compatibility: comingSoon
      ? null
      : propertyValue(properties, "plugin_compatibility") ||
        "See project documentation",
    image,
    language: details.language,
    license: details.license?.spdx_id || null,
    links: {
      source: comingSoon
        ? `${details.html_url}/tree/${encodeURIComponent(contentBranch)}`
        : details.html_url,
      issues: details.has_issues ? `${details.html_url}/issues` : null,
      wiki: details.has_wiki ? `${details.html_url}/wiki` : null,
      spigot: propertyValue(properties, "plugin_spigot"),
      modrinth: propertyValue(properties, "plugin_modrinth")
    },
    dependencies,
    releaseData
  };
}

async function main() {
  const repos = await paged(`/orgs/${ORG}/repos?type=public&sort=full_name`);
  const catalogueRepos = [];

  for (const repo of repos) {
    const properties = await getCustomProperties(repo.full_name);
    const enabled = propertyValue(properties, "plugin_catalog");
    if (enabled === true || String(enabled).toLowerCase() === "true") {
      catalogueRepos.push(repo);
    }
  }

  const catalogue = await Promise.all(
    catalogueRepos.map(repo => buildAutomaticEntry(repo))
  );

  console.log(
    `Generated catalogue from GitHub Custom Properties: ${catalogue.length} plugin(s).`
  );

  catalogue.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile("catalog.json", JSON.stringify(catalogue, null, 2) + "\n", "utf8");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
