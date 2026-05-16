export interface ModuleGeneratorSchema {
  name: string;
  directory: 'modules' | 'composition';
  withCqrs: boolean;
}
