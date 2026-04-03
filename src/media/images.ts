import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ImageAsset } from "../types";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  src: {
    large2x?: string;
    large?: string;
    original?: string;
  };
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
}

interface CachedThemeImageRecord {
  sourceUrl: string;
  photoId: number;
  width: number;
  height: number;
  createdAt: string;
  lastUsedAt: string;
  localPath: string;
}

interface DownloadThemeImagesResult {
  assets: ImageAsset[];
  cacheHits: number;
  cacheMisses: number;
  remoteDownloads: number;
}

const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeThemeKey(theme: string): string {
  return theme
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "theme";
}

function cacheRootForTheme(theme: string): string {
  return path.resolve("cache", "theme-images", normalizeThemeKey(theme));
}

function cacheImagePath(root: string, photoId: number): string {
  return path.join(root, `${photoId}-1920x1080-q90.jpg`);
}

function cacheMetadataPath(root: string, photoId: number): string {
  return path.join(root, `${photoId}.json`);
}

async function loadCachedRecords(root: string): Promise<CachedThemeImageRecord[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  const records: CachedThemeImageRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const metadataPath = path.join(root, entry.name);
    try {
      const record = JSON.parse(await readFile(metadataPath, "utf8")) as CachedThemeImageRecord;
      const fileStats = await stat(record.localPath);
      const ageMs = now - fileStats.mtimeMs;
      if (!Number.isFinite(ageMs) || ageMs > CACHE_TTL_MS) {
        await Promise.allSettled([
          unlink(metadataPath),
          unlink(record.localPath),
        ]);
        continue;
      }
      records.push(record);
    } catch {
      await unlink(metadataPath).catch(() => undefined);
    }
  }
  records.sort((left, right) => left.photoId - right.photoId);
  return records;
}

async function updateCacheRecord(root: string, record: CachedThemeImageRecord): Promise<void> {
  await writeFile(cacheMetadataPath(root, record.photoId), JSON.stringify(record, null, 2), "utf8");
}

async function fetchSearch(url: string, apiKey: string): Promise<PexelsSearchResponse> {
  const response = await fetch(url, {
    headers: { Authorization: apiKey },
  });
  if (!response.ok) {
    throw new Error(`Pexels search failed (${response.status} ${response.statusText})`);
  }
  return (await response.json()) as PexelsSearchResponse;
}

async function downloadBuffer(url: string, retries: number): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Image download failed (${response.status} ${response.statusText})`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function downloadThemeImages(params: {
  theme: string;
  apiKey: string;
  imageDir: string;
  neededImages: number;
  onProgress?: (current: number, total: number) => void;
}): Promise<DownloadThemeImagesResult> {
  const assets: ImageAsset[] = [];
  const seen = new Set<number>();
  const cacheRoot = cacheRootForTheme(params.theme);
  await mkdir(cacheRoot, { recursive: true });
  let cacheHits = 0;
  let cacheMisses = 0;
  let remoteDownloads = 0;
  const cachedRecords = await loadCachedRecords(cacheRoot);
  for (const record of cachedRecords) {
    if (assets.length >= params.neededImages) {
      break;
    }
    seen.add(record.photoId);
    const outputPath = path.join(params.imageDir, `${String(assets.length + 1).padStart(4, "0")}-${record.photoId}.jpg`);
    await copyFile(record.localPath, outputPath);
    const updatedRecord = {
      ...record,
      lastUsedAt: new Date().toISOString(),
    };
    await updateCacheRecord(cacheRoot, updatedRecord);
    assets.push({
      id: String(record.photoId),
      sourceUrl: record.sourceUrl,
      localPath: outputPath,
      width: record.width,
      height: record.height,
    });
    cacheHits += 1;
    params.onProgress?.(assets.length, params.neededImages);
  }
  let page = 1;
  const perPage = Math.min(80, Math.max(params.neededImages, 15));

  while (assets.length < params.neededImages) {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", params.theme);
    url.searchParams.set("orientation", "landscape");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    const result = await fetchSearch(url.toString(), params.apiKey);
    if (!result.photos.length) {
      break;
    }

    for (const photo of result.photos) {
      if (assets.length >= params.neededImages) {
        break;
      }
      if (seen.has(photo.id)) {
        continue;
      }
      seen.add(photo.id);

      const sourceUrl = photo.src.large2x ?? photo.src.large ?? photo.src.original;
      if (!sourceUrl) {
        continue;
      }

      try {
        const input = await downloadBuffer(sourceUrl, 3);
        const cachedPath = cacheImagePath(cacheRoot, photo.id);
        await sharp(input)
          .rotate()
          .resize(1920, 1080, { fit: "cover", position: "attention" })
          .jpeg({ quality: 90, mozjpeg: true })
          .toFile(cachedPath);
        const outputPath = path.join(params.imageDir, `${String(assets.length + 1).padStart(4, "0")}-${photo.id}.jpg`);
        await copyFile(cachedPath, outputPath);
        const timestamp = new Date().toISOString();
        await updateCacheRecord(cacheRoot, {
          sourceUrl,
          photoId: photo.id,
          width: photo.width,
          height: photo.height,
          createdAt: timestamp,
          lastUsedAt: timestamp,
          localPath: cachedPath,
        });

        assets.push({
          id: String(photo.id),
          sourceUrl,
          localPath: outputPath,
          width: photo.width,
          height: photo.height,
        });
        cacheMisses += 1;
        remoteDownloads += 1;
        params.onProgress?.(assets.length, params.neededImages);
      } catch {
        continue;
      }
    }

    page += 1;
  }

  if (assets.length < params.neededImages) {
    throw new Error(`Unable to download enough themed images. Needed ${params.neededImages}, got ${assets.length}.`);
  }

  return {
    assets,
    cacheHits,
    cacheMisses,
    remoteDownloads,
  };
}
