// Procedural company generator: names, tickers and initial fundamentals.

export const SECTOR_DEFS = [
  { name: "Technology", baseVolatility: 0.028, baseGrowth: 0.12 },
  { name: "Healthcare", baseVolatility: 0.024, baseGrowth: 0.08 },
  { name: "Financials", baseVolatility: 0.020, baseGrowth: 0.05 },
  { name: "Energy", baseVolatility: 0.026, baseGrowth: 0.03 },
  { name: "Consumer Goods", baseVolatility: 0.015, baseGrowth: 0.04 },
  { name: "Industrials", baseVolatility: 0.018, baseGrowth: 0.04 },
  { name: "Utilities", baseVolatility: 0.011, baseGrowth: 0.02 },
  { name: "Real Estate", baseVolatility: 0.017, baseGrowth: 0.03 },
  { name: "Materials", baseVolatility: 0.021, baseGrowth: 0.03 },
  { name: "Telecom", baseVolatility: 0.016, baseGrowth: 0.03 },
  { name: "Transportation", baseVolatility: 0.020, baseGrowth: 0.04 },
  { name: "Media & Entertainment", baseVolatility: 0.025, baseGrowth: 0.07 },
] as const;

const ROOTS = [
  "Apex", "Nova", "Vertex", "Quantum", "Stellar", "Ironclad", "Summit", "Pioneer", "Atlas", "Zenith",
  "Cascade", "Meridian", "Frontier", "Beacon", "Horizon", "Catalyst", "Momentum", "Paragon", "Vanguard", "Keystone",
  "Blue Ridge", "Redwood", "Silverline", "Goldcrest", "Northwind", "Eastgate", "Westbrook", "Southport", "Clearwater", "Stonebridge",
  "Falcon", "Osprey", "Kestrel", "Peregrine", "Raven", "Condor", "Heron", "Sparrow", "Talon", "Griffin",
  "Helios", "Orion", "Lyra", "Vega", "Polaris", "Sirius", "Titan", "Nebula", "Pulsar", "Equinox",
  "Granite", "Cobalt", "Onyx", "Amber", "Crimson", "Sable", "Ivory", "Cedar", "Willow", "Juniper",
  "Fairview", "Lakeshore", "Riverbend", "Highland", "Crestwood", "Oakmont", "Brookfield", "Ashford", "Sterling", "Windham",
  "Axiom", "Cipher", "Vector", "Matrix", "Kinetic", "Dynamo", "Synergy", "Fusion", "Nimbus", "Zephyr",
  "Bastion", "Citadel", "Rampart", "Sentinel", "Harbor", "Anchor", "Compass", "Lighthouse", "Voyager", "Odyssey",
  "Ember", "Aurora", "Solstice", "Tundra", "Sierra", "Mesa", "Canyon", "Delta", "Prairie", "Glacier",
] as const;

const SECTOR_WORDS: Record<string, string[]> = {
  Technology: ["Systems", "Software", "Robotics", "Semiconductors", "Data", "Cloud", "Analytics", "Networks", "AI Labs", "Computing", "Cyber", "Digital"],
  Healthcare: ["Biotech", "Pharma", "Therapeutics", "Medical", "Genomics", "Health", "Diagnostics", "Biosciences", "Care Group", "Labs"],
  Financials: ["Capital", "Financial", "Holdings", "Bancorp", "Trust", "Insurance", "Asset Management", "Securities", "Credit", "Partners"],
  Energy: ["Energy", "Petroleum", "Solar", "Wind Power", "Drilling", "Resources", "Renewables", "Gas", "Hydro", "Power"],
  "Consumer Goods": ["Brands", "Foods", "Beverages", "Retail", "Apparel", "Home Goods", "Stores", "Consumer", "Markets", "Goods"],
  Industrials: ["Industries", "Manufacturing", "Engineering", "Machinery", "Aerospace", "Defense", "Tools", "Fabrication", "Automation", "Works"],
  Utilities: ["Utilities", "Electric", "Water", "Grid", "Gas & Electric", "Power Co", "Energy Services"],
  "Real Estate": ["Properties", "Realty", "REIT", "Development", "Land", "Estates", "Commercial Realty", "Housing"],
  Materials: ["Mining", "Steel", "Chemicals", "Metals", "Minerals", "Aggregates", "Polymers", "Timber", "Alloys"],
  Telecom: ["Telecom", "Communications", "Wireless", "Broadband", "Fiber", "Satellite", "Networks"],
  Transportation: ["Logistics", "Freight", "Shipping", "Airlines", "Rail", "Transport", "Carriers", "Trucking"],
  "Media & Entertainment": ["Media", "Studios", "Entertainment", "Gaming", "Streaming", "Publishing", "Interactive", "Broadcasting"],
};

const SUFFIXES = ["Inc", "Corp", "Group", "Co", "Ltd", "Holdings", "PLC", "Enterprises"];

export interface GeneratedCompany {
  name: string;
  symbol: string;
  sectorIndex: number; // index into SECTOR_DEFS
  price: number;
  sharesOutstanding: number;
  revenue: number;
  earnings: number;
  cashReserves: number;
  growthRate: number;
  profitMargin: number;
  volatility: number;
  beta: number;
  quality: number;
  dividendYield: number;
  earningsOffset: number;
  description: string;
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function symbolFromName(name: string, rng: () => number): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  const len = 3 + Math.floor(rng() * 2); // 3-4 chars
  let sym = "";
  // Take initials of words first, then fill from letters.
  const words = name.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  for (const w of words) if (sym.length < len) sym += w[0];
  let i = 1;
  while (sym.length < len && i < letters.length) {
    if (!sym.includes(letters[i]) || rng() > 0.5) sym += letters[i];
    i++;
  }
  while (sym.length < len) sym += String.fromCharCode(65 + Math.floor(rng() * 26));
  return sym.slice(0, len);
}

// Log-normal-ish helper.
function lognorm(rng: () => number, median: number, spread: number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(n * spread);
}

/**
 * Generate a batch of companies with a symbol-uniqueness guarantee against
 * both the provided set and each other. Mutates `usedSymbols`.
 */
export function generateCompanies(
  count: number,
  usedSymbols: Set<string>,
  rng: () => number = Math.random
): GeneratedCompany[] {
  const out: GeneratedCompany[] = [];
  for (let i = 0; i < count; i++) {
    const sectorIndex = Math.floor(rng() * SECTOR_DEFS.length);
    const sector = SECTOR_DEFS[sectorIndex];
    const root = pick(ROOTS, rng);
    const word = pick(SECTOR_WORDS[sector.name], rng);
    const withSuffix = rng() < 0.45;
    const name = withSuffix ? `${root} ${word} ${pick(SUFFIXES, rng)}` : `${root} ${word}`;

    let symbol = symbolFromName(name, rng);
    let guard = 0;
    while (usedSymbols.has(symbol)) {
      symbol = symbol.slice(0, 3) + String.fromCharCode(65 + Math.floor(rng() * 26));
      if (++guard > 30) symbol = symbol.slice(0, 2) + Math.floor(rng() * 90 + 10).toString();
    }
    usedSymbols.add(symbol);

    // Fundamentals: revenue spans small-caps (~$20M) to mega-caps (~$300B).
    const revenue = lognorm(rng, 800e6, 1.9);
    const profitMargin = Math.min(0.4, Math.max(-0.25, 0.08 + (rng() - 0.35) * 0.3));
    const earnings = revenue * profitMargin;
    const growthRate = sector.baseGrowth + (rng() - 0.4) * 0.25;
    const quality = Math.max(-1, Math.min(1, (rng() - 0.5) * 2 * rng()));

    // Value the company off fundamentals with a noisy multiple, then derive
    // share count so prices land in a familiar $2 - $900 range.
    const multiple = 12 + rng() * 20 + Math.max(0, growthRate) * 60;
    const marketCap = Math.max(15e6, earnings > 0 ? earnings * multiple : revenue * (0.5 + rng() * 2));
    const price = 2 + lognorm(rng, 38, 0.9);
    const sharesOutstanding = Math.max(1_000_000, Math.round(marketCap / price));

    const matureAndProfitable = profitMargin > 0.05 && growthRate < 0.08;
    const dividendYield = matureAndProfitable && rng() < 0.6 ? 0.005 + rng() * 0.045 : 0;

    out.push({
      name,
      symbol,
      sectorIndex,
      price: Math.round(price * 100) / 100,
      sharesOutstanding,
      revenue,
      earnings,
      cashReserves: revenue * (0.05 + rng() * 0.4),
      growthRate,
      profitMargin,
      volatility: Math.max(0.006, sector.baseVolatility * (0.6 + rng() * 1.1)),
      beta: Math.max(0.1, 0.4 + rng() * 1.4),
      quality,
      dividendYield,
      earningsOffset: Math.floor(rng() * 63),
      description: `${name} is a ${sector.name.toLowerCase()} company operating in the ${word.toLowerCase()} space.`,
    });
  }
  return out;
}
