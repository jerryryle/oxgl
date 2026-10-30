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
  WebGLFramebuffer,
  WebGLObject,
  WebGLRenderbuffer,
  WebGLProgram,
  WebGLQuery,
  WebGLSync,
  WebGLTransformFeedback,
  WebGLVertexArrayObject,
  WebGLSampler,
  WebGLShader,
  WebGLShaderPrecisionFormat,
  WebGLTexture,
  WebGLUniformLocation,
} from './objects.js';

/** Version of the JS ↔ native interface reported by the loaded addon. */
export const nativeAbiVersion: number = native.nativeAbiVersion();
