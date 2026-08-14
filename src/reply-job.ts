/**
 * Optional model Consumer that turns one Fleet reply receipt into a background job.
 * @module @wha1echai/dsh-cross-session/reply-job
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-dsh-cross-session-reply-job'
export const inject = ['tools', 'fleet']

/** Bounded job-output configuration for the optional reply Consumer. */
export interface Config {
  maxOutputBytes: number
}

/** Maximum complete model-facing result size handed to the official Jobs Consumer. */
export const Config: Schema<Config> = Schema.object({
  maxOutputBytes: Schema.number()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .step(1)
    .default(300_000),
})

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'fleet-reply': 'fleet-reply'
  }
}

const VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    jobId: { type: 'string', required: true },
  },
} as const

function receipt(value: string): string {
  if (value.length === 0 || value !== value.trim()) {
    throw new TypeError('reply_receipt must be a non-empty exact receipt without surrounding whitespace')
  }
  return value
}

/** Register `fleet_wait` only while the public Jobs seam is mounted. */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['jobs'], (jobsCtx) => {
    jobsCtx.tools.register(defineTool({
      name: 'fleet_wait',
      description: 'Start a background job that observes the complete target turn for one fleet_send reply receipt. The job does not cancel the target; use job_output/job_kill from the official Jobs Consumer.',
      parameters: {
        reply_receipt: {
          type: 'string',
          required: true,
          description: 'Caller-bound single-observer receipt returned by fleet_send.',
        },
      },
      output: {
        schema: VALUE_SCHEMA,
        render: (_args, value) => [{
          type: 'text',
          text: `Started Fleet reply job ${value.jobId}. Use the official job tools to collect or stop it.`,
        }],
      },
      execute(args, exec) {
        if (exec.agent === undefined) throw new Error('fleet_wait requires an owning agent session')
        exec.signal.throwIfAborted()
        const replyReceipt = receipt(args.reply_receipt)
        const owner = exec.agent
        const controller = new AbortController()
        const jobId = jobsCtx.jobs.start({
          kind: 'fleet-reply',
          label: 'Wait for Fleet reply',
          owner,
          outputLimitBytes: config.maxOutputBytes,
          run: () => ({
            cancel: reason => controller.abort(reason ?? 'Fleet reply job killed'),
            done: jobsCtx.fleet.waitForReply(replyReceipt, {
              callerAgent: owner,
              callerSessionId: owner.session.id,
              signal: controller.signal,
            }).then(
              (result): JobOutcome => ({
                status: 'completed',
                detail: result.outcome,
                output: JSON.stringify(result),
              }),
              (error: unknown): JobOutcome => controller.signal.aborted
                ? { status: 'killed', detail: String(controller.signal.reason ?? 'cancelled') }
                : { status: 'failed', detail: String(error) },
            ),
          }),
        })
        return Promise.resolve({ jobId })
      },
      presentCall: () => ({ card: 'generic', title: 'Wait for Fleet reply', kind: 'execute' }),
    }))
  })
}
