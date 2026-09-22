document.querySelectorAll("[data-url]").forEach((button) => {
  button.addEventListener("click", () => {
    const url = button.dataset.url;

    if (url) {
      window.location.href = url;
    }
  });
});
