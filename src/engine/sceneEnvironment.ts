import {
  Color,
  Entity,
  SHADOW_PCSS_32F,
  StandardMaterial,
  type AppBase,
} from 'playcanvas';

export interface SceneEnvironment {
  ground: Entity;
  keyLight: Entity;
  fillLight: Entity;
  /** Show/hide the procedural ground (hidden when a splat backdrop provides one). */
  setGroundVisible(visible: boolean): void;
  setGroundColor(color: Color): void;
  /** Key light intensity, used by domain randomization. */
  setLightIntensity(intensity: number): void;
  /** Key light direction as euler angles. */
  setLightAngles(x: number, y: number): void;
  destroy(): void;
}

/**
 * Builds the default studio environment: a ground plane that receives
 * shadows and a two-light rig. Splat backdrops can replace the ground.
 */
export function createSceneEnvironment(app: AppBase, parent: Entity): SceneEnvironment {
  const groundMaterial = new StandardMaterial();
  groundMaterial.diffuse = new Color(0.42, 0.43, 0.45);
  groundMaterial.gloss = 0.3;
  groundMaterial.metalness = 0.2;
  groundMaterial.useMetalness = true;
  groundMaterial.update();

  const ground = new Entity('ground', app);
  ground.addComponent('render', {
    type: 'box',
    material: groundMaterial,
    castShadows: false,
  });
  ground.setLocalScale(30, 0.1, 30);
  ground.setLocalPosition(0, -0.05, 0);
  parent.addChild(ground);

  const keyLight = new Entity('key-light', app);
  keyLight.addComponent('light', {
    type: 'directional',
    color: Color.WHITE,
    castShadows: true,
    intensity: 1.6,
    shadowBias: 0.2,
    normalOffsetBias: 0.05,
    shadowDistance: 24,
    shadowResolution: 2048,
    shadowType: SHADOW_PCSS_32F,
    shadowIntensity: 0.6,
  });
  keyLight.setEulerAngles(50, 30, 0);
  parent.addChild(keyLight);

  const fillLight = new Entity('fill-light', app);
  fillLight.addComponent('light', {
    type: 'directional',
    color: new Color(0.8, 0.85, 1.0),
    castShadows: false,
    intensity: 0.5,
  });
  fillLight.setEulerAngles(-40, -120, 0);
  parent.addChild(fillLight);

  app.scene.ambientLight = new Color(0.25, 0.25, 0.28);

  return {
    ground,
    keyLight,
    fillLight,
    setGroundVisible(visible: boolean) {
      ground.enabled = visible;
    },
    setGroundColor(color: Color) {
      groundMaterial.diffuse = color;
      groundMaterial.update();
    },
    setLightIntensity(intensity: number) {
      keyLight.light!.intensity = intensity;
    },
    setLightAngles(x: number, y: number) {
      keyLight.setEulerAngles(x, y, 0);
    },
    destroy() {
      ground.destroy();
      keyLight.destroy();
      fillLight.destroy();
    },
  };
}
