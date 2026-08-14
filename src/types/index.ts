export type CountryTally = {
  code: string
  name: string
  count: number
}

export type Species = {
  key: number
  scientificName: string
  authorship: string
  vernacularName: string | null
  rank: string
  taxonomicStatus: string | null
  count: number
  imageCount: number
  fossilCount: number
  extinct: boolean
  extinctSource: string
  ambiguousName: boolean
  unidentified: boolean
  topCountries: CountryTally[]
  yearMin: number | null
  yearMax: number | null
}

export type Dataset = {
  generatedAt: string
  fetchedAt: string | null
  source: string
  genusTaxonKey: number
  count: number
  countryCount: number
  fossilCount: number
  fossilSpecimenCount: number
  extinctSpeciesCount: number
  yearMin: number | null
  yearMax: number | null
  topCountries: CountryTally[]
  fields: string[]
  precisionTiers: Record<string, string>
  species: Species[]
}

/**
 * One row of public/data/occurrences.json.
 * [lon, lat, speciesIndex, year (0 = unknown), gbifKey, precision, isFossil]
 * speciesIndex indexes into Dataset.species.
 */
export type PackedPoint = [number, number, number, number, number, number, number]

// 0 = within 1 km, 1 = 1 to 10 km, 2 = coarser or unrecorded.
export type Precision = 0 | 1 | 2

export type OccurrenceMedia = {
  url: string
  license: string
  rightsHolder?: string
  creator?: string
}

export type OccurrenceDetail = {
  key: number
  species?: string
  scientificName?: string
  latitude: number
  longitude: number
  coordinateUncertaintyInMeters?: number
  country?: string
  countryCode?: string
  locality?: string
  eventDate?: string
  year?: number
  basisOfRecord?: string
  datasetKey?: string
  datasetName?: string
  publisher?: string
  recordedBy?: string
  media: OccurrenceMedia[]
  license?: string
  gbifUrl: string
}
