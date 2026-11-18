import type { Rule } from 'eslint';

declare const rule: Rule.RuleModule;

export declare const CONTRACT_EDGES: Readonly<Record<string, readonly string[]>>;
export declare const INFRA_EDGES: Readonly<Record<string, readonly string[]>>;
export declare function findEdgeCycle(
  edges: Readonly<Record<string, readonly string[]>>,
): string[] | undefined;

export default rule;
