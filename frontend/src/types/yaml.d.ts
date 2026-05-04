// Module declaration for YAML imports handled by @rollup/plugin-yaml.
// Imported YAMLs are parsed into plain JS objects/arrays at build time.
// Consumers should validate the shape at runtime — see profileLoader.ts.
declare module '*.yaml' {
  const data: unknown;
  export default data;
}
