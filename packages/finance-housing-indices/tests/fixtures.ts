import type { UkHpiSourceSpec } from "../src/hmlr";
import type { PricePaidSourceSpec } from "../src/pricePaid";

export const source: UkHpiSourceSpec = {
  releasePeriod: "2025-03",
  publishedAt: "2025-05-21",
  pageUrl: "https://www.gov.uk/government/example",
  downloadUrl: "https://publicdata.landregistry.gov.uk/example.csv",
};

export const csv = `Date,RegionName,AreaCode,AveragePrice,Index,IndexSA,1m%Change,12m%Change,AveragePriceSA,SalesVolume,DetachedPrice,DetachedIndex,Detached1m%Change,Detached12m%Change,SemiDetachedPrice,SemiDetachedIndex,SemiDetached1m%Change,SemiDetached12m%Change,TerracedPrice,TerracedIndex,Terraced1m%Change,Terraced12m%Change,FlatPrice,FlatIndex
01/01/2024,"Belfast, East",N09000003,180000,100,,,,,,250000,101,,,200000,102,,,160000,103,,,140000,104
01/03/2024,"Belfast, East",N09000003,190000,110,,,,,,260000,111,,,210000,112,,,170000,113,,,150000,114
01/03/2025,England,E92000001,300000,120,,,,,,450000,121,,,320000,122,,,270000,123,,,230000,124
`;

export const pricePaidSource: PricePaidSourceSpec = {
  releasePeriod: "2026-08",
  publishedAt: "2026-10-01",
  pageUrl:
    "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
  downloadUrl:
    "https://price-paid-data.publicdata.landregistry.gov.uk/pp-2026.csv",
  observedThrough: "2026-08-31",
  latestCompleteMonth: "2026-06",
};

export const pricePaidCsv = [
  '"{tx-1}","315000","2026-06-18 00:00","CF10 1AA","D","N","F","12","","HIGH STREET","","CARDIFF","CARDIFF","CARDIFF","A","A"',
  '"{tx-2}","340000","2026-08-05 00:00","CF10 2BB","S","Y","L","8","","CASTLE STREET","","CARDIFF","CARDIFF","CARDIFF","A","A"',
  '"{tx-3}","250000","2026-04-11 00:00","CF11 3CC","T","N","F","2","","RIVER ROAD","","CARDIFF","CARDIFF","CARDIFF","A","A"',
].join("\n");
