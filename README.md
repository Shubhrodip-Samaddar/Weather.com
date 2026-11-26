# Station Log — Real-Time Weather Lookup

A dependency-free weather app styled like a weather station instrument panel. A "barograph" trace draws itself behind the current temperature, and an ambient canvas animation (rain, snow, fog, thunder, stars, sun) reflects the live conditions at whatever location you're viewing.

> 💡 Add a screenshot (e.g. `preview.png`) to the repo and place `![Preview](preview.png)` here. Load a rainy or stormy city first so the animation shows.

**Live demo:** `https://<your-username>.github.io/<repo-name>/`

## Features

- 🔍 **Search any city or country** with a live autocomplete dropdown (debounced, up to 6 matches, keyboard navigable)
- 📍 **Auto-detects your location** on open, shows the real city name, and falls back gracefully if permission is denied
- 🌦️ **Weather-driven animation** in the hero card: rain (light/moderate/heavy), snow, fog, thunderstorm with lightning flashes, clear day sun glow, clear night stars, cloudy/overcast drifting clouds
- 📅 **10-day forecast** plus a 24-hour hourly strip
- 🌡️ Instant **°C / °F** toggle (no refetch)
- 💨 **Wind speed & direction, humidity, pressure, visibility**
- 🏭 **Air Quality Index (US AQI)** with colour-coded category
- 🌅 **Sunrise & sunset** times in the location's local time
- 📈 Animated SVG barograph generated from the next 24h of temperature data

## Tech

- Vanilla JavaScript (`fetch`, `async/await`, `Promise.all`, `AbortController`, Canvas 2D, Geolocation API)
- Vanilla CSS (custom properties, grid/flexbox, `prefers-reduced-motion` support)
- Free, keyless APIs:
  - [Open-Meteo Forecast](https://open-meteo.com/en/docs)
  - [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api)
  - [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api)
  - [BigDataCloud Reverse Geocoding](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api)
- Fonts: Fraunces, Inter, JetBrains Mono

No API keys, backend, or build step, just three static files.

## Engineering notes

- Forecast and air-quality requests run **in parallel** with `Promise.all`; AQI failing never blocks the main reading.
- Search suggestions are **debounced** and in-flight requests are **cancelled** with `AbortController` to avoid stale results.
- Unit toggling re-renders from cached data instead of refetching.
- Weather condition (WMO code + day/night flag) maps to an animation mode; the canvas loop is resized on window changes and swapped when a new location loads.

## Running locally

```bash
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>

# any static server works
npx serve .
# or
python3 -m http.server 8000
```

In VS Code you can also install **Live Server**, then right-click `index.html` → **Open with Live Server**.

## Project structure

```
├── index.html   # markup
├── style.css    # design tokens, layout, components
├── app.js       # data fetching, rendering, search, canvas animation
└── README.md
```

## Deploying to GitHub Pages

1. Push the folder to a GitHub repo.
2. Go to **Settings → Pages**.
3. Set **Source** to your default branch, root folder.
4. Your app goes live at `https://<your-username>.github.io/<repo-name>/`.

## Credits

Weather, air quality, and geocoding data by [Open-Meteo](https://open-meteo.com/). Reverse geocoding by [BigDataCloud](https://www.bigdatacloud.com/).

## License

MIT
