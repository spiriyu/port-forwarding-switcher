import chalk from 'chalk';
import { type MappingResponse, type MappingStatus, type LogEntry } from '@portswitch/shared';

function statusColor(status: MappingStatus): (s: string) => string {
  if (status === 'listening') return chalk.green;
  if (status === 'error') return chalk.red;
  return chalk.dim;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

export function formatMappingsTable(mappings: MappingResponse[]): string {
  if (mappings.length === 0) return chalk.dim('No mappings configured.');

  const headers = ['ID', 'NAME', 'SOURCE', 'TARGET', 'STATUS', 'CONNS'];
  const rows = mappings.map((m) => [
    m.id,
    m.name,
    `${m.sourceHost}:${m.sourcePort}`,
    `${m.targetHost}:${m.targetPort}`,
    m.status,
    String(m.stats.openConnections),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );

  const header = headers.map((h, i) => pad(chalk.bold(h), widths[i] ?? h.length)).join('  ');
  const separator = widths.map((w) => '─'.repeat(w)).join('  ');
  const lines = rows.map((row, ri) => {
    const m = mappings[ri];
    const color = m ? statusColor(m.status) : chalk.dim;
    return row
      .map((cell, i) => {
        const padded = pad(cell ?? '', widths[i] ?? (cell ?? '').length);
        return i === 4 ? color(padded) : padded;
      })
      .join('  ');
  });

  return [header, separator, ...lines].join('\n');
}

export function formatMapping(m: MappingResponse): string {
  const color = statusColor(m.status);
  const lines = [
    `${chalk.bold('ID:')}      ${m.id}`,
    `${chalk.bold('Name:')}    ${m.name}`,
    `${chalk.bold('Source:')}  ${m.sourceHost}:${m.sourcePort}`,
    `${chalk.bold('Target:')}  ${m.targetHost}:${m.targetPort}`,
    `${chalk.bold('Enabled:')} ${m.enabled}`,
    `${chalk.bold('Status:')}  ${color(m.status)}`,
  ];
  if (m.error) {
    lines.push(`${chalk.bold('Error:')}   ${chalk.red(m.error.code)} — ${m.error.message}`);
  }
  return lines.join('\n');
}

export function formatLogEntry(entry: LogEntry): string {
  const levelColor =
    entry.level === 'error'
      ? chalk.red
      : entry.level === 'warn'
        ? chalk.yellow
        : entry.level === 'info'
          ? chalk.cyan
          : chalk.dim;
  const ts = entry.ts.length > 11 ? entry.ts.slice(11, 23) : entry.ts;
  const parts: string[] = [chalk.dim(ts), levelColor(entry.level.padEnd(5)), chalk.dim(`[${entry.category}]`)];
  if (entry.mappingId) parts.push(chalk.dim(`{${entry.mappingId.slice(0, 8)}}`));
  parts.push(entry.msg);
  let line = parts.join(' ');
  if (entry.err) {
    line += `\n  ${chalk.dim(entry.err.code + ': ' + entry.err.message)}`;
  }
  return line;
}

export function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
