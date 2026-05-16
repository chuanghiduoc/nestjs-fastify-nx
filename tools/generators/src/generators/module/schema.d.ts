export interface ModuleGeneratorSchema {
  name: string;
  // CLI enforces enum ["modules","composition"] via schema.json. The type is
  // widened to string so programmatic callers can pass full-path equivalents
  // ("libs/modules", "libs/composition") — normalizeDirectory() validates and
  // maps them to the canonical enum at runtime.
  directory: string;
  withCqrs: boolean;
}
