import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StudioEngine } from './StudioEngine';
import { rehydrateAssets, snapshotPendingAssets } from './rehydrateAssets';
import { useStore } from '../store/useStore';

const EngineContext = createContext<StudioEngine | null>(null);

/** Access the StudioEngine; null while the engine is booting. */
export function useEngine(): StudioEngine | null {
  return useContext(EngineContext);
}

/**
 * Owns the engine canvas and StudioEngine lifecycle. Children render as UI
 * overlay on top of the canvas.
 */
export function EngineProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<StudioEngine | null>(null);
  const setEngineStatus = useStore((s) => s.setEngineStatus);
  const setSplats = useStore((s) => s.setSplats);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let instance: StudioEngine | null = null;

    StudioEngine.create(canvas)
      .then((created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        instance = created;
        created.splats.onChange((entries) => {
          setSplats(entries);
          snapshotPendingAssets(created);
          // A splat backdrop replaces the procedural ground.
          created.environment.setGroundVisible(
            !entries.some((e) => e.role === 'backdrop')
          );
        });
        created.models.onChange((entries) => {
          useStore.getState().setModels(entries);
          snapshotPendingAssets(created);
        });
        void rehydrateAssets(created);
        // A body falling asleep persists its settled pose (mm-rounded,
        // same convention as routeSelectionTransform). PhysicsWorld's
        // lastPos/lastYaw watermark recognizes the resulting store echo
        // so it never teleports the body it came from.
        created.physics.onSettled = (id, pose) => {
          const s = useStore.getState();
          if (!s.sceneObjects.some((o) => o.id === id)) return;
          s.updateObject(id, { position: pose.position, rotation: pose.rotation });
        };
        // Mirror store scene objects into engine entities (+ physics bodies),
        // and the conveyor toggle/speed into belt visuals + colliders.
        const syncBelt = (show: boolean, speed: number) => {
          created.conveyor.setActive(show);
          created.conveyor.setSpeed(speed);
          created.physics.setBelt(show, speed);
        };
        // Physics first: body creation/removal must settle before
        // objects.sync asks isTracking() to decide pose ownership (a
        // physics→off toggle otherwise leaves the entity stale for a
        // frame at the removed body's last pose).
        created.physics.syncObjects(useStore.getState().sceneObjects);
        created.objects.sync(useStore.getState().sceneObjects);
        syncBelt(useStore.getState().showConveyor, useStore.getState().conveyorSpeed);
        const unsubObjects = useStore.subscribe((state, prev) => {
          if (state.sceneObjects !== prev.sceneObjects) {
            created.physics.syncObjects(state.sceneObjects);
            created.objects.sync(state.sceneObjects);
          }
          if (
            state.showConveyor !== prev.showConveyor ||
            state.conveyorSpeed !== prev.conveyorSpeed
          ) {
            syncBelt(state.showConveyor, state.conveyorSpeed);
          }
        });
        created.app.on('destroy', unsubObjects);
        setEngine(created);
        setEngineStatus('ready');
        if (import.meta.env.DEV) {
          (window as unknown as { __studio?: StudioEngine }).__studio = created;
        }
      })
      .catch((err: Error) => {
        console.error('Engine boot failed', err);
        if (!disposed) setEngineStatus('error', err.message);
      });

    return () => {
      disposed = true;
      setEngine(null);
      instance?.destroy();
    };
  }, [setEngineStatus, setSplats]);

  return (
    <div className="engine-root">
      <canvas ref={canvasRef} className="engine-canvas" />
      <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>
    </div>
  );
}
