/** Loads Maps JS API with Places library once per page (sandbox address autocomplete). */
let loadPromise: Promise<void> | null = null;

export function loadGoogleMapsPlacesScript(apiKey: string): Promise<void> {
  if (typeof google !== "undefined" && google.maps?.places) {
    return Promise.resolve();
  }
  if (!loadPromise) {
    loadPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Google Maps Script konnte nicht geladen werden"));
      document.head.appendChild(s);
    });
  }
  return loadPromise;
}
