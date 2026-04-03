import { createCanvas, loadImage } from "@napi-rs/canvas";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const TILESET_URL = "https://img.craftpix.net/2019/04/Forest-Top-Down-2D-Game-Tileset3.webp";
const FIXTURE_DIR = path.resolve("test", "fixtures", "tileset");
const SOURCE_PATH = path.join(FIXTURE_DIR, "forest-top-down-source.webp");
const OUTPUT_PATH = path.join(FIXTURE_DIR, "forest-scene.png");
const README_PATH = path.join(FIXTURE_DIR, "README.md");

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cropFromPercent(imageWidth: number, imageHeight: number, left: number, top: number, width: number, height: number): CropRect {
  return {
    x: Math.round(imageWidth * left),
    y: Math.round(imageHeight * top),
    width: Math.max(24, Math.round(imageWidth * width)),
    height: Math.max(24, Math.round(imageHeight * height)),
  };
}

async function fetchSource(): Promise<Buffer> {
  const response = await fetch(TILESET_URL);
  if (!response.ok) {
    throw new Error(`Unable to download tileset preview (${response.status} ${response.statusText})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  const source = await fetchSource();
  await writeFile(SOURCE_PATH, source);

  const image = await loadImage(source);
  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const grass = cropFromPercent(image.width, image.height, 0.03, 0.04, 0.13, 0.18);
  const pathTile = cropFromPercent(image.width, image.height, 0.18, 0.04, 0.13, 0.18);
  const water = cropFromPercent(image.width, image.height, 0.33, 0.04, 0.13, 0.18);
  const tree = cropFromPercent(image.width, image.height, 0.49, 0.03, 0.16, 0.22);
  const rock = cropFromPercent(image.width, image.height, 0.68, 0.05, 0.13, 0.18);
  const detail = cropFromPercent(image.width, image.height, 0.83, 0.36, 0.11, 0.16);

  const tileSize = 64;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      ctx.drawImage(image as any, grass.x, grass.y, grass.width, grass.height, column * tileSize, row * tileSize, tileSize, tileSize);
    }
  }

  for (let row = 0; row < 8; row += 1) {
    const crop = row % 2 === 0 ? pathTile : water;
    ctx.drawImage(image as any, crop.x, crop.y, crop.width, crop.height, 3 * tileSize, row * tileSize, tileSize, tileSize);
    if (row !== 3 && row !== 4) {
      ctx.drawImage(image as any, crop.x, crop.y, crop.width, crop.height, 4 * tileSize, row * tileSize, tileSize, tileSize);
    }
  }

  const wallPositions = [
    [0, 0], [1, 0], [2, 0], [5, 0], [6, 0], [7, 0],
    [0, 1], [7, 1], [0, 2], [7, 2], [0, 5], [7, 5], [0, 6], [7, 6],
    [0, 7], [1, 7], [2, 7], [5, 7], [6, 7], [7, 7],
  ];
  for (const [column, row] of wallPositions) {
    ctx.drawImage(image as any, tree.x, tree.y, tree.width, tree.height, column * tileSize, row * tileSize, tileSize, tileSize);
  }

  const rockPositions = [
    [1, 2], [6, 2], [1, 5], [6, 5], [2, 6], [5, 1],
  ];
  for (const [column, row] of rockPositions) {
    ctx.drawImage(image as any, rock.x, rock.y, rock.width, rock.height, column * tileSize, row * tileSize, tileSize, tileSize);
  }

  const detailPositions = [
    [2, 2], [5, 2], [2, 5], [5, 5], [3, 3], [4, 4], [2, 4], [5, 4],
  ];
  for (const [column, row] of detailPositions) {
    ctx.drawImage(image as any, detail.x, detail.y, detail.width, detail.height, column * tileSize + 8, row * tileSize + 8, tileSize - 16, tileSize - 16);
  }

  await writeFile(OUTPUT_PATH, await canvas.encode("png"));
  await writeFile(
    README_PATH,
    [
      "# Tileset Fixture",
      "",
      `Source preview URL: ${TILESET_URL}`,
      "",
      "- `forest-top-down-source.webp` is the one-time downloaded source preview used for fixture prep.",
      "- `forest-scene.png` is the deterministic derived fixture consumed by `src/media/edges.test.ts`.",
      "- Tests never hit the network; rerun `bun run scripts/prepare-edge-fixtures.ts` only when regenerating the fixture.",
    ].join("\n"),
  );

  console.log(`Wrote ${OUTPUT_PATH}`);
}

await main();
