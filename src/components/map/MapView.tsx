import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { PackedPoint } from '../../types'
import { toGeoJSON, type MapFilter } from '../../lib/data'

const SOURCE = 'occurrences'
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

const EMPTY: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: 'FeatureCollection',
  features: [],
}

type Props = {
  points: PackedPoint[] | null
  filter: MapFilter
  speciesNames: string[]
  onSelect: (key: number) => void
  selectedKey: number | null
}

/**
 * Paint an emoji to a canvas, then recolour it through its own alpha.
 * A paw glyph draws near black, and colour emoji fonts are missing on some
 * platforms, so tinting it ourselves is the only way to get one look everywhere.
 */
function emojiIcon(emoji: string, color: string, size = 96): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable, so map icons cannot be drawn.')

  ctx.font = `${Math.round(size * 0.78)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04)

  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, size, size)

  return ctx.getImageData(0, 0, size, size)
}

export function MapView({ points, filter, speciesNames, onSelect, selectedKey }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const ready = useRef(false)

  // Style and data race each other, so both paths read the newest props here
  // rather than from a stale closure.
  const latest = useRef({ points, filter, speciesNames })
  latest.current = { points, filter, speciesNames }

  function syncData(m: mapboxgl.Map) {
    const src = m.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined
    if (!src) return
    const { points: p, filter: f } = latest.current
    src.setData(p ? toGeoJSON(p, f) : EMPTY)
  }

  useEffect(() => {
    if (!container.current || map.current || !TOKEN) return

    mapboxgl.accessToken = TOKEN
    const m = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      projection: 'globe',
      center: [118, -2],
      zoom: 1.6,
      minZoom: 0.8,
      maxZoom: 14,
      attributionControl: false,
    })
    map.current = m

    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right')
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')

    // Mapbox only reacts to window resize, so a collapsing sidebar would leave
    // the canvas at its old width.
    const observer = new ResizeObserver(() => m.resize())
    observer.observe(container.current)

    const peek = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      className: 'peek-popup',
    })

    m.on('style.load', () => {
      m.setFog({
        color: 'rgb(11,12,16)',
        'high-color': 'rgb(18,20,28)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(8,9,12)',
        'star-intensity': 0.12,
      })

      m.addImage('paw', emojiIcon('🐾', '#fb923c'), { pixelRatio: 3 })
      m.addImage('paw-bright', emojiIcon('🐾', '#ffd9a8'), { pixelRatio: 3 })
      m.addImage('bone', emojiIcon('🦴', '#9fd0e6'), { pixelRatio: 3 })

      m.addSource(SOURCE, {
        type: 'geojson',
        data: EMPTY,
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 9,
      })

      m.addLayer({
        id: 'cluster-glow',
        type: 'circle',
        source: SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#fb923c',
          'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.26, 0.12],
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'point_count'],
            2, 18, 50, 26, 500, 36, 5000, 48, 50000, 62,
          ],
        },
      })

      // Icon size is a multiple of the 32px base (96px image at pixelRatio 3).
      m.addLayer({
        id: 'clusters',
        type: 'symbol',
        source: SOURCE,
        filter: ['has', 'point_count'],
        layout: {
          'icon-image': 'paw',
          'icon-size': [
            'interpolate', ['linear'], ['get', 'point_count'],
            2, 0.5, 50, 0.68, 500, 0.9, 5000, 1.15, 50000, 1.5,
          ],
          'icon-allow-overlap': true,
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 12,
          'text-offset': [0, 1.9],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#f4f2ec',
          'text-halo-color': 'rgba(11,12,16,0.92)',
          'text-halo-width': 1.4,
        },
      })

      // Size and opacity carry coordinate precision, so a 20 m record does not
      // look identical to a 30 km one.
      m.addLayer({
        id: 'points',
        type: 'symbol',
        source: SOURCE,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': [
            'case',
            ['==', ['get', 'fossil'], 1], 'bone',
            ['==', ['get', 'precision'], 0], 'paw-bright',
            'paw',
          ],
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            9, ['case', ['==', ['get', 'precision'], 2], 0.55, 0.45],
            14, ['case', ['==', ['get', 'precision'], 2], 1.25, ['==', ['get', 'precision'], 1], 1, 0.85],
          ],
          'icon-allow-overlap': true,
          'icon-rotate': ['%', ['get', 'key'], 360],
          'icon-rotation-alignment': 'map',
        },
        paint: {
          'icon-opacity': [
            'case',
            ['==', ['get', 'precision'], 2], 0.38,
            ['==', ['get', 'precision'], 1], 0.65,
            0.95,
          ],
        },
      })

      // Invisible, generous tap target. A paw is an awkward shape to hit.
      m.addLayer({
        id: 'points-hit',
        type: 'circle',
        source: SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 13, 14, 22],
          'circle-color': '#000000',
          'circle-opacity': 0,
        },
      })

      m.addLayer({
        id: 'selected',
        type: 'circle',
        source: SOURCE,
        filter: ['==', ['get', 'key'], -1],
        paint: {
          'circle-radius': 17,
          'circle-color': 'transparent',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#f4f2ec',
        },
      })

      ready.current = true
      syncData(m)
    })

    // Clicks and hovers use the wide circles, not the icons.
    m.on('click', 'cluster-glow', (e) => {
      const feature = e.features?.[0]
      if (!feature) return
      const src = m.getSource(SOURCE) as mapboxgl.GeoJSONSource
      src.getClusterExpansionZoom(feature.properties?.cluster_id, (err, zoom) => {
        if (err || zoom == null) return
        m.easeTo({
          center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
          duration: 700,
        })
      })
    })

    m.on('click', 'points-hit', (e) => {
      const key = e.features?.[0]?.properties?.key
      if (typeof key === 'number') onSelect(key)
    })

    m.on('mousemove', 'cluster-glow', (e) => {
      const f = e.features?.[0]
      if (!f) return
      m.getCanvas().style.cursor = 'pointer'
      const count = f.properties?.point_count as number
      peek
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(
          `<div class="peek"><b>${count.toLocaleString('en-US')}</b> sightings<span>Click to zoom in</span></div>`,
        )
        .addTo(m)
    })

    m.on('mousemove', 'points-hit', (e) => {
      const f = e.features?.[0]
      if (!f) return
      m.getCanvas().style.cursor = 'pointer'
      const name = latest.current.speciesNames[f.properties?.s as number] ?? 'Cat'
      const year = f.properties?.year as number
      peek
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="peek"><b>${name}</b><span>${year ? `Seen in ${year}` : 'Date not recorded'}</span></div>`,
        )
        .addTo(m)
    })

    for (const layer of ['cluster-glow', 'points-hit']) {
      m.on('mouseleave', layer, () => {
        m.getCanvas().style.cursor = ''
        peek.remove()
      })
    }

    return () => {
      observer.disconnect()
      peek.remove()
      m.remove()
      map.current = null
      ready.current = false
    }
    // Mounts once; prop changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (m && ready.current) syncData(m)
  }, [points, filter])

  useEffect(() => {
    const m = map.current
    if (m && ready.current && m.getLayer('selected')) {
      m.setFilter('selected', ['==', ['get', 'key'], selectedKey ?? -1])
    }
  }, [selectedKey])

  if (!TOKEN) {
    return (
      <div className="map-missing-token">
        <h2>Mapbox token missing</h2>
        <p>
          Copy <code>.env.example</code> to <code>.env</code> and set{' '}
          <code>VITE_MAPBOX_TOKEN</code>, then restart the dev server.
        </p>
      </div>
    )
  }

  return <div ref={container} className="map" />
}
