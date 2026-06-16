import {
  SplatCollisionProxyPreview,
  SplatEnvironment,
  createPairedSplatEnvironment,
  getSplatEnvironmentReadiness,
  parseSplatCollisionProxyGeoms,
  useSplatCollisionProxyGeoms,
  useSplatSceneConfig,
  withSplatEnvironment,
} from '../src';
import type {
  PairedSplatEnvironmentConfig,
  SceneConfig,
  SplatCollisionProxyGeomPreview,
  SplatCollisionProxyPreviewStatus,
  SplatEnvironmentReadinessStatus,
  VisualScenarioConfig,
} from '../src';
import {
  SparkSplatEnvironment,
  useSparkSplatEnvironment,
} from '../src/spark';

const sceneConfig = {
  src: '/models/robot/',
  sceneFile: 'robot.xml',
  environmentFiles: ['fixtures/table.xml'],
} satisfies SceneConfig;

const kitchen = {
  id: 'kitchen-lighting-a',
  label: 'Kitchen lighting A',
  environment: 'gaussian-splat',
  splat: {
    enabled: true,
    src: '/models/robot/splats/kitchen/scene.spz',
    format: 'spz',
    requiresCollisionProxy: true,
    collisionProxy: {
      xmlPath: '/models/robot/splats/kitchen/scene.xml',
      status: 'validated',
      notes: ['Paired visual splat with MJCF collision proxy.'],
    },
  },
} satisfies VisualScenarioConfig;

const visualOnlySplat = {
  id: 'visual-only-lab',
  label: 'Visual-only lab capture',
  environment: 'gaussian-splat',
  splat: {
    enabled: true,
    src: '/models/robot/splats/lab/scene.spz',
    format: 'spz',
    requiresCollisionProxy: false,
  },
} satisfies VisualScenarioConfig;

const pairedEnvironment = createPairedSplatEnvironment(kitchen, {
  renderer: 'spark',
});

const readyStatus: SplatEnvironmentReadinessStatus =
  getSplatEnvironmentReadiness({
    scenario: kitchen,
    renderer: 'spark',
  }).status;
const missingProxyStatus: SplatEnvironmentReadinessStatus =
  getSplatEnvironmentReadiness({
    scenario: {
      ...kitchen,
      splat: {
        ...kitchen.splat,
        collisionProxy: null,
      },
    },
    renderer: 'spark',
  }).status;
const unsupportedSparkStatus: SplatEnvironmentReadinessStatus =
  getSplatEnvironmentReadiness({
    scenario: {
      ...kitchen,
      splat: {
        ...kitchen.splat,
        format: 'ply',
      },
    },
    renderer: 'spark',
  }).status;
const visualOnlySplatStatus: SplatEnvironmentReadinessStatus =
  getSplatEnvironmentReadiness({
    scenario: visualOnlySplat,
    renderer: 'spark',
  }).status;

void readyStatus;
void missingProxyStatus;
void unsupportedSparkStatus;
void visualOnlySplatStatus;

if (pairedEnvironment) {
  const explicitEnvironment = {
    id: 'warehouse',
    label: 'Warehouse',
    splat: {
      src: '/models/robot/splats/warehouse/scene.spz',
      format: 'spz',
    },
    collisionProxy: {
      xmlPath: '/models/robot/splats/warehouse/scene.xml',
      status: 'generated',
    },
  } satisfies PairedSplatEnvironmentConfig;

  const composedFromScenario = withSplatEnvironment(sceneConfig, kitchen);
  const composedFromEnvironment = withSplatEnvironment(
    composedFromScenario,
    explicitEnvironment,
  );

  composedFromEnvironment.environmentFiles?.includes(
    'splats/warehouse/scene.xml',
  );
}

function RendererAgnosticSplatHarness() {
  const splat = useSplatSceneConfig({
    sceneConfig,
    scenario: kitchen,
    renderer: 'custom',
  });
  const readinessReady: boolean = splat.readiness.ready;
  void readinessReady;
  const proxy = splat.environment?.collisionProxy;

  return (
    <SplatEnvironment
      environment={splat.environment}
      renderer="custom"
      collisionProxy={
        proxy ? <SplatCollisionProxyPreview collisionProxy={proxy} /> : undefined
      }
      position={[0, 0, 0]}
      showPlaceholder={false}
    >
      <group userData={{ renderer: 'app-owned' }} />
    </SplatEnvironment>
  );
}

function SplatCollisionProxyPreviewHarness() {
  const proxy = kitchen.splat.collisionProxy;
  const state = useSplatCollisionProxyGeoms({
    collisionProxy: proxy,
    xmlText: '<mujoco><worldbody><geom name="floor" type="plane" size="2 2 0.05"/></worldbody></mujoco>',
  });
  const status: SplatCollisionProxyPreviewStatus = state.status;
  const firstGeom: SplatCollisionProxyGeomPreview | undefined = state.geoms[0];
  const parsed = parseSplatCollisionProxyGeoms(
    '<mujoco><worldbody><body pos="1 0 0"><geom type="box" size="0.2 0.3 0.4"/></body></worldbody></mujoco>',
  );
  const parsedGeom: SplatCollisionProxyGeomPreview | undefined = parsed[0];
  void status;
  void firstGeom;
  void parsedGeom;

  return (
    <SplatCollisionProxyPreview
      collisionProxy={proxy}
      xmlText='<mujoco><worldbody><geom type="sphere" size="0.1"/></worldbody></mujoco>'
      color="#f97316"
      opacity={0.2}
    />
  );
}

function SparkSplatHarness() {
  const splat = useSparkSplatEnvironment({
    sceneConfig,
    scenario: kitchen,
    onStatusChange: (status) => {
      const _: 'idle' | 'loading' | 'ready' | 'error' = status;
      void _;
    },
    onError: (error) => {
      error.message.toUpperCase();
    },
  });
  const readinessStatus: SplatEnvironmentReadinessStatus = splat.readiness.status;
  void readinessStatus;

  return (
    <SparkSplatEnvironment
      {...splat.props}
      hideGroundMeshes
      onLoad={(mesh) => {
        mesh.visible = true;
      }}
    />
  );
}

function VisualOnlySparkSplatHarness() {
  const splat = useSparkSplatEnvironment({
    sceneConfig,
    scenario: visualOnlySplat,
  });
  const readinessReady: boolean = splat.readiness.ready;
  const visualSrc: string | undefined = splat.props.src;
  const sceneWithoutProxy: SceneConfig = splat.sceneConfig;
  void readinessReady;
  void visualSrc;
  void sceneWithoutProxy;

  return <SparkSplatEnvironment {...splat.props} />;
}

void RendererAgnosticSplatHarness;
void SplatCollisionProxyPreviewHarness;
void SparkSplatHarness;
void VisualOnlySparkSplatHarness;
