import { defineCommandSpec } from '../shared.js';
export const teamKnowledgeSpec = defineCommandSpec({
    name: 'team knowledge',
    summary: 'Build, query, inspect, or compact the advisory Team Agents knowledge index.',
    positional: [
        { name: 'action', summary: 'Knowledge action. Supports: build, query, stats, compact.' }
    ],
    options: [
        { flag: '--cwd', value: 'path', summary: 'Repository root.' },
        { flag: '--scope', value: 'name', summary: 'Build scope. Currently project.' },
        { flag: '--dry-run', summary: 'Report planned build outputs without writing runtime cache files.' },
        { flag: '--write', summary: 'Write generated runtime cache files under .atm/runtime/knowledge.' },
        { flag: '--task', value: 'id', summary: 'Task id used to derive query text.' },
        { flag: '--actor', value: 'id', summary: 'Team actor requesting the knowledge operation.' },
        { flag: '--query', value: 'text', summary: 'Literal query text.' },
        { flag: '--top', value: 'n', summary: 'Maximum query hits to return.' },
        { flag: '--repo', value: 'name', summary: 'Metadata filter.' },
        { flag: '--channel', value: 'name', summary: 'Metadata filter.' },
        { flag: '--domain', value: 'name', summary: 'Metadata filter.' },
        { flag: '--path', value: 'glob', summary: 'Metadata path filter.' },
        { flag: '--atom', value: 'id', summary: 'Metadata atom filter.' },
        { flag: '--validator', value: 'command', summary: 'Metadata validator filter.' },
        { flag: '--vector-rerank', summary: 'Opt in to runtime-cache hybrid rerank after lexical shortlist ranking.' },
        { flag: '--warning-bytes', value: 'n', summary: 'Runtime cache warning threshold for stats/compact.' },
        { flag: '--budget-bytes', value: 'n', summary: 'Runtime cache hard-limit threshold for stats/compact.' },
        { flag: '--json', summary: 'Return JSON output.' },
        { flag: '--pretty', summary: 'Return pretty JSON output.' },
        { flag: '--help', summary: 'Show help.' }
    ]
});
