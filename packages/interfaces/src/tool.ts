/**
 * ToolInterface — tools are the only way agents touch the outside world, and
 * every tool declares typed schemas for its input and output.
 */

import type { SchemaSpec, SchemaValidation } from './schema'
import { formatViolations, validateAgainstSchema } from './schema'

export interface ToolContext {
  /** workspace_id travels with every context and every table from day one (spec locked decision 11). */
  readonly workspaceId: string
  /** Workflow or agent run this call belongs to — the traceability link. */
  readonly runId?: string
}

export type ToolResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string }

export interface ToolSpec {
  readonly name: string
  readonly description: string
  readonly inputSchema: SchemaSpec
  readonly outputSchema: SchemaSpec
  execute(input: unknown, context: ToolContext): Promise<ToolResult>
}

export interface ToolInterface {
  readonly name: string
  readonly description: string
  readonly inputSchema: SchemaSpec
  readonly outputSchema: SchemaSpec
  execute(input: unknown, context: ToolContext): Promise<ToolResult>
}

/**
 * Wraps a tool so its typed schemas are enforced, not decorative: input is
 * validated before execute, output after. A schema violation on the way out is
 * a defect — surfaced as a failed result, never swallowed.
 */
export function defineTool(spec: ToolSpec): ToolInterface {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
      const inputCheck = validateAgainstSchema(spec.inputSchema, input)
      if (!inputCheck.ok) {
        return { ok: false, error: `invalid input for tool ${spec.name}: ${formatViolations(inputCheck)}` }
      }
      const result = await spec.execute(input, context)
      if (!result.ok) {
        return result
      }
      const outputCheck = validateAgainstSchema(spec.outputSchema, result.data)
      if (!outputCheck.ok) {
        return {
          ok: false,
          error: `tool ${spec.name} returned output violating its schema: ${formatViolations(outputCheck)}`,
        }
      }
      return result
    },
  }
}

export type { SchemaSpec, SchemaValidation }
