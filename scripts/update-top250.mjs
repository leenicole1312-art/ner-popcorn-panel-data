import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUTPUT_PATH = new URL("../data/top250.json", import.meta.url);
const CHART_URL = "https://www.imdb.com/chart/top/?ref_=nv_mv_250";
const EXPECTED_COUNT = 250;

const cleanText = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const parseYear = (v) => {
  const m = cleanText(v).match(/\b(18|19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
};
const parseRating = (v) => {
  const m = cleanText(v).match(/\b\d(?:\.\d)?\b/);
  return m ? Number(m[0]) : null;
};

function validateFilms(films) {
  if (!Array.isArray(films) || films.length !== EXPECTED_COUNT) {
    throw new Error(`Expected ${EXPECTED_COUNT} films, found ${films?.length ?? 0}.`);
  }
  const ids = new Set();
  const ranks = new Set();
  for (const film of films) {
    if (!/^tt\d{7,10}$/.test(film.imdbId)) throw new Error(`Invalid IMDb ID: ${film.imdbId}`);
    if (!Number.isInteger(film.rank) || film.rank < 1 || film.rank > EXPECTED_COUNT) {
      throw new Error(`Invalid rank for ${film.imdbId}: ${film.rank}`);
    }
    if (!film.title) throw new Error(`Missing title for ${film.imdbId}`);
    if (ids.has(film.imdbId)) throw new Error(`Duplicate IMDb ID: ${film.imdbId}`);
    if (ranks.has(film.rank)) throw new Error(`Duplicate rank: ${film.rank}`);
    ids.add(film.imdbId);
    ranks.add(film.rank);
  }
}

async function readPreviousPayload() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function scrapeTop250() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "en-GB",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
  });

  try {
    await page.goto(CHART_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector("li.ipc-metadata-list-summary-item", { timeout: 60000 });

    const raw = await page.locator("li.ipc-metadata-list-summary-item").evaluateAll((items) =>
      items.map((item, index) => {
        const link = item.querySelector('a[href*="/title/tt"]');
        const href = link?.getAttribute("href") ?? "";
        const imdbId = href.match(/tt\d{7,10}/)?.[0] ?? "";
        const heading = item.querySelector("h3.ipc-title__text")?.textContent ?? "";
        const title = heading.replace(/^\s*\d+\.\s*/, "").trim();
        const metadata = Array.from(item.querySelectorAll(".cli-title-metadata-item"))
          .map((node) => node.textContent?.trim() ?? "");
        const ratingText =
          item.querySelector('[data-testid="ratingGroup--imdb-rating"]')?.textContent ??
          item.querySelector(".ipc-rating-star--rating")?.textContent ?? "";
        return { imdbId, rank: index + 1, title, yearText: metadata[0] ?? "", ratingText };
      })
    );

    return raw.map((film) => ({
      imdbId: film.imdbId,
      rank: film.rank,
      title: cleanText(film.title),
      year: parseYear(film.yearText),
      imdbRating: parseRating(film.ratingText)
    }));
  } finally {
    await browser.close();
  }
}

const films = await scrapeTop250();
validateFilms(films);

const previous = await readPreviousPayload();
const payload = {
  schemaVersion: 1,
  source: "IMDb Top 250",
  sourceUrl: CHART_URL,
  generatedAt: new Date().toISOString(),
  previousGeneratedAt: previous?.generatedAt ?? null,
  count: films.length,
  films
};

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`Wrote ${films.length} validated films to data/top250.json.`);
