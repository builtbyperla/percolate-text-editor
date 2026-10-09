import type { FsEntry } from '../fileexplorer/FileSystemProvider';

export const ORCHESTRATOR_TS = `import { chat, embed, search } from "./providers";
import { MAX_ATTEMPTS, BASE_BACKOFF_MS, MAX_OUTPUT_CHARS } from "./config";
import { RateLimited, ToolError } from "./errors";

// Dispatch one tool call and normalize whatever the provider hands back.
export async function callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    const started = Date.now();
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
            const raw = await invoke(name, args);
            return {
                tool: name,
                output: raw.text,
                attempts,
                elapsedMs: Date.now() - started,
                truncated: raw.text.length >= MAX_OUTPUT_CHARS,
            };
        } catch (err) {
            if (!(err instanceof RateLimited)) throw err;
            await sleep(BASE_BACKOFF_MS * 2 ** (attempts - 1));
        }
    }

    throw new ToolError(\`tool \${name} gave up after \${MAX_ATTEMPTS} attempts\`);
}

// Tool arguments are flat strings on purpose: they come off a model response,
// so anything richer would just be parsed back out again.
export type ToolArgs = Record<string, string>;

export interface ToolResult {
    tool: string;
    output: string;
    attempts: number;
    elapsedMs: number;
    // Set when the provider hit the output ceiling, so a caller can decide
    // whether to re-ask for a narrower slice instead of trusting a cut answer.
    truncated: boolean;
}

export interface Step {
    id: string;
    tool: string;
    args: ToolArgs;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The three tools this agent exposes. Each one wraps a provider call and
// returns plain text, so the planner never sees provider-shaped objects.
async function invoke(name: string, args: ToolArgs): Promise<{ text: string }> {
    switch (name) {
        case "search_web":
            return { text: await search(args.query, Number(args.limit ?? 5)) };
        case "summarize":
            return { text: await chat(\`Summarize:\\n\\n\${args.text}\`) };
        case "similar":
            return { text: (await embed(args.text)).join(",") };
        default:
            throw new ToolError(\`unknown tool: \${name}\`);
    }
}

export class StepRunner {
    private readonly results: ToolResult[] = [];

    constructor(private readonly steps: Step[]) {}

    async run(): Promise<ToolResult[]> {
        let prior = "";

        for (const step of this.steps) {
            const result = await callTool(step.tool, { ...step.args, prior });
            this.results.push(result);
            prior = result.output;
        }

        return this.results;
    }

    get slowest(): ToolResult | null {
        if (this.results.length === 0) return null;
        return [...this.results].sort((a, b) => b.elapsedMs - a.elapsedMs)[0];
    }

    // Steps that needed more than one attempt. Nothing reads this yet.
    get retried(): ToolResult[] {
        return this.results.filter(r => r.attempts > 1);
    }
}

export function totalElapsed(results: ToolResult[]): number {
    return results.reduce((sum, r) => sum + r.elapsedMs, 0);
}

export function anyTruncated(results: ToolResult[]): boolean {
    return results.some(r => r.truncated);
}

// Entry point: plan a task into steps, run them, and return the last output.
export async function runAgent(task: string): Promise<string> {
    const steps: Step[] = [
        { id: "s-1", tool: "search_web", args: { query: task, limit: "5" } },
        { id: "s-2", tool: "summarize", args: { text: "" } },
    ];

    const runner = new StepRunner(steps);
    const results = await runner.run();

    return results[results.length - 1]?.output ?? "";
}
`;

export const RUN_WRITEUP_MD = `# Run 2291 — write-up

Run \`2291\` completed successfully in **20.4s**, but spent nearly a quarter of
that inside a single retrying subtask. Recording it here because the run
*looked* clean from the summary alone.

## What happened

\`st-2\` ("collect pricing pages") hit \`503\`s from the upstream host twice
before succeeding on the third attempt:

\`\`\`
09:15:03  attempt 1/3 failed (ConnectionError: upstream returned 503)
09:15:05  attempt 2/3 failed (ConnectionError: upstream returned 503)
09:15:07  fetch_doc returned 18432 bytes in 0.91s
\`\`\`

The backoff worked as designed — 0.5s then 1.0s — so the cost was about
**4.8s**, against a 0.9s successful fetch.

## Timing

| Subtask | Attempts | Elapsed | Recovered |
| --- | --- | --- | --- |
| st-1 | 1 | 2.04s | no |
| st-2 | 3 | 4.82s | **yes** |
| st-3 | 1 | 2.11s | no |
| st-4 | 1 | 2.44s | no |
| st-5 | 1 | 3.02s | no |

## Observations

1. **A recovered subtask is invisible in the summary.** The final answer was
   complete, so nothing signalled that a third of the wall time was retries.
   The \`recovered\` flag exists for this, but nothing reads it yet.
2. \`st-5\` tripped the *slow tool* warning at 2.81s without failing. Worth
   watching rather than acting on.
3. Budget was never close — 48,219 of 100,000 tokens. The early-stop path did
   not engage.

## Follow-ups

- Surface \`recovered=true\` in the run summary, not just the log.
- Consider a per-subtask latency budget separate from the token budget; they
  measure different failures.
`;

// The Python sample App.tsx uses for its scratch editor tab, exported here so the
// demo tree can serve the same text as a real file. One copy, two entry points.
export const TRACE_PY = `import asyncio
from agent import Planner, ToolRegistry

async def run_agent(task: str) -> str:
    """Decompose a task, run subtasks, and return the final answer."""
    registry = ToolRegistry()
    registry.add("search_web", search_web)
    registry.add("fetch_doc", fetch_doc)

    planner = Planner(model="claude-sonnet-4-6", tools=registry)
    plan = await planner.decompose(task)

    results = []
    for subtask in plan.subtasks:
        try:
            result = await planner.execute(subtask)
            results.append(result)
        except ToolError as exc:
            # Retry once on transient tool failures before giving up.
            print(f"subtask {subtask.id} failed: {exc}, retrying")
            result = await planner.execute(subtask)
            results.append(result)

    return planner.summarize(results)

if __name__ == "__main__":
    answer = asyncio.run(run_agent("research competitors in vector db space"))
    print(answer)
`;

export const DEMO_DIRS: Record<string, FsEntry[]> = {
    'inmemory:/': [{ name: 'src', path: 'inmemory:/src', kind: 'dir' }],
    'inmemory:/src': [
        { name: 'orchestrator.ts', path: 'inmemory:/src/orchestrator.ts', kind: 'file' },
        { name: 'run-2291.md', path: 'inmemory:/src/run-2291.md', kind: 'file' },
        // Not opened by the seed — it's there for the visitor to find in the tree,
        // and it's the file the canned chat exchange claims to have read.
        { name: 'trace.py', path: 'inmemory:/src/trace.py', kind: 'file' },
    ],
};

export const DEMO_FILES: Record<string, string> = {
    'inmemory:/src/orchestrator.ts': ORCHESTRATOR_TS,
    'inmemory:/src/run-2291.md': RUN_WRITEUP_MD,
    'inmemory:/src/trace.py': TRACE_PY,
};
