import type { CoverageTarget, Plan } from '@signalplan/floorplan'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mapMessage, type MapData } from '../mapView.ts'
import { formatLength, type Units } from '../editor/units.ts'
import { WALL_STYLES } from '../editor/wallStyles.ts'
import {
  accessPointMarkers,
  floorLayouts,
  heatmapPixels,
  sceneBounds,
  wallBoxes,
  WALL_THICKNESS_M,
  type Bounds,
  type FloorLayout,
} from './layout.ts'
import { NoContextError, type View3DFailure } from './failures.ts'
import { View3DFailed } from './ThreeDStatus.tsx'

/**
 * The view-only 3D view (D49, D57): floors stacked at their elevations
 * (plus any spread), walls standing on them, each floor's heatmap and the
 * access points at their mounting height. Plan x and y lie flat on the
 * ground, with plan y towards the viewer, so the default view looks at the
 * plan the way the 2D editor shows it. It draws only when something changes.
 *
 * This module is the only one that imports three.js, and it's loaded only
 * when the view first opens, so the 2D editor stays small.
 */
export interface View3DProps {
  plan: Plan
  /** Each floor's coverage, coloured for the map on show (D64). */
  maps: ReadonlyMap<string, MapData>
  hiddenFloors: readonly string[]
  spreadM: number
  /** The Heatmap setting: off leaves the floors plain. */
  showHeatmap: boolean
  fullWalls: boolean
  units: Units
  target: CoverageTarget | undefined
}

/** One turn of the Rotate buttons, and of Tilt. */
const STEP_RAD = Math.PI / 12

export default function View3D(props: View3DProps) {
  const { plan, maps, hiddenFloors, spreadM, fullWalls, showHeatmap } = props
  const host = useRef<HTMLDivElement>(null)
  const world = useRef<World>(undefined)
  // Why the view can't draw, if it can't (D93); "Try again" bumps `attempt`.
  const [failure, setFailure] = useState<View3DFailure | undefined>(() =>
    hasWebGL() ? undefined : 'no-webgl',
  )
  const [attempt, setAttempt] = useState(0)
  // With ?fps in the address, a button measures the frame rate (D58).
  const [measuring] = useState(() =>
    new URLSearchParams(window.location.search).has('fps'),
  )
  const layouts = useMemo(
    () => floorLayouts(plan, hiddenFloors, spreadM),
    [plan, hiddenFloors, spreadM],
  )
  const bounds = useMemo(() => sceneBounds(plan, layouts), [plan, layouts])
  // Frame the plan again only when what's drawn changes shape, not on every
  // edit; a new floor or spread does.
  const frameKey = bounds
    ? [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, bounds.bottomM]
        .map((n) => n.toFixed(1))
        .join(',') + `|${bounds.topM.toFixed(1)}`
    : ''

  // The renderer, camera and controls live as long as the view.
  useEffect(() => {
    const element = host.current
    if (failure || !element) return
    // WebGL was there when checked, but the context may not be made, e.g.
    // after too many; that throws to the host, which says so (D93).
    const created = createWorld(element, () => setFailure('lost'))
    world.current = created
    return () => {
      created.dispose()
      world.current = undefined
    }
  }, [failure, attempt])

  // Rebuild the scene when the plan, its coverage or the settings change.
  useEffect(() => {
    // A scene that can't be built throws to the host as well.
    world.current?.show(
      layouts,
      plan,
      showHeatmap ? maps : new Map(),
      fullWalls,
    )
  }, [layouts, plan, maps, fullWalls, showHeatmap, failure, attempt])

  const frame = useEffectEvent(() => {
    if (bounds) world.current?.frame(bounds)
  })
  useEffect(() => frame(), [frameKey, failure, attempt])

  if (failure) {
    return (
      <View3DFailed
        failure={failure}
        onRetry={() => {
          setFailure(undefined)
          setAttempt((n) => n + 1)
        }}
      />
    )
  }

  return (
    <div className="view3d">
      <div
        ref={host}
        className="view3d-canvas"
        role="img"
        aria-label="3D view of the floors, described below"
      />
      <div className="view3d-controls" role="group" aria-label="3D view">
        <button
          type="button"
          onClick={() => world.current?.orbit(-STEP_RAD, 0)}
          title="Rotate left"
          aria-label="Rotate left"
        >
          ↺
        </button>
        <button
          type="button"
          onClick={() => world.current?.orbit(STEP_RAD, 0)}
          title="Rotate right"
          aria-label="Rotate right"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={() => world.current?.orbit(0, -STEP_RAD)}
          title="Tilt up, to look from higher"
          aria-label="Tilt up"
        >
          ⤒
        </button>
        <button
          type="button"
          onClick={() => world.current?.orbit(0, STEP_RAD)}
          title="Tilt down, to look from lower"
          aria-label="Tilt down"
        >
          ⤓
        </button>
        <button
          type="button"
          onClick={() => world.current?.zoom(1 / 1.25)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => world.current?.zoom(1.25)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => bounds && world.current?.frame(bounds)}
          title="Reset the view"
        >
          Reset
        </button>
      </div>
      {measuring && <FrameRate world={world} />}
      <Description {...props} layouts={layouts} />
    </div>
  )
}

/** The ?fps readout: measures rotation frame times on this device (D58). */
function FrameRate({ world }: { world: React.RefObject<World | undefined> }) {
  const [result, setResult] = useState<string>()
  return (
    <div className="view3d-fps" role="status">
      <button
        type="button"
        onClick={async () => {
          setResult('Measuring…')
          const measured = await world.current?.measure()
          setResult(
            measured
              ? `Median ${measured.medianMs.toFixed(1)} ms (${(1000 / measured.medianMs).toFixed(0)} fps), 95th percentile ${measured.p95Ms.toFixed(1)} ms`
              : 'Nothing to measure',
          )
        }}
      >
        Measure frame rate
      </button>
      {result && <span>{result}</span>}
    </div>
  )
}

/**
 * The text alternative (D57): each floor drawn, top first, with its height,
 * what's on it and its coverage.
 */
function Description({
  plan,
  maps,
  layouts,
  units,
  target,
}: View3DProps & { layouts: readonly FloorLayout[] }) {
  if (layouts.length === 0) {
    return <p className="visually-hidden">No floors are shown.</p>
  }
  return (
    <ul className="visually-hidden" aria-label="Floors in the 3D view">
      {[...layouts].reverse().map(({ floor }) => {
        const aps = plan.accessPoints.filter((ap) => ap.floorId === floor.id)
        const map = maps.get(floor.id)
        const names = aps.map((ap) => ap.name).join(', ')
        return (
          <li key={floor.id}>
            {`${floor.name || 'Unnamed floor'}, at ${formatLength(floor.elevationM, units)}: `}
            {`${floor.walls.length} wall${floor.walls.length === 1 ? '' : 's'}, `}
            {aps.length === 0
              ? 'no access points. '
              : `access point${aps.length === 1 ? '' : 's'} ${names}. `}
            {map
              ? mapMessage(map, target, units)
              : 'Coverage is being worked out.'}
          </li>
        )
      })}
    </ul>
  )
}

/** Whether this browser can draw WebGL at all. */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    // Browsers allow only a few contexts at once, so give this one back.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return gl !== null
  } catch {
    return false
  }
}

interface World {
  show(
    layouts: readonly FloorLayout[],
    plan: Plan,
    maps: ReadonlyMap<string, MapData>,
    fullWalls: boolean,
  ): void
  frame(bounds: Bounds): void
  orbit(azimuth: number, polar: number): void
  zoom(factor: number): void
  /**
   * Rotates a step on each of 180 animation frames and returns the median
   * and 95th percentile time between frames, in ms (D58).
   */
  measure(): Promise<{ medianMs: number; p95Ms: number }>
  dispose(): void
}

function createWorld(element: HTMLDivElement, onLost: () => void): World {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch {
    throw new NoContextError()
  }
  try {
    return buildWorld(renderer, element, onLost)
  } catch (error) {
    release(renderer)
    throw error
  }
}

/** Frees a renderer and gives its WebGL context back to the browser. */
function release(renderer: THREE.WebGLRenderer) {
  renderer.dispose()
  renderer.forceContextLoss()
  renderer.domElement.remove()
}

function buildWorld(
  renderer: THREE.WebGLRenderer,
  element: HTMLDivElement,
  onLost: () => void,
): World {
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  element.append(renderer.domElement)
  // The graphics card can take the context away (sleep, another tab); the
  // view then says so rather than freezing on the last frame (D93).
  const lost = (event: Event) => {
    event.preventDefault()
    onLost()
  }
  renderer.domElement.addEventListener('webglcontextlost', lost)
  const style = getComputedStyle(element)
  const token = (name: string) => style.getPropertyValue(name).trim()

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(token('--canvas') || '#f4f3f1')
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(0.6, 1, 0.4)
  scene.add(sun)

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.maxPolarAngle = Math.PI / 2 - 0.05

  let content = new THREE.Group()
  scene.add(content)

  let renders = 0
  const render = () => {
    const started = performance.now()
    renderer.render(scene, camera)
    renders++
    // For the frame-rate check (D57).
    element.dataset['renders'] = String(renders)
    element.dataset['renderMs'] = (performance.now() - started).toFixed(2)
  }
  controls.addEventListener('change', render)

  /**
   * Labels keep a fixed size on screen: a sprite that ignores distance is
   * `scale / tan(fov / 2)` of half the view's height tall.
   */
  const sizeLabels = () => {
    const height = element.clientHeight || 1
    const perPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / height
    content.traverse((object) => {
      const size = object.userData['labelPx'] as [number, number] | undefined
      if (size) object.scale.set(size[0] * perPixel, size[1] * perPixel, 1)
    })
  }

  const resize = () => {
    const width = element.clientWidth
    const height = element.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    sizeLabels()
    render()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(element)

  const materials = new Map<string, THREE.Material>()
  const material = (key: string, make: () => THREE.Material) => {
    let m = materials.get(key)
    if (!m) {
      m = make()
      materials.set(key, m)
    }
    return m
  }

  return {
    show(layouts, plan, maps, fullWalls) {
      scene.remove(content)
      disposeTree(content)
      content = buildContent(layouts, plan, maps, fullWalls, material, token)
      scene.add(content)
      sizeLabels()
      render()
    },
    frame(bounds) {
      // The first framing can come before the size is known.
      if (element.clientHeight > 0) {
        camera.aspect = element.clientWidth / element.clientHeight
        camera.updateProjectionMatrix()
      }
      const centre = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.bottomM + bounds.topM) / 2,
        (bounds.minY + bounds.maxY) / 2,
      )
      const size = Math.max(
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
        bounds.topM - bounds.bottomM,
        4,
      )
      // From the front (plan bottom), above and a little to the right,
      // further back on a narrow (portrait) view so the sides fit.
      const direction = new THREE.Vector3(0.45, 0.85, 1).normalize()
      const distance = (size * 1.7) / Math.min(camera.aspect, 1)
      controls.target.copy(centre)
      camera.position.copy(centre).addScaledVector(direction, distance)
      controls.update()
      render()
    },
    orbit(azimuth, polar) {
      const offset = camera.position.clone().sub(controls.target)
      const spherical = new THREE.Spherical().setFromVector3(offset)
      spherical.theta += azimuth
      spherical.phi = Math.min(
        Math.max(spherical.phi + polar, 0.05),
        controls.maxPolarAngle,
      )
      camera.position
        .copy(controls.target)
        .add(offset.setFromSpherical(spherical))
      controls.update()
      render()
    },
    async measure() {
      const gaps: number[] = []
      let last = performance.now()
      for (let i = 0; i < 180; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const now = performance.now()
        gaps.push(now - last)
        last = now
        this.orbit(Math.PI / 90, 0)
      }
      gaps.sort((a, b) => a - b)
      return { medianMs: gaps[90]!, p95Ms: gaps[171]! }
    },
    zoom(factor) {
      const offset = camera.position.clone().sub(controls.target)
      camera.position.copy(controls.target).addScaledVector(offset, factor)
      controls.update()
      render()
    },
    dispose() {
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      observer.disconnect()
      controls.dispose()
      disposeTree(content)
      for (const m of materials.values()) m.dispose()
      release(renderer)
    },
  }
}

/** Everything drawn for the floors shown. */
function buildContent(
  layouts: readonly FloorLayout[],
  plan: Plan,
  maps: ReadonlyMap<string, MapData>,
  fullWalls: boolean,
  material: (key: string, make: () => THREE.Material) => THREE.Material,
  token: (name: string) => string,
): THREE.Group {
  const group = new THREE.Group()
  const lowest = layouts[0]?.floor.elevationM

  for (const { floor, baseM } of layouts) {
    // The slab, as a faint plate over the floor's extent with its openings
    // cut out; the lowest floor stands on the ground and has none.
    if (floor.nodes.length > 0 && floor.elevationM !== lowest) {
      const xs = floor.nodes.map((n) => n.x)
      const ys = floor.nodes.map((n) => n.y)
      const shape = new THREE.Shape()
      shape.moveTo(Math.min(...xs), Math.min(...ys))
      shape.lineTo(Math.max(...xs), Math.min(...ys))
      shape.lineTo(Math.max(...xs), Math.max(...ys))
      shape.lineTo(Math.min(...xs), Math.max(...ys))
      for (const { points } of floor.floorOpenings ?? []) {
        shape.holes.push(
          new THREE.Path(points.map((p) => new THREE.Vector2(p.x, p.y))),
        )
      }
      const slab = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        material(
          'slab',
          () =>
            new THREE.MeshBasicMaterial({
              color: token('--muted') || '#5e5a66',
              transparent: true,
              opacity: 0.12,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
        ),
      )
      // The shape is drawn in plan x, y: lay it flat with plan y along +z.
      slab.rotation.x = Math.PI / 2
      slab.position.y = baseM - 0.02
      group.add(slab)
    }

    const map = maps.get(floor.id)
    if (map && map.coverage.grid.cols > 0 && map.coverage.grid.rows > 0) {
      const { grid } = map.coverage
      const texture = new THREE.DataTexture(
        heatmapPixels(map),
        grid.cols,
        grid.rows,
        THREE.RGBAFormat,
      )
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      const width = grid.cols * grid.cellM
      const depth = grid.rows * grid.cellM
      const heatmap = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      // Turned so the texture's first row (smallest plan y) is at the far
      // side, as in 2D.
      heatmap.rotation.x = Math.PI / 2
      heatmap.position.set(
        grid.originX + width / 2,
        baseM + 0.01,
        grid.originY + depth / 2,
      )
      group.add(heatmap)
    }

    for (const wall of wallBoxes(floor, fullWalls)) {
      if (wall.length === 0) continue
      const glass = wall.material === 'glass' || wall.material === 'low-e-glass'
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(
          wall.length,
          wall.height,
          wall.opening ? WALL_THICKNESS_M * 0.6 : WALL_THICKNESS_M,
        ),
        material(
          `wall:${wall.material}`,
          () =>
            new THREE.MeshLambertMaterial({
              color: WALL_STYLES[wall.material].colour,
              transparent: glass,
              opacity: glass ? 0.45 : 1,
            }),
        ),
      )
      box.position.set(wall.x, baseM + wall.height / 2, wall.y)
      box.rotation.y = -wall.angle
      group.add(box)
    }
  }

  for (const { ap, heightM } of accessPointMarkers(plan, layouts)) {
    const floorBase = heightM - ap.heightM
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 20, 14),
      material(
        'ap',
        () =>
          new THREE.MeshLambertMaterial({
            color: token('--ap') || '#ffffff',
            emissive: 0x333333,
          }),
      ),
    )
    marker.position.set(ap.x, heightM, ap.y)
    group.add(marker)
    // A thin stand down to its floor shows how high it's mounted.
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, ap.heightM, 8),
      material(
        'stand',
        () =>
          new THREE.MeshBasicMaterial({ color: token('--text') || '#1d1b22' }),
      ),
    )
    stand.position.set(ap.x, floorBase + ap.heightM / 2, ap.y)
    group.add(stand)
    group.add(label(ap.name, ap.x, heightM + 0.45, ap.y, token))
  }
  return group
}

/** A name that always faces the camera, at a fixed size on screen. */
function label(
  text: string,
  x: number,
  y: number,
  z: number,
  token: (name: string) => string,
): THREE.Sprite {
  const scale = 2
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const font = `600 ${13 * scale}px system-ui, sans-serif`
  context.font = font
  const width = Math.ceil(context.measureText(text).width) + 10 * scale
  const height = 22 * scale
  canvas.width = width
  canvas.height = height
  context.font = font
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = 4 * scale
  context.strokeStyle = token('--canvas') || '#f4f3f1'
  context.strokeText(text, 5 * scale, height / 2)
  context.fillStyle = token('--text') || '#1d1b22'
  context.fillText(text, 5 * scale, height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      sizeAttenuation: false,
    }),
  )
  // Its size on screen in CSS pixels; `sizeLabels` scales it to that.
  sprite.userData['labelPx'] = [width / scale, height / scale]
  sprite.position.set(x, y, z)
  sprite.renderOrder = 10
  return sprite
}

/** Frees the geometries and textures of everything in a group. */
function disposeTree(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      const m = object.material as THREE.Material & { map?: THREE.Texture }
      // Shared materials live in the cache; per-object ones carry a map.
      if (m.map) {
        m.map.dispose()
        m.dispose()
      }
    }
    if (object instanceof THREE.Sprite) {
      object.material.map?.dispose()
      object.material.dispose()
    }
  })
}
