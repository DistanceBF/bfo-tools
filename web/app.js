document.querySelectorAll("[data-url]").forEach((button) => {
  button.addEventListener("click", () => {
    const url = button.dataset.url;

    if (url) {
      window.location.href = url;
    }
  });
});

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
