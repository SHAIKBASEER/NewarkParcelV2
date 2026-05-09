const parcelSource = window.NEWARK_PARCELS;
const compactSource = resolveCompactSource();

if ((!parcelSource || !Array.isArray(parcelSource.features)) && (!compactSource || !Array.isArray(compactSource.rows))) {
  document.body.innerHTML = "<div style='padding:24px;font-family:sans-serif'>Could not load parcel data. Keep index.html, app.js, styles.css, data_compact_*.js, and data_geom.js in the same folder.</div>";
  throw new Error("Missing parcel data");
}

function resolveCompactSource() {
  if (window.NEWARK_COMPACT && Array.isArray(window.NEWARK_COMPACT.rows)) {
    return window.NEWARK_COMPACT;
  }
  const shards = window.NEWARK_COMPACT_SHARDS;
  if (!Array.isArray(shards) || !shards.length) {
    return null;
  }
  const schema = shards.find((shard) => Array.isArray(shard.schema))?.schema;
  if (!schema) {
    return null;
  }
  return {
    metadata: shards.find((shard) => shard.metadata)?.metadata || {},
    schema,
    rows: shards.flatMap((shard) => Array.isArray(shard.rows) ? shard.rows : []),
  };
}

function expandCompact(source) {
  const schema = source.schema;
  return source.rows.map((row) => {
    const properties = {};
    schema.forEach((key, index) => {
      properties[key] = row[index];
    });
    return { type: "Feature", geometry: null, properties };
  });
}

const allFeatures = compactSource ? expandCompact(compactSource) : parcelSource.features;
const allProps = allFeatures.map((feature) => feature.properties);
const attrById = new Map(allFeatures.map((feature) => [feature.properties.id, feature.properties]));
let fuseSearch = null;
let geomById = null;
let geomPromise = null;
const selectedIds = new Set();
let activeRecord = null;
let currentBaseLayer = null;
let apiKeyPromise = null;
let dashboardEntered = false;
let lastAssistantMatch = null;
let apiDisabledUntil = 0;
const USE_REMOTE_AI = false;

const state = {
  status: "All",
  ownership: "All",
  geographies: [],
  zonings: [],
  search: "",
  scoreMin: 0,
  scoreMax: 100,
  landMin: 0,
  landMax: Infinity,
  improvementMin: 0,
  improvementMax: Infinity,
  drilldown: null,
  clusters: true,
  tab: "map",
};

const statusColors = {
  "Vacant / vacant land": "#c0334e",
  "Likely underutilized": "#e09a3e",
  "Occupied / active": "#0a8f60",
};

const ownershipColors = {
  "Private": "#4338ca",
  "Public": "#2563eb",
  "Nonprofit": "#7c3aed",
};

let filtered = [];
let externalFilterIds = null;
let externalFilterLabel = "";
let mapRenderSeq = 0;
let map;
let parcelLayer;
let clusterLayer;
let charts = {};
let firstFit = true;
const CLUSTER_STEP = 0.0045;
let currentMapRenderMode = "";
let zoomRenderTimer = null;
let filterInputSeq = 0;
let fullLandMax = Infinity;
let fullImprovementMax = Infinity;

function el(id) {
  return document.getElementById(id);
}

function fmt(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(value || 0));
}

function money(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${fmt(n)}`;
}

function moneyOrUnknown(value) {
  if (value === "" || value === null || value === undefined) return "Unknown";
  return money(value);
}

function yearOrUnknown(value) {
  const n = Number(value);
  return n > 0 ? String(Math.trunc(n)) : "Unknown";
}

function formatCensusId(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d+\.0$/.test(text)) return text.slice(0, -2);
  if (/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) return String(Math.trunc(Number(text)));
  return text;
}

function formatZcta(value) {
  const text = formatCensusId(value);
  if (!text) return "";
  return /^\d{1,4}$/.test(text) ? text.padStart(5, "0") : text;
}

function displayRecordValue(key, value) {
  if (key === "censusZcta") return formatZcta(value);
  if (["censusTract", "censusBlock", "censusBlockGroup"].includes(key)) return formatCensusId(value);
  if (["lastYearTaxes", "salePrice"].includes(key)) return moneyOrUnknown(value);
  if (key === "yearConstructed") return yearOrUnknown(value);
  return value;
}

function displayRecordLabel(key) {
  const labels = {
    lastYearTaxes: "Last Year Tax",
    landDescription: "Land Description",
    salePrice: "Sale Price",
    yearConstructed: "Year Built",
    censusZcta: "ZCTA",
  };
  return labels[key] || key;
}

function acres(value) {
  const n = Number(value || 0);
  return n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[char]));
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\bneedinsights\b/g, "need insights")
    .replace(/\bvacnt\b/g, "vacant")
    .replace(/\bvacnat\b/g, "vacant")
    .replace(/\bdetailes\b/g, "details")
    .replace(/\bvisualziation\b/g, "visualization")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function featureHaystack(p) {
  return [
    p.id, p.regridPath, p.regridParcel, p.pamsPin, p.block, p.lot, p.address, p.owner,
    p.modOwner, p.ownership, p.ownerSubtype, p.ownerConfidence, p.lbcsFunction, p.lbcsOwnership,
    p.landUse, p.propClass, p.vacancy, p.vacancyMethod, p.zoning, p.ward, p.neighborhood,
    p.censusTract, p.censusBlock, p.censusBlockGroup, p.censusZcta, p.qoz, p.redevelopment,
  ].map(normalizeText).join(" ");
}

function queryTokens(text) {
  const stop = new Set(["show", "me", "give", "all", "only", "the", "data", "entries", "parcels", "parcel", "report", "best", "chart", "charts", "with", "for", "in", "of", "and", "to", "please", "make", "create", "generate", "view", "display", "this", "ok", "details", "detail", "need", "insights", "insight", "on"]);
  return normalizeText(text).split(/\s+/).filter((token) => token.length > 1 && !stop.has(token));
}

function extractParcelId(text) {
  const match = String(text).match(/\b\d{4}_\d+_\d+\b/i);
  return match ? match[0] : "";
}

function initFuseSearch() {
  if (!window.Fuse) return null;
  return new Fuse(allFeatures, {
    includeScore: true,
    ignoreLocation: true,
    shouldSort: true,
    threshold: 0.28,
    minMatchCharLength: 2,
    keys: [
      { name: "properties.id", weight: 0.2 },
      { name: "properties.regridParcel", weight: 0.2 },
      { name: "properties.regridPath", weight: 0.12 },
      { name: "properties.address", weight: 0.13 },
      { name: "properties.owner", weight: 0.11 },
      { name: "properties.zoning", weight: 0.08 },
      { name: "properties.lbcsFunction", weight: 0.06 },
      { name: "properties.lbcsOwnership", weight: 0.04 },
      { name: "properties.neighborhood", weight: 0.03 },
      { name: "properties.ward", weight: 0.02 },
      { name: "properties.censusZcta", weight: 0.01 },
    ],
  });
}

function fuzzyFeatureMatches(text, source = allFeatures) {
  if (!fuseSearch) return [];
  const tokens = queryTokens(text);
  const query = tokens.join(" ") || normalizeText(text);
  if (!query) return [];
  const allowed = source === allFeatures ? null : new Set(source.map((feature) => feature.properties.id));
  return fuseSearch.search(query, { limit: 600 })
    .filter((result) => result.score <= 0.34 && (!allowed || allowed.has(result.item.properties.id)))
    .map((result) => result.item);
}

function countBy(features, key) {
  const counts = new Map();
  features.forEach((feature) => {
    const value = feature.properties[key] || "Unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function countByFormatted(features, key, formatter) {
  const counts = new Map();
  features.forEach((feature) => {
    const formatted = formatter(feature.properties[key]);
    const value = formatted || "Unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function planningStatus(p) {
  if (p.vacancy === "Vacant" || p.vacancy === "Vacant land") return "Vacant / vacant land";
  return p.vacancy;
}

function localClusterKey(p) {
  if (!p.lat || !p.lon) return "unknown";
  return `${Math.round(p.lat / CLUSTER_STEP) * CLUSTER_STEP},${Math.round(p.lon / CLUSTER_STEP) * CLUSTER_STEP}`;
}

function currentClusters(minCount = 3) {
  const clusters = new Map();
  filtered.forEach(({ properties: p }) => {
    if (p.opportunity < 45 || !p.lat || !p.lon) return;
    const key = localClusterKey(p);
    const c = clusters.get(key) || {
      lat: 0,
      lon: 0,
      count: 0,
      score: 0,
      vacant: 0,
      publicOrNonprofit: 0,
      value: 0,
      statuses: new Map(),
    };
    c.lat += p.lat;
    c.lon += p.lon;
    c.count += 1;
    c.score += p.opportunity;
    c.value += Number(p.assessed || 0);
    if (p.vacancy !== "Occupied / active") c.vacant += 1;
    if (["Public", "Nonprofit"].includes(p.ownership)) c.publicOrNonprofit += 1;
    c.statuses.set(p.vacancy, (c.statuses.get(p.vacancy) || 0) + 1);
    clusters.set(key, c);
  });
  return [...clusters.values()]
    .filter((cluster) => cluster.count >= minCount)
    .map((cluster) => {
      const dominantStatus = [...cluster.statuses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Mixed";
      return {
        ...cluster,
        lat: cluster.lat / cluster.count,
        lon: cluster.lon / cluster.count,
        avgScore: cluster.score / cluster.count,
        dominantStatus,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function statusFamily(status) {
  if (status === "Vacant" || status === "Vacant land" || status === "Vacant / vacant land") return "vacant";
  if (status === "Likely underutilized") return "under";
  return "good";
}

function opportunityColor(score) {
  if (score >= 70) return "#c0334e";
  if (score >= 50) return "#c96a2a";
  if (score >= 35) return "#d7a43c";
  return "#7aa6b8";
}

function parcelColor(p) {
  if (state.status !== "All") return statusColors[planningStatus(p)] || "#8a93a6";
  if (state.ownership !== "All") return ownershipColors[p.ownership] || "#8a93a6";
  return opportunityColor(p.opportunity);
}

function parcelStyle(feature) {
  const p = feature.properties;
  const selected = selectedIds.has(p.id);
  return {
    color: selected ? "#111827" : "#17202a",
    weight: selected ? 2.2 : (p.opportunity >= 60 ? 0.75 : 0.35),
    opacity: selected ? 1 : 0.7,
    fillColor: parcelColor(p),
    fillOpacity: selected ? 0.86 : (p.opportunity >= 45 || state.status !== "All" ? 0.62 : 0.36),
  };
}

function popup(feature) {
  const p = feature.properties;
  return `
    <div class="popup-head">
      <div class="popup-pin">${escapeHtml(p.id)} - BLOCK ${escapeHtml(p.block)} / LOT ${escapeHtml(p.lot)}</div>
      <div class="popup-address">${escapeHtml(p.address || "Address unavailable")}</div>
      <div class="badges">
        <span class="badge ${statusFamily(p.vacancy)}">${escapeHtml(p.vacancy)}</span>
        <span class="badge opp">Score ${p.opportunity}</span>
        <span class="badge gray">${escapeHtml(p.ownership)}</span>
      </div>
      <div class="popup-actions">
        <button type="button" data-action="record" data-id="${escapeHtml(p.id)}">Full record</button>
        <button type="button" data-action="select" data-id="${escapeHtml(p.id)}">${selectedIds.has(p.id) ? "Selected" : "Select"}</button>
      </div>
    </div>
    <div class="popup-body">
      <div class="popup-grid">
        <div class="popup-field"><span>Owner</span><strong>${escapeHtml(p.owner)}</strong></div>
        <div class="popup-field"><span>Owner signal</span><strong>${escapeHtml(p.ownerSubtype)} - ${escapeHtml(p.ownerConfidence)}</strong></div>
        <div class="popup-field"><span>Land use</span><strong>${escapeHtml(p.landUse)}</strong></div>
        <div class="popup-field"><span>LBCS function</span><strong>${escapeHtml(p.lbcsFunction)}</strong></div>
        <div class="popup-field"><span>LBCS ownership</span><strong>${escapeHtml(p.lbcsOwnership)}</strong></div>
        <div class="popup-field"><span>Zoning</span><strong>${escapeHtml(p.zoning)}</strong></div>
        <div class="popup-field"><span>Geography</span><strong>${escapeHtml(p.neighborhood)}</strong></div>
        <div class="popup-field"><span>Lat / Long</span><strong>${p.latitude}, ${p.longitude}</strong></div>
        <div class="popup-field"><span>Lot size</span><strong>${acres(p.lotAcres)} ac</strong></div>
        <div class="popup-field"><span>Land description</span><strong>${escapeHtml(p.landDescription || "Unknown")}</strong></div>
        <div class="popup-field"><span>Assessed</span><strong>${money(p.assessed)}</strong></div>
        <div class="popup-field"><span>Land value</span><strong>${money(p.landValue)}</strong></div>
        <div class="popup-field"><span>Improved value</span><strong>${money(p.improvementValue)}</strong></div>
        <div class="popup-field"><span>Last year tax</span><strong>${moneyOrUnknown(p.lastYearTaxes)}</strong></div>
        <div class="popup-field"><span>Sale price</span><strong>${moneyOrUnknown(p.salePrice)}</strong></div>
        <div class="popup-field"><span>Year built</span><strong>${escapeHtml(yearOrUnknown(p.yearConstructed))}</strong></div>
        <div class="popup-field"><span>Census tract</span><strong>${escapeHtml(formatCensusId(p.censusTract) || "Unknown")}</strong></div>
        <div class="popup-field"><span>ZCTA</span><strong>${escapeHtml(formatZcta(p.censusZcta) || "Unknown")}</strong></div>
        <div class="popup-field"><span>Vacancy method</span><strong>${escapeHtml(p.vacancyMethod)}</strong></div>
        <div class="popup-field"><span>Value source</span><strong>${escapeHtml(p.assessedSource)}</strong></div>
      </div>
    </div>
  `;
}

function pointStyle(feature) {
  const p = feature.properties;
  const selected = selectedIds.has(p.id);
  return {
    radius: selected ? 7 : (p.opportunity >= 60 ? 4.5 : 3),
    color: selected ? "#111827" : "rgba(17,24,39,.55)",
    weight: selected ? 2 : 0.6,
    fillColor: parcelColor(p),
    fillOpacity: selected ? 0.95 : 0.72,
  };
}

function mapRenderMode() {
  if (!map) return "points";
  if (filtered.length <= 900 || map.getZoom() >= 17) return "polygons";
  return "points";
}

function pointFeatures() {
  return filtered
    .filter((feature) => feature.properties.lat && feature.properties.lon)
    .map((feature) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [feature.properties.lon, feature.properties.lat],
      },
      properties: feature.properties,
    }));
}

function bindPopupActions() {
  document.querySelectorAll("[data-action='record']").forEach((button) => {
    button.addEventListener("click", () => openParcelRecord(button.dataset.id));
  });
  document.querySelectorAll("[data-action='select']").forEach((button) => {
    button.addEventListener("click", () => toggleSelected(button.dataset.id));
  });
}

function matchesDrilldown(p) {
  if (!state.drilldown) return true;
  const { type, value, extra } = state.drilldown;
  if (type === "status") return planningStatus(p) === value;
  if (type === "ownerSubtype") return p.ownerSubtype === value;
  if (type === "ownership") return p.ownership === value;
  if (type === "lbcsFunction") {
    if (p.lbcsFunction !== value) return false;
    return !extra?.status || planningStatus(p) === extra.status;
  }
  if (type === "landUse") return p.landUse === value;
  if (type === "zcta") return formatZcta(p.censusZcta) === formatZcta(value);
  if (type === "parcel") return p.id === value || p.regridParcel === value;
  if (type === "valuePositive") {
    return value === "Land value" ? Number(p.landValue || 0) > 0 : Number(p.improvementValue || 0) > 0;
  }
  return true;
}

function setDrilldown(type, value, extra = {}) {
  state.drilldown = { type, value, extra };
  selectedIds.clear();
  applyFilters();
  updateSelectionUi();
}

function clearDrilldown() {
  state.drilldown = null;
}

function syncDashboardGlobals() {
  window.allFeatures = allFeatures;
  window.filtered = filtered;
  window.dashboardState = state;
  window.renderAll = renderAll;
  window.renderMap = renderMap;
  window.applyFilters = applyFilters;
  window.resetDashboardFilters = resetDashboardFilters;
  window.applyExternalFeatureFilter = applyExternalFeatureFilter;
  window.clearExternalFeatureFilter = clearExternalFeatureFilter;
}

function applyExternalFeatureFilter(ids, label = "SQL query scope") {
  externalFilterIds = ids instanceof Set ? ids : new Set(ids || []);
  externalFilterLabel = label;
  state.drilldown = null;
  applyFilters();
}

function clearExternalFeatureFilter() {
  externalFilterIds = null;
  externalFilterLabel = "";
}

function applyFilters() {
  const query = normalizeText(state.search);
  const scopeIds = externalFilterIds;
  const scoreMin = Number(state.scoreMin || 0);
  const scoreMax = Number(state.scoreMax || 100);
  const landMin = Number(state.landMin || 0);
  const landMax = Number.isFinite(Number(state.landMax)) ? Number(state.landMax) : Infinity;
  const improvementMin = Number(state.improvementMin || 0);
  const improvementMax = Number.isFinite(Number(state.improvementMax)) ? Number(state.improvementMax) : Infinity;
  filtered = allFeatures.filter(({ properties: p }) => {
    if (scopeIds && !scopeIds.has(p.id)) return false;
    if (state.status === "Vacant Group" && !["Vacant", "Vacant land"].includes(p.vacancy)) return false;
    if (state.status !== "All" && state.status !== "Vacant Group" && p.vacancy !== state.status) return false;
    if (state.ownership !== "All" && p.ownership !== state.ownership) return false;
    if (state.geographies.length && !state.geographies.includes(p.ward) && !state.geographies.includes(p.neighborhood)) return false;
    if (state.zonings.length && !state.zonings.includes(p.zoning)) return false;
    if (Number(p.opportunity || 0) < scoreMin || Number(p.opportunity || 0) > scoreMax) return false;
    if (Number(p.landValue || 0) < landMin || Number(p.landValue || 0) > landMax) return false;
    if (Number(p.improvementValue || 0) < improvementMin || Number(p.improvementValue || 0) > improvementMax) return false;
    if (!matchesDrilldown(p)) return false;
    if (query) {
      const haystack = featureHaystack(p);
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  syncDashboardGlobals();
  renderAll();
}

function initMap() {
  map = L.map("map", {
    renderer: L.canvas({ padding: 0.4 }),
    preferCanvas: true,
    zoomControl: false,
  }).setView([40.7357, -74.1724], 12);

  switchBaseLayer("light");

  el("zoomIn").addEventListener("click", () => map.zoomIn());
  el("zoomOut").addEventListener("click", () => map.zoomOut());
  el("fitMap").addEventListener("click", fitVisible);
  el("clusterToggle").addEventListener("click", () => {
    state.clusters = !state.clusters;
    el("clusterToggle").classList.toggle("on", state.clusters);
    renderClusters();
  });
  document.querySelectorAll("[data-layer]").forEach((button) => {
    button.addEventListener("click", () => switchBaseLayer(button.dataset.layer));
  });
  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const themeName = button.dataset.theme === "glass" ? "glass" : "dark-indigo";
      if (window.npiApplyTheme) {
        window.npiApplyTheme(themeName);
      } else {
        document.body.classList.toggle("theme-glass", themeName === "glass");
        localStorage.setItem("npi-theme", themeName);
        document.querySelectorAll("[data-theme]").forEach((themeButton) => themeButton.classList.toggle("active", themeButton === button));
      }
    });
  });
  map.on("zoomend", () => {
    if (!dashboardEntered || state.tab !== "map") return;
    clearTimeout(zoomRenderTimer);
    zoomRenderTimer = setTimeout(() => {
      const nextMode = mapRenderMode();
      if (nextMode !== currentMapRenderMode) renderMap();
    }, 120);
  });
}

function baseLayerConfig(name) {
  const layers = {
    light: ["https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", "&copy; OpenStreetMap contributors &copy; CARTO"],
    dark: ["https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", "&copy; OpenStreetMap contributors &copy; CARTO"],
    satellite: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "Tiles &copy; Esri"],
    streets: ["https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", "&copy; OpenStreetMap contributors"],
    topo: ["https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", "Map data &copy; OpenStreetMap contributors, SRTM | OpenTopoMap"],
    traffic: ["https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", "Traffic-ready placeholder. Add a traffic tile provider URL/key to replace this layer."],
  };
  return layers[name] || layers.light;
}

function switchBaseLayer(name) {
  if (!map) return;
  if (currentBaseLayer) currentBaseLayer.remove();
  const [url, attribution] = baseLayerConfig(name);
  currentBaseLayer = L.tileLayer(url, { attribution, maxZoom: 20 });
  currentBaseLayer.addTo(map);
  document.querySelectorAll("[data-layer]").forEach((button) => button.classList.toggle("active", button.dataset.layer === name));
  if (name === "traffic") addAiMessage("bot", "Traffic layer is ready as a placeholder. Real live traffic tiles usually need a provider URL and API key, so this button can be connected when you choose a provider.");
}

function loadGeometry() {
  if (geomById) return Promise.resolve(geomById);
  if (window.NEWARK_GEOM) {
    geomById = new Map(window.NEWARK_GEOM.features.map((feature) => [feature.properties.id, feature]));
    return Promise.resolve(geomById);
  }
  if (geomPromise) return geomPromise;
  geomPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./data_geom.js";
    script.onload = () => {
      geomById = new Map(window.NEWARK_GEOM.features.map((feature) => [feature.properties.id, feature]));
      resolve(geomById);
    };
    script.onerror = () => reject(new Error("Could not load data_geom.js"));
    document.head.appendChild(script);
  });
  return geomPromise;
}

function renderMap() {
  if (!map) return;
  const renderSeq = ++mapRenderSeq;
  const mode = mapRenderMode();
  currentMapRenderMode = mode;
  el("mapLoading").classList.remove("gone");
  el("mapLoading").innerHTML = mode === "polygons"
    ? `<div class="spinner"></div><div class="loading-title">Rendering parcel polygons</div><div class="loading-sub">Zoomed detail mode</div>`
    : `<div class="spinner"></div><div class="loading-title">Rendering fast parcel points</div><div class="loading-sub">Zoom in or filter to see full polygons</div>`;

  if (mode === "points") {
    requestAnimationFrame(() => {
      if (renderSeq !== mapRenderSeq) return;
      if (parcelLayer) parcelLayer.remove();
      parcelLayer = L.geoJSON(pointFeatures(), {
        renderer: L.canvas({ padding: 0.35 }),
        pointToLayer(feature, latlng) {
          return L.circleMarker(latlng, pointStyle(feature));
        },
        onEachFeature(feature, layer) {
          layer.bindPopup(popup(feature));
          layer.on("popupopen", bindPopupActions);
        },
      }).addTo(map);
      renderClusters();
      if (firstFit) {
        fitVisible();
        firstFit = false;
      }
      el("mapLoading").classList.add("gone");
    });
    return;
  }

  loadGeometry().then(() => requestAnimationFrame(() => {
    if (renderSeq !== mapRenderSeq) return;
    if (parcelLayer) parcelLayer.remove();
    const geoFeatures = filtered.map((feature) => {
      const geometryFeature = geomById.get(feature.properties.id);
      if (!geometryFeature) return null;
      return {
        type: "Feature",
        geometry: geometryFeature.geometry,
        properties: feature.properties,
      };
    }).filter(Boolean);
    parcelLayer = L.geoJSON(geoFeatures, {
      renderer: L.canvas({ padding: 0.4 }),
      style: parcelStyle,
      onEachFeature(feature, layer) {
        layer.bindPopup(popup(feature));
        layer.on("popupopen", bindPopupActions);
      },
    }).addTo(map);
    renderClusters();
    if (firstFit) {
      fitVisible();
      firstFit = false;
    }
    el("mapLoading").classList.add("gone");
  })).catch((error) => {
    el("mapLoading").innerHTML = `<div class="loading-title">Map geometry did not load</div><div class="loading-sub">${escapeHtml(error.message)}</div>`;
  });
}

function renderClusters() {
  if (!map) return;
  if (clusterLayer) clusterLayer.remove();
  clusterLayer = L.layerGroup();
  if (!state.clusters) return;

  currentClusters(3).forEach((cluster) => {
    const avgScore = cluster.avgScore;
    L.circleMarker([cluster.lat, cluster.lon], {
      radius: Math.min(30, 5 + Math.sqrt(cluster.count) * 3.1),
      color: "#0d1117",
      weight: 1.4,
      fillColor: avgScore >= 65 ? "#c0334e" : "#f2b84b",
      fillOpacity: 0.58,
    }).bindTooltip(
      `<strong>${cluster.count} opportunity parcels</strong><br>${cluster.dominantStatus}<br>${cluster.vacant} vacant/under - avg score ${avgScore.toFixed(0)}`,
      { direction: "top" }
    ).addTo(clusterLayer);
  });

  clusterLayer.addTo(map);
}

function fitVisible() {
  if (!parcelLayer) return;
  const bounds = parcelLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.04), { animate: false });
}

function renderBars(containerId, entries, color, total, drillType = "") {
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  el(containerId).innerHTML = entries.map(([label, value]) => `
    <div class="bar-row" ${drillType ? `data-drill-type="${drillType}" data-drill-value="${escapeHtml(label)}" title="Double-click to filter ${escapeHtml(label)}"` : ""}>
      <div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%;background:${color};"></div></div>
      <div class="bar-num">${total ? `${((value / total) * 100).toFixed(0)}%` : fmt(value)}</div>
    </div>
  `).join("");
  bindHtmlDrilldowns();
}

function renderProgressChart(containerId, entries, palette) {
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  const total = entries.reduce((sum, entry) => sum + entry[1], 0) || 1;
  el(containerId).innerHTML = entries.map(([label, value], idx) => {
    const pct = (value / total) * 100;
    return `
      <div class="progress-row" data-drill-type="landUse" data-drill-value="${escapeHtml(label)}" title="Double-click to filter ${escapeHtml(label)} parcels" style="--delay:${idx * 35}ms">
        <div class="progress-meta">
          <strong title="${escapeHtml(label)}">${escapeHtml(label)}</strong>
          <span>${pct.toFixed(0)}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${(value / max) * 100}%;background:${palette[idx % palette.length]}">
            <b>${fmt(value)}</b>
          </div>
        </div>
      </div>
    `;
  }).join("");
  bindHtmlDrilldowns();
}

function renderStatusLegend(entries) {
  const total = entries.reduce((sum, entry) => sum + entry[1], 0) || 1;
  el("statusLegend").innerHTML = entries.map(([label, value]) => `
    <div class="status-leg-row">
      <span class="status-dot" style="background:${statusColors[label] || "#8a93a6"}"></span>
      <strong>${escapeHtml(label.replace("Likely ", ""))}</strong>
      <em>${((value / total) * 100).toFixed(0)}%</em>
      <small>${fmt(value)}</small>
    </div>
  `).join("");
}

function renderTreemap(containerId, entries) {
  const total = entries.reduce((sum, entry) => sum + entry[1], 0) || 1;
  const colors = ["#c0334e", "#d27a38", "#f3b63f", "#4fad91", "#39a3b4", "#7b80d9", "#ab72e8", "#e678a9", "#8bd16b", "#f1b66d"];
  el(containerId).innerHTML = entries.map(([label, value], idx) => {
    const pct = (value / total) * 100;
    return `
      <div class="tree-cell" data-drill-type="zcta" data-drill-value="${escapeHtml(label)}" title="Double-click to filter ZCTA ${escapeHtml(String(label))}" style="--grow:${Math.max(8, pct)};background:${colors[idx % colors.length]};--delay:${idx * 45}ms">
        <strong>${escapeHtml(formatZcta(label))}</strong>
        <span>${fmt(value)}</span>
        <small>${pct.toFixed(0)}%</small>
      </div>
    `;
  }).join("");
  bindHtmlDrilldowns();
}

function bindHtmlDrilldowns() {
  document.querySelectorAll("[data-drill-type]").forEach((node) => {
    if (node.dataset.drillReady) return;
    node.dataset.drillReady = "1";
    node.addEventListener("dblclick", () => setDrilldown(node.dataset.drillType, node.dataset.drillValue));
  });
}

function renderParcelList() {
  const rows = [...filtered]
    .sort((a, b) => b.properties.opportunity - a.properties.opportunity || b.properties.assessed - a.properties.assessed)
    .slice(0, 18)
    .map(({ properties: p }) => `
      <div class="parcel-item ${selectedIds.has(p.id) ? "selected" : ""}">
        <label class="select-line">
          <input type="checkbox" data-select-id="${escapeHtml(p.id)}" ${selectedIds.has(p.id) ? "checked" : ""} />
          <strong>${escapeHtml(p.address || "No address")}</strong>
        </label>
        <div class="parcel-meta">BLK ${escapeHtml(p.block)} / LOT ${escapeHtml(p.lot)} - ${escapeHtml(p.zoning)}</div>
        <div class="badges">
          <span class="badge ${statusFamily(p.vacancy)}">${escapeHtml(p.vacancy)}</span>
          <span class="badge opp">${p.opportunity}</span>
          <span class="badge gray">${money(p.assessed)}</span>
        </div>
        <button class="record-link" data-record-id="${escapeHtml(p.id)}" type="button">View full data</button>
      </div>
    `);
  el("parcelList").innerHTML = rows.join("");
  document.querySelectorAll("[data-select-id]").forEach((input) => {
    input.addEventListener("change", () => toggleSelected(input.dataset.selectId, input.checked));
  });
  document.querySelectorAll("[data-record-id]").forEach((button) => {
    button.addEventListener("click", () => openParcelRecord(button.dataset.recordId));
  });
}

function metrics() {
  const total = filtered.length;
  const vacantOnly = filtered.filter((f) => ["Vacant", "Vacant land"].includes(f.properties.vacancy)).length;
  const underOnly = filtered.filter((f) => f.properties.vacancy === "Likely underutilized").length;
  const vacant = vacantOnly + underOnly;
  const civic = filtered.filter((f) => ["Public", "Nonprofit"].includes(f.properties.ownership)).length;
  const values = filtered.map((f) => f.properties.assessed || 0);
  const sumValue = values.reduce((sum, value) => sum + value, 0);
  const landValue = filtered.reduce((sum, f) => sum + Number(f.properties.landValue || 0), 0);
  const improvedValue = filtered.reduce((sum, f) => sum + Number(f.properties.improvementValue || 0), 0);
  const medianValue = median(values);
  const avgScore = total ? filtered.reduce((sum, f) => sum + f.properties.opportunity, 0) / total : 0;
  const avgAcres = total ? filtered.reduce((sum, f) => sum + Number(f.properties.lotAcres || 0), 0) / total : 0;
  const clusters = currentClusters(3).length;
  return { total, vacant, vacantOnly, underOnly, civic, sumValue, landValue, improvedValue, medianValue, avgScore, avgAcres, clusters };
}

function renderKpis() {
  const m = metrics();
  const vacantPct = m.total ? `${((m.vacant / m.total) * 100).toFixed(1)}%` : "0.0%";
  const share = `${((m.total / allFeatures.length) * 100).toFixed(1)}% of dataset`;

  el("sourceCount").textContent = `${fmt(allFeatures.length)} real parcels`;
  el("mapTabCount").textContent = fmt(m.total);
  const dataTabCount = el("dataTabCount");
  if (dataTabCount) dataTabCount.textContent = fmt(m.total);
  el("sidebarCount").textContent = fmt(m.total);
  if (window.devTab?.syncCounts) window.devTab.syncCounts(m.total);
  el("kVacant").textContent = fmt(m.vacant);
  el("kVacantPct").textContent = vacantPct;
  el("kValue").textContent = money(m.sumValue);
  el("kMedian").textContent = `median ${money(m.medianValue)}`;
  el("kLandValue").textContent = money(m.landValue);
  el("kImprovedValue").textContent = money(m.improvedValue);

  el("mParcels").textContent = fmt(m.total);
  el("mVacant").textContent = fmt(m.vacant);
  el("mScore").textContent = m.avgScore.toFixed(0);

  el("cParcels").textContent = fmt(m.total);
  el("cShare").textContent = share;
  el("cVacantOnly").textContent = fmt(m.vacantOnly);
  el("cUnderOnly").textContent = fmt(m.underOnly);
  el("cOpportunity").textContent = fmt(m.vacant);
  el("cValue").textContent = money(m.sumValue);
  const drillText = state.drilldown ? ` - drilldown: ${state.drilldown.value}` : "";
  const scopeText = externalFilterIds ? ` - scoped by ${externalFilterLabel || "external query"}` : "";
  el("statusText").textContent = `${fmt(m.total)} parcels visible - ${fmt(m.vacant)} vacant or underutilized - ${fmt(m.clusters)} opportunity clusters${drillText}${scopeText}`;
  updateSelectionUi();
}

function renderLegend() {
  const selectedStatusLabel = state.status === "Vacant Group" ? "Vacant / vacant land" : state.status;
  const entries = state.status !== "All"
    ? [[selectedStatusLabel, statusColors[selectedStatusLabel] || "#8a93a6"]]
    : [["70+ score", "#c0334e"], ["50-69 score", "#c96a2a"], ["35-49 score", "#d7a43c"], ["0-34 score", "#7aa6b8"]];
  const countMap = new Map();
  filtered.forEach((feature) => {
    const label = planningStatus(feature.properties);
    countMap.set(label, (countMap.get(label) || 0) + 1);
  });
  el("legend").innerHTML = `
    <div class="legend-title">${state.status === "All" ? "Opportunity score" : "Selected status"}</div>
    ${entries.map(([label, color]) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${color}"></span>
        <span>${escapeHtml(label)}</span>
        <span class="legend-count">${state.status !== "All" ? fmt(countMap.get(label) || 0) : ""}</span>
      </div>
    `).join("")}
  `;
}

function makeChart(id, type, labels, values, colors, extra = {}) {
  if (!window.Chart) return;
  Chart.defaults.font.family = "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = "#4b5565";
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el(id), {
    type,
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
        borderRadius: type === "bar" ? 8 : 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 8 },
      plugins: {
        legend: {
          display: type !== "bar",
          position: "bottom",
          labels: {
            boxWidth: 10,
            usePointStyle: true,
            color: "#4b5565",
            font: { family: "Plus Jakarta Sans", size: 11, weight: 600 },
            padding: 14,
          },
        },
        tooltip: {
          backgroundColor: "rgba(15,23,42,.94)",
          titleFont: { family: "Plus Jakarta Sans", size: 12, weight: 700 },
          bodyFont: { family: "Plus Jakarta Sans", size: 12, weight: 500 },
          padding: 12,
          cornerRadius: 10,
          callbacks: { label: (context) => `${context.label}: ${fmt(context.raw)}` },
        },
      },
      scales: type === "bar" ? {
        x: { grid: { color: "#edf0f6" }, ticks: { precision: 0, color: "#8a93a6", font: { family: "Plus Jakarta Sans", size: 10, weight: 600 } } },
        y: { grid: { display: false }, ticks: { color: "#4b5565", font: { family: "Plus Jakarta Sans", weight: 600 }, callback: wrapTick } },
      } : {},
      ...extra,
    },
  });
  bindChartDrilldown(id, charts[id]);
}

function bindChartDrilldown(id, chart) {
  const canvas = el(id);
  if (!canvas || !chart) return;
  canvas.ondblclick = (event) => {
    const points = chart.getElementsAtEventForMode(event, "nearest", { intersect: id !== "scatterChart" }, true);
    if (!points.length) return;
    handleChartDrilldown(id, chart, points[0]);
  };
}

function handleChartDrilldown(id, chart, point) {
  const label = chart.data.labels?.[point.index];
  const dataset = chart.data.datasets?.[point.datasetIndex || 0];
  if (!label && !dataset) return;
  if (id === "statusChart") {
    setDrilldown("status", label);
    return;
  }
  if (id === "ownershipChart") {
    setDrilldown("ownerSubtype", label);
    return;
  }
  if (id === "matrixChart") {
    setDrilldown("lbcsFunction", label, { status: dataset?.drillStatus });
    return;
  }
  if (id === "scatterChart") {
    const raw = dataset?.data?.[point.index];
    if (raw?.id) {
      setDrilldown("parcel", raw.id);
      openParcelRecord(raw.id);
    }
    return;
  }
  if (id === "valueSplitChart") {
    setDrilldown("valuePositive", label);
  }
}

function wrapTick(value) {
  const label = this.getLabelForValue ? this.getLabelForValue(value) : String(value);
  if (label.length <= 18) return label;
  const words = label.split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if ((line + " " + word).trim().length > 18) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function makeScatter(id, datasets) {
  if (!window.Chart) return;
  Chart.defaults.font.family = "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = "#4b5565";
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el(id), {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true, font: { family: "Plus Jakarta Sans", weight: 600 } } },
          tooltip: {
            backgroundColor: "rgba(15,23,42,.94)",
            titleFont: { family: "Plus Jakarta Sans", size: 12, weight: 700 },
            bodyFont: { family: "Plus Jakarta Sans", size: 12, weight: 500 },
            padding: 12,
            cornerRadius: 10,
            callbacks: {
            label(context) {
              const raw = context.raw;
              return `${raw.label}: land ${money(raw.x * 1000)}, improvement ratio ${raw.y.toFixed(0)}%, score ${raw.score}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "LAND_VAL ($K)" },
          min: 0,
          max: 4_500,
          grid: { color: "#edf0f6" },
          ticks: { color: "#8a93a6", font: { family: "Plus Jakarta Sans", size: 10, weight: 600 } },
        },
        y: {
          type: "linear",
          title: { display: true, text: "IMPRVT_VAL / LAND_VAL %" },
          ticks: { callback: (value) => `${value}%`, color: "#8a93a6", font: { family: "Plus Jakarta Sans", size: 10, weight: 600 } },
          grid: { color: "#edf0f6" },
        },
      },
    },
  });
}

function makeRadar(id, labels, values) {
  if (!window.Chart) return;
  Chart.defaults.font.family = "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = "#4b5565";
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el(id), {
    type: "radar",
    data: {
      labels,
      datasets: [{
        label: "Opportunity profile",
        data: values,
        backgroundColor: "rgba(67,56,202,.18)",
        borderColor: "#4338ca",
        pointBackgroundColor: "#4338ca",
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { display: false },
          grid: { color: "#dfe3ed" },
          angleLines: { color: "#dfe3ed" },
          pointLabels: { color: "#4b5565", font: { family: "Plus Jakarta Sans", weight: 600 } },
        },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderCharts() {
  const statusMap = new Map();
  filtered.forEach((feature) => {
    const label = planningStatus(feature.properties);
    statusMap.set(label, (statusMap.get(label) || 0) + 1);
  });
  const status = [...statusMap.entries()].sort((a, b) => b[1] - a[1]);
  makeChart("statusChart", "doughnut", status.map((x) => x[0]), status.map((x) => x[1]), status.map((x) => statusColors[x[0]] || "#8a93a6"));
  renderStatusLegend(status);

  const owner = countBy(filtered, "ownerSubtype").slice(0, 6);
  makeChart("ownershipChart", "doughnut", owner.map((x) => x[0]), owner.map((x) => x[1]), ["#4338ca", "#2563eb", "#7c3aed", "#0a8f60", "#c96a2a", "#8a93a6"]);

  const total = filtered.length || 1;
  const vacant = filtered.filter((f) => f.properties.vacancy !== "Occupied / active").length;
  const civic = filtered.filter((f) => ["Public", "Nonprofit"].includes(f.properties.ownership)).length;
  const bigLots = filtered.filter((f) => Number(f.properties.lotAcres || 0) >= 0.15).length;
  const qoz = filtered.filter((f) => f.properties.qoz === "Yes").length;
  const clustered = currentClusters(3).reduce((sum, cluster) => sum + cluster.count, 0);
  makeRadar("profileChart", ["Vacancy", "Civic owner", "Large lots", "QOZ", "Clustered"], [
    (vacant / total) * 100,
    (civic / total) * 100,
    (bigLots / total) * 100,
    (qoz / total) * 100,
    (clustered / total) * 100,
  ].map((v) => Math.round(v)));

  const sampleStep = Math.max(1, Math.ceil(filtered.length / 1300));
  const scatterGroups = ["Vacant / vacant land", "Likely underutilized", "Occupied / active"].map((statusName) => ({
    label: statusName,
    data: filtered
      .filter((feature, idx) => idx % sampleStep === 0 && planningStatus(feature.properties) === statusName)
      .map(({ properties: p }) => ({
        x: Math.min(4_500, Number(p.landValue || 0) / 1000),
        y: Math.min(350, Number(p.landValue || 0) ? (Number(p.improvementValue || 0) / Number(p.landValue || 1)) * 100 : 0),
        label: p.address || `${p.block}/${p.lot}`,
        id: p.id,
        score: p.opportunity,
      })),
    backgroundColor: statusColors[statusName] || "#8a93a6",
    pointRadius: statusName === "Occupied / active" ? 2.5 : 4,
    pointHoverRadius: 6,
  }));
  makeScatter("scatterChart", scatterGroups);

  const lbcsMatrixLabels = countBy(filtered, "lbcsFunction").filter(([label]) => label !== "Unknown").slice(0, 7).map(([label]) => label);
  const matrixDatasets = [
    ["Vacant / vacant land", "#c0334e"],
    ["Likely underutilized", "#e09a3e"],
    ["Occupied / active", "#0a8f60"],
  ].map(([label, color]) => ({
    label: label.replace("Likely ", ""),
    drillStatus: label,
    data: lbcsMatrixLabels.map((lbcs) => filtered.filter((f) => f.properties.lbcsFunction === lbcs && planningStatus(f.properties) === label).length),
    backgroundColor: color,
    borderRadius: 4,
  }));
  if (charts.matrixChart) charts.matrixChart.destroy();
  charts.matrixChart = new Chart(el("matrixChart"), {
    type: "bar",
    data: { labels: lbcsMatrixLabels, datasets: matrixDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true, boxWidth: 8, color: "#4b5565", font: { family: "Plus Jakarta Sans", weight: 600 } } },
        tooltip: {
          backgroundColor: "rgba(15,23,42,.94)",
          titleFont: { family: "Plus Jakarta Sans", size: 12, weight: 700 },
          bodyFont: { family: "Plus Jakarta Sans", size: 12, weight: 500 },
          padding: 12,
          cornerRadius: 10,
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { callback: wrapTick, color: "#4b5565", font: { family: "Plus Jakarta Sans", size: 10, weight: 600 } } },
        y: { stacked: true, grid: { color: "#edf0f6" }, ticks: { color: "#8a93a6", font: { family: "Plus Jakarta Sans", size: 10, weight: 600 } } },
      },
      animation: { duration: 900, easing: "easeOutQuart" },
    },
  });
  bindChartDrilldown("matrixChart", charts.matrixChart);

  makeChart("valueSplitChart", "doughnut", ["Land value", "Improvement value"], [
    filtered.reduce((sum, f) => sum + Number(f.properties.landValue || 0), 0),
    filtered.reduce((sum, f) => sum + Number(f.properties.improvementValue || 0), 0),
  ], ["#0a8f60", "#4338ca"], {
    plugins: {
      tooltip: {
        backgroundColor: "rgba(15,23,42,.94)",
        titleFont: { family: "Plus Jakarta Sans", size: 12, weight: 700 },
        bodyFont: { family: "Plus Jakarta Sans", size: 12, weight: 500 },
        padding: 12,
        cornerRadius: 10,
        callbacks: { label: (context) => `${context.label}: ${money(context.raw)}` },
      },
    },
  });
}

function renderInsights() {
  const m = metrics();
  const vacantFeatures = filtered.filter((f) => f.properties.vacancy !== "Occupied / active");
  const geoTop = countBy(vacantFeatures, "neighborhood")[0] || ["No area", 0];
  const ownerTop = countBy(filtered, "ownership")[0] || ["No ownership", 0];
  const zoningTop = countBy(vacantFeatures.length ? vacantFeatures : filtered, "zoning")[0] || ["No zoning", 0];
  const lbcsTop = countBy(vacantFeatures.filter((f) => f.properties.lbcsFunction !== "Unknown"), "lbcsFunction")[0] || ["No LBCS function", 0];
  const nonprofitOpp = vacantFeatures.filter((f) => f.properties.ownership === "Nonprofit").length;
  const publicOpp = vacantFeatures.filter((f) => f.properties.ownership === "Public").length;
  const highOpp = filtered.filter((f) => f.properties.opportunity >= 45);

  el("iVacant").textContent = fmt(m.vacant);
  el("iVacantText").textContent = `${geoTop[0]} has the largest visible concentration in the current filter, with ${fmt(geoTop[1])} vacant or underutilized parcels. Leading LBCS function among opportunity parcels is ${lbcsTop[0]} (${fmt(lbcsTop[1])}).`;
  el("iClusters").textContent = fmt(m.clusters);
  el("iClusterText").textContent = `${fmt(highOpp.length)} parcels score 45 or higher. Cluster markers identify groups of at least four high-opportunity parcels that may support coordinated acquisition, land banking, or redevelopment planning.`;
  el("iOwnership").textContent = ownerTop[0];
  el("iOwnershipText").textContent = `${ownerTop[0]} ownership dominates the current view with ${fmt(ownerTop[1])} parcels. Within opportunity parcels, ${fmt(publicOpp)} are public and ${fmt(nonprofitOpp)} are nonprofit, useful for acquisition or partnership triage.`;
  el("iZoning").textContent = zoningTop[0];
  el("iZoningText").textContent = `${zoningTop[0]} is the leading zoning category among the selected opportunity parcels, with ${fmt(zoningTop[1])} parcels in the current filter.`;
}

function renderAll() {
  renderKpis();
  renderBars("ownershipBars", countBy(filtered, "ownership"), "#4338ca", filtered.length, "ownership");
  renderBars("landUseBars", countBy(filtered, "landUse").slice(0, 7), "#0a8f60", filtered.length, "landUse");
  renderBars("lbcsBars", countBy(filtered, "lbcsFunction").filter(([label]) => label !== "Unknown").slice(0, 7), "#2563eb", filtered.length, "lbcsFunction");
  renderProgressChart("landUseProgress", countBy(filtered, "landUse").slice(0, 7), ["#3478f6", "#8b5cf6", "#f59e0b", "#06a6bf", "#10b981", "#c0334e", "#64748b"]);
  renderTreemap("zctaTreemap", countByFormatted(filtered.filter((f) => f.properties.censusZcta), "censusZcta", formatZcta).slice(0, 10));
  renderParcelList();
  renderLegend();
  if (state.tab === "charts") renderCharts();
  if (state.tab === "insights") renderInsights();
  if (dashboardEntered && state.tab === "map") renderMap();
}

function updateMultiLabel(kind) {
  const values = kind === "geo" ? state.geographies : state.zonings;
  const labelId = kind === "geo" ? "geoMenuLabel" : "zoningMenuLabel";
  const allText = kind === "geo" ? "All areas" : "All zoning";
  el(labelId).textContent = values.length ? (values.length === 1 ? values[0] : `${values.length} selected`) : allText;
}

function buildMultiMenu(kind, values) {
  const menu = el(kind === "geo" ? "geoMenu" : "zoningMenu");
  const stateKey = kind === "geo" ? "geographies" : "zonings";
  menu.innerHTML = `
    <label class="multi-option all-option">
      <input type="checkbox" value="__all__" checked />
      <span>${kind === "geo" ? "All areas" : "All zoning"}</span>
    </label>
    ${values.map((value) => `
      <label class="multi-option">
        <input type="checkbox" value="${escapeHtml(value)}" />
        <span>${escapeHtml(value)}</span>
      </label>
    `).join("")}
  `;
  menu.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.value === "__all__") {
        state[stateKey] = [];
        menu.querySelectorAll("input:not([value='__all__'])").forEach((box) => { box.checked = false; });
      } else {
        const checked = [...menu.querySelectorAll("input:not([value='__all__']):checked")].map((box) => box.value);
        state[stateKey] = checked;
        menu.querySelector("input[value='__all__']").checked = checked.length === 0;
      }
      updateMultiLabel(kind);
      applyFilters();
    });
  });
  updateMultiLabel(kind);
}

function toggleMenu(kind) {
  const menu = el(kind === "geo" ? "geoMenu" : "zoningMenu");
  const button = el(kind === "geo" ? "geoMenuButton" : "zoningMenuButton");
  document.querySelectorAll(".multi-menu").forEach((node) => {
    if (node !== menu) node.classList.add("gone");
  });
  menu.classList.toggle("gone");
  const rect = button.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(window.innerWidth - 272, rect.left))}px`;
  menu.style.top = `${rect.bottom + 8}px`;
}

function valueCeil(values, fallback) {
  const max = Math.max(...values.map((v) => Number(v || 0)), fallback);
  if (max <= 100) return 100;
  const power = Math.pow(10, Math.max(3, String(Math.round(max)).length - 2));
  return Math.ceil(max / power) * power;
}

function updateSliderLabels() {
  el("scoreRangeLabel").textContent = `${state.scoreMin} - ${state.scoreMax}`;
  el("landRangeLabel").textContent = `${money(state.landMin)} - ${money(state.landMax)}`;
  el("improvementRangeLabel").textContent = `${money(state.improvementMin)} - ${money(state.improvementMax)}`;
}

function initRangeSliders() {
  const landMax = valueCeil(allProps.map((p) => p.landValue), 1_000_000);
  const improvementMax = valueCeil(allProps.map((p) => p.improvementValue), 1_000_000);
  state.landMax = landMax;
  state.improvementMax = improvementMax;
  fullLandMax = landMax;
  fullImprovementMax = improvementMax;
  const configs = [
    ["scoreMin", "scoreMax", 0, 100],
    ["landMin", "landMax", 0, landMax],
    ["improvementMin", "improvementMax", 0, improvementMax],
  ];
  configs.forEach(([minId, maxId, min, max]) => {
    const minInput = el(minId);
    const maxInput = el(maxId);
    [minInput, maxInput].forEach((input) => {
      input.min = min;
      input.max = max;
      input.step = max > 100 ? Math.max(1000, Math.round(max / 250)) : 1;
    });
    minInput.value = min;
    maxInput.value = max;
  });
  updateSliderLabels();
}

function initFilters() {
  const geos = [...new Set(allProps.flatMap((p) => [p.ward, p.neighborhood]).filter(Boolean))].sort();
  const zones = [...new Set(allProps.map((p) => p.zoning).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  buildMultiMenu("geo", geos);
  buildMultiMenu("zoning", zones);
  initRangeSliders();

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.dataset.filter;
      const value = button.dataset.value;
      state[group] = value;
      document.querySelectorAll(`[data-filter="${group}"]`).forEach((b) => b.classList.toggle("on", b === button));
      applyFilters();
    });
  });

  el("geoMenuButton").addEventListener("click", () => toggleMenu("geo"));
  el("zoningMenuButton").addEventListener("click", () => toggleMenu("zoning"));
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".multi-select") && !event.target.closest(".multi-menu")) {
      document.querySelectorAll(".multi-menu").forEach((node) => node.classList.add("gone"));
    }
  });

  let timer;
  el("searchInput").addEventListener("input", (event) => {
    clearTimeout(timer);
    const seq = ++filterInputSeq;
    timer = setTimeout(() => {
      if (seq !== filterInputSeq) return;
      state.search = event.target.value;
      applyFilters();
    }, 150);
  });

  ["scoreMin", "scoreMax", "landMin", "landMax", "improvementMin", "improvementMax"].forEach((id) => {
    el(id).addEventListener("input", (event) => {
      clearTimeout(timer);
      const pair = id.endsWith("Min") ? id.replace("Min", "Max") : id.replace("Max", "Min");
      if (id.endsWith("Min") && Number(event.target.value) > Number(el(pair).value)) el(pair).value = event.target.value;
      if (id.endsWith("Max") && Number(event.target.value) < Number(el(pair).value)) el(pair).value = event.target.value;
      const seq = ++filterInputSeq;
      timer = setTimeout(() => {
        if (seq !== filterInputSeq) return;
        ["scoreMin", "scoreMax", "landMin", "landMax", "improvementMin", "improvementMax"].forEach((rangeId) => {
          state[rangeId] = Number(el(rangeId).value);
        });
        updateSliderLabels();
        applyFilters();
      }, 80);
    });
  });

  el("resetFilters").addEventListener("click", () => {
    clearTimeout(timer);
    filterInputSeq++;
    resetDashboardFilters();
  });
}

function resetDashboardFilters() {
  clearExternalFeatureFilter();
  state.status = "All";
  state.ownership = "All";
  state.geographies = [];
  state.zonings = [];
  state.search = "";
  state.scoreMin = 0;
  state.scoreMax = 100;
  state.landMin = 0;
  state.improvementMin = 0;
  state.landMax = Number.isFinite(fullLandMax) ? fullLandMax : Number(el("landMax").max);
  state.improvementMax = Number.isFinite(fullImprovementMax) ? fullImprovementMax : Number(el("improvementMax").max);
  clearDrilldown();
  el("searchInput").value = "";
  const cmdSearch = el("cmdSearch");
  if (cmdSearch) cmdSearch.value = "";
  document.querySelectorAll(".multi-menu input[value='__all__']").forEach((box) => { box.checked = true; });
  document.querySelectorAll(".multi-menu input:not([value='__all__'])").forEach((box) => { box.checked = false; });
  el("scoreMin").value = 0;
  el("scoreMax").value = 100;
  el("landMin").value = 0;
  el("landMax").value = state.landMax;
  el("improvementMin").value = 0;
  el("improvementMax").value = state.improvementMax;
  updateMultiLabel("geo");
  updateMultiLabel("zoning");
  updateSliderLabels();
  document.querySelectorAll("[data-filter='status']").forEach((b) => b.classList.toggle("on", b.dataset.value === "All"));
  document.querySelectorAll("[data-filter='ownership']").forEach((b) => b.classList.toggle("on", b.dataset.value === "All"));
  applyFilters();
  if (filtered.length !== allFeatures.length && state.status === "All" && state.ownership === "All" && !state.geographies.length && !state.zonings.length && !state.search && !state.drilldown && !externalFilterIds) {
    console.warn("Reset expected full dataset but filters returned", filtered.length, state);
    filtered = [...allFeatures];
    syncDashboardGlobals();
    renderAll();
  }
}

function initTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === button));
      document.querySelectorAll(".view").forEach((view) => view.classList.add("gone"));
      el(`view-${state.tab}`).classList.remove("gone");
      if (state.tab === "map") {
        setTimeout(() => {
          map.invalidateSize();
          renderMap();
        }, 60);
      } else {
        if (state.tab === "charts") renderCharts();
        if (state.tab === "insights") renderInsights();
      }
    });
  });
}

function updateSelectionUi() {
  const count = selectedIds.size;
  ["selectedCount"].forEach((id) => {
    const node = el(id);
    if (node) node.textContent = `${fmt(count)} selected`;
  });
  const dock = el("exportDock");
  if (dock) dock.classList.toggle("active", count > 0);
}

function toggleSelected(id, force) {
  const shouldSelect = force === undefined ? !selectedIds.has(id) : force;
  if (shouldSelect) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelectionUi();
  renderParcelList();
  if (parcelLayer) parcelLayer.setStyle(parcelStyle);
}

function selectedFeatures() {
  return allFeatures.filter((feature) => selectedIds.has(feature.properties.id));
}

const exportColumns = [
  "id", "regridPath", "regridParcel", "block", "lot", "address", "owner", "ownership",
  "ownerSubtype", "ownerConfidence", "lbcsFunction", "lbcsOwnership", "landUse", "vacancy",
  "vacancyMethod", "assessed", "landValue", "improvementValue", "lastYearTaxes", "salePrice", "yearConstructed", "lotAcres", "landDescription", "zoning",
  "ward", "neighborhood", "latitude", "longitude", "censusTract", "censusBlock",
  "censusBlockGroup", "censusZcta", "medianHouseholdIncome", "populationDensity",
  "housingAffordabilityIndex", "opportunity"
];

function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function featuresToCsv(features) {
  const rows = features.map((feature) => exportColumns.map((column) => {
    const value = feature.properties[column] ?? "";
    return `"${String(value).replaceAll('"', '""')}"`;
  }).join(","));
  return [exportColumns.join(","), ...rows].join("\n");
}

function exportFeaturesCsv(features, filename) {
  downloadText(filename, featuresToCsv(features), "text/csv;charset=utf-8");
}

function exportCsv() {
  exportFeaturesCsv(filtered, "newark_visible_parcels.csv");
}

function exportSelectedCsv() {
  const features = selectedFeatures();
  exportFeaturesCsv(features.length ? features : filtered, features.length ? "newark_selected_parcels.csv" : "newark_visible_parcels.csv");
}

function openParcelRecord(id) {
  const props = attrById.get(id);
  if (!props) return;
  activeRecord = props;
  el("recordParcelId").textContent = props.regridParcel || props.id;
  el("recordTitle").textContent = props.address || "Full Parcel Record";
  el("selectRecordParcel").textContent = selectedIds.has(props.id) ? "Remove selection" : "Select parcel";
  const preferred = [
    "id", "regridPath", "regridParcel", "address", "owner", "ownership", "ownerSubtype", "ownerConfidence",
    "lbcsFunction", "lbcsOwnership", "landUse", "vacancy", "vacancyMethod", "landValue", "improvementValue", "lastYearTaxes", "salePrice", "yearConstructed", "landDescription",
    "assessed", "netValue", "lotAcres", "zoning", "ward", "neighborhood", "latitude", "longitude",
    "censusTract", "censusBlock", "censusBlockGroup", "censusZcta", "medianHouseholdIncome", "populationDensity",
    "populationGrowthPast5", "populationGrowthNext5", "housingAffordabilityIndex", "qoz", "redevelopment", "opportunity"
  ];
  const keys = [...new Set([...preferred, ...Object.keys(props)])].filter((key) => props[key] !== "" && props[key] !== null && props[key] !== undefined);
  el("recordGrid").innerHTML = keys.map((key) => `
    <div class="record-field">
      <span>${escapeHtml(displayRecordLabel(key))}</span>
      <strong>${escapeHtml(displayRecordValue(key, props[key]))}</strong>
    </div>
  `).join("");
  el("parcelModal").classList.remove("gone");
}

function closeParcelRecord() {
  el("parcelModal").classList.add("gone");
}

function exportActiveSingleCsv() {
  if (!activeRecord) return;
  exportFeaturesCsv([{ properties: activeRecord }], `parcel_${activeRecord.regridParcel || activeRecord.id}.csv`);
}

function exportActiveJson() {
  if (!activeRecord) return;
  downloadText(`parcel_${activeRecord.regridParcel || activeRecord.id}.json`, JSON.stringify(activeRecord, null, 2), "application/json;charset=utf-8");
}

function reportScope(options = {}) {
  const chosen = selectedFeatures();
  if (chosen.length) return { title: "Selected Parcels", features: chosen };
  if (options.features) return { title: options.title || "Matched Parcel Report", features: options.features };
  if (options.focus === "vacant") {
    return { title: "Vacant Parcel Report", features: filtered.filter((f) => ["Vacant", "Vacant land"].includes(f.properties.vacancy)) };
  }
  if (options.focus === "underutilized") {
    return { title: "Underutilized Parcel Report", features: filtered.filter((f) => f.properties.vacancy === "Likely underutilized") };
  }
  if (options.focus === "opportunity") {
    return { title: "Opportunity Parcel Report", features: filtered.filter((f) => f.properties.vacancy !== "Occupied / active" || f.properties.opportunity >= 45) };
  }
  if (options.focus === "public") {
    return { title: "Public Ownership Parcel Report", features: filtered.filter((f) => f.properties.ownership === "Public") };
  }
  if (options.focus === "private") {
    return { title: "Private Ownership Parcel Report", features: filtered.filter((f) => f.properties.ownership === "Private") };
  }
  if (options.focus === "nonprofit") {
    return { title: "Nonprofit Parcel Report", features: filtered.filter((f) => f.properties.ownership === "Nonprofit") };
  }
  return { title: "Current Visible Parcel Report", features: filtered };
}

function inferReportFocus(q, wantsNonprofit = false) {
  if (q.includes("vacant")) return "vacant";
  if (q.includes("underutil")) return "underutilized";
  if (q.includes("opportunity") || q.includes("cluster")) return "opportunity";
  if (wantsNonprofit || q.includes("ngo")) return "nonprofit";
  if (q.includes("public")) return "public";
  if (q.includes("private")) return "private";
  return "current";
}

function inferReportOptions(text, wantsNonprofit = false) {
  const q = normalizeText(text);
  const focus = inferReportFocus(q, wantsNonprofit);
  if (focus !== "current") return { focus };
  const match = findBestFieldMatch(text);
  if (match) {
    const features = allFeatures.filter((feature) => normalizeText(feature.properties[match.key]) === normalizeText(match.value));
    return { features, title: `${match.label}: ${match.value} Report` };
  }
  const matches = featuresMatchingText(text, allFeatures);
  if (matches.length && matches.length < allFeatures.length) {
    return { features: matches, title: `Matched Query Report` };
  }
  return { focus: "current" };
}

function reportBars(entries, total, color) {
  return entries.slice(0, 8).map(([label, value]) => {
    const pct = total ? (value / total) * 100 : 0;
    return `<div class="rbar"><span>${escapeHtml(label)}</span><div><b style="width:${Math.max(3, pct)}%;background:${color}"></b></div><em>${fmt(value)} (${pct.toFixed(1)}%)</em></div>`;
  }).join("");
}

function svgDonut(entries, colors) {
  const total = entries.reduce((sum, entry) => sum + entry[1], 0) || 1;
  let acc = 0;
  const circles = entries.map(([label, value], idx) => {
    const frac = value / total;
    const dash = `${(frac * 100).toFixed(3)} ${100 - (frac * 100).toFixed(3)}`;
    const offset = 25 - acc * 100;
    acc += frac;
    return `<circle r="15.9" cx="20" cy="20" fill="transparent" stroke="${colors[idx % colors.length]}" stroke-width="7" stroke-dasharray="${dash}" stroke-dashoffset="${offset}"></circle>`;
  }).join("");
  const legend = entries.map(([label, value], idx) => `<div class="legend"><b style="background:${colors[idx % colors.length]}"></b><span>${escapeHtml(label)}</span><em>${fmt(value)}</em></div>`).join("");
  return `<div class="donut-wrap"><svg viewBox="0 0 40 40">${circles}<text x="20" y="20" text-anchor="middle" dominant-baseline="central" font-size="5" font-weight="800">${fmt(total)}</text></svg><div>${legend}</div></div>`;
}

function reportNarrative(scope, metrics, features) {
  const topGeo = topEntry(features, "neighborhood");
  const topOwner = topEntry(features, "ownership");
  const topLbcs = topEntry(features.filter((f) => f.properties.lbcsFunction !== "Unknown"), "lbcsFunction");
  const vacancyRate = metrics.total ? ((metrics.vacantOnly + metrics.underOnly) / metrics.total) * 100 : 0;
  return `This ${scope.title.toLowerCase()} includes ${fmt(metrics.total)} parcels. ${fmt(metrics.vacantOnly)} are vacant and ${fmt(metrics.underOnly)} are underutilized, giving an opportunity share of ${vacancyRate.toFixed(1)}%. The strongest geography is ${topGeo[0]} with ${fmt(topGeo[1])} parcels. Dominant ownership is ${topOwner[0]} with ${fmt(topOwner[1])} parcels. The leading LBCS function is ${topLbcs[0]} with ${fmt(topLbcs[1])} parcels.`;
}

function reportMetrics(features) {
  const total = features.length;
  const vacantOnly = features.filter((f) => f.properties.vacancy === "Vacant").length;
  const underOnly = features.filter((f) => f.properties.vacancy === "Likely underutilized").length;
  const active = features.filter((f) => f.properties.vacancy === "Occupied / active").length;
  const landValue = features.reduce((sum, f) => sum + Number(f.properties.landValue || 0), 0);
  const improvementValue = features.reduce((sum, f) => sum + Number(f.properties.improvementValue || 0), 0);
  return { total, vacantOnly, underOnly, active, landValue, improvementValue };
}

function reportTable(features, limit = 80) {
  return features.slice(0, limit).map(({ properties: p }) => `
    <tr><td>${escapeHtml(p.regridParcel || p.id)}</td><td>${escapeHtml(p.address)}</td><td>${escapeHtml(p.owner)}</td><td>${escapeHtml(p.ownership)}</td><td>${escapeHtml(p.vacancy)}</td><td>${escapeHtml(p.lbcsFunction)}</td><td>${money(p.landValue)}</td><td>${money(p.improvementValue)}</td><td>${p.opportunity}</td></tr>
  `).join("");
}

function exportReport(options = {}) {
  const m = metrics();
  const scope = reportScope(options);
  const reportFeatures = scope.features;
  const rm = reportMetrics(reportFeatures);
  const rows = reportTable(reportFeatures, 80);
  const statusEntries = [["Vacant", rm.vacantOnly], ["Underutilized", rm.underOnly], ["Active", rm.active]];
  const ownerEntries = countBy(reportFeatures, "ownership");
  const geoEntries = countBy(reportFeatures, "neighborhood");
  const lbcsEntries = countBy(reportFeatures.filter((f) => f.properties.lbcsFunction !== "Unknown"), "lbcsFunction");
  const zoningEntries = countBy(reportFeatures, "zoning");
  const narrative = reportNarrative(scope, rm, reportFeatures);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${scope.title}</title><style>body{font-family:'Plus Jakarta Sans',Inter,ui-sans-serif,system-ui,sans-serif;padding:30px;color:#111827;background:#f4f6fb}h1{margin:0 0 8px;font-size:30px}.sub{color:#667085}.wrap{max-width:1240px;margin:auto}.hero{background:linear-gradient(135deg,#101827,#4338ca);color:white;border-radius:24px;padding:24px;margin-bottom:16px}.hero .sub{color:rgba(255,255,255,.72)}.card{background:white;border:1px solid #e5e7eb;border-radius:18px;padding:18px;box-shadow:0 8px 26px rgba(15,23,42,.08);margin:14px 0}.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0}.kpi{background:white;border:1px solid #e5e7eb;border-radius:16px;padding:16px}.kpi span{font-size:11px;color:#8a93a6;font-weight:800;text-transform:uppercase}.kpi strong{display:block;font-size:26px;margin-top:5px}.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}.rbar{display:grid;grid-template-columns:160px 1fr 125px;gap:10px;align-items:center;margin:10px 0;font-size:12px}.rbar div{height:14px;background:#eef0f6;border-radius:99px;overflow:hidden}.rbar b{display:block;height:100%;border-radius:99px}.rbar em{font-style:normal;text-align:right;color:#667085}.donut-wrap{display:grid;grid-template-columns:130px 1fr;gap:16px;align-items:center}.donut-wrap svg{width:130px;height:130px;transform:rotate(-90deg)}.donut-wrap text{transform:rotate(90deg);transform-origin:center;fill:#111827}.legend{display:grid;grid-template-columns:12px 1fr 70px;gap:8px;align-items:center;margin:7px 0;font-size:12px}.legend b{width:10px;height:10px;border-radius:3px}.legend em{text-align:right;color:#667085;font-style:normal}table{border-collapse:collapse;width:100%;font-size:11px;background:white}td,th{border-bottom:1px solid #e5e7eb;padding:8px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#667085}.prompt,.method,.narrative{padding:12px 14px;background:#eef2ff;border-radius:12px;color:#4338ca;font-weight:700}.method{background:#ecfdf5;color:#065f46;font-weight:600;line-height:1.5}.narrative{background:#fff7ed;color:#9a3412;line-height:1.55}@media print{body{background:white;padding:12px}.card,.kpi{box-shadow:none}.no-print{display:none}.charts{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}table{font-size:9px}.hero{background:#111827!important;color:white!important}}</style></head><body><div class="wrap"><div class="hero"><h1>Living Cities - Newark City Parcel Project</h1><p class="sub">Prepared by Abdul Baseer Shaik, Data Analyst Consultant. Director, Centre of Wealth: Dr. Ahmed Whitt.</p></div>${options.prompt ? `<p class="prompt">User request: ${escapeHtml(options.prompt)}</p>` : ""}<p class="method">Method: Vacant = county IMPRVT_VAL is 0. Underutilized = county IMPRVT_VAL is greater than 0 and less than or equal to 20% of LAND_VAL. Active = improvement ratio above 20%. Report scope: ${escapeHtml(scope.title)}.</p><h2>${scope.title}</h2><p class="narrative">${escapeHtml(narrative)}</p><div class="kpis"><div class="kpi"><span>Report parcels</span><strong>${fmt(rm.total)}</strong></div><div class="kpi"><span>Vacant</span><strong>${fmt(rm.vacantOnly)}</strong></div><div class="kpi"><span>Underutilized</span><strong>${fmt(rm.underOnly)}</strong></div><div class="kpi"><span>Land value</span><strong>${money(rm.landValue)}</strong></div><div class="kpi"><span>Improvement value</span><strong>${money(rm.improvementValue)}</strong></div></div><div class="charts"><div class="card"><h3>Status Composition</h3>${svgDonut(statusEntries, ["#c0334e","#e09a3e","#0a8f60"])}</div><div class="card"><h3>Ownership</h3>${reportBars(ownerEntries, rm.total, "#4338ca")}</div><div class="card"><h3>Top Geographies</h3>${reportBars(geoEntries, rm.total, "#0a8f60")}</div><div class="card"><h3>LBCS Function</h3>${reportBars(lbcsEntries, rm.total, "#2563eb")}</div><div class="card"><h3>Zoning</h3>${reportBars(zoningEntries, rm.total, "#c96a2a")}</div></div><div class="card"><h2>Parcel Table</h2><p class="sub">Showing up to 80 parcels. Export CSV from the dashboard for the complete table.</p><table><thead><tr><th>Parcel</th><th>Address</th><th>Owner</th><th>Ownership</th><th>Status</th><th>LBCS function</th><th>Land value</th><th>Improvement</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table></div><button class="no-print" onclick="window.print()" style="padding:12px 16px;border:0;border-radius:12px;background:#4338ca;color:white;font-weight:800">Print / Save PDF</button></div>${options.print ? "<script>setTimeout(()=>window.print(),500)</script>" : ""}</body></html>`;
  downloadText(`${scope.title.toLowerCase().replaceAll(" ", "_")}.html`, html, "text/html;charset=utf-8");
}

function addAiMessage(role, text) {
  const box = el("aiMessages");
  const div = document.createElement("div");
  div.className = `ai-msg ${role}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function addTypingIndicator() {
  const node = addAiMessage("bot", "Thinking...");
  node.classList.add("typing");
  return node;
}

function removeTypingIndicator(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function topEntry(features, key) {
  return countBy(features, key)[0] || ["Unknown", 0];
}

function featuresMatchingText(text, source = allFeatures) {
  const parcelId = extractParcelId(text);
  if (parcelId) {
    return source.filter((feature) => {
      const p = feature.properties;
      return normalizeText(p.id) === normalizeText(parcelId) || normalizeText(p.regridParcel) === normalizeText(parcelId);
    });
  }
  const tokens = queryTokens(text);
  if (!tokens.length) return source;
  const exactPhrase = normalizeText(text);
  const scored = source.map((feature) => {
    const haystack = featureHaystack(feature.properties);
    let score = 0;
    if (exactPhrase && haystack.includes(exactPhrase)) score += 8;
    tokens.forEach((token) => {
      if (haystack.includes(token)) score += 1;
    });
    return { feature, score };
  }).filter((item) => item.score > 0);
  if (!scored.length) return fuzzyFeatureMatches(text, source);
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const directMatches = scored.filter((item) => item.score >= Math.max(1, best - 1)).map((item) => item.feature);
  if (directMatches.length) return directMatches;
  return fuzzyFeatureMatches(text, source);
}

function findBestFieldMatch(text) {
  const q = normalizeText(text);
  const fields = [
    ["ownership", "Ownership"],
    ["ownerSubtype", "Owner subtype"],
    ["vacancy", "Status"],
    ["zoning", "Zoning"],
    ["ward", "Ward"],
    ["neighborhood", "Neighborhood"],
    ["landUse", "Land use"],
    ["lbcsFunction", "LBCS function"],
    ["lbcsOwnership", "LBCS ownership"],
    ["censusZcta", "ZCTA"],
  ];
  let best = null;
  fields.forEach(([key, label]) => {
    const values = [...new Set(allProps.map((p) => p[key]).filter(Boolean))];
    values.forEach((value) => {
      const n = normalizeText(value);
      if (!n) return;
      const hit = q.includes(n) || n.includes(q);
      const tokenHit = queryTokens(text).some((token) => n.includes(token) && token.length >= 3);
      if (hit || tokenHit) {
        const score = (hit ? 10 : 2) + Math.min(8, n.length / 8);
        if (!best || score > best.score) best = { key, label, value, score };
      }
    });
  });
  return best;
}

function applyDataMatchFilter(text) {
  const q = normalizeText(text);
  const parcelId = extractParcelId(text);
  if (parcelId) {
    const matches = featuresMatchingText(parcelId, allFeatures);
    lastAssistantMatch = { label: parcelId, features: matches };
    if (matches.length === 1 && (q.includes("detail") || q.includes("record"))) {
      openParcelRecord(matches[0].properties.id);
      return `Opened the full parcel record for ${parcelId}.`;
    }
    state.search = parcelId;
    el("searchInput").value = parcelId;
    applyFilters();
    if (matches.length === 1) {
      return `Filtered to parcel ${parcelId}. It is ${matches[0].properties.vacancy}, owned by ${matches[0].properties.owner}, with land value ${money(matches[0].properties.landValue)} and improvement value ${money(matches[0].properties.improvementValue)}.`;
    }
    return `Searched for parcel ${parcelId}. ${fmt(filtered.length)} parcels match.`;
  }
  const match = findBestFieldMatch(text);
  if (match) {
    if (match.key === "ownership") {
      state.ownership = match.value;
      document.querySelectorAll("[data-filter='ownership']").forEach((b) => b.classList.toggle("on", b.dataset.value === match.value));
      applyFilters();
      return `Filtered by ${match.label}: ${match.value}. ${fmt(filtered.length)} parcels match.`;
    }
    if (match.key === "vacancy") {
      state.status = match.value === "Vacant" ? "Vacant Group" : match.value;
      document.querySelectorAll("[data-filter='status']").forEach((b) => b.classList.toggle("on", b.dataset.value === state.status));
      applyFilters();
      return `Filtered by ${match.label}: ${match.value}. ${fmt(filtered.length)} parcels match.`;
    }
    if (match.key === "zoning") {
      state.zonings = [match.value];
      document.querySelectorAll("#zoningMenu input").forEach((box) => { box.checked = box.value === match.value; });
      const allBox = document.querySelector("#zoningMenu input[value='__all__']");
      if (allBox) allBox.checked = false;
      updateMultiLabel("zoning");
      applyFilters();
      return `Filtered by ${match.label}: ${match.value}. ${fmt(filtered.length)} parcels match.`;
    }
    if (match.key === "ward" || match.key === "neighborhood") {
      state.geographies = [match.value];
      document.querySelectorAll("#geoMenu input").forEach((box) => { box.checked = box.value === match.value; });
      const allBox = document.querySelector("#geoMenu input[value='__all__']");
      if (allBox) allBox.checked = false;
      updateMultiLabel("geo");
      applyFilters();
      return `Filtered by ${match.label}: ${match.value}. ${fmt(filtered.length)} parcels match.`;
    }
    state.search = match.value;
    el("searchInput").value = match.value;
    applyFilters();
    return `Searched ${match.label}: ${match.value}. ${fmt(filtered.length)} parcels match.`;
  }
  const tokens = queryTokens(text);
  if (tokens.length) {
    const phrase = tokens.join(" ");
    const matches = featuresMatchingText(phrase, allFeatures);
    if (matches.length && matches.length < allFeatures.length) {
      lastAssistantMatch = { label: phrase, features: matches };
      state.search = phrase;
      el("searchInput").value = phrase;
      applyFilters();
      return `Searched all parcel fields for "${phrase}". ${fmt(filtered.length)} parcels match.`;
    }
    const fuzzyMatches = fuzzyFeatureMatches(phrase, allFeatures);
    if (fuzzyMatches.length) {
      lastAssistantMatch = { label: phrase, features: fuzzyMatches };
      selectedIds.clear();
      fuzzyMatches.slice(0, 120).forEach((feature) => selectedIds.add(feature.properties.id));
      updateSelectionUi();
      renderParcelList();
      document.querySelector("[data-tab='map']").click();
      return `Fuse.js fuzzy search found ${fmt(fuzzyMatches.length)} likely parcel matches for "${phrase}". I selected the top ${fmt(Math.min(120, fuzzyMatches.length))} matches so you can export or inspect them without hiding the broader dashboard.`;
    }
  }
  return null;
}

function datasetSummaryText() {
  const m = metrics();
  const vacantFeatures = filtered.filter((f) => f.properties.vacancy !== "Occupied / active");
  const topGeo = topEntry(vacantFeatures.length ? vacantFeatures : filtered, "neighborhood");
  const topOwner = topEntry(filtered, "ownership");
  const topLbcs = topEntry(filtered.filter((f) => f.properties.lbcsFunction !== "Unknown"), "lbcsFunction");
  return `Current view has ${fmt(m.total)} parcels. ${fmt(m.vacantOnly)} are vacant, ${fmt(m.underOnly)} are underutilized, and ${fmt(m.total - m.vacant)} are active. Top vacancy/opportunity geography is ${topGeo[0]} (${fmt(topGeo[1])} parcels). Dominant ownership is ${topOwner[0]} (${fmt(topOwner[1])}). Leading LBCS function is ${topLbcs[0]} (${fmt(topLbcs[1])}). Total land value is ${money(m.landValue)} and improvement value is ${money(m.improvedValue)}.`;
}

function dashboardDomContext() {
  const activeTab = document.querySelector("[data-tab].on")?.dataset.tab || state.tab;
  const activeStatus = document.querySelector("[data-filter='status'].on")?.textContent.trim() || "All";
  const activeOwnership = document.querySelector("[data-filter='ownership'].on")?.textContent.trim() || "All";
  const chartTitles = [...document.querySelectorAll(".chart-head h2")].map((node) => node.textContent.trim());
  const visibleViews = [...document.querySelectorAll(".view:not(.gone)")].map((node) => node.id);
  return {
    activeTab,
    visibleViews,
    filters: {
      status: activeStatus,
      ownership: activeOwnership,
      geography: state.geographies.length ? state.geographies.join(", ") : "All",
      zoning: state.zonings.length ? state.zonings.join(", ") : "All",
      search: el("searchInput")?.value || "",
      score: `${state.scoreMin}-${state.scoreMax}`,
      landValue: `${money(state.landMin)}-${money(state.landMax)}`,
      improvementValue: `${money(state.improvementMin)}-${money(state.improvementMax)}`,
    },
    counts: {
      filtered: filtered.length,
      selected: selectedIds.size,
    },
    availableTabs: [...document.querySelectorAll("[data-tab]")].map((node) => node.dataset.tab),
    availableMapLayers: [...document.querySelectorAll("[data-layer]")].map((node) => node.dataset.layer),
    visibleCharts: chartTitles,
    exportButtons: ["visible CSV", "selected CSV", "single parcel CSV", "single parcel JSON", "HTML report", "print/save PDF from report"],
  };
}

function dashboardContextText() {
  const ctx = dashboardDomContext();
  return `Dashboard UI context: active tab=${ctx.activeTab}; visible view=${ctx.visibleViews.join(",")}; filters=status ${ctx.filters.status}, ownership ${ctx.filters.ownership}, geography ${ctx.filters.geography}, zoning ${ctx.filters.zoning}, score ${ctx.filters.score}, land value ${ctx.filters.landValue}, improvement value ${ctx.filters.improvementValue}, search "${ctx.filters.search}"; filtered parcels=${fmt(ctx.counts.filtered)}; selected parcels=${fmt(ctx.counts.selected)}; available tabs=${ctx.availableTabs.join(", ")}; map layers=${ctx.availableMapLayers.join(", ")}; charts=${ctx.visibleCharts.join(", ") || "charts render on Analytics tab"}.`;
}

function exactBreakdown(key, label, limit = 8, source = filtered) {
  const entries = countBy(source, key).slice(0, limit);
  if (!entries.length) return `No ${label} records found in the current view.`;
  return `${label}: ` + entries.map(([name, count]) => `${name} ${fmt(count)}`).join("; ") + ".";
}

function statusBreakdownText() {
  const m = metrics();
  const active = m.total - m.vacant;
  return `Status counts from county fields: Vacant ${fmt(m.vacantOnly)} (IMPRVT_VAL = 0), Underutilized ${fmt(m.underOnly)} (IMPRVT_VAL <= 20% of LAND_VAL), Active ${fmt(active)}. Total visible: ${fmt(m.total)}.`;
}

function analystBriefText(source = filtered, label = "current view") {
  const m = reportMetrics(source);
  const opportunity = source.filter((f) => f.properties.vacancy !== "Occupied / active");
  const topGeo = topEntry(opportunity.length ? opportunity : source, "neighborhood");
  const topWard = topEntry(opportunity.length ? opportunity : source, "ward");
  const topOwner = topEntry(source, "ownership");
  const topSubtype = topEntry(source, "ownerSubtype");
  const topLbcs = topEntry(source.filter((f) => f.properties.lbcsFunction !== "Unknown"), "lbcsFunction");
  const topZoning = topEntry(source.filter((f) => f.properties.zoning !== "Unknown"), "zoning");
  const highScore = source.filter((f) => f.properties.opportunity >= 45).length;
  const civicOpp = opportunity.filter((f) => ["Public", "Nonprofit"].includes(f.properties.ownership)).length;
  const totalValue = m.landValue + m.improvementValue;
  const improvementRatio = m.landValue ? (m.improvementValue / m.landValue) : 0;
  const recommendation = opportunity.length
    ? `Start with ${topGeo[0]} / ${topWard[0]}, then prioritize ${fmt(civicOpp)} public or nonprofit opportunity parcels because they may be easier for coordinated partnership, acquisition, or land-bank conversations.`
    : "This scope is mostly active, so use it as a comparison baseline rather than a vacancy acquisition target.";
  return [
    `Analyst brief for ${label}: ${fmt(m.total)} parcels; ${fmt(m.vacantOnly)} vacant, ${fmt(m.underOnly)} underutilized, and ${fmt(m.active)} active.`,
    `Concentration: ${topGeo[0]} is the leading opportunity geography (${fmt(topGeo[1])} parcels), with ${topWard[0]} as the leading ward signal.`,
    `Ownership: ${topOwner[0]} dominates (${fmt(topOwner[1])} parcels); strongest owner subtype is ${topSubtype[0]} (${fmt(topSubtype[1])}).`,
    `Land use / zoning: leading LBCS function is ${topLbcs[0]} (${fmt(topLbcs[1])}); leading zoning is ${topZoning[0]} (${fmt(topZoning[1])}).`,
    `Value signal: land value ${money(m.landValue)}, improvement value ${money(m.improvementValue)}, combined value ${money(totalValue)}, improvement-to-land ratio ${improvementRatio ? `${(improvementRatio * 100).toFixed(1)}%` : "not available"}.`,
    `Action read: ${fmt(highScore)} parcels score 45+ for opportunity. ${recommendation}`
  ].join("\n");
}

function strongestOpportunitiesText() {
  const rows = [...filtered]
    .sort((a, b) => b.properties.opportunity - a.properties.opportunity || b.properties.landValue - a.properties.landValue)
    .slice(0, 5)
    .map(({ properties: p }, idx) => `${idx + 1}. ${p.address || p.regridParcel} (${p.vacancy}, ${p.ownership}, score ${p.opportunity}, land ${money(p.landValue)}, improvement ${money(p.improvementValue)})`);
  return rows.length ? `Top opportunity parcels:\n${rows.join("\n")}` : "No parcels are visible in the current filter.";
}

function applyAssistantCommand(text) {
  const q = text.toLowerCase();
  const nq = normalizeText(text);
  const wantsAction = /\b(show|filter|switch|open|go to|view|display|set|export|create|generate|only|just|visualize|analyse|analyze|compare)\b/.test(q);
  const wantsNonprofit = q.includes("non profit") || q.includes("nonprofit") || q.includes("ngo") || q.includes("non-profit");
  if (/\b(reset|clear|all parcels|all parcel|show all|entire data|full data|all data)\b/.test(q)) {
    resetDashboardFilters();
    return `Reset all dashboard filters. Full dataset is visible again: ${fmt(filtered.length)} parcels. ${statusBreakdownText()}`;
  }
  if (/^(ok\s*)?(show|open|display)\s*(me)?\s*$/i.test(String(text).trim()) && lastAssistantMatch) {
    if (lastAssistantMatch.features.length === 1) {
      const p = lastAssistantMatch.features[0].properties;
      state.search = p.regridParcel || p.id;
      el("searchInput").value = state.search;
      applyFilters();
      openParcelRecord(p.id);
      return `Opened the full parcel record for ${p.regridParcel || p.id}.`;
    }
    state.search = lastAssistantMatch.label;
    el("searchInput").value = lastAssistantMatch.label;
    applyFilters();
    return `Filtered to the previous matched scope: ${lastAssistantMatch.label}. ${fmt(filtered.length)} parcels are visible.`;
  }
  if ((nq.includes("insight") || nq.includes("findings")) && nq.includes("vacant")) {
    state.status = "Vacant Group";
    document.querySelectorAll("[data-filter='status']").forEach((b) => b.classList.toggle("on", b.dataset.value === "Vacant Group"));
    applyFilters();
    document.querySelector("[data-tab='insights']").click();
    return `Opened Key Findings for vacant parcels. ${fmt(filtered.length)} vacant parcels are visible.`;
  }
  if (wantsAction && wantsNonprofit) {
    state.ownership = "Nonprofit";
    document.querySelectorAll("[data-filter='ownership']").forEach((b) => b.classList.toggle("on", b.dataset.value === "Nonprofit"));
    applyFilters();
    const [subtype, count] = topEntry(filtered, "ownerSubtype");
    if (q.includes("chart") || q.includes("visual") || q.includes("analytics")) document.querySelector("[data-tab='charts']").click();
    return `Filtered to nonprofit entries. ${fmt(filtered.length)} nonprofit parcels are visible. Leading nonprofit subtype: ${subtype} (${fmt(count)} parcels).`;
  }
  if (/\b(select|selected)\b/.test(q) && q.includes("clear")) {
    selectedIds.clear();
    updateSelectionUi();
    renderParcelList();
    if (parcelLayer) parcelLayer.setStyle(parcelStyle);
    return "Cleared selected parcels.";
  }
  if (q.includes("documentation") || q.includes("help") || q.includes("how to use")) {
    document.querySelector("[data-tab='docs']").click();
    return "Opened the Documentation tab.";
  }
  if (q.includes("login")) {
    el("loginScreen").classList.remove("gone");
    return "Opened the branded login screen.";
  }
  if (wantsAction && (q.includes("private") || q.includes("public"))) {
    const owner = q.includes("public") ? "Public" : "Private";
    state.ownership = owner;
    document.querySelectorAll("[data-filter='ownership']").forEach((b) => b.classList.toggle("on", b.dataset.value === owner));
    applyFilters();
    if (q.includes("chart") || q.includes("visual") || q.includes("analytics")) document.querySelector("[data-tab='charts']").click();
    return `Filtered to ${owner} ownership. ${fmt(filtered.length)} parcels are visible.`;
  }
  if (wantsAction && q.includes("vacant")) {
    state.status = "Vacant Group";
    document.querySelectorAll("[data-filter='status']").forEach((b) => b.classList.toggle("on", b.dataset.value === "Vacant Group"));
    applyFilters();
    if (q.includes("chart") || q.includes("visual") || q.includes("analytics")) document.querySelector("[data-tab='charts']").click();
    return "Filtered the dashboard to vacant parcels using the county IMPRVT_VAL = 0 rule.";
  }
  if (wantsAction && q.includes("underutil")) {
    state.status = "Likely underutilized";
    document.querySelectorAll("[data-filter='status']").forEach((b) => b.classList.toggle("on", b.dataset.value === "Likely underutilized"));
    applyFilters();
    if (q.includes("chart") || q.includes("visual") || q.includes("analytics")) document.querySelector("[data-tab='charts']").click();
    return "Filtered to underutilized parcels where IMPRVT_VAL is <= 20% of LAND_VAL.";
  }
  if (wantsAction && q.includes("active")) {
    state.status = "Occupied / active";
    document.querySelectorAll("[data-filter='status']").forEach((b) => b.classList.toggle("on", b.dataset.value === "Occupied / active"));
    applyFilters();
    if (q.includes("chart") || q.includes("visual") || q.includes("analytics")) document.querySelector("[data-tab='charts']").click();
    return "Filtered to occupied / active parcels.";
  }
  if (wantsAction) {
    const dataFilter = applyDataMatchFilter(text);
    if (dataFilter) {
      if (q.includes("chart") || q.includes("visual") || q.includes("analytics") || q.includes("compare")) {
        document.querySelector("[data-tab='charts']").click();
        return `${dataFilter} Opened Analytics so the charts reflect that matched scope.`;
      }
      return dataFilter;
    }
  }
  if (wantsAction && (q.includes("analytics") || q.includes("chart"))) {
    document.querySelector("[data-tab='charts']").click();
    return "Opened the Analytics view.";
  }
  if (wantsAction && q.includes("map")) {
    document.querySelector("[data-tab='map']").click();
    return "Opened the Map view.";
  }
  if (wantsAction && (q.includes("finding") || q.includes("insight"))) {
    document.querySelector("[data-tab='insights']").click();
    return "Opened Key Findings.";
  }
  if (wantsAction && q.includes("satellite")) {
    switchBaseLayer("satellite");
    return "Switched the map to satellite imagery.";
  }
  if (wantsAction && q.includes("dark")) {
    switchBaseLayer("dark");
    return "Switched the map to dark mode.";
  }
  if (wantsAction && q.includes("topo")) {
    switchBaseLayer("topo");
    return "Switched the map to topographic mode.";
  }
  if (wantsAction && q.includes("street")) {
    switchBaseLayer("streets");
    return "Switched the map to street mode.";
  }
  if (wantsAction && q.includes("traffic")) {
    switchBaseLayer("traffic");
    return "Switched to the traffic-ready layer placeholder.";
  }
  if (q.includes("report") || q.includes("pdf")) {
    const reportOptions = inferReportOptions(text, wantsNonprofit);
    const scope = reportScope(reportOptions);
    exportReport({ ...reportOptions, prompt: text, print: q.includes("pdf") });
    return `Generated a detailed report for ${scope.title} with KPI cards, chart summaries, method notes, and parcel table.\n\n${analystBriefText(scope.features, scope.title)}\n\nIf you asked for PDF, use the print dialog to save as PDF.`;
  }
  if (q.includes("export")) {
    exportCsv();
    return "Exported the current visible parcel data as CSV.";
  }
  return null;
}

function localAiAnswer(text) {
  const command = applyAssistantCommand(text);
  if (command) return command;
  const q = text.toLowerCase();
  if (q.includes("summary") || q.includes("summarize") || q.includes("insight") || q.includes("brief") || q.includes("analysis")) {
    return analystBriefText(filtered, "current visible dashboard");
  }
  if (q.includes("ownership")) {
    return `${analystBriefText(filtered, "ownership analysis")}\n\n${exactBreakdown("ownership", "Ownership")} ${exactBreakdown("ownerSubtype", "Owner subtype", 6)}`;
  }
  if (q.includes("non profit") || q.includes("nonprofit") || q.includes("ngo") || q.includes("non-profit")) {
    const nonprofit = filtered.filter((f) => f.properties.ownership === "Nonprofit");
    return `${analystBriefText(nonprofit, "nonprofit parcel scope")}\n\n${fmt(nonprofit.length)} nonprofit parcels are in the current view. ${exactBreakdown("ownerSubtype", "Nonprofit subtype", 6, nonprofit)} ${exactBreakdown("vacancy", "Nonprofit status", 6, nonprofit)}`;
  }
  if (q.includes("status") || q.includes("vacant") || q.includes("active") || q.includes("underutil")) {
    return `${statusBreakdownText()}\n\n${analystBriefText(filtered, "utilization status analysis")}`;
  }
  if (q.includes("where") || q.includes("concentrated") || q.includes("cluster")) {
    const candidates = filtered.filter((f) => f.properties.vacancy !== "Occupied / active");
    const [label, count] = topEntry(candidates.length ? candidates : filtered, "neighborhood");
    return `${label} has the strongest concentration in the current view with ${fmt(count)} vacant or underutilized parcels. Use cluster markers on the map to inspect coordinated sites.`;
  }
  if (q.includes("value") || q.includes("land val") || q.includes("improvement")) {
    const m = metrics();
    return `Visible parcels have ${money(m.landValue)} in county land value and ${money(m.improvedValue)} in county improvement value. The current assessed total is ${money(m.sumValue)}.`;
  }
  if (q.includes("lbcs") || q.includes("function")) {
    return exactBreakdown("lbcsFunction", "LBCS function", 8, filtered.filter((f) => f.properties.lbcsFunction !== "Unknown"));
  }
  if (q.includes("zcta") || q.includes("zip")) {
    const entries = countByFormatted(filtered.filter((f) => f.properties.censusZcta), "censusZcta", formatZcta).slice(0, 10);
    return entries.length ? "Census ZCTA: " + entries.map(([name, count]) => `${name} ${fmt(count)}`).join("; ") + "." : "No Census ZCTA records found in the current view.";
  }
  if (q.includes("tract") || q.includes("census")) {
    return exactBreakdown("censusTract", "Census tract", 10, filtered.filter((f) => f.properties.censusTract));
  }
  if (q.includes("zoning")) {
    return exactBreakdown("zoning", "Zoning", 10);
  }
  if (q.includes("top") || q.includes("opportunity") || q.includes("best")) {
    return strongestOpportunitiesText();
  }
  if (q.includes("selected")) {
    const features = selectedFeatures();
    return features.length ? `${fmt(features.length)} parcels are selected. ${exactBreakdown("vacancy", "Selected status", 6, features)}` : "No parcels are selected yet. Select parcels from the high-opportunity list or a map popup.";
  }
  const match = findBestFieldMatch(text);
  if (match) {
    const source = allFeatures.filter((feature) => normalizeText(feature.properties[match.key]) === normalizeText(match.value));
    lastAssistantMatch = { label: match.value, features: source };
    const m = reportMetrics(source);
    return `I matched ${match.label} = ${match.value}. That scope contains ${fmt(m.total)} parcels: ${fmt(m.vacantOnly)} vacant, ${fmt(m.underOnly)} underutilized, and ${fmt(m.active)} active. Land value is ${money(m.landValue)} and improvement value is ${money(m.improvementValue)}. Say "show ${match.value}" to filter the dashboard or "report for ${match.value}" to export it.`;
  }
  const matched = featuresMatchingText(text, allFeatures);
  if (matched.length && matched.length < allFeatures.length) {
    lastAssistantMatch = { label: queryTokens(text).join(" ") || text, features: matched };
    const m = reportMetrics(matched);
    return `I matched your text against parcel fields and found ${fmt(m.total)} parcels: ${fmt(m.vacantOnly)} vacant, ${fmt(m.underOnly)} underutilized, ${fmt(m.active)} active. Say "show ${text}" to filter the dashboard or "report for ${text}" to export this scope.`;
  }
  return datasetSummaryText();
}

function loadApiKey() {
  if (apiKeyPromise) return apiKeyPromise;
  apiKeyPromise = fetch("./Api.txt", { cache: "no-store" })
    .then((r) => r.ok ? r.text() : "")
    .then((txt) => {
      const match = txt.match(/key\s*=\s*['"]([^'"]+)['"]/i);
      return match ? match[1].trim() : "";
    })
    .catch(() => "");
  return apiKeyPromise;
}

async function askAssistant(text) {
  addAiMessage("user", text);
  const typing = addTypingIndicator();
  const local = localAiAnswer(text);
  if (/^(Filtered|Reset|Opened|Generated|Switched|Exported|Cleared|Searched)/.test(local)) {
    removeTypingIndicator(typing);
    addAiMessage("bot", local);
    return;
  }
  if (!USE_REMOTE_AI) {
    removeTypingIndicator(typing);
    addAiMessage("bot", local);
    return;
  }
  const key = await loadApiKey();
  if (!key || Date.now() < apiDisabledUntil) {
    removeTypingIndicator(typing);
    addAiMessage("bot", local);
    return;
  }
  try {
    const prompt = `You are a Newark parcel dashboard analyst embedded in an HTML dashboard. The deterministic local engine has already computed a grounded answer. Use it as the source of truth; you may make the wording clearer, but do not change counts or invent parcel records. If the user asks to change the UI, recommend the exact dashboard control/tab/layer.\n\nDeterministic local answer:\n${local}\n\nDOM context:\n${dashboardContextText()}\n\nDataset facts:\n${datasetSummaryText()}\n${statusBreakdownText()}\n${exactBreakdown("ownership", "Ownership")}\n${exactBreakdown("zoning", "Zoning", 8)}\n${exactBreakdown("lbcsFunction", "LBCS function", 8, filtered.filter((f) => f.properties.lbcsFunction !== "Unknown"))}\n\nUser question: ${text}`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: prompt }),
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    removeTypingIndicator(typing);
    addAiMessage("bot", data.output_text || local);
    el("aiStatus").textContent = "API mode active with local dashboard actions.";
  } catch (error) {
    removeTypingIndicator(typing);
    if (String(error.message).includes("429")) {
      apiDisabledUntil = Date.now() + 10 * 60 * 1000;
      el("aiStatus").textContent = "API quota/rate limit hit. Using fast local dataset assistant for this session.";
      addAiMessage("bot", local);
    } else {
      addAiMessage("bot", `${local} API mode did not respond (${error.message}), so I used the local dataset assistant.`);
    }
  }
}

/*
function exportCsvOld() {
  const columns = [
    "id", "regridPath", "regridParcel", "block", "lot", "address", "owner", "ownership",
    "ownerSubtype", "ownerConfidence", "lbcsFunction", "lbcsOwnership", "landUse", "vacancy",
    "vacancyMethod", "assessed", "landValue", "improvementValue", "lastYearTaxes", "salePrice", "yearConstructed", "lotAcres", "landDescription", "zoning",
    "ward", "neighborhood", "latitude", "longitude", "censusTract", "censusBlock",
    "censusBlockGroup", "censusZcta", "medianHouseholdIncome", "populationDensity",
    "housingAffordabilityIndex", "opportunity"
  ];
  const rows = filtered.map((feature) => columns.map((column) => {
    const value = feature.properties[column] ?? "";
    return `"${String(value).replaceAll('"', '""')}"`;
  }).join(","));
  const csv = [columns.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "newark_filtered_parcels.csv";
  a.click();
  URL.revokeObjectURL(url);
}
*/

syncDashboardGlobals();
initMap();
initFilters();
initTabs();
el("exportCsv").addEventListener("click", exportCsv);
el("exportVisible").addEventListener("click", exportCsv);
el("exportSelected").addEventListener("click", exportSelectedCsv);
el("exportSelectedDock").addEventListener("click", exportSelectedCsv);
el("exportReport").addEventListener("click", exportReport);
el("clearSelected").addEventListener("click", () => {
  selectedIds.clear();
  updateSelectionUi();
  renderParcelList();
  if (parcelLayer) parcelLayer.setStyle(parcelStyle);
});
el("closeParcelModal").addEventListener("click", closeParcelRecord);
el("parcelModal").addEventListener("click", (event) => {
  if (event.target === el("parcelModal")) closeParcelRecord();
});
el("selectRecordParcel").addEventListener("click", () => {
  if (activeRecord) toggleSelected(activeRecord.id);
  if (activeRecord) el("selectRecordParcel").textContent = selectedIds.has(activeRecord.id) ? "Remove selection" : "Select parcel";
});
el("exportSingleParcel").addEventListener("click", exportActiveSingleCsv);
el("exportParcelJson").addEventListener("click", exportActiveJson);

function positionAiPanel() {
  const launcher = el("aiLauncher");
  const panel = el("aiPanel");
  if (!launcher || !panel || panel.classList.contains("gone")) return;
  const rect = launcher.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 28);
  const height = Math.min(window.innerHeight - 28, 520);
  const left = Math.max(14, Math.min(window.innerWidth - width - 14, rect.left + rect.width + 12));
  const fallbackLeft = Math.max(14, rect.left - width - 12);
  const finalLeft = rect.left + rect.width + width + 26 <= window.innerWidth ? left : fallbackLeft;
  const top = Math.max(14, Math.min(window.innerHeight - height - 14, rect.top));
  panel.style.left = `${finalLeft}px`;
  panel.style.right = "auto";
  panel.style.top = `${top}px`;
  panel.style.maxHeight = `${height}px`;
}

function restoreAiLauncherPosition() {
  const launcher = el("aiLauncher");
  if (!launcher) return;
  try {
    const saved = JSON.parse(localStorage.getItem("newarkAiLauncherPosition") || "null");
    if (!saved) return;
    const left = Math.max(8, Math.min(window.innerWidth - 66, saved.left));
    const top = Math.max(8, Math.min(window.innerHeight - 66, saved.top));
    launcher.style.left = `${left}px`;
    launcher.style.top = `${top}px`;
    launcher.style.right = "auto";
  } catch {
    localStorage.removeItem("newarkAiLauncherPosition");
  }
}

function setAiLauncherDock(position) {
  const launcher = el("aiLauncher");
  if (!launcher) return;
  const margin = 20;
  const w = launcher.offsetWidth || 58;
  const h = launcher.offsetHeight || 58;
  const slots = {
    "top-left": { left: margin, top: 96 },
    "top-right": { left: window.innerWidth - w - margin, top: 96 },
    "mid-left": { left: margin, top: Math.round((window.innerHeight - h) / 2) },
    "mid-right": { left: window.innerWidth - w - margin, top: Math.round((window.innerHeight - h) / 2) },
    "bottom-left": { left: margin, top: window.innerHeight - h - 48 },
    "bottom-right": { left: window.innerWidth - w - margin, top: window.innerHeight - h - 48 },
  };
  const slot = slots[position] || slots["top-right"];
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, slot.left));
  const top = Math.max(8, Math.min(window.innerHeight - h - 8, slot.top));
  launcher.style.left = `${left}px`;
  launcher.style.top = `${top}px`;
  launcher.style.right = "auto";
  localStorage.setItem("newarkAiLauncherPosition", JSON.stringify({ left, top }));
  positionAiPanel();
}

function initDraggableAiLauncher() {
  const launcher = el("aiLauncher");
  if (!launcher) return;
  restoreAiLauncherPosition();
  let drag = null;
  launcher.addEventListener("pointerdown", (event) => {
    const rect = launcher.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const left = Math.max(8, Math.min(window.innerWidth - launcher.offsetWidth - 8, event.clientX - drag.offsetX));
    const top = Math.max(8, Math.min(window.innerHeight - launcher.offsetHeight - 8, event.clientY - drag.offsetY));
    if (Math.abs(left - launcher.getBoundingClientRect().left) > 2 || Math.abs(top - launcher.getBoundingClientRect().top) > 2) {
      drag.moved = true;
      launcher.classList.add("dragging");
    }
    launcher.style.left = `${left}px`;
    launcher.style.top = `${top}px`;
    launcher.style.right = "auto";
    positionAiPanel();
  });
  launcher.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = launcher.getBoundingClientRect();
    localStorage.setItem("newarkAiLauncherPosition", JSON.stringify({ left: rect.left, top: rect.top }));
    launcher.classList.remove("dragging");
    const moved = drag.moved;
    drag = null;
    if (moved) {
      launcher.dataset.dragSuppress = String(Date.now() + 250);
      event.preventDefault();
      event.stopPropagation();
    }
  });
  window.addEventListener("resize", () => {
    restoreAiLauncherPosition();
    positionAiPanel();
  });
}

function enterDashboard() {
  dashboardEntered = true;
  el("loginScreen").classList.add("authenticating");
  setTimeout(() => {
    el("loginScreen").classList.add("gone");
    el("loginScreen").classList.remove("authenticating");
    map.invalidateSize();
    renderMap();
    if (parcelLayer) fitVisible();
  }, 720);
}

function validateLogin() {
  const password = el("loginPassword").value.trim();
  const card = document.querySelector(".login-card");
  el("loginError").textContent = "";
  card.classList.remove("invalid");
  if (password !== "Newark") {
    el("loginError").textContent = "Password must be Newark.";
    card.classList.add("invalid");
    setTimeout(() => card.classList.remove("invalid"), 360);
    el("loginPassword").focus();
    return;
  }
  enterDashboard();
}

el("enterDashboard").addEventListener("click", validateLogin);
el("loginPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") validateLogin();
});
initDraggableAiLauncher();
document.querySelectorAll("[data-ai-dock]").forEach((button) => {
  button.addEventListener("click", () => setAiLauncherDock(button.dataset.aiDock));
});
el("aiLauncher").addEventListener("click", () => {
  if (Number(el("aiLauncher").dataset.dragSuppress || 0) > Date.now()) return;
  el("aiPanel").classList.toggle("gone");
  positionAiPanel();
});
el("closeAi").addEventListener("click", () => el("aiPanel").classList.add("gone"));
el("aiForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = el("aiInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  askAssistant(text);
});
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => askAssistant(button.dataset.prompt));
});
fuseSearch = initFuseSearch();
el("aiStatus").textContent = fuseSearch
  ? "No-token local assistant active with Fuse.js fuzzy matching. Counts come from the loaded parcel dataset."
  : "No-token local assistant active. Exact answers come from the loaded parcel dataset.";
applyFilters();





