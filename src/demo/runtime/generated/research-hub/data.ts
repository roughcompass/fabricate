export type Sector = "Banks" | "Energy" | "Technology" | "Healthcare" | "Consumer";
export type Region = "Americas" | "EMEA" | "Asia Pacific";
export type Rating = "Overweight" | "Neutral" | "Underweight";

export interface Report {
  id: string;
  title: string;
  sector: Sector;
  analyst: string;
  region: Region;
  published: string;
  /** Publication time, with its zone. */
  time: string;
  pages: number;
  /** How many companies the report covers. */
  companies: number;
  rating: Rating;
  summary: string;
  keyPoints: readonly string[];
}

export const SECTORS: readonly Sector[] = ["Banks", "Energy", "Technology", "Healthcare", "Consumer"];
export const REGIONS: readonly Region[] = ["Americas", "EMEA", "Asia Pacific"];

export const REPORTS: readonly Report[] = [
  {
    id: "rpt-4821",
    title: "US regional banks: deposit costs peak",
    sector: "Banks",
    analyst: "Maya Collins",
    region: "Americas",
    published: "16 Oct 2026",
    time: "07:00 ET",
    pages: 24,
    companies: 12,
    rating: "Overweight",
    summary: "Deposit betas have stopped rising for the first time in eight quarters. We expect net interest margins to trough in the fourth quarter and raise our view on the group to overweight.",
    keyPoints: ["Deposit betas flat quarter on quarter at 41%", "Margin trough brought forward to Q4 2026", "Commercial real estate losses stay within reserves", "Top pick moves to mid-cap lenders with low loan-to-deposit ratios"],
  },
  {
    id: "rpt-4817",
    title: "European utilities: grid capex cycle",
    sector: "Energy",
    analyst: "Lukas Weber",
    region: "EMEA",
    published: "15 Oct 2026",
    time: "08:30 CET",
    pages: 36,
    companies: 9,
    rating: "Overweight",
    summary: "Regulated grid spending across the EU rises 40% over the next five years. Allowed returns are resetting higher, which supports earnings growth for network operators.",
    keyPoints: ["EUR 584bn of grid investment planned to 2031", "Allowed returns reset 60 basis points higher in three markets", "Network operators preferred over generators"],
  },
  {
    id: "rpt-4809",
    title: "Asian semiconductors: memory upcycle",
    sector: "Technology",
    analyst: "Hiro Tanaka",
    region: "Asia Pacific",
    published: "14 Oct 2026",
    time: "09:00 JST",
    pages: 42,
    companies: 15,
    rating: "Overweight",
    summary: "High-bandwidth memory demand outstrips supply into 2027. Contract prices for server memory rise for a fourth straight quarter.",
    keyPoints: ["Server memory contract prices up 12% quarter on quarter", "Capacity additions lag demand by two quarters", "Inventory days back to the five-year average", "Equipment makers lag memory makers on valuation"],
  },
  {
    id: "rpt-4802",
    title: "Global pharma: patent cliff to 2030",
    sector: "Healthcare",
    analyst: "Amara Osei",
    region: "EMEA",
    published: "13 Oct 2026",
    time: "07:30 GMT",
    pages: 51,
    companies: 18,
    rating: "Neutral",
    summary: "USD 190bn of annual sales lose exclusivity by 2030. Pipelines replace about two thirds of it, so we stay neutral and favor companies with late-stage obesity assets.",
    keyPoints: ["USD 190bn of sales lose exclusivity by 2030", "Pipelines replace about 65% of lost revenue", "Obesity treatments lead late-stage value"],
  },
  {
    id: "rpt-4796",
    title: "US consumer: holiday spending outlook",
    sector: "Consumer",
    analyst: "Daniel Reyes",
    region: "Americas",
    published: "12 Oct 2026",
    time: "06:45 ET",
    pages: 18,
    companies: 20,
    rating: "Neutral",
    summary: "We expect holiday sales to grow 3.1%, below last year. Lower-income shoppers are trading down, while premium spending holds up.",
    keyPoints: ["Holiday sales growth of 3.1%, down from 3.8%", "Trading down concentrated in lower-income households", "Off-price retailers gain share"],
  },
  {
    id: "rpt-4788",
    title: "Japanese megabanks: rate normalization",
    sector: "Banks",
    analyst: "Hiro Tanaka",
    region: "Asia Pacific",
    published: "9 Oct 2026",
    time: "08:00 JST",
    pages: 28,
    companies: 6,
    rating: "Overweight",
    summary: "Each 25 basis point rise in the policy rate lifts megabank earnings by about 8%. Buybacks continue as capital ratios stay above target.",
    keyPoints: ["8% earnings uplift per 25 basis point hike", "Capital ratios 150 basis points above target", "Buyback yields of 3% to 4% through 2027"],
  },
  {
    id: "rpt-4774",
    title: "European software: AI pricing models",
    sector: "Technology",
    analyst: "Sofia Lindqvist",
    region: "EMEA",
    published: "7 Oct 2026",
    time: "09:15 CET",
    pages: 33,
    companies: 11,
    rating: "Underweight",
    summary: "Seat-based pricing comes under pressure as agents replace users. Vendors moving to usage pricing face two years of slower reported growth.",
    keyPoints: ["Seat counts fall 6% at early adopters", "Usage pricing transitions slow growth for about two years", "We prefer vendors that own their customers' data"],
  },
  {
    id: "rpt-4761",
    title: "LatAm oil and gas: offshore output",
    sector: "Energy",
    analyst: "Daniel Reyes",
    region: "Americas",
    published: "2 Oct 2026",
    time: "10:00 ET",
    pages: 22,
    companies: 7,
    rating: "Neutral",
    summary: "Offshore production in Brazil and Guyana adds 900,000 barrels a day by 2028. Breakevens near USD 35 a barrel keep the projects resilient to lower prices.",
    keyPoints: ["900,000 barrels a day of new offshore output by 2028", "Breakevens near USD 35 a barrel", "Dividend cover stays above 1.5 times at USD 60 oil"],
  },
];
