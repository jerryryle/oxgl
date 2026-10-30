// WebGL object interfaces (WebGL 1.0 §5.3–§5.12). Each object holds its
// owning context's state, its native slot key and its deletion flag; the
// context classes reach them through `objectState`.
import { CONSTRUCTING, toDOMString } from './webidl.js';

/** Internal state shared by every WebGL object. */
export interface ObjectState {
  /** The owning context's state object (identity only). */
  readonly owner: object;
  /** Native slot key, or `null` for an object created while the context was lost. */
  readonly key: readonly [number, number] | null;
  /** Deleted, or created invalid. */
  deleted: boolean;
}

/** A shader's extra state. */
export interface ShaderState extends ObjectState {
  readonly type: number;
  source: string;
}

/** A program's extra state. */
export interface ProgramState extends ObjectState {
  readonly attached: Set<WebGLShader>;
  /** Incremented by every `linkProgram`; invalidates older uniform locations. */
  linkCount: number;
}

/** Returns an object's internal state; assigned by `WebGLObject`'s static block. */
export let objectState: (object: WebGLObject) => ObjectState;

/** Base of every WebGL object (WebGL 1.0 §5.3). */
export class WebGLObject {
  readonly #state: ObjectState;
  #label = '';

  static {
    objectState = (object: WebGLObject) => object.#state;
  }

  /** @internal Created by the context. */
  constructor(token: symbol, state: ObjectState) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#state = state;
  }

  /** A debugging label (WebGL 1.0 §5.3). */
  get label(): string {
    return this.#label;
  }

  set label(value: string) {
    this.#label = toDOMString(value);
  }
}

// The `brand` declarations emit nothing; they make the otherwise identical
// classes distinct types, as the IDL interfaces are.

/** WebGL 1.0 §5.4. */
export class WebGLBuffer extends WebGLObject {
  declare private readonly brand: 'WebGLBuffer';
}
/** WebGL 1.0 §5.6. */
export class WebGLProgram extends WebGLObject {
  declare private readonly brand: 'WebGLProgram';
}
/** WebGL 1.0 §5.8. */
export class WebGLShader extends WebGLObject {
  declare private readonly brand: 'WebGLShader';
}
/** WebGL 1.0 §5.9. */
export class WebGLTexture extends WebGLObject {
  declare private readonly brand: 'WebGLTexture';
}
/** WebGL 2.0 §3.3. */
export class WebGLSampler extends WebGLObject {
  declare private readonly brand: 'WebGLSampler';
}

/** Returns a location's state; assigned by `WebGLUniformLocation`'s static block. */
export let locationState: (location: WebGLUniformLocation) => LocationState;

/** A uniform location's state. */
export interface LocationState {
  readonly program: ProgramState;
  readonly linkCount: number;
  readonly location: number;
}

/** WebGL 1.0 §5.10. */
export class WebGLUniformLocation {
  readonly #state: LocationState;

  static {
    locationState = (location) => location.#state;
  }

  /** @internal Returned by `getUniformLocation`. */
  constructor(token: symbol, state: LocationState) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#state = state;
  }
}

/** WebGL 1.0 §5.11. */
export class WebGLActiveInfo {
  readonly #size: number;
  readonly #type: number;
  readonly #name: string;

  /** @internal Returned by `getActiveAttrib` and `getActiveUniform`. */
  constructor(token: symbol, size: number, type: number, name: string) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#size = size;
    this.#type = type;
    this.#name = name;
  }

  get size(): number {
    return this.#size;
  }

  get type(): number {
    return this.#type;
  }

  get name(): string {
    return this.#name;
  }
}

/** A shader numeric format's range and precision (WebGL 1.0 §5.12). */
export class WebGLShaderPrecisionFormat {
  readonly #rangeMin: number;
  readonly #rangeMax: number;
  readonly #precision: number;

  /** @internal Returned by `getShaderPrecisionFormat`. */
  constructor(token: symbol, rangeMin: number, rangeMax: number, precision: number) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#rangeMin = rangeMin;
    this.#rangeMax = rangeMax;
    this.#precision = precision;
  }

  /** Base-2 log of the absolute value of the smallest representable number. */
  get rangeMin(): number {
    return this.#rangeMin;
  }

  /** Base-2 log of the absolute value of the largest representable number. */
  get rangeMax(): number {
    return this.#rangeMax;
  }

  /** Bits of precision. */
  get precision(): number {
    return this.#precision;
  }
}
