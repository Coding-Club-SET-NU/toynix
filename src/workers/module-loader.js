export async function loadUserlandModule(name) {
  try {
    const module = await import(`../userland/bin/${name}.js`);
    if (!module || typeof module.run !== "function") return null;
    return async (ctx, args) => module.run(ctx, args);
  } catch (error) {
    return null;
  }
}
