import { writeFile } from "node:fs/promises";

const ORG = "Tebrox-Development";
const API = "https://api.github.com";
const token = process.env.CATALOG_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";

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
  if (token && response.status === 403) {
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

function parseMarketplaceEntries(value) {
  if (!value) return [];

  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap(entry => String(entry).split(/[;\r\n]+/))
    .map(entry => entry.trim())
    .filter(Boolean);
}

function marketplaceFromUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    const known = {
      "spigotmc.org": {
        key: "spigot",
        name: "SpigotMC",
        icon: "https://www.spigotmc.org/favicon.ico"
      },
      "modrinth.com": {
        key: "modrinth",
        name: "Modrinth",
        icon: "https://modrinth.com/favicon.ico"
      },
      "hangar.papermc.io": {
        key: "hangar",
        name: "Hangar",
        icon: "https://hangar.papermc.io/favicon.ico"
      }
    };

    const platform = known[hostname] || {
      key: "other",
      name: hostname,
      icon: `${parsed.protocol}//${parsed.hostname}/favicon.ico`
    };

    return {
      ...platform,
      url
    };
  } catch {
    return null;
  }
}

function marketplaceFromEntry(entry) {
  const spigot = entry.match(/^s:(\d+)$/i);
  if (spigot) {
    return marketplaceFromUrl(
      `https://www.spigotmc.org/resources/${spigot[1]}/`
    );
  }

  const modrinth = entry.match(/^m:([^\s;]+)$/i);
  if (modrinth) {
    return marketplaceFromUrl(
      `https://modrinth.com/plugin/${encodeURIComponent(modrinth[1])}`
    );
  }

  const hangar = entry.match(/^h:([^/\s;]+)\/([^\s;]+)$/i);
  if (hangar) {
    return marketplaceFromUrl(
      `https://hangar.papermc.io/${encodeURIComponent(hangar[1])}/${encodeURIComponent(hangar[2])}`
    );
  }

  return marketplaceFromUrl(entry);
}

async function isMarketplacePublic(marketplace) {
  try {
    if (marketplace.key === "modrinth") {
      const parsed = new URL(marketplace.url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const project = parts[1];

      if (!project) return true;

      const response = await fetch(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(decodeURIComponent(project))}`,
        {
          headers: {
            "User-Agent": "Tebrox-Development/plugin-catalog"
          }
        }
      );

      return response.status !== 404;
    }

    const response = await fetch(marketplace.url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Tebrox-Development/plugin-catalog"
      }
    });

    // Only hide on a definitive "not found" response. Other statuses can be
    // caused by bot protection, rate limits or temporary marketplace issues.
    return response.status !== 404;
  } catch {
    // Keep configured links visible when the availability check itself fails.
    return true;
  }
}

async function getMarketplaces(properties) {
  const configured = parseMarketplaceEntries(
    propertyValue(properties, "plugin_marketplaces")
  );

  const legacy = [
    propertyValue(properties, "plugin_spigot"),
    propertyValue(properties, "plugin_modrinth")
  ].filter(Boolean);

  const entries = configured.length ? configured : legacy;
  const marketplaces = [...new Set(entries)]
    .map(marketplaceFromEntry)
    .filter(Boolean);

  const visibility = await Promise.all(
    marketplaces.map(isMarketplacePublic)
  );

  return marketplaces.filter((_, index) => visibility[index]);
}

async function getCustomProperties(repo) {
  const valuesUrl = `${API}/repos/${repo}/properties/values`;
  let response = await fetch(valuesUrl, { headers });

  if (token && (response.status === 403 || response.status === 404)) {
    response = await fetch(valuesUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": headers["User-Agent"]
      }
    });
  }

  if (response.status === 404) return {};
  if (!response.ok) {
    throw new Error(
      `GitHub custom properties API ${response.status}: ${valuesUrl}. ` +
      "Configure the CATALOG_GITHUB_TOKEN repository secret with Metadata read access."
    );
  }

  const values = await response.json();
  return Object.fromEntries(
    values.map(entry => [entry.property_name, entry.value])
  );
}

function titleFromRepo(name) {
  return name.replace(/-/g, " ");
}

function rawFileUrl(repo, branch, path) {
  const encodedRepo = repo.split("/").map(encodeURIComponent).join("/");
  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${encodedRepo}/${encodedBranch}/${encodedPath}`;
}

async function rawFileExists(repo, branch, path) {
  try {
    const response = await fetch(rawFileUrl(repo, branch, path), { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function branchExists(repo, branch) {
  for (const probe of ["README.md", "pom.xml", "build.gradle", "build.gradle.kts"]) {
    if (await rawFileExists(repo, branch, probe)) {
      return true;
    }
  }

  return false;
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
  try {
    const response = await fetch(rawFileUrl(repo, branch, path));
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
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
function parseMavenModules(content) {
  return [...content.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)]
    .map(match => match[1].trim().replace(/^\.\//, "").replace(/\/$/, ""))
    .filter(module => module && !module.includes(".."));
}

async function readPluginDescriptor(repo, branch, basePath = "") {
  const prefix = basePath ? `${basePath}/` : "";

  const paperPlugin = await fetchTextFile(
    repo,
    `${prefix}src/main/resources/paper-plugin.yml`,
    branch
  );

  if (paperPlugin) {
    return parsePaperDependencies(paperPlugin);
  }

  const pluginYml = await fetchTextFile(
    repo,
    `${prefix}src/main/resources/plugin.yml`,
    branch
  );

  if (pluginYml) {
    return {
      required: parsePluginList(pluginYml, "depend"),
      optional: parsePluginList(pluginYml, "softdepend")
    };
  }

  return null;
}

async function getPluginDependencies(repo, branch) {
  const rootDescriptor = await readPluginDescriptor(repo, branch);
  if (rootDescriptor) return rootDescriptor;

  const pom = await fetchTextFile(repo, "pom.xml", branch);
  if (!pom) return { required: [], optional: [] };

  const modules = parseMavenModules(pom);
  for (const module of modules) {
    const descriptor = await readPluginDescriptor(repo, branch, module);
    if (descriptor) return descriptor;
  }

  return { required: [], optional: [] };
}

async function findBanner(repo, branch) {
  const repoName = repo.split("/").pop();
  const names = [
    "banner.png",
    "banner.webp",
    "banner.jpg",
    "banner.jpeg",
    `${repoName.toLowerCase()}-banner.png`,
    `${repoName.toLowerCase()}-banner.webp`,
    `${repoName.toLowerCase()}-banner.jpg`,
    `${repoName.toLowerCase()}-banner.jpeg`,
    `${repoName.toLowerCase()}_banner.png`,
    `${repoName.toLowerCase()}_banner.webp`,
    `${repoName.toLowerCase()}_banner.jpg`,
    `${repoName.toLowerCase()}_banner.jpeg`
  ];

  const candidates = [
    ...names.map(name => `docs/assets/${name}`),
    "assets/banner.png",
    "assets/banner.webp",
    "assets/banner.jpg",
    "assets/banner.jpeg"
  ];

  for (const path of candidates) {
    if (await rawFileExists(repo, branch, path)) {
      return rawFileUrl(repo, branch, path);
    }
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

async function buildAutomaticEntry(repo, properties) {
  const details = await request(`/repos/${repo.full_name}`);
  const releaseData = await getReleaseData(details.full_name);
  const comingSoon = !details.archived && !releaseData;
  const contentBranch = await getContentBranch(
    details.full_name,
    details.default_branch,
    comingSoon
  );

  const configuredPlatforms = propertyValue(properties, "plugin_platforms");
  const platforms = Array.isArray(configuredPlatforms)
    ? configuredPlatforms
    : configuredPlatforms
      ? String(configuredPlatforms).split(",").map(value => value.trim()).filter(Boolean)
      : [];

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
    createdAt: details.created_at,
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
      wiki: details.has_wiki ? `${details.html_url}/wiki` : null
    },
    marketplaces: await getMarketplaces(properties),
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
      catalogueRepos.push({ repo, properties });
    }
  }

  const catalogue = await Promise.all(
    catalogueRepos.map(({ repo, properties }) =>
      buildAutomaticEntry(repo, properties)
    )
  );

  console.log(
    `Generated catalogue from GitHub Custom Properties: ${catalogue.length} plugin(s).`
  );

  const statusOrder = {
    "Coming Soon": 0,
    "Active": 1,
    "Archived": 2
  };

  catalogue.sort((a, b) => {
    const statusDifference =
      (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);

    if (statusDifference) return statusDifference;

    const createdDifference =
      Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);

    return createdDifference || a.name.localeCompare(b.name);
  });
  await writeFile("catalog.json", JSON.stringify(catalogue, null, 2) + "\n", "utf8");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
