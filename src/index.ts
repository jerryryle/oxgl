import { native } from './native.js';

export {
  createContext,
  HeadlessCanvas,
  WebGL2RenderingContext,
  WebGLRenderingContext,
  WebGLContextEvent,
  type WebGLContextEventInit,
  type ContextBackend,
  type ContextOptions,
  type WebGLContextAttributes,
  type WebGLPowerPreference,
} from './context.js';

export {
  WebGLActiveInfo,
  WebGLBuffer,
  WebGLFramebuffer,
  WebGLObject,
  WebGLRenderbuffer,
  WebGLProgram,
  WebGLQuery,
  WebGLSync,
  WebGLTransformFeedback,
  WebGLVertexArrayObject,
  WebGLVertexArrayObjectOES,
  WebGLSampler,
  WebGLShader,
  WebGLShaderPrecisionFormat,
  WebGLTexture,
  WebGLUniformLocation,
} from './objects.js';

export type { ExtensionMap } from './extensions.js';

/** Version of the JS ↔ native interface reported by the loaded addon. */
export const nativeAbiVersion: number = native.nativeAbiVersion();
