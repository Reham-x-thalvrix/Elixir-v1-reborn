/* Elixir V1 - loader (isolated world) - made by Thalvrix */
(() => {
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("core.js");
    s.onload = () => s.remove();
    s.onerror = () => console.warn("[Elixir V1] injector failed to load");
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    console.warn("[Elixir V1] loader error", e);
  }
})();
