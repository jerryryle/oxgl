import { native } from './native.js';

export {
  createContext,
  HeadlessCanvas,
  WebGL2RenderingContext,
  WebGLRenderingContext,
  type ContextBackend,
  type ContextOptions,
  type WebGLContextAttributes,
  type WebGLPowerPreference,
} from './context.js';

export {
  WebGLActiveInfo,
  WebGLBuffer,
  WebGLObject,
  WebGLProgram,
  WebGLShader,
  WebGLShaderPrecisionFormat,
  WebGLUniformLocation,
} from './objects.js';

/** Version of the JS ↔ native interface reported by the loaded addon. */
export const nativeAbiVersion: number = native.nativeAbiVersion();
