"use strict";

const ids = [
  "enabled",
  "restoreMetadata",
  "restoreCollapsed",
  "forceCollapseOnRestore"
];

function showSavedIndicator() {
  const el = document.getElementById("save-indicator");
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 1200);
}

async function refreshStatus() {
  const status = await browser.runtime.sendMessage({ action: "getStatus" });
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const statsBox = document.getElementById("stats-box");
  const mainContent = document.getElementById("main-content");

  mainContent.classList.toggle("disabled", !status.settings.enabled);

  dot.className = "status-dot";
  if (!status.settings.enabled) {
    text.textContent = "Расширение отключено";
  } else {
    dot.classList.add("active");
    text.textContent = "Активно: пустые плашки скрываются автоматически";
  }

  const activeCount = status.stats ? status.stats.activeGroupsCount : 0;
  const savedCount = status.stats ? status.stats.savedHiddenGroupsCount : 0;
  statsBox.textContent = `Видимых нативных групп: ${activeCount} • Скрытых в других группах STG: ${savedCount}`;
}

async function saveCurrentForm() {
  const patch = {
    enabled: document.getElementById("enabled").checked,
    restoreMetadata: document.getElementById("restoreMetadata").checked,
    restoreCollapsed: document.getElementById("restoreCollapsed").checked,
    forceCollapseOnRestore: document.getElementById("forceCollapseOnRestore").checked
  };
  await browser.storage.local.set(patch);
  showSavedIndicator();
  setTimeout(refreshStatus, 50);
}

async function initPopup() {
  const status = await browser.runtime.sendMessage({ action: "getStatus" });
  const s = status.settings;

  document.getElementById("enabled").checked = !!s.enabled;
  document.getElementById("restoreMetadata").checked = !!s.restoreMetadata;
  document.getElementById("restoreCollapsed").checked = !!s.restoreCollapsed;
  document.getElementById("forceCollapseOnRestore").checked = !!s.forceCollapseOnRestore;

  await refreshStatus();

  for (const id of ids) {
    document.getElementById(id).addEventListener("change", saveCurrentForm);
  }

  document.getElementById("sync-btn").addEventListener("click", async () => {
    await browser.runtime.sendMessage({ action: "syncNow" });
    await refreshStatus();
    showSavedIndicator();
  });

  document.getElementById("reset-btn").addEventListener("click", async () => {
    await browser.runtime.sendMessage({ action: "resetDefaults" });
    await initPopup();
    showSavedIndicator();
  });
}

document.addEventListener("DOMContentLoaded", initPopup);
