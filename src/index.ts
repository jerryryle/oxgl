import { native } from './native.js';

export {
  createContext,
  WebGL2RenderingContext,
  WebGLRenderingContext,
  type ContextBackend,
  type ContextOptions,
} from './context.js';

/** Version of the JS ↔ native interface reported by the loaded addon. */
export const nativeAbiVersion: number = native.nativeAbiVersion();
