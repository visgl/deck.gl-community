import {render, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {Deckgl} from '../components';

// Mock the shared module for log
vi.mock(import('../../shared'), () => {
  const mockEnableLogging = vi.fn<() => void>();
  const mockDisableLogging = vi.fn<() => void>();

  return {
    log: {
      disableLogging: mockDisableLogging,
      enableLogging: mockEnableLogging
    },
    mockDisableLogging,
    mockEnableLogging
  };
});

// Mock the reconciler module
vi.mock(import('../../reconciler'), () => {
  const mockRender = vi.fn<() => void>();
  const mockConfigure = vi.fn<() => void>();
  const mockCreateRoot = vi.fn<() => unknown>(() => ({
    configure: mockConfigure,
    render: mockRender,
    store: {
      getState: vi.fn<() => unknown>(),
      setState: vi.fn<() => void>(),
      subscribe: vi.fn<() => void>()
    }
  }));
  const mockUnmountAtNode = vi.fn<() => void>();
  const mockRoots = new Map();

  return {
    createRoot: mockCreateRoot,
    mockConfigure,
    mockCreateRoot,
    mockRender,
    mockRoots,
    mockUnmountAtNode,
    roots: mockRoots,
    unmountAtNode: mockUnmountAtNode
  };
});

// Get the mocks after they've been set up
const {mockRender, mockConfigure, mockCreateRoot, mockUnmountAtNode, mockRoots} = (await import(
  '../../reconciler'
)) as unknown as {
  mockRender: ReturnType<typeof vi.fn>;
  mockConfigure: ReturnType<typeof vi.fn>;
  mockCreateRoot: ReturnType<typeof vi.fn>;
  mockUnmountAtNode: ReturnType<typeof vi.fn>;
  mockRoots: Map<unknown, unknown>;
};

const {mockEnableLogging, mockDisableLogging} = (await import('../../shared')) as unknown as {
  mockEnableLogging: ReturnType<typeof vi.fn>;
  mockDisableLogging: ReturnType<typeof vi.fn>;
};

describe('Deckgl Component Tests', () => {
  beforeEach(() => {
    mockRoots.clear();
  });

  describe('Basic rendering', () => {
    it('should create reconciler root on mount', () => {
      render(
        <Deckgl>
          <div>Test content</div>
        </Deckgl>
      );

      expect(mockCreateRoot).toHaveBeenCalledWith(expect.any(HTMLCanvasElement));
    });

    it('should render canvas in standalone mode', () => {
      render(
        <Deckgl>
          <div>Content</div>
        </Deckgl>
      );

      const canvas = document.querySelector('#deckgl-fiber-canvas');
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas?.tagName).toBe('CANVAS');
    });

    it('should render hidden div in interleaved mode', () => {
      render(
        <Deckgl interleaved>
          <div>Content</div>
        </Deckgl>
      );

      const interleaveDiv = document.querySelector('#deckgl-fiber-interleave');
      expect(interleaveDiv).toBeInstanceOf(HTMLDivElement);
      expect(interleaveDiv?.hasAttribute('hidden')).toBeTruthy();
    });

    it('should not render canvas or wrapper elements in interleaved mode', () => {
      const {container} = render(
        <Deckgl interleaved>
          <div>Test</div>
        </Deckgl>
      );

      const canvas = container.querySelector('#deckgl-fiber-canvas');
      const wrapper = container.querySelector('#deckgl-fiber-wrapper');
      expect(canvas).toBeNull();
      expect(wrapper).toBeNull();
    });
  });

  describe('Props handling', () => {
    it('should pass props to root.configure', () => {
      const props = {
        initialViewState: {
          latitude: 0,
          longitude: 0,
          zoom: 1
        }
      };

      render(
        <Deckgl {...props}>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          initialViewState: props.initialViewState
        })
      );
    });

    it('should handle prop updates without debug', () => {
      const {rerender} = render(
        <Deckgl initialViewState={{latitude: 0, longitude: 0, zoom: 1}}>
          <div>Test</div>
        </Deckgl>
      );

      rerender(
        <Deckgl initialViewState={{latitude: 10, longitude: 10, zoom: 2}}>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          initialViewState: {latitude: 10, longitude: 10, zoom: 2}
        })
      );
    });
  });

  describe('Canvas ref timing', () => {
    it('should pass canvas ref to root.configure after ref is set', async () => {
      render(
        <Deckgl>
          <div>Test</div>
        </Deckgl>
      );

      await waitFor(() => {
        expect(mockConfigure).toHaveBeenCalledWith(
          expect.objectContaining({
            canvas: expect.any(HTMLCanvasElement)
          })
        );
      });

      const configCall = mockConfigure.mock.calls[0][0] as {canvas: HTMLCanvasElement};
      expect(configCall.canvas.id).toBe('deckgl-fiber-canvas');
    });

    it('should pass parent ref to root.configure after ref is set', async () => {
      render(
        <Deckgl>
          <div>Test</div>
        </Deckgl>
      );

      await waitFor(() => {
        expect(mockConfigure).toHaveBeenCalledWith(
          expect.objectContaining({
            parent: expect.any(HTMLDivElement)
          })
        );
      });

      const configCall = mockConfigure.mock.calls[0][0] as {parent: HTMLDivElement};
      expect(configCall.parent.id).toBe('deckgl-fiber-wrapper');
    });

    it('should not override explicit canvas prop with ref canvas', () => {
      const explicitCanvas = document.createElement('canvas');
      explicitCanvas.id = 'custom-canvas';
      document.body.append(explicitCanvas);

      render(
        <Deckgl canvas={explicitCanvas}>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          canvas: explicitCanvas
        })
      );

      const configCall = mockConfigure.mock.calls[0][0] as {canvas: HTMLCanvasElement};
      expect(configCall.canvas).toBe(explicitCanvas);
      expect(configCall.canvas.id).toBe('custom-canvas');

      explicitCanvas.remove();
    });

    it('should not override explicit parent prop with ref parent', () => {
      const explicitParent = document.createElement('div');
      explicitParent.id = 'custom-parent';
      document.body.append(explicitParent);

      render(
        <Deckgl parent={explicitParent}>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: explicitParent
        })
      );

      const configCall = mockConfigure.mock.calls[0][0] as {parent: HTMLDivElement};
      expect(configCall.parent).toBe(explicitParent);
      expect(configCall.parent.id).toBe('custom-parent');

      explicitParent.remove();
    });
  });

  describe('Interleaved mode ref handling', () => {
    it('should use interleave div ref for root creation in interleaved mode', () => {
      render(
        <Deckgl interleaved>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockCreateRoot).toHaveBeenCalledWith(expect.any(HTMLDivElement));
      const rootCall = mockCreateRoot.mock.calls[0][0] as HTMLDivElement;
      expect(rootCall.id).toBe('deckgl-fiber-interleave');
    });

    it('should use canvas ref for root creation in standalone mode', () => {
      render(
        <Deckgl>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockCreateRoot).toHaveBeenCalledWith(expect.any(HTMLCanvasElement));
      const rootCall = mockCreateRoot.mock.calls[0][0] as HTMLCanvasElement;
      expect(rootCall.id).toBe('deckgl-fiber-canvas');
    });
  });

  describe('Debug logging', () => {
    it('should enable logging when debug prop is true', () => {
      render(
        <Deckgl debug>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockEnableLogging).toHaveBeenCalledWith();
    });

    it('should disable logging when debug prop is false', () => {
      render(
        <Deckgl debug={false}>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockDisableLogging).toHaveBeenCalledWith();
    });

    it('should handle undefined debug prop as falsy', () => {
      render(
        <Deckgl>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockDisableLogging).toHaveBeenCalledWith();
      expect(mockEnableLogging).not.toHaveBeenCalled();
    });

    it('should toggle debug mode', () => {
      const {rerender} = render(
        <Deckgl debug={false}>
          <div>Test</div>
        </Deckgl>
      );

      rerender(
        <Deckgl debug>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockEnableLogging).toHaveBeenCalledWith();
    });

    it('should toggle logging multiple times', () => {
      const {rerender} = render(
        <Deckgl debug={false}>
          <div>Test</div>
        </Deckgl>
      );

      rerender(
        <Deckgl debug>
          <div>Test</div>
        </Deckgl>
      );

      rerender(
        <Deckgl debug={false}>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockEnableLogging).toHaveBeenCalledOnce();
      expect(mockDisableLogging).toHaveBeenCalledTimes(2);
    });
  });

  describe('Children updates', () => {
    it('should handle children updates', () => {
      const {rerender} = render(
        <Deckgl>
          <div>Initial</div>
        </Deckgl>
      );

      rerender(
        <Deckgl>
          <div>Updated</div>
        </Deckgl>
      );

      expect(mockRender).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cleanup behavior', () => {
    it('should call unmountAtNode with correct node in standalone mode', () => {
      const {unmount} = render(
        <Deckgl>
          <div>Test</div>
        </Deckgl>
      );

      unmount();

      expect(mockUnmountAtNode).toHaveBeenCalledExactlyOnceWith(expect.any(HTMLCanvasElement));
      const unmountCall = mockUnmountAtNode.mock.calls[0][0] as HTMLCanvasElement;
      expect(unmountCall.id).toBe('deckgl-fiber-canvas');
    });

    it('should call unmountAtNode with correct node in interleaved mode', () => {
      const {unmount} = render(
        <Deckgl interleaved>
          <div>Test</div>
        </Deckgl>
      );

      unmount();

      expect(mockUnmountAtNode).toHaveBeenCalledExactlyOnceWith(expect.any(HTMLDivElement));
      const unmountCall = mockUnmountAtNode.mock.calls[0][0] as HTMLDivElement;
      expect(unmountCall.id).toBe('deckgl-fiber-interleave');
    });
  });

  describe('Config memoization', () => {
    it('should call configure when children change', () => {
      const props = {initialViewState: {latitude: 0, longitude: 0, zoom: 1}};
      const {rerender} = render(
        <Deckgl {...props}>
          <div>Initial</div>
        </Deckgl>
      );

      rerender(
        <Deckgl {...props}>
          <div>Updated</div>
        </Deckgl>
      );

      expect(mockConfigure).toHaveBeenCalledTimes(2);
    });

    it('should call configure with updated props', () => {
      const {rerender} = render(
        <Deckgl initialViewState={{latitude: 0, longitude: 0, zoom: 1}}>
          <div>Test</div>
        </Deckgl>
      );

      rerender(
        <Deckgl initialViewState={{latitude: 10, longitude: 10, zoom: 2}}>
          <div>Test</div>
        </Deckgl>
      );

      expect(mockConfigure).toHaveBeenCalledTimes(2);
      expect(mockConfigure).toHaveBeenLastCalledWith(
        expect.objectContaining({
          initialViewState: {latitude: 10, longitude: 10, zoom: 2}
        })
      );
    });
  });
});
