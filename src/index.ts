import { native } from './native.js';

export {
  createContext,
  HeadlessCanvas,
  WebGL2RenderingContext,
  WebGLRenderingContext,
  WebGLShaderPrecisionFormat,
  type ContextBackend,
  type ContextOptions,
  type WebGLContextAttributes,
  type WebGLPowerPreference,
} from './context.js';

/** Version of the JS ↔ native interface reported by the loaded addon. */
export const nativeAbiVersion: number = native.nativeAbiVersion();
