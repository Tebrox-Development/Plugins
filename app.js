const grid = document.querySelector("#plugin-grid");
const template = document.querySelector("#plugin-template");
const searchInput = document.querySelector("#search");
const filters = [...document.querySelectorAll(".filter")];
const supportUrl = "https://discord.gg/QRcVgVkAZr";

let plugins = [];
let activeFilter = "all";

document.querySelector("#year").textContent = new Date().getFullYear();

const number = new Intl.NumberFormat("en-US");
const optionalDependencyPreview = 4;

function link(label, url) {
  if (!url) return null;
  const a = document.createElement("a");
  a.textContent = label;
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

function marketplaceLink(label, url, platform, status) {
  if (!url) return null;

  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.className = `marketplace-link ${platform}`;

  const name = document.createElement("span");
  name.className = "marketplace-name";
  name.textContent = label;
  a.appendChild(name);

  if (status) {
    const badge = document.createElement("span");
    badge.className = "marketplace-status";
    badge.textContent = status;
    a.appendChild(badge);
  }

  return a;
}

function buildCard(plugin) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".plugin-card");

  const image = fragment.querySelector(".card-image");
  image.src = plugin.image || "";
  image.alt = `${plugin.name} banner`;
  image.addEventListener("error", () => {
    image.hidden = true;
  }, { once: true });

  const statusBadge = fragment.querySelector(".status-badge");
  statusBadge.textContent = plugin.status;
  statusBadge.classList.toggle("coming-soon", plugin.status === "Coming Soon");
  statusBadge.classList.toggle("archived", plugin.status === "Archived");
  fragment.querySelector(".plugin-type").textContent = plugin.type;
  fragment.querySelector(".plugin-name").textContent = plugin.name;
  fragment.querySelector(".plugin-description").textContent = plugin.description;

  const release = plugin.releaseData;
  const comingSoon = plugin.status === "Coming Soon";

  const releaseMeta = fragment.querySelector(".release-meta");
  const versionBadge = fragment.querySelector(".version-badge");

  if (comingSoon) {
    releaseMeta.remove();
    versionBadge.textContent = "Coming Soon";
  } else {
    fragment.querySelector(".compatibility").textContent = plugin.compatibility;
    fragment.querySelector(".downloads").textContent =
      Number.isFinite(release?.totalDownloads)
        ? number.format(release.totalDownloads)
        : "Unavailable";
    versionBadge.textContent = release?.version
      ? `v${release.version}`
      : "—";
  }

  const tags = fragment.querySelector(".tags");
  plugin.platforms.forEach(platform => {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = platform;
    tags.appendChild(el);
  });

  const requiredDependencies = plugin.dependencies?.required || [];
  const optionalDependencies = plugin.dependencies?.optional || [];

  if (requiredDependencies.length || optionalDependencies.length) {
    const dependencySection = document.createElement("div");
    dependencySection.className = "dependency-section";

    const addDependencyRow = (label, values, optional = false) => {
      if (!values.length) return;

      const row = document.createElement("div");
      row.className = "dependency-row";

      const title = document.createElement("span");
      title.className = "dependency-label";
      title.textContent = label;
      row.appendChild(title);

      const list = document.createElement("div");
      list.className = "dependency-list";

      const hiddenBadges = [];

      values.forEach((value, index) => {
        const badge = document.createElement("span");
        badge.className = optional ? "dependency optional" : "dependency required";
        badge.textContent = value;

        if (optional && index >= optionalDependencyPreview) {
          badge.hidden = true;
          hiddenBadges.push(badge);
        }

        list.appendChild(badge);
      });

      if (optional && hiddenBadges.length) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "dependency-toggle";
        toggle.textContent = `+${hiddenBadges.length} more`;
        toggle.setAttribute("aria-expanded", "false");

        toggle.addEventListener("click", () => {
          const expanded = toggle.getAttribute("aria-expanded") === "true";
          hiddenBadges.forEach(badge => {
            badge.hidden = expanded;
          });
          toggle.setAttribute("aria-expanded", String(!expanded));
          toggle.textContent = expanded
            ? `+${hiddenBadges.length} more`
            : "Show less";
        });

        list.appendChild(toggle);
      }

      row.appendChild(list);
      dependencySection.appendChild(row);
    };

    addDependencyRow("Required", requiredDependencies);
    addDependencyRow("Optional", optionalDependencies, true);

    tags.after(dependencySection);
  }

  const download = fragment.querySelector(".download-link");
  if (comingSoon) {
    download.remove();
    fragment.querySelector(".card-actions").classList.add("source-only");
  } else {
    download.href = release?.downloadUrl || plugin.links?.source || "#";
    download.target = "_blank";
    if (!release?.downloadUrl) {
      download.textContent = "Releases";
    }
  }

  const source = fragment.querySelector(".source-link");
  source.href = plugin.links.source;
  source.target = "_blank";

  const secondary = fragment.querySelector(".secondary-links");

  const marketplaces = [
    ["SpigotMC", plugin.links.spigot, "spigot", plugin.marketplaceStatus?.spigot],
    ["Modrinth", plugin.links.modrinth, "modrinth", plugin.marketplaceStatus?.modrinth]
  ].filter(([, url]) => Boolean(url));

  if (marketplaces.length) {
    const marketplaceSection = document.createElement("div");
    marketplaceSection.className = "marketplace-section";

    const marketplaceLabel = document.createElement("span");
    marketplaceLabel.className = "marketplace-label";
    marketplaceLabel.textContent = "Also available on";
    marketplaceSection.appendChild(marketplaceLabel);

    const marketplaceLinks = document.createElement("div");
    marketplaceLinks.className = "marketplace-links";

    marketplaces.forEach(([label, url, platform, status]) => {
      const el = marketplaceLink(label, url, platform, status);
      if (el) marketplaceLinks.appendChild(el);
    });

    marketplaceSection.appendChild(marketplaceLinks);
    secondary.before(marketplaceSection);
  }

  [
    ["Discord Support", supportUrl],
    ["Documentation", plugin.links.wiki],
    ["Issues", plugin.links.issues]
  ].forEach(([label, url]) => {
    const el = link(label, url);
    if (el) secondary.appendChild(el);
  });

  card.dataset.type = plugin.type;
  const dependencySearch = [
    ...(plugin.dependencies?.required || []),
    ...(plugin.dependencies?.optional || [])
  ].join(" ");
  card.dataset.search = `${plugin.name} ${plugin.description} ${plugin.type} ${plugin.platforms.join(" ")} ${dependencySearch}`.toLowerCase();

  return fragment;
}

function render() {
  grid.innerHTML = "";

  const query = searchInput.value.trim().toLowerCase();
  const visible = plugins.filter(plugin => {
    const typeMatch = activeFilter === "all" || plugin.type === activeFilter;
    const dependencySearch = [
      ...(plugin.dependencies?.required || []),
      ...(plugin.dependencies?.optional || [])
    ].join(" ");
    const text = `${plugin.name} ${plugin.description} ${plugin.type} ${plugin.platforms.join(" ")} ${dependencySearch}`.toLowerCase();
    return typeMatch && (!query || text.includes(query));
  });

  if (!visible.length) {
    grid.innerHTML = `<div class="empty-state">No plugins match this filter.</div>`;
    return;
  }

  visible.forEach(plugin => grid.appendChild(buildCard(plugin)));
}

async function init() {
  try {
    const response = await fetch("catalog.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load catalog.json");
    plugins = await response.json();

    render();
  } catch (error) {
    console.error(error);
    grid.innerHTML = `<div class="empty-state">The plugin catalogue could not be loaded.</div>`;
  }
}

filters.forEach(button => {
  button.addEventListener("click", () => {
    filters.forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    render();
  });
});

searchInput.addEventListener("input", render);

init();
