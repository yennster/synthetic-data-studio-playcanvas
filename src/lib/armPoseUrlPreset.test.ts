/**
 * Integration test for the `?armPose=` deep link: parse → applyUrlPresets
 * → store `robot.armHomePose`. Named separately from applyUrlPresets so
 * it stays out of the way of the (parallel-owned) preset-application
 * module's own future test file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { refreshUrlParams } from './urlParams';
import {
  applyUrlPresets,
  _resetApplyUrlPresetsForTest,
} from './applyUrlPresets';
import { BRACCIO_REST_RAD } from './braccio';
import { DEFAULT_ROBOT, useStore } from '../store/useStore';

function applyWithSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
  refreshUrlParams();
  _resetApplyUrlPresetsForTest();
  applyUrlPresets();
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  refreshUrlParams();
  _resetApplyUrlPresetsForTest();
  useStore.getState().setRobot({ armHomePose: [...BRACCIO_REST_RAD] });
});

describe('?armPose= url preset', () => {
  it('defaults the store home pose to the Braccio rest pose', () => {
    expect(DEFAULT_ROBOT.armHomePose).toEqual([...BRACCIO_REST_RAD]);
  });

  it('writes a valid six-float pose to robot.armHomePose', () => {
    applyWithSearch('?armPose=1.57,1.0,0.5,1.57,1.57,0.5');
    expect(useStore.getState().robot.armHomePose).toEqual([
      1.57, 1.0, 0.5, 1.57, 1.57, 0.5,
    ]);
  });

  it('leaves the home pose untouched when the param is absent or invalid', () => {
    const before = useStore.getState().robot.armHomePose;
    applyWithSearch('?armPose=1,2,3'); // wrong arity → dropped by the parser
    expect(useStore.getState().robot.armHomePose).toEqual(before);
  });
});
