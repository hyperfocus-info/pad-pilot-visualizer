#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { runCommand } from "../src/utils/process";

const DEFAULT_FILE_COUNT = 5;
const PROJECTS_DIR = path.join(homedir(), "Documents", "Image-Line", "FL Studio", "Projects");
const SUPPORTED_AUDIO_EXTENSIONS = new Set([".mp3", ".wav"]);
const THEME_BANK = [
  ["rainforest canopy", "sunset canyon", "alpine wildflower", "bioluminescent reef", "aurora glacier", "tropical waterfall", "desert bloom", "coral tidepool", "moonlit mangrove", "emerald fern grotto"],
  ["prism butterfly garden", "neon koi pond", "iridescent hummingbird", "rainbow mushroom grove", "stained glass jungle", "opal thunderstorm", "flamingo salt flats", "sapphire river delta", "golden sunflower field", "amethyst cave spring"],
  ["lavender meadow", "electric orchid forest", "citrus orchard", "rosy dawn coastline", "teal monsoon jungle", "violet lavender hills", "firefly marsh", "scarlet maple valley", "turquoise cenote", "glowing cactus garden"],
  ["peacock feather forest", "copper autumn creek", "fuchsia bougainvillea wall", "arctic aurora lake", "honeybee meadow", "pink salt lake", "jade bamboo grove", "sunlit coral garden", "wild iris riverbank", "golden aspen ridge"],
  ["moonflower desert", "indigo tide caves", "parrot tulip field", "misty redwood trail", "cobalt glacier lagoon", "papaya sunset beach", "hibiscus jungle rain", "berry nebula sky", "amber wheat field", "mint alpine lake"],
  ["dragonfruit grove", "lilac thunderclouds", "carnival reef fish", "mossy waterfall shrine", "tangerine canyon light", "crystal fern valley", "polar sky ribbons", "orchid volcano dusk", "marigold prairie", "shimmering lotus pond"],
  ["cerulean cliffside sea", "rose quartz desert", "jade monsoon valley", "copper canyon river", "glacier blue night", "fire opal rainforest", "violet jacaranda avenue", "cactus blossom sunrise", "sunbeam through leaves", "lush banana grove"],
  ["wild poppy hillside", "azure peacock lagoon", "coral flamingo estuary", "electric moss cave", "luminous birch forest", "saffron desert wind", "watermelon sugar orchard", "rainbow eucalyptus grove", "seafoam cliff garden", "gilded lily marsh"],
  ["tropical fruit market jungle", "storm-lit sunflower farm", "midnight orchid greenhouse", "aquamarine waterfall basin", "pink peony storm", "copper leaf forest floor", "ultraviolet tide line", "gold dust canyon", "candy-colored koi", "misty pine sunrise"],
  ["opal butterfly swarm", "nectarine blossom orchard", "stormy teal coastline", "bluebonnet prairie", "fire coral lagoon", "moonlit cherry grove", "canary wildflower trail", "verdant ravine", "pastel cactus valley", "glacial rainbow fog"],
  ["red hibiscus shoreline", "mango sunset jungle", "lapis lazuli river", "orchid haze mountain", "sunset dune garden", "glowing jellyfish cove", "sakura meadow", "rainbow trout stream", "mint blossom fields", "ember volcano flowers"],
  ["pearl cloud forest", "cobalt parakeet canopy", "rose garden rain", "amber tide marsh", "citrine canyon bloom", "violet storm surf", "lime fern undergrowth", "aurora meadow mist", "tropical lagoon palms", "scarlet macaw rainforest"],
  ["melon-colored twilight", "goldenrod field", "icy blue canyon", "palm oasis shimmer", "mulberry moon garden", "sunrise over lupines", "verdigris waterfall", "pink camellia grove", "deep sea anemones", "orange grove dusk"],
  ["indigo hydrangea path", "copper sunset lake", "rain-kissed lotus leaves", "mint and coral reef", "solar flare desert", "wild plum orchard", "sapphire ice cave", "painted desert sky", "firefly bamboo grove", "lush monstera jungle"],
  ["amaranth wildflower plain", "turquoise mangrove river", "cranberry bog glow", "violet lily pads", "kiwi green canyon", "poppy super bloom", "moonrise over dunes", "emerald tea terraces", "opal tide sunset", "lavender canyon rain"],
  ["paradise bird plumage", "rainbow lorikeet forest", "buttercup meadow creek", "blue morpho jungle", "dragonfly pond shimmer", "ruby canyon walls", "jade succulent garden", "glittering frost pines", "saffron sky savanna", "orchid mist waterfall"],
  ["tropic thunder clouds", "rose and gold horizon", "cyan alpine bloom", "coral sandstone arches", "willow river dawn", "amethyst mountain lake", "neon wildflower field", "peach blossom valley", "iris storm meadow", "moss and ember cliffs"],
  ["bioluminescent kelp forest", "sunlit tide pools", "pink magnolia rain", "emerald hummingbird garden", "teal canyon shadows", "burnt orange mesa", "lavender glacier dawn", "copper moss woodland", "citron fern canyon", "opal moon beach"],
  ["pastel marsh reeds", "scarlet sunset palms", "electric blue kingfisher", "butterfly conservatory vines", "mango grove moonrise", "prismatic waterfall spray", "roseate spoonbill wetlands", "storm over lavender fields", "turquoise desert river", "garnet autumn woods"],
  ["lemon grove sunlight", "violet sea cliffs", "crimson tide at dusk", "sagebrush super bloom", "polar dawn sky", "jungle orchids after rain", "nectar-rich meadow", "glowing canyon stream", "sea glass shoreline", "pearl waterfall mist"],
  ["cyan monsoon leaves", "golden acacia plain", "raspberry sunset clouds", "orchid-lined boardwalk", "teal mushroom forest", "sunrise coral atoll", "amber prairie thunder", "amethyst fern hollow", "frosted berry branches", "lush waterfall ravine"],
  ["mint aurora mountains", "tulip festival field", "copper and teal parrots", "springtime blossom tunnel", "moonlit reef garden", "cactus flowers at noon", "rainbow canyon strata", "sapphire lotus bloom", "orange monarch migration", "wild mint riverbank"],
  ["pink dawn over pines", "glowing desert night", "golden meadow breeze", "violet tide orchard", "indigo rainforest rain", "crystal blue fjord", "copper sunflower sunset", "emerald canyon oasis", "fire coral sunrise", "strawberry moon marsh"],
  ["storm-lit orchid canyon", "pastel sunrise dunes", "jade waterfall terrace", "rose quartz beach", "neon fern grotto", "scarlet poppy sea", "azure lagoon bloom", "gold leaf woodland", "bioluminescent mushroom trail", "lavender thunder horizon"],
  ["opal garden after rain", "teal and coral mangroves", "amber moon desert", "fuchsia alpine flowers", "silver-blue glacier stream", "sunset over palms", "rainbow mineral hot spring", "wildflower canyon road", "cobalt butterfly clouds", "emerald river mist"],
].flat();

if (THEME_BANK.length !== 250) {
  throw new Error(`Theme bank must contain exactly 250 entries, received ${THEME_BANK.length}.`);
}

interface FiestaRun {
  inputPath: string;
  theme: string;
  halftime: boolean;
  particleIntensity: number;
  outputFileName: string;
}

interface AudioCandidate {
  inputPath: string;
  baseName: string;
  canonicalName: string;
  version: number;
  extension: string;
}

function parseRequestedCount(argv: string[]): number {
  const rawCount = argv[2];
  if (rawCount === undefined) {
    return DEFAULT_FILE_COUNT;
  }

  if (argv.length > 3) {
    throw new Error("Fiesta accepts at most one optional argument: the number of files to process.");
  }

  const parsed = Number.parseInt(rawCount, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Fiesta file count must be a positive integer.");
  }

  return parsed;
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }
  return copy;
}

function sampleWithoutReplacement<T>(items: readonly T[], count: number): T[] {
  return shuffle(items).slice(0, Math.max(0, Math.min(count, items.length)));
}

function randomHalftime(): boolean {
  return Math.random() < 0.25;
}

function randomParticleIntensity(): number {
  return (10 + Math.floor(Math.random() * 21)) * 5;
}

function parseAudioCandidate(inputPath: string): AudioCandidate {
  const extension = path.extname(inputPath).toLowerCase();
  const baseName = path.basename(inputPath, extension);
  const versionMatch = /^(.*?)(?:_(\d+))?$/.exec(baseName);
  const canonicalName = versionMatch?.[2] ? (versionMatch[1] || baseName) : baseName;
  const version = versionMatch?.[2] ? Number.parseInt(versionMatch[2], 10) : 0;
  return {
    inputPath,
    baseName,
    canonicalName,
    version,
    extension,
  };
}

function extensionPriority(extension: string): number {
  return extension === ".mp3" ? 0 : extension === ".wav" ? 1 : 2;
}

function compareCandidates(left: AudioCandidate, right: AudioCandidate): number {
  if (left.version !== right.version) {
    return right.version - left.version;
  }

  const extensionDifference = extensionPriority(left.extension) - extensionPriority(right.extension);
  if (extensionDifference !== 0) {
    return extensionDifference;
  }

  return left.baseName.localeCompare(right.baseName, undefined, { sensitivity: "base" });
}

async function discoverAudioFiles(): Promise<string[]> {
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(PROJECTS_DIR, entry.name))
    .map(parseAudioCandidate);

  const selectedByCanonicalName = new Map<string, AudioCandidate>();
  for (const candidate of candidates) {
    const current = selectedByCanonicalName.get(candidate.canonicalName);
    if (!current || compareCandidates(candidate, current) < 0) {
      selectedByCanonicalName.set(candidate.canonicalName, candidate);
    }
  }

  return [...selectedByCanonicalName.values()]
    .sort((left, right) => left.baseName.localeCompare(right.baseName, undefined, { sensitivity: "base" }))
    .map((candidate) => candidate.inputPath);
}

function buildRuns(inputs: string[], themes: string[]): FiestaRun[] {
  return inputs.map((inputPath, index) => {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    return {
      inputPath,
      theme: themes[index] ?? themes[themes.length - 1] ?? "rainforest canopy",
      halftime: randomHalftime(),
      particleIntensity: randomParticleIntensity(),
      outputFileName: `${baseName}.mp4`,
    };
  });
}

function formatRunSummary(run: FiestaRun, index: number): string {
  return [
    `[${String(index + 1).padStart(2, "0")}] ${path.basename(run.inputPath)}`,
    `theme="${run.theme}"`,
    `halftime=${run.halftime ? "on" : "off"}`,
    `particleIntensity=${run.particleIntensity}`,
    `output=${run.outputFileName}`,
  ].join(" | ");
}

async function runFiestaBatch(runs: FiestaRun[]): Promise<void> {
  const failures: Array<{ run: FiestaRun; error: unknown }> = [];

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    const command = [
      process.execPath,
      "run",
      "src/cli.ts",
      "--input",
      run.inputPath,
      "--theme",
      run.theme,
      "--particleIntensity",
      String(run.particleIntensity),
      "--output",
      run.outputFileName,
    ];
    if (run.halftime) {
      command.push("--halftime");
    }

    console.log(`\nStarting ${formatRunSummary(run, index)}`);

    try {
      await runCommand(command, {
        cwd: path.resolve("."),
        stdout: "inherit",
        stderr: "inherit",
      });
    } catch (error) {
      failures.push({ run, error });
      console.error(`Failed ${path.basename(run.inputPath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    const names = failures.map(({ run }) => path.basename(run.inputPath)).join(", ");
    throw new Error(`Fiesta completed with ${failures.length} failed run(s): ${names}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.PEXELS_API_KEY) {
    throw new Error("PEXELS_API_KEY must be set before running fiesta.");
  }

  const requestedCount = parseRequestedCount(process.argv);
  const availableAudioFiles = await discoverAudioFiles();
  if (availableAudioFiles.length === 0) {
    throw new Error(`No .mp3 or .wav files found in ${PROJECTS_DIR}.`);
  }

  const selectedInputs = sampleWithoutReplacement(availableAudioFiles, requestedCount);
  if (selectedInputs.length < requestedCount) {
    console.warn(`Requested ${requestedCount} files but found ${selectedInputs.length}; running the available audio exports only.`);
  }

  const selectedThemes = sampleWithoutReplacement(THEME_BANK, selectedInputs.length);
  const runs = buildRuns(selectedInputs, selectedThemes);

  console.log(`Fiesta source folder: ${PROJECTS_DIR}`);
  console.log("Fiesta output folder: default CLI video directory");
  console.log(`Queued ${runs.length} run(s).`);
  for (let index = 0; index < runs.length; index += 1) {
    console.log(formatRunSummary(runs[index]!, index));
  }

  await runFiestaBatch(runs);
}

await main();
