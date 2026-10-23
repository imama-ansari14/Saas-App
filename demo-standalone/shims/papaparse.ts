// The standalone demo loads Papa Parse from cdnjs as a global instead of bundling it.
const Papa = (globalThis as unknown as { Papa: unknown }).Papa;
export default Papa;
