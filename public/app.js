const $ = (selector) => document.querySelector(selector);

const STATION_COLOURS = [
  "#d55e00", "#0072b2", "#009e73", "#cc79a7",
  "#e69f00", "#56b4e9", "#7a4da3", "#4d7c0f",
];

const state = {
  productId: null,
  date: "",
  time: "00",
  sources: new Set(),
  locations: new Set(),
  sourceOrder: [],
  stationOrder: [],
};

let config;
let catalog;
let assetIndex;
let dragItem = null;

const dashboard = $("#dashboard");
const productSelect = $("#product-select");
const fullscreenButton = $("#fullscreen-button");
const controls = $("#controls");
const fullscreenToolbar = $("#fullscreen-toolbar");
const productMeta = $("#product-meta");
const plots = $("#plots");
const status = $("#status");

init().catch((error) => {
  status.textContent = `Could not load dashboard data: ${error.message}`;
});

async function init() {
  [config, catalog] = await Promise.all([
    fetchJson("config/products.json"),
    fetchJson("catalog.json"),
  ]);

  assetIndex = new Map();

  for (const [productId, records] of Object.entries(catalog.products ?? {})) {
    for (const record of records) {
      assetIndex.set(assetKey(productId, record), record);
    }
  }

  for (const [id, product] of Object.entries(config.products)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = product.label;
    productSelect.append(option);
  }

  productSelect.addEventListener("change", () => selectProduct(productSelect.value));
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreen);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} (${response.status})`);
  return response.json();
}

function selectProduct(productId) {
  state.productId = productId || null;
  plots.replaceChildren();

  if (!state.productId) {
    controls.hidden = true;
    productMeta.hidden = true;
    fullscreenButton.disabled = true;
    status.textContent = "Select a product to start.";
    return;
  }

  const product = currentProduct();
  const dates = availableDates(state.productId);
  const hours = availableHours(product);

  state.date = dates.at(-1) ?? new Date().toISOString().slice(0, 10);
  state.time = latestTime(state.productId, state.date) ?? hours[0] ?? "00";
  state.sources = new Set(product.defaultSources ?? [config.observationSource]);
  state.locations = new Set(product.defaultLocations ?? []);
  state.sourceOrder = [...sourceIds(product)];
  state.stationOrder = (product.locations ?? []).map((location) => location.id);

  controls.hidden = false;
  productMeta.hidden = false;
  fullscreenButton.disabled = false;

  renderMeta();
  refresh();
}

function refresh() {
  renderControls();
  renderFullscreenToolbar();
  renderPlots();
}

function currentProduct() {
  return config.products[state.productId];
}

function records(productId) {
  return catalog.products?.[productId] ?? [];
}

function assetKey(productId, record) {
  return [
    productId,
    record.source,
    record.date,
    record.time ?? "",
    record.location ?? "",
  ].join("|");
}

function assetFor(productId, source, date, time = "", location = "") {
  return assetIndex.get(assetKey(productId, {
    source,
    date,
    time,
    location,
  }));
}

function sourceIds(product) {
  return product.sources ?? config.sources.map((source) => source.id);
}

function sourceLabel(id) {
  return config.sources.find((source) => source.id === id)?.label ?? id;
}

function availableDates(productId) {
  return [...new Set(records(productId).map((record) => record.date))].sort();
}

function latestTime(productId, date) {
  return records(productId)
    .filter((record) => record.date === date && record.time)
    .map((record) => record.time)
    .sort()
    .at(-1);
}

function availableHours(product) {
  const configured = [];

  if (product.hours) {
    for (let hour = product.hours.start; hour <= product.hours.end; hour += 1) {
      configured.push(String(hour).padStart(2, "0"));
    }
  }

  const detected = records(state.productId)
    .map((record) => record.time)
    .filter(Boolean);

  return [...new Set([...configured, ...detected])].sort();
}

function orderItems(order, allowedIds) {
  return [
    ...order.filter((id) => allowedIds.includes(id)),
    ...allowedIds.filter((id) => !order.includes(id)),
  ];
}

function selectedSources() {
  const product = currentProduct();
  const selected = sourceIds(product).filter((id) => state.sources.has(id));
  return orderItems(state.sourceOrder, selected);
}

function selectedLocations() {
  const product = currentProduct();
  const selected = product.locations
    .filter((location) => state.locations.has(location.id))
    .map((location) => location.id);

  const order = orderItems(state.stationOrder, selected);

  return order.map((id) =>
    product.locations.find((location) => location.id === id),
  );
}

function renderMeta() {
  const product = currentProduct();
  productMeta.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = product.label;
  productMeta.append(title);

  if (product.description) {
    const description = document.createElement("p");
    description.textContent = product.description;
    productMeta.append(description);
  }
}

function renderControls() {
  const product = currentProduct();
  const dates = availableDates(state.productId);

  controls.innerHTML = `
    <label>
      Date
      <input id="date-input" type="date" value="${state.date}">
      <small>
        ${dates.length ? `Detected dates: ${dates.slice(-6).join(", ")}` : "No graphics detected yet."}
      </small>
    </label>

    ${product.view === "map" ? timeControl("time-input") : ""}

    ${choiceGroup(
      "sources",
      "Models",
      orderItems(state.sourceOrder, sourceIds(product)).map((id) => ({
        id,
        label: sourceLabel(id),
      })),
      state.sources,
    )}

    ${product.view === "station"
      ? choiceGroup(
        "locations",
        "Locations",
        selectedLocationChoices(product),
        state.locations,
      )
      : ""}
  `;

  $("#date-input").addEventListener("change", (event) => {
    state.date = event.target.value;

    if (product.view === "map") {
      const hours = availableHours(product);
      state.time = latestTime(state.productId, state.date)
        ?? (hours.includes(state.time) ? state.time : hours[0]);
    }

    refresh();
  });

  bindTimeControls(controls, "#time-input");
  bindSelectionControls(controls);
}

function selectedLocationChoices(product) {
  const ids = orderItems(
    state.stationOrder,
    product.locations.map((location) => location.id),
  );

  return ids.map((id) => product.locations.find((location) => location.id === id));
}

function timeControl(selectId) {
  const hours = availableHours(currentProduct());
  const currentIndex = hours.indexOf(state.time);

  return `
    <label>
      UTC hour
      <div class="time-control">
        <button
          type="button"
          data-time-step="-1"
          aria-label="Previous hour"
          ${currentIndex <= 0 ? "disabled" : ""}
        >←</button>

        <select id="${selectId}">
          ${hours.map((hour) => `
            <option value="${hour}" ${hour === state.time ? "selected" : ""}>
              ${hour}:00
            </option>
          `).join("")}
        </select>

        <button
          type="button"
          data-time-step="1"
          aria-label="Next hour"
          ${currentIndex === -1 || currentIndex >= hours.length - 1 ? "disabled" : ""}
        >→</button>
      </div>
    </label>
  `;
}

function choiceGroup(target, title, items, selected) {
  return `
    <fieldset>
      <legend>${title}</legend>

      <div class="choice-actions">
        <button type="button" data-target="${target}" data-action="all">All</button>
        <button type="button" data-target="${target}" data-action="none">None</button>
      </div>

      <div class="choices">
        ${items.map((item) => `
          <label>
            <input
              type="checkbox"
              value="${item.id}"
              data-target="${target}"
              ${selected.has(item.id) ? "checked" : ""}
            >
            ${item.label}
          </label>
        `).join("")}
      </div>
    </fieldset>
  `;
}

function bindTimeControls(container, selector) {
  container.querySelector(selector)?.addEventListener("change", (event) => {
    state.time = event.target.value;
    refresh();
  });

  container.querySelectorAll("[data-time-step]").forEach((button) => {
    button.addEventListener("click", () => {
      moveTime(Number(button.dataset.timeStep));
    });
  });
}

function moveTime(step) {
  const hours = availableHours(currentProduct());
  const index = hours.indexOf(state.time);
  const next = index + step;

  if (next < 0 || next >= hours.length) return;

  state.time = hours[next];
  refresh();
}

function bindSelectionControls(container) {
  container.querySelectorAll("input[type=checkbox][data-target]").forEach((input) => {
    input.addEventListener("change", () => {
      const selected = state[input.dataset.target];

      if (input.checked) selected.add(input.value);
      else selected.delete(input.value);

      refresh();
    });
  });

  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = currentProduct();
      const target = button.dataset.target;

      const ids = target === "sources"
        ? sourceIds(product)
        : product.locations.map((location) => location.id);

      state[target] = new Set(button.dataset.action === "all" ? ids : []);
      refresh();
    });
  });
}

function renderPlots() {
  plots.replaceChildren();

  if (!state.productId) return;

  const product = currentProduct();
  const sources = selectedSources();

  if (!sources.length) {
    status.textContent = "Select at least one model.";
    return;
  }

  if (product.view === "map") renderMap(sources);
  else renderStations(product, sources);
}

function renderMap(sources) {
  const available = sources.some((source) =>
    assetFor(state.productId, source, state.date, state.time),
  );

  status.textContent = available
    ? `${state.date}, ${state.time}:00 UTC`
    : `No graphics available for ${state.date}, ${state.time}:00 UTC.`;

  plots.append(modelMosaic(
    sources,
    (source) => plotCard(
      `${sourceLabel(source)} · ${state.time}:00 UTC`,
      assetFor(state.productId, source, state.date, state.time),
    ),
    "sources",
  ));
}

function renderStations(product, sources) {
  const locations = selectedLocations();

  if (!locations.length) {
    status.textContent = "Select at least one location.";
    return;
  }

  const available = locations.some((location) =>
    sources.some((source) =>
      assetFor(state.productId, source, state.date, "", location.id),
    ),
  );

  status.textContent = available
    ? `${state.date} · 00–24 UTC`
    : `No graphics available for ${state.date}.`;

  const layout = document.createElement("div");
  layout.className = `station-layout ${
    product.minimap ? "has-overview" : "no-overview"
  }`;

  /*
   * Lidar has one shared location overview/minimap.
   * Radiosonde currently has no minimap, as configured in products.json.
   */
  if (product.minimap) {
    layout.append(stationOverview(product, locations));
  }

  /*
   * Reuse the same mosaic layout used for map-model views.
   *
   * Examples:
   * - 1 station: one full card
   * - 2 stations: two columns
   * - 3 stations: one card left, two stacked cards right
   * - 4 stations: 2 + 2
   * - 5 stations: 2 + 3
   *
   * Dragging one station card onto another swaps whole station cards.
   */
  const stationMosaic = modelMosaic(
    locations,
    (location) => stationCard(product, location, sources),
    "locations",
  );

  stationMosaic.classList.add("station-mosaic");

  const scroll = document.createElement("div");
  scroll.className = "station-board-scroll";
  scroll.append(stationMosaic);

  layout.append(scroll);
  plots.append(layout);
}

function stationCard(product, location, sources) {
  const card = document.createElement("article");
  card.className = "station-card";

  const header = document.createElement("header");
  const title = document.createElement("h3");

  if (product.minimap) {
    title.append(stationMarker(product, location.id, selectedLocations()));
  }

  title.append(document.createTextNode(location.label));
  header.append(title);
  card.append(header);

  /*
   * Passing "sources" makes individual model panels draggable.
   *
   * The source order is global for the current product view:
   * swapping obs and claef1k_ref in one station updates every open station.
   */
  const models = modelMosaic(
    sources,
    (source) => plotCard(
      sourceLabel(source),
      assetFor(
        state.productId,
        source,
        state.date,
        "",
        location.id,
      ),
    ),
    "sources",
  );

  models.classList.add("station-model-mosaic");
  card.append(models);

  return card;
}


function modelMosaic(sources, renderCard, reorderKind = null) {
  const groups = mosaicGroups(sources);
  const largestStack = Math.max(...groups.map((group) => group.length));

  const mosaic = document.createElement("section");
  mosaic.className = "model-mosaic";
  mosaic.style.gridTemplateColumns = groups
    .map((group) => `${largestStack / group.length}fr`)
    .join(" ");

  for (const group of groups) {
    const column = document.createElement("div");
    column.className = "mosaic-column";
    column.style.setProperty("--stack-size", group.length);

    for (const source of group) {
      const card = renderCard(source);

      if (reorderKind) {
        makeSortable(card, reorderKind, source);
      }

      column.append(card);
    }

    mosaic.append(column);
  }

  return mosaic;
}

function mosaicGroups(items) {
  if (items.length <= 2) return items.map((item) => [item]);
  if (items.length === 3) return [[items[0]], [items[1], items[2]]];
  if (items.length === 4) return [[items[0], items[1]], [items[2], items[3]]];
  if (items.length === 5) return [[items[0], items[1]], [items[2], items[3], items[4]]];

  const leftCount = Math.ceil(items.length / 2);
  return [items.slice(0, leftCount), items.slice(leftCount)];
}

function plotCard(label, record) {
  const card = document.createElement("figure");
  card.className = "plot-card";

  const caption = document.createElement("figcaption");
  caption.textContent = label;
  card.append(caption);

  const frame = document.createElement("div");
  frame.className = "plot-frame";

  if (!record) {
    frame.append(missingMessage());
  } else {
    const link = document.createElement("a");
    link.href = imageUrl(record.file);
    link.target = "_blank";
    link.rel = "noopener";
    link.draggable = false;

    const image = document.createElement("img");
    image.src = imageUrl(record.file);
    image.alt = label;
    image.loading = "lazy";
    image.draggable = false;

    image.addEventListener("error", () => {
      frame.replaceChildren(missingMessage());
    });

    link.append(image);
    frame.append(link);
  }

  card.append(frame);
  return card;
}

function missingMessage() {
  const message = document.createElement("div");
  message.className = "missing";
  message.textContent = "Image not available";
  return message;
}

function makeSortable(element, type, id) {
  element.draggable = true;
  element.classList.add("sortable");

  element.addEventListener("dragstart", (event) => {
    /*
     * Important for nested sortable elements:
     *
     * Model plots live inside draggable station cards. Without stopping
     * propagation, starting to drag a model plot also starts a drag on its
     * parent station card, overwriting dragItem with a location drag.
     */
    event.stopPropagation();

    dragItem = { type, id };
    element.classList.add("dragging");

    event.dataTransfer.effectAllowed = "move";

    /*
     * Some browsers require a text payload before they allow a drop.
     * Keep both a dashboard-specific payload and plain text fallback.
     */
    const payload = JSON.stringify({ type, id });

    event.dataTransfer.setData("application/x-weather-dashboard-sort", payload);
    event.dataTransfer.setData("text/plain", payload);
  });

  element.addEventListener("dragend", (event) => {
    event.stopPropagation();

    dragItem = null;

    document.querySelectorAll(".drag-over, .dragging").forEach((item) => {
      item.classList.remove("drag-over", "dragging");
    });
  });

  element.addEventListener("dragover", (event) => {
    if (!dragItem || dragItem.type !== type || dragItem.id === id) {
      return;
    }

    /*
     * preventDefault() is required to mark this element as a valid drop
     * target in browser native drag-and-drop.
     */
    event.preventDefault();
    event.stopPropagation();

    event.dataTransfer.dropEffect = "move";
    element.classList.add("drag-over");
  });

  element.addEventListener("dragenter", (event) => {
    if (!dragItem || dragItem.type !== type || dragItem.id === id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    element.classList.add("drag-over");
  });

  element.addEventListener("dragleave", (event) => {
    event.stopPropagation();

    /*
     * Do not remove the visual drop state just because the pointer entered
     * a child element, such as an image or caption inside the plot tile.
     */
    if (!element.contains(event.relatedTarget)) {
      element.classList.remove("drag-over");
    }
  });

  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();

    let dragged = dragItem;

    /*
     * Use the stored payload as a fallback. This also makes the behavior
     * more robust if a browser does not preserve the global drag state.
     */
    if (!dragged) {
      const rawPayload =
        event.dataTransfer.getData("application/x-weather-dashboard-sort") ||
        event.dataTransfer.getData("text/plain");

      try {
        dragged = JSON.parse(rawPayload);
      } catch {
        dragged = null;
      }
    }

    element.classList.remove("drag-over");

    if (!dragged || dragged.type !== type || dragged.id === id) {
      return;
    }

    swapOrder(type, dragged.id, id);
  });
}

function swapOrder(type, firstId, secondId) {
  const order = type === "sources" ? state.sourceOrder : state.stationOrder;
  const firstIndex = order.indexOf(firstId);
  const secondIndex = order.indexOf(secondId);

  if (firstIndex === -1 || secondIndex === -1) return;

  [order[firstIndex], order[secondIndex]] = [order[secondIndex], order[firstIndex]];
  refresh();
}

function stationColour(product, locationId) {
  const index = product.locations.findIndex((location) => location.id === locationId);
  return STATION_COLOURS[index % STATION_COLOURS.length];
}

function stationMarker(product, locationId, locations) {
  const marker = document.createElement("span");
  marker.className = "station-marker";
  marker.style.setProperty("--station-colour", stationColour(product, locationId));
  marker.textContent = locations.findIndex((location) => location.id === locationId) + 1;
  return marker;
}

function stationOverview(product, locations) {
  const overview = document.createElement("section");
  overview.className = "station-overview";

  overview.append(minimap(product, locations));

  const legend = document.createElement("div");
  legend.className = "station-legend";

  for (const location of locations) {
    const item = document.createElement("div");
    item.className = "station-legend-item";
    item.append(stationMarker(product, location.id, locations));
    item.append(document.createTextNode(location.label));
    legend.append(item);
  }

  overview.append(legend);
  return overview;
}

function minimap(product, selectedLocations) {
  const allLocations = product.locations.filter((location) => location.coordinates);
  const selectedIds = new Set(selectedLocations.map((location) => location.id));

  const lons = allLocations.map((location) => location.coordinates[0]);
  const lats = allLocations.map((location) => location.coordinates[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("minimap");
  svg.setAttribute("viewBox", "0 0 150 100");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Schematic station map");
  svg.innerHTML = `<rect x="4" y="4" width="142" height="92" rx="5"></rect>`;

  for (const location of allLocations) {
    const [lon, lat] = location.coordinates;
    const x = 12 + ((lon - minLon) / (maxLon - minLon || 1)) * 126;
    const y = 88 - ((lat - minLat) / (maxLat - minLat || 1)) * 76;
    const selected = selectedIds.has(location.id);

    const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    point.setAttribute("cx", x);
    point.setAttribute("cy", y);
    point.setAttribute("r", selected ? "6" : "3");
    point.setAttribute("class", selected ? "selected" : "other");

    if (selected) {
      point.setAttribute("fill", stationColour(product, location.id));
    }

    svg.append(point);

    if (selected) {
      const number = document.createElementNS("http://www.w3.org/2000/svg", "text");
      number.setAttribute("x", x);
      number.setAttribute("y", y + 2.7);
      number.setAttribute("text-anchor", "middle");
      number.textContent = selectedLocations.findIndex(
        (item) => item.id === location.id,
      ) + 1;
      svg.append(number);
    }
  }

  return svg;
}

function imageUrl(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function toggleFullscreen() {
  if (document.fullscreenElement === dashboard) {
    await document.exitFullscreen();
  } else {
    await dashboard.requestFullscreen();
  }
}

function syncFullscreen() {
  const active = document.fullscreenElement === dashboard;
  fullscreenButton.textContent = active ? "Exit fullscreen" : "⛶ Fullscreen";
  renderFullscreenToolbar();
  renderPlots();
}

function renderFullscreenToolbar() {
  const active = document.fullscreenElement === dashboard;

  fullscreenToolbar.hidden = !active || !state.productId;

  if (!active || !state.productId) {
    fullscreenToolbar.replaceChildren();
    return;
  }

  const product = currentProduct();

  fullscreenToolbar.innerHTML = `
    <div class="fullscreen-toolbar-header">
      <strong>Controls</strong>
      <button type="button" data-exit-fullscreen title="Exit fullscreen">×</button>
    </div>

    ${product.view === "map" ? `
      <section class="fullscreen-control-group">
        ${timeControl("fullscreen-time-input")}
      </section>
    ` : ""}

    ${fullscreenChoiceGroup(
      "sources",
      "Models",
      orderItems(state.sourceOrder, sourceIds(product)).map((id) => ({
        id,
        label: sourceLabel(id),
      })),
      state.sources,
    )}

    ${product.view === "station"
      ? fullscreenChoiceGroup(
        "locations",
        "Locations",
        selectedLocationChoices(product),
        state.locations,
      )
      : ""}
  `;

  fullscreenToolbar.querySelector("[data-exit-fullscreen]").addEventListener("click", () => {
    document.exitFullscreen();
  });

  bindTimeControls(fullscreenToolbar, "#fullscreen-time-input");
  bindSelectionControls(fullscreenToolbar);
}

function fullscreenChoiceGroup(target, title, items, selected) {
  return `
    <section class="fullscreen-control-group">
      <div class="fullscreen-control-heading">
        <strong>${title}</strong>
        <span>
          <button type="button" data-target="${target}" data-action="all">All</button>
          <button type="button" data-target="${target}" data-action="none">None</button>
        </span>
      </div>

      <div class="fullscreen-choices">
        ${items.map((item) => `
          <label>
            <input
              type="checkbox"
              value="${item.id}"
              data-target="${target}"
              ${selected.has(item.id) ? "checked" : ""}
            >
            ${item.label}
          </label>
        `).join("")}
      </div>
    </section>
  `;
}
