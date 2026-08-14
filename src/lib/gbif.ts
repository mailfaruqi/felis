import type { OccurrenceDetail, OccurrenceMedia } from '../types'

// Detail is fetched live so media URLs and licences stay current. GBIF is
// CORS open, so no backend is needed.
const API = 'https://api.gbif.org/v1'

// Only these licences allow us to show the image.
const DISPLAYABLE_LICENCES = ['creativecommons.org/licenses/by', 'creativecommons.org/publicdomain']

function isDisplayable(license: string | undefined): boolean {
  if (!license) return false
  return DISPLAYABLE_LICENCES.some((ok) => license.includes(ok))
}

function readableLicence(license: string | undefined): string {
  if (!license) return 'Licence not stated'
  const match = license.match(/licenses\/([a-z-]+)\//)
  if (match) return `CC ${match[1].toUpperCase()}`
  if (license.includes('publicdomain/zero')) return 'CC0'
  if (license.includes('publicdomain')) return 'Public domain'
  return license
}

type RawMedia = {
  type?: string
  identifier?: string
  references?: string
  license?: string
  rightsHolder?: string
  creator?: string
}

export async function fetchOccurrence(key: number, signal?: AbortSignal): Promise<OccurrenceDetail> {
  const res = await fetch(`${API}/occurrence/${key}`, { signal })
  if (!res.ok) throw new Error(`GBIF returned ${res.status} for occurrence ${key}`)
  const r = await res.json()

  const media: OccurrenceMedia[] = (r.media ?? [])
    .filter((m: RawMedia) => m.type === 'StillImage' && m.identifier && isDisplayable(m.license))
    .map((m: RawMedia) => ({
      url: m.identifier as string,
      license: readableLicence(m.license),
      rightsHolder: m.rightsHolder,
      creator: m.creator,
    }))

  return {
    key: r.key,
    species: r.species,
    scientificName: r.scientificName,
    latitude: r.decimalLatitude,
    longitude: r.decimalLongitude,
    coordinateUncertaintyInMeters: r.coordinateUncertaintyInMeters,
    country: r.country,
    countryCode: r.countryCode,
    locality: r.locality ?? r.verbatimLocality,
    eventDate: r.eventDate,
    year: r.year,
    basisOfRecord: r.basisOfRecord,
    datasetKey: r.datasetKey,
    datasetName: r.datasetName,
    publisher: r.publishingOrgKey,
    recordedBy: r.recordedBy,
    media,
    license: readableLicence(r.license),
    gbifUrl: `https://www.gbif.org/occurrence/${r.key}`,
  }
}

export function formatBasisOfRecord(value: string | undefined): string {
  if (!value) return 'Unknown'
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ')
}
