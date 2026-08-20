import {
  AnimComponentSystem,
  AnimClipHandler,
  AnimStateGraphHandler,
  AppBase,
  AppOptions,
  CameraComponentSystem,
  ContainerHandler,
  CubemapHandler,
  FILLMODE_FILL_WINDOW,
  GSplatComponentSystem,
  GSplatHandler,
  Keyboard,
  LightComponentSystem,
  Mouse,
  RESOLUTION_AUTO,
  RenderComponentSystem,
  RenderHandler,
  ScriptComponentSystem,
  ScriptHandler,
  TextureHandler,
  TouchDevice,
  createGraphicsDevice,
} from 'playcanvas';

/**
 * Creates a PlayCanvas AppBase configured for the studio: gsplat rendering,
 * GLB container loading, scripts, and window-fill canvas sizing.
 */
export async function createApp(canvas: HTMLCanvasElement): Promise<AppBase> {
  const device = await createGraphicsDevice(canvas, {
    // Splats do not benefit from MSAA and it is expensive.
    antialias: false,
  });
  device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

  const createOptions = new AppOptions();
  createOptions.graphicsDevice = device;
  createOptions.mouse = new Mouse(canvas);
  createOptions.touch = new TouchDevice(canvas);
  createOptions.keyboard = new Keyboard(window);

  createOptions.componentSystems = [
    RenderComponentSystem,
    CameraComponentSystem,
    LightComponentSystem,
    ScriptComponentSystem,
    GSplatComponentSystem,
    AnimComponentSystem,
  ];
  createOptions.resourceHandlers = [
    TextureHandler,
    CubemapHandler,
    ContainerHandler,
    RenderHandler,
    ScriptHandler,
    GSplatHandler,
    AnimClipHandler,
    AnimStateGraphHandler,
  ];

  const app = new AppBase(canvas);
  app.init(createOptions);

  app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(RESOLUTION_AUTO);

  const resize = () => app.resizeCanvas();
  window.addEventListener('resize', resize);
  app.on('destroy', () => window.removeEventListener('resize', resize));

  return app;
}
