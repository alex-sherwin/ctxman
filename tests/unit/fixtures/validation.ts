// Test helpers over the validate() facade (src/datasets/validate.ts): read the issues / data of a ParseResult
// without narrowing it first.
import type { ParseResult, ValidationIssue } from '../../../src/datasets/validate.ts';

export function issuesOf(result: ParseResult<unknown>): ValidationIssue[] {
  return result.success ? [] : result.issues;
}

export function dataOf<T>(result: ParseResult<T>): T | undefined {
  return result.success ? result.data : undefined;
}
