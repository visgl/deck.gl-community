import {ScatterplotLayer} from '@deck.gl/layers';
import {describe, expect, it} from 'vitest';

import {
  getSuspendedCommitReason,
  maySuspendCommit,
  maySuspendCommitInSyncRender,
  maySuspendCommitOnUpdate,
  preloadInstance,
  startSuspendingCommit,
  suspendInstance,
  unhideInstance,
  unhideTextInstance,
  waitForCommitToBeReady
} from '../config';
import {createMockInstance} from './test-utils';

describe('config-suspense', () => {
  describe('unhideInstance()', () => {
    it('should be a no-op', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test'});
      const instance = createMockInstance(layer);
      const props = {layer};

      // Act & Assert
      expect(() => unhideInstance(instance, props)).not.toThrow();
    });
  });

  describe('unhideTextInstance()', () => {
    it('should always throw error for text nodes', () => {
      // Act & Assert
      expect(() => unhideTextInstance()).toThrow(
        'Text nodes are not supported in deck.gl renderer'
      );
    });
  });

  describe('maySuspendCommit()', () => {
    it('should always return false', () => {
      // Act & Assert
      expect(maySuspendCommit('layer', {})).toBeFalsy();
      expect(maySuspendCommit('view', {})).toBeFalsy();
    });
  });

  describe('startSuspendingCommit()', () => {
    it('should return state with pendingCount: 0', () => {
      // Act
      const result = startSuspendingCommit();

      // Assert
      expect(result).toStrictEqual({pendingCount: 0});
    });
  });

  describe('suspendInstance()', () => {
    it('should be a no-op', () => {
      // Act & Assert
      expect(() => suspendInstance('layer', {})).not.toThrow();
    });
  });

  describe('waitForCommitToBeReady()', () => {
    it('should always return null', () => {
      // Arrange
      const state = {pendingCount: 0};

      // Act
      const result = waitForCommitToBeReady(state, 0);

      // Assert
      expect(result).toBeNull();
    });

    it('should work with any suspendedState', () => {
      // Arrange
      const state = {pendingCount: 5};

      // Act
      const result = waitForCommitToBeReady(state, 0);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('maySuspendCommitOnUpdate()', () => {
    it('should always return false', () => {
      // Act & Assert
      expect(maySuspendCommitOnUpdate('layer', {}, {})).toBeFalsy();
      expect(maySuspendCommitOnUpdate('view', {a: 1}, {a: 2})).toBeFalsy();
    });
  });

  describe('maySuspendCommitInSyncRender()', () => {
    it('should always return false', () => {
      // Act & Assert
      expect(maySuspendCommitInSyncRender('layer', {})).toBeFalsy();
      expect(maySuspendCommitInSyncRender('view', {})).toBeFalsy();
    });
  });

  describe('preloadInstance()', () => {
    it('should always return true', () => {
      // Act & Assert
      expect(preloadInstance('layer', {})).toBeTruthy();
      expect(preloadInstance('view', {})).toBeTruthy();
    });
  });

  describe('getSuspendedCommitReason()', () => {
    it('should always return null', () => {
      // Arrange
      const state = {pendingCount: 0};
      const container = {} as never;

      // Act
      const result = getSuspendedCommitReason(state, container);

      // Assert
      expect(result).toBeNull();
    });

    it('should work with any suspendedState', () => {
      // Arrange
      const state = {pendingCount: 10};
      const container = {} as never;

      // Act
      const result = getSuspendedCommitReason(state, container);

      // Assert
      expect(result).toBeNull();
    });
  });
});
