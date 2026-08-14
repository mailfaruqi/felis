import type { Dataset, PackedPoint } from '../types'

export async function loadDataset(): Promise<Dataset> {
  const res = await fetch('/data/species.json')
  if (!res.ok) throw new Error('Could not load the species index.')
  return res.json()
}

export async function loadPoints(): Promise<PackedPoint[]> {
  const res = await fetch('/data/occurrences.json')
  if (!res.ok) throw new Error('Could not load the occurrence data.')
  const body = await res.json()
  return body.points
}

export type MapFilter = {
  speciesIndex: number | null
  showFossils: boolean
}

// Rebuilt on every filter change rather than using setFilter: with clustering on,
// a layer filter runs after clustering, so cluster counts would stay unfiltered.
export function toGeoJSON(
  points: PackedPoint[],
  filter: MapFilter,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = []

  for (const [lon, lat, s, year, key, precision, fossil] of points) {
    if (filter.speciesIndex !== null && s !== filter.speciesIndex) continue
    if (!filter.showFossils && fossil === 1) continue

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { key, s, year, precision, fossil },
    })
  }

  return { type: 'FeatureCollection', features }
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatDatasetDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
