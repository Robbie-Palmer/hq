import type { UkHpiSourceSpec } from "../src/hmlr";

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
