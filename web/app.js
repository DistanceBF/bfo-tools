document.querySelectorAll("[data-url]").forEach((button) => {
  button.addEventListener("click", () => {
    const url = button.dataset.url;

    if (url && !button.disabled) {
      window.location.href = url;
    }
  });
});

const newsDialog = document.getElementById("newsDialog");
async function loadNews() {
  const content = document.getElementById("newsContent");
  const refresh = document.getElementById("refreshNews");
  refresh.disabled = true;
  content.textContent = "Loading patch notes...";
  try {
    const response = await fetch("https://api.github.com/repos/DistanceBF/bfo-tools/releases?per_page=100", {
      headers: { Accept: "application/vnd.github+json" }, cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Could not load patch notes. Check your connection and try again.");
    const releases = (await response.json()).filter((release) => !release.draft && !release.prerelease);
    content.replaceChildren();
    if (!releases.length) content.textContent = "No patch notes published yet.";
    for (const release of releases) {
      const entry = document.createElement("article");
      entry.className = "news-entry";
      const title = document.createElement("h3");
      title.textContent = release.name || release.tag_name;
      const date = document.createElement("p");
      date.className = "muted small";
      date.textContent = release.published_at ? new Date(release.published_at).toLocaleDateString() : "";
      const notes = document.createElement("p");
      notes.textContent = release.body || "No notes provided for this release.";
      const link = document.createElement("a");
      link.href = `https://github.com/DistanceBF/bfo-tools/releases/tag/${encodeURIComponent(release.tag_name)}`;
      link.textContent = "View release on GitHub";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      entry.append(title, date, notes, link);
      content.append(entry);
    }
  } catch (error) {
    content.textContent = error.name === "TimeoutError" ? "Loading timed out. Please try again." : error.message;
  } finally {
    refresh.disabled = false;
  }
}
document.getElementById("openNews").addEventListener("click", () => {
  newsDialog.showModal();
  loadNews();
});
document.getElementById("closeNews").addEventListener("click", () => newsDialog.close());
document.getElementById("refreshNews").addEventListener("click", loadNews);

document.getElementById("checkUpdates").addEventListener("click", async () => {
  const status = document.getElementById("updateStatus");
  status.textContent = "Checking...";
  try {
    const response = await fetch("/api/update/check");
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "Update check failed");
    status.textContent = result.available ? `Update available: ${result.latest}` : (result.message || `Current: ${result.current}`);
    if (result.available && confirm(`Version ${result.latest} is available. Install it now? Your profile and missions will be preserved.`)) {
      status.textContent = "Updating...";
      const update = await fetch("/api/update/apply", {method: "POST"});
      const applied = await update.json();
      if (!update.ok || applied.error) throw new Error(applied.error || "Update failed");
      status.textContent = applied.message;
    }
  } catch (error) {
    status.textContent = error.message;
  }
});
