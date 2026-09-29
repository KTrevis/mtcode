import type { SkyConditions } from "./skyConditions";

/**
 * A sky's colours. The first three are the Night sky artwork's diagonal
 * gradient, so a deep clear night comes out as that scene's own palette.
 */
export type SkyPalette = {
  readonly skyA: string;
  readonly skyB: string;
  readonly skyC: string;
  /** Light pooled along the bottom edge, from sunset or city glow. */
  readonly horizon: string;
  readonly horizonStrength: number;
  readonly glow: string;
  readonly glowEdge: string;
  readonly glowStrength: number;
  /** Cloud bodies run left to right through these, as the Night sky's do. */
  readonly cloudA: string;
  readonly cloudB: string;
  readonly cloudC: string;
  readonly cloudOpacity: number;
  readonly stars: number;
  readonly haze: string;
  readonly precipitation: string;
};

type Key = Omit<SkyPalette, "haze" | "precipitation">;

const key = (
  sky: readonly [string, string, string],
  horizon: readonly [string, number],
  glow: readonly [string, string, number],
  cloud: readonly [string, string, string, number],
  stars: number,
): Key => ({
  skyA: sky[0],
  skyB: sky[1],
  skyC: sky[2],
  horizon: horizon[0],
  horizonStrength: horizon[1],
  glow: glow[0],
  glowEdge: glow[1],
  glowStrength: glow[2],
  cloudA: cloud[0],
  cloudB: cloud[1],
  cloudC: cloud[2],
  cloudOpacity: cloud[3],
  stars,
});

/** The Night sky artwork's own colours (the default theme's stage-night tokens). */
const NIGHT = key(
  ["#07152f", "#151443", "#32155b"],
  ["#32155b", 0],
  ["#5165d8", "#26307a", 0.4],
  ["#4ea4ff", "#696fea", "#a85bea", 0.56],
  1,
);

const MIDDAY = key(
  ["#1c5fc4", "#3f8adc", "#86bcee"],
  ["#d8ecfb", 0.45],
  ["#ffffff", "#bfe0fa", 0.34],
  ["#e9f0f9", "#eef2f8", "#f6f7fb", 0.93],
  0,
);

const AFTERNOON = key(
  ["#2468c6", "#4c90da", "#9cc8f0"],
  ["#e2f0fa", 0.5],
  ["#fffbee", "#cfe6fa", 0.4],
  ["#e8eff8", "#eef1f6", "#f5f4f4", 0.92],
  0,
);

/**
 * Sun heights in degrees and the sky each one wears, from deep night up to
 * midday. Mornings run cooler and pinker, evenings warmer and more violet, so
 * the same height reads differently either side of noon.
 */
const MORNING: ReadonlyArray<readonly [number, Key]> = [
  [-16, NIGHT],
  [
    -10,
    key(
      ["#0a1a45", "#1b2560", "#3a3478"],
      ["#4a4a90", 0.3],
      ["#6a7ae0", "#2c357e", 0.42],
      ["#5f95f0", "#7483e4", "#9a7ad8", 0.6],
      0.75,
    ),
  ],
  [
    -5,
    key(
      ["#142a66", "#34458f", "#8c6fa6"],
      ["#d58a9a", 0.5],
      ["#e59aa6", "#5a4f9a", 0.45],
      ["#8da0e0", "#a894cc", "#d0a0c0", 0.7],
      0.3,
    ),
  ],
  [
    -2,
    key(
      ["#1f3576", "#5a5ea4", "#f0a08a"],
      ["#ffb08a", 0.75],
      ["#ffc0a0", "#9a78b4", 0.6],
      ["#d0a0c8", "#f0a8b0", "#ffc0a0", 0.8],
      0.06,
    ),
  ],
  [
    0.5,
    key(
      ["#2d4c98", "#8480b8", "#ffb488"],
      ["#ffc48e", 0.85],
      ["#ffd8a0", "#e0a0a0", 0.7],
      ["#f0b8c0", "#ffc8a8", "#ffdcb0", 0.85],
      0,
    ),
  ],
  [
    5,
    key(
      ["#3462b0", "#86a0d0", "#f6d2ac"],
      ["#ffd6a6", 0.7],
      ["#fff0c8", "#f0c8b0", 0.6],
      ["#f1e8ea", "#f8e4d0", "#fff2de", 0.88],
      0,
    ),
  ],
  // Between golden light and plain day the sky stays blue overhead and only
  // the horizon warms; blending the two straight across goes grey.
  [
    9,
    key(
      ["#2a64bc", "#5f98da", "#f4ead8"],
      ["#ffdcae", 0.5],
      ["#fff2cc", "#f0d8b8", 0.58],
      ["#f5eef0", "#f9ecdc", "#fff6e8", 0.9],
      0,
    ),
  ],
  [
    14,
    key(
      ["#2868be", "#5896d6", "#b2d6f0"],
      ["#eef2ec", 0.35],
      ["#fffaf0", "#d8eaf6", 0.45],
      ["#ecf1f8", "#f2f3f5", "#fbf8f2", 0.9],
      0,
    ),
  ],
  [30, AFTERNOON],
  [55, MIDDAY],
];

const EVENING: ReadonlyArray<readonly [number, Key]> = [
  [-16, NIGHT],
  [
    -10,
    key(
      ["#0b1843", "#1e1d5c", "#472673"],
      ["#5b3380", 0.35],
      ["#6a5fd8", "#2d2a78", 0.42],
      ["#5d8ff0", "#7a6fe0", "#a864d8", 0.6],
      0.75,
    ),
  ],
  [
    -5,
    key(
      ["#13235e", "#2e3486", "#7a4f96"],
      ["#c0668a", 0.55],
      ["#d0708a", "#4e3c8e", 0.45],
      ["#7f86d8", "#9a78c8", "#c07cb8", 0.7],
      0.3,
    ),
  ],
  [
    -2,
    key(
      ["#1b2a6c", "#50459a", "#d8766e"],
      ["#ff8a5c", 0.8],
      ["#ff9a66", "#8a5a9a", 0.6],
      ["#c58ab8", "#e38e98", "#f0a07e", 0.8],
      0.08,
    ),
  ],
  [
    0.5,
    key(
      ["#28428f", "#7a6aa8", "#f39a64"],
      ["#ffa65c", 0.9],
      ["#ffc070", "#e08a78", 0.7],
      ["#e7a3a8", "#f5b08c", "#ffc98e", 0.85],
      0,
    ),
  ],
  [
    5,
    key(
      ["#2f5aa8", "#7f94c4", "#f5c58e"],
      ["#ffc070", 0.75],
      ["#ffe0a0", "#f0b890", 0.6],
      ["#f1e4d6", "#f7d8b8", "#ffe9c8", 0.88],
      0,
    ),
  ],
  [
    9,
    key(
      ["#2b62b6", "#6294d4", "#f6e4c8"],
      ["#ffd29a", 0.55],
      ["#ffeab8", "#f2cca8", 0.6],
      ["#f6ebe4", "#fae4cc", "#fff0da", 0.9],
      0,
    ),
  ],
  [
    14,
    key(
      ["#2a66ba", "#5a92d2", "#b4d2ec"],
      ["#f8e6c6", 0.35],
      ["#fff4d8", "#e0e4e8", 0.45],
      ["#eef3fa", "#f4f1ec", "#fbf6ee", 0.9],
      0,
    ),
  ],
  [30, AFTERNOON],
  [55, MIDDAY],
];

type Lab = readonly [number, number, number];

const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const fromLinear = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

function toLab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((at) =>
    toLinear(Number.parseInt(hex.slice(at, at + 2), 16) / 255),
  );
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromLab([L, A, B]: Lab): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(channel))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Perceptual blend, so a sunset fading to blue passes through violet, not grey. */
export function mixColor(from: string, to: string, amount: number): string {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  const a = toLab(from);
  const b = toLab(to);
  return fromLab([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]);
}

/**
 * Pulls a colour toward an overcast `tint`: its lightness most of the way,
 * its hue by `1 - keep`. Keeping some of the original hue is what lets a grey
 * sunset stay a warm grey instead of going to concrete.
 */
function toward(color: string, tint: string, amount: number, keep: number): string {
  if (amount <= 0) return color;
  const [L, A, B] = toLab(color);
  const [tL, tA, tB] = toLab(tint);
  const hueA = A * keep + tA * (1 - keep);
  const hueB = B * keep + tB * (1 - keep);
  return fromLab([L + (tL - L) * amount * 0.85, A + (hueA - A) * amount, B + (hueB - B) * amount]);
}

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function blendKeys(from: Key, to: Key, t: number): Key {
  const mixNumber = (a: number, b: number) => a + (b - a) * t;
  return {
    skyA: mixColor(from.skyA, to.skyA, t),
    skyB: mixColor(from.skyB, to.skyB, t),
    skyC: mixColor(from.skyC, to.skyC, t),
    horizon: mixColor(from.horizon, to.horizon, t),
    horizonStrength: mixNumber(from.horizonStrength, to.horizonStrength),
    glow: mixColor(from.glow, to.glow, t),
    glowEdge: mixColor(from.glowEdge, to.glowEdge, t),
    glowStrength: mixNumber(from.glowStrength, to.glowStrength),
    cloudA: mixColor(from.cloudA, to.cloudA, t),
    cloudB: mixColor(from.cloudB, to.cloudB, t),
    cloudC: mixColor(from.cloudC, to.cloudC, t),
    cloudOpacity: mixNumber(from.cloudOpacity, to.cloudOpacity),
    stars: mixNumber(from.stars, to.stars),
  };
}

function clearSky(sun: number, morning: boolean): Key {
  const keys = morning ? MORNING : EVENING;
  if (sun <= keys[0]![0]) return keys[0]![1];
  for (let index = 1; index < keys.length; index++) {
    const [height, palette] = keys[index]!;
    if (sun <= height) {
      const [lower, from] = keys[index - 1]!;
      return blendKeys(from, palette, smooth(0, 1, (sun - lower) / (height - lower)));
    }
  }
  return keys[keys.length - 1]![1];
}

/**
 * The palette for a moment: the clear sky for the sun's height, then the
 * weather laid over it. Cloud drains colour toward the grey of an overcast
 * day (or the violet-grey of an overcast night), rain and storms darken it,
 * snow lifts it, and fog washes the whole thing toward its own haze.
 */
export function skyPalette(conditions: SkyConditions): SkyPalette {
  const morning = conditions.sunAzimuth < 180;
  const base = clearSky(conditions.sun, morning);
  const daylight = smooth(-6, 10, conditions.sun);
  // Twilight keeps its colour under cloud; a grey noon does not.
  const warmth = smooth(-9, -2, conditions.sun) * (1 - smooth(4, 16, conditions.sun));
  const cover = Math.max(conditions.low, conditions.mid * 0.9, conditions.high * 0.3);
  const grey = smooth(0.45, 1, Math.max(conditions.low, conditions.mid * 0.85));
  const falling = conditions.precipitation !== "none";
  const gloom =
    (falling && conditions.precipitation !== "snow"
      ? conditions.precipitation === "drizzle"
        ? 0.3 + 0.2 * conditions.intensity
        : 0.4 + 0.45 * conditions.intensity
      : 0) + (conditions.thunder ? 0.45 : 0);
  const snowy = conditions.precipitation === "snow" ? conditions.intensity : 0;
  // Overcast is a cool blue-grey by day and a slate violet at night; rain
  // drives it toward a deep slate, and a storm toward indigo.
  const overcastSky = mixColor("#262b48", "#a9b4c6", daylight);
  const rainSky = mixColor("#161a34", "#56647e", daylight);
  const stormSky = mixColor("#0b0c22", "#232a46", daylight);
  const sky = (color: string) => {
    let next = toward(color, overcastSky, grey * 0.9, 0.2 + 0.45 * warmth);
    if (gloom > 0)
      next = toward(
        next,
        conditions.thunder ? stormSky : rainSky,
        Math.min(1, gloom),
        0.15 + 0.3 * warmth,
      );
    if (snowy > 0) next = toward(next, mixColor("#3a4266", "#e4e9f2", daylight), snowy * 0.6, 0.3);
    return next;
  };
  const overcastCloud = mixColor("#3a3f66", "#d4dae4", daylight);
  const rainCloud = mixColor("#262a4a", "#7c8aa2", daylight);
  const stormCloud = mixColor("#1a1d3c", "#3a4462", daylight);
  const cloud = (color: string) => {
    let next = toward(color, overcastCloud, grey * 0.7, 0.3 + 0.4 * warmth);
    if (gloom > 0)
      next = toward(
        next,
        conditions.thunder ? stormCloud : rainCloud,
        Math.min(1, gloom),
        0.2 + 0.3 * warmth,
      );
    return next;
  };
  const open = 1 - grey;
  const skyC = sky(base.skyC);
  const fog = conditions.fog;
  const haze = mixColor(skyC, mixColor("#5a5f86", "#e6eaf0", daylight), 0.55);
  return {
    skyA: sky(base.skyA),
    skyB: sky(base.skyB),
    skyC,
    horizon: sky(base.horizon),
    horizonStrength: base.horizonStrength * (0.35 + 0.65 * open) * (1 - Math.min(1, gloom) * 0.6),
    glow: base.glow,
    glowEdge: sky(base.glowEdge),
    glowStrength: base.glowStrength * (0.25 + 0.75 * open) * (1 - fog * 0.4),
    cloudA: cloud(base.cloudA),
    cloudB: cloud(base.cloudB),
    cloudC: cloud(base.cloudC),
    cloudOpacity: Math.min(0.97, base.cloudOpacity + grey * 0.15),
    stars: base.stars * (1 - cover) ** 1.6 * (1 - fog),
    haze,
    precipitation: mixColor(cloud(base.cloudA), daylight > 0.5 ? "#ffffff" : "#c8d4ff", 0.45),
  };
}
