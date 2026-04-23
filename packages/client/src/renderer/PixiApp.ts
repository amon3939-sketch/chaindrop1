/**
 * Thin wrapper around a PIXI.Application so that callers do not need
 * to deal with PIXI's async init contract directly. Manages:
 *
 *   - the fixed 1280x720 internal drawing surface
 *   - attaching to a host canvas
 *   - resizing to fit the window with letterbox
 *   - tearing down on unmount
 *
 * All actual rendering is done by layer classes that mount themselves
 * on `app.stage`.
 */

import { Application, Container } from 'pixi.js';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from './layout';

export interface PixiAppOptions {
  canvas: HTMLCanvasElement;
  background?: number;
  /** Observe `window.resize` and fit the canvas to the viewport. */
  autoFit?: boolean;
}

export class PixiApp {
  readonly app: Application;
  readonly worldContainer: Container;

  private resizeListener: (() => void) | null = null;
  private initialized = false;

  constructor(private opts: PixiAppOptions) {
    this.app = new Application();
    this.worldContainer = new Container();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.app.init({
      canvas: this.opts.canvas,
      width: INTERNAL_WIDTH,
      height: INTERNAL_HEIGHT,
      antialias: true,
      resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      autoDensity: true,
      background: this.opts.background ?? 0x1a1a2e,
    });
    this.app.stage.addChild(this.worldContainer);
    this.initialized = true;

    if (this.opts.autoFit && typeof window !== 'undefined') {
      const onResize = () => this.fitToWindow();
      this.resizeListener = onResize;
      window.addEventListener('resize', onResize);
      onResize();
    }
  }

  /**
   * Resize the host canvas to fit the viewport while preserving the
   * internal 16:9 aspect ratio (letterbox).
   */
  fitToWindow(): void {
    if (!this.initialized) return;
    if (typeof window === 'undefined') return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / INTERNAL_WIDTH, vh / INTERNAL_HEIGHT);
    const outW = Math.floor(INTERNAL_WIDTH * scale);
    const outH = Math.floor(INTERNAL_HEIGHT * scale);
    this.opts.canvas.style.width = `${outW}px`;
    this.opts.canvas.style.height = `${outH}px`;
  }

  destroy(): void {
    if (this.resizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }
    if (this.initialized) {
      this.app.destroy({ removeView: false }, { children: true });
      this.initialized = false;
    }
  }
}
