// WebIDL argument conversions (https://webidl.spec.whatwg.org/#es-type-mapping)
// shared by the context and object classes. Conversions run before native
// code, so native code never re-enters JS (conversions can call user
// `valueOf`).

/** Guards the constructors: contexts and objects come only from oxgl. */
export const CONSTRUCTING = Symbol('oxgl.constructing');

export function toNumber(value: unknown): number {
  // Unary plus is ToNumber, which throws for BigInt and Symbol as WebIDL does.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- the static type is not the runtime one
  return +(value as number);
}
export function toFloat(value: unknown): number {
  return Math.fround(toNumber(value));
}
export function toLong(value: unknown): number {
  return toNumber(value) | 0;
}
export function toUnsignedLong(value: unknown): number {
  return toNumber(value) >>> 0;
}
/** `long long` (`GLintptr`, `GLsizeiptr`, `GLint64`): exact for |x| < 2^53, which is every size a buffer can have. */
export function toLongLong(value: unknown): number {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return 0;
  const t = Math.trunc(n);
  return Number.isSafeInteger(t) ? t : Number(BigInt.asIntN(64, BigInt(t)));
}
/** `unsigned long long`. */
export function toUnsignedLongLong(value: unknown): number {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return 0;
  const t = Math.trunc(n);
  return Number.isSafeInteger(t) && t >= 0 ? t : Number(BigInt.asUintN(64, BigInt(t)));
}
export function toBoolean(value: unknown): boolean {
  return Boolean(value);
}
export function toDOMString(value: unknown): string {
  if (typeof value === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
  return String(value);
}

export function requireArguments(name: string, required: number, given: number): void {
  if (given < required) {
    throw new TypeError(
      `Failed to execute '${name}': ${String(required)} argument${required === 1 ? '' : 's'} required, but only ${String(given)} present.`,
    );
  }
}

type TypedArrayOf<T> = T extends Float32ArrayConstructor
  ? Float32Array
  : T extends Int32ArrayConstructor
    ? Int32Array
    : Uint32Array;

/**
 * `Float32List`, `Int32List` or `Uint32List`: the typed array itself, or a
 * `sequence<T>` (any iterable) converted element by element.
 */
export function toList<C extends Float32ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor>(
  Type: C,
  convert: (value: unknown) => number,
  value: unknown,
  method: string,
): TypedArrayOf<C> {
  if (value instanceof Type) return value as TypedArrayOf<C>;
  if (typeof value === 'object' && value !== null && Symbol.iterator in value) {
    return (Type as Float32ArrayConstructor).from(value as Iterable<unknown>, convert) as TypedArrayOf<C>;
  }
  throw new TypeError(`Failed to execute '${method}': The provided value cannot be converted to a sequence.`);
}

/** Whether `value` is an `ArrayBuffer`, `SharedArrayBuffer` or a view of one (`AllowSharedBufferSource`). */
export function isBufferSource(value: unknown): value is ArrayBufferLike | ArrayBufferView {
  return (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer === 'function' && value instanceof SharedArrayBuffer)
  );
}
