#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import Ws from 'ws';
import * as nodePath from 'path';
import { readFileSync } from 'fs';

const CLI_VERSION: string = (() => {
  // In the dist bundle __dirname is dist/apps/cli/ (same dir as package.json).
  // In tests vitest runs from source so __dirname is apps/cli/src/ and
  // package.json is one level up.
  for (const p of [nodePath.join(__dirname, 'package.json'), nodePath.join(__dirname, '../package.json')]) {
    try {
      return (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? '0.0.0';
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
})();
import {
  DEFAULT_DAEMON_PORT,
  ErrorCode,
  type ServerMessage,
  type LogEntry,
  type PatchMappingRequest,
} from '@portswitch/shared';
import { createServiceManager } from '@portswitch/service-mgr';
import { DaemonClient, DaemonUnreachableError, DaemonApiError } from './client';
import { formatMappingsTable, formatMapping, formatLogEntry, toJson } from './output';
import { resolveId } from './resolve';
import { ExitCode } from './exit-codes';

// ── Error handling ──────────────────────────────────────────────────────────

function handleError(err: unknown): never {
  if (err instanceof DaemonUnreachableError) {
    console.error(chalk.red('Error:'), 'Cannot reach daemon.', chalk.dim('Is it running?'));
    process.exit(ExitCode.DAEMON_UNREACHABLE);
  }
  if (err instanceof DaemonApiError) {
    let hint = '';
    if (err.body.code === ErrorCode.EACCES_PRIVILEGED_PORT) {
      hint = chalk.dim('\nHint: Use a port ≥1024 or re-run the daemon with elevated privileges.');
    }
    console.error(chalk.red(`Error [${err.body.code}]:`), err.body.message + hint);
    const code =
      err.body.code === ErrorCode.EACCES_PRIVILEGED_PORT
        ? ExitCode.EACCES_PRIVILEGED_PORT
        : err.body.code === ErrorCode.CONFLICT || err.body.code === ErrorCode.EADDRINUSE
          ? ExitCode.CONFLICT
          : err.body.code === ErrorCode.VALIDATION
            ? ExitCode.VALIDATION
            : ExitCode.DAEMON_ERROR;
    process.exit(code);
  }
  console.error(chalk.red('Error:'), err instanceof Error ? err.message : String(err));
  process.exit(ExitCode.GENERIC);
}

// ── Address parsing ─────────────────────────────────────────────────────────

export function parseAddress(raw: string): { host: string; port: number } {
  const lastColon = raw.lastIndexOf(':');
  if (lastColon === -1) return { host: '127.0.0.1', port: Number(raw) };
  return { host: raw.slice(0, lastColon), port: Number(raw.slice(lastColon + 1)) };
}

// ── WebSocket streaming ─────────────────────────────────────────────────────

async function connectWs(wsUrl: string): Promise<Ws.WebSocket> {
  return new Promise((resolve, reject) => {
    const sock = new Ws(wsUrl);
    sock.once('open', () => resolve(sock));
    sock.once('error', (err) => reject(new DaemonUnreachableError(err)));
  });
}

function printEvent(msg: ServerMessage): void {
  const ts = new Date().toISOString().slice(11, 23);
  switch (msg.type) {
    case 'mapping.created':
      console.log(`${chalk.dim(ts)} ${chalk.green('+')} ${msg.payload.mapping.name} created`);
      break;
    case 'mapping.updated':
      console.log(`${chalk.dim(ts)} ${chalk.yellow('~')} ${msg.payload.mapping.name} updated`);
      break;
    case 'mapping.deleted':
      console.log(`${chalk.dim(ts)} ${chalk.red('-')} ${msg.payload.id} deleted`);
      break;
    case 'mapping.status': {
      const c =
        msg.payload.status === 'listening'
          ? chalk.green
          : msg.payload.status === 'error'
            ? chalk.red
            : chalk.dim;
      const errSuffix = msg.payload.error ? ` (${msg.payload.error.code})` : '';
      console.log(
        `${chalk.dim(ts)} ${c('●')} ${msg.payload.id.slice(0, 8)} → ${msg.payload.status}${errSuffix}`,
      );
      break;
    }
    case 'daemon.shutdown':
      console.log(`${chalk.dim(ts)} ${chalk.red('!')} daemon shutting down: ${msg.payload.reason}`);
      break;
  }
}

async function streamEvents(client: DaemonClient, json: boolean): Promise<void> {
  const sock = await connectWs(client.wsUrl);

  const pingTimer = setInterval(() => {
    if (sock.readyState === Ws.OPEN) sock.send(JSON.stringify({ type: 'ping' }));
  }, 30_000);

  const onSigint = () => {
    sock.close();
    process.exit(ExitCode.OK);
  };
  process.on('SIGINT', onSigint);

  console.log(chalk.dim('Connected. Watching for events (Ctrl+C to stop)...'));

  return new Promise<void>((resolve) => {
    sock.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === 'hello') {
        if (json) {
          console.log(toJson({ type: 'hello', mappings: msg.payload.snapshot.mappings }));
        } else {
          console.log(formatMappingsTable(msg.payload.snapshot.mappings));
        }
        return;
      }
      if (msg.type === 'pong') return;
      if (json) {
        console.log(toJson(msg));
      } else {
        printEvent(msg);
      }
    });
    const cleanup = () => {
      clearInterval(pingTimer);
      process.off('SIGINT', onSigint);
      resolve();
    };
    sock.on('close', cleanup);
    sock.on('error', cleanup);
  });
}

async function streamLogs(client: DaemonClient, json: boolean): Promise<void> {
  const sock = await connectWs(client.wsUrl);

  sock.send(JSON.stringify({ type: 'log.subscribe', payload: {} }));

  const pingTimer = setInterval(() => {
    if (sock.readyState === Ws.OPEN) sock.send(JSON.stringify({ type: 'ping' }));
  }, 30_000);

  const onSigint = () => {
    sock.close();
    process.exit(ExitCode.OK);
  };
  process.on('SIGINT', onSigint);

  console.log(chalk.dim('Streaming logs (Ctrl+C to stop)...'));

  return new Promise<void>((resolve) => {
    sock.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === 'log') {
        if (json) {
          console.log(toJson(msg.payload.entry));
        } else {
          console.log(formatLogEntry(msg.payload.entry as LogEntry));
        }
      } else if (msg.type === 'log.dropped') {
        console.warn(chalk.yellow(`[${msg.payload.count} log entries dropped]`));
      }
    });
    const cleanup = () => {
      clearInterval(pingTimer);
      process.off('SIGINT', onSigint);
      resolve();
    };
    sock.on('close', cleanup);
    sock.on('error', cleanup);
  });
}

// ── Shell completion ────────────────────────────────────────────────────────

function generateCompletion(shell: string): string {
  const cmds = [
    'list', 'ls', 'add', 'enable', 'disable', 'toggle',
    'remove', 'rm', 'delete', 'edit', 'watch', 'logs', 'doctor', 'completion',
  ];
  if (shell === 'bash') {
    return [
      '_portswitch_completion() {',
      '  local cur="${COMP_WORDS[COMP_CWORD]}"',
      `  local cmds="${cmds.join(' ')}"`,
      '  COMPREPLY=($(compgen -W "$cmds" -- "$cur"))',
      '}',
      'complete -F _portswitch_completion portswitch',
    ].join('\n');
  }
  if (shell === 'zsh') {
    return [
      '#compdef portswitch',
      '_portswitch() {',
      `  local -a cmds=(${cmds.map((c) => `'${c}'`).join(' ')})`,
      '  _describe "command" cmds',
      '}',
      '_portswitch',
    ].join('\n');
  }
  if (shell === 'fish') {
    return cmds
      .map((c) => `complete -c portswitch -f -n '__fish_use_subcommand' -a '${c}'`)
      .join('\n');
  }
  return '';
}

// ── Program ─────────────────────────────────────────────────────────────────

export function createProgram(): Command {
  const program = new Command();

  program
    .name('portswitch')
    .description('Host port-forwarding manager')
    .version(CLI_VERSION)
    .option('--url <url>', 'daemon base URL', `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`)
    .option('--json', 'output as JSON');

  const getClient = () => new DaemonClient((program.opts() as { url: string }).url);
  const isJson = () => !!(program.opts() as { json?: boolean }).json;

  // list
  program
    .command('list')
    .alias('ls')
    .description('List all port mappings')
    .action(async () => {
      try {
        const { mappings } = await getClient().listMappings();
        console.log(isJson() ? toJson(mappings) : formatMappingsTable(mappings));
      } catch (err) {
        handleError(err);
      }
    });

  // add
  const addCmd = program
    .command('add <source> <target>')
    .description('Add a mapping  (source: [host:]port  target: [host:]port)')
    .option('-n, --name <name>', 'display name')
    .option('-e, --enabled', 'start listening immediately')
    .option('--group <name>', 'group name or ID to add mapping to');

  addCmd.action(async (sourceArg: string, targetArg: string) => {
    try {
      const opts = addCmd.opts() as { name?: string; enabled?: boolean; group?: string };
      const c = getClient();
      let groupId: string;
      if (opts.group) {
        const { groups } = await c.listGroups();
        const match = groups.find((g) => g.name.toLowerCase() === opts.group!.toLowerCase() || g.id === opts.group);
        if (!match) {
          console.error(chalk.red('Error:'), `Group "${opts.group}" not found`);
          process.exit(ExitCode.DAEMON_ERROR);
        }
        groupId = match.id;
      } else {
        const { groups } = await c.listGroups();
        if (groups.length === 0) {
          console.error(chalk.red('Error:'), 'No groups exist. Create one with: portswitch group add --name <name>');
          process.exit(ExitCode.DAEMON_ERROR);
        }
        if (groups.length > 1) {
          console.error(chalk.red('Error:'), 'Multiple groups exist. Specify one with: --group <name>');
          process.exit(ExitCode.DAEMON_ERROR);
        }
        groupId = groups[0]!.id;
      }
      const src = parseAddress(sourceArg);
      const tgt = parseAddress(targetArg);
      const mapping = await c.createMapping({
        sourceHost: src.host,
        sourcePort: src.port,
        targetHost: tgt.host,
        targetPort: tgt.port,
        name: opts.name,
        enabled: opts.enabled ?? false,
        groupId,
      });
      if (isJson()) {
        console.log(toJson(mapping));
      } else {
        console.log(chalk.green('Mapping created:'));
        console.log(formatMapping(mapping));
      }
    } catch (err) {
      handleError(err);
    }
  });

  // enable
  program
    .command('enable <id-or-name>')
    .description('Enable a mapping (start listening)')
    .action(async (idOrName: string) => {
      try {
        const c = getClient();
        const id = await resolveId(c, idOrName);
        const mapping = await c.patchMapping(id, { enabled: true });
        if (isJson()) {
          console.log(toJson(mapping));
        } else {
          console.log(chalk.green('Enabled:'), mapping.name);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // disable
  program
    .command('disable <id-or-name>')
    .description('Disable a mapping (stop listening)')
    .action(async (idOrName: string) => {
      try {
        const c = getClient();
        const id = await resolveId(c, idOrName);
        const mapping = await c.patchMapping(id, { enabled: false });
        if (isJson()) {
          console.log(toJson(mapping));
        } else {
          console.log(chalk.dim('Disabled:'), mapping.name);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // toggle
  program
    .command('toggle <id-or-name>')
    .description('Toggle a mapping on or off')
    .action(async (idOrName: string) => {
      try {
        const c = getClient();
        const id = await resolveId(c, idOrName);
        const mapping = await c.toggleMapping(id);
        if (isJson()) {
          console.log(toJson(mapping));
        } else {
          const label = mapping.enabled ? chalk.green('Enabled:') : chalk.dim('Disabled:');
          console.log(label, mapping.name);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // remove (also aliased as 'rm' and 'delete')
  const removeAction = async (idOrName: string) => {
    try {
      const c = getClient();
      const id = await resolveId(c, idOrName);
      await c.deleteMapping(id);
      if (!isJson()) console.log(chalk.dim('Removed.'));
    } catch (err) {
      handleError(err);
    }
  };
  program.command('remove <id-or-name>').alias('rm').alias('delete').description('Remove a mapping permanently').action(removeAction);

  // edit
  const editCmd = program
    .command('edit <id-or-name>')
    .description('Edit a mapping')
    .option('-n, --name <name>', 'new display name')
    .option('-s, --source <source>', 'new source [host:]port')
    .option('-t, --target <target>', 'new target [host:]port')
    .option('--enable', 'enable the mapping')
    .option('--disable', 'disable the mapping');

  editCmd.action(async (idOrName: string) => {
    try {
      const opts = editCmd.opts() as {
        name?: string;
        source?: string;
        target?: string;
        enable?: boolean;
        disable?: boolean;
      };

      if (opts.enable && opts.disable) {
        console.error(chalk.red('Error:'), '--enable and --disable are mutually exclusive');
        process.exit(ExitCode.BAD_INVOCATION);
      }

      const patch: Partial<PatchMappingRequest> = {};
      if (opts.name) patch.name = opts.name;
      if (opts.source) {
        const { host, port } = parseAddress(opts.source);
        patch.sourceHost = host;
        patch.sourcePort = port;
      }
      if (opts.target) {
        const { host, port } = parseAddress(opts.target);
        patch.targetHost = host;
        patch.targetPort = port;
      }
      if (opts.enable) patch.enabled = true;
      if (opts.disable) patch.enabled = false;

      if (Object.keys(patch).length === 0) {
        console.error(chalk.yellow('Nothing to update. Specify at least one option (--name, --source, --target, --enable, --disable).'));
        process.exit(ExitCode.BAD_INVOCATION);
      }

      const c = getClient();
      const id = await resolveId(c, idOrName);
      const mapping = await c.patchMapping(id, patch);
      if (isJson()) {
        console.log(toJson(mapping));
      } else {
        console.log(chalk.green('Updated:'));
        console.log(formatMapping(mapping));
      }
    } catch (err) {
      handleError(err);
    }
  });

  // group
  const groupCmd = program
    .command('group <action>')
    .description('Manage groups  (actions: list, add, rename, enable, disable, remove, duplicate)')
    .option('-n, --name <name>', 'group name or id')
    .option('--new-name <newName>', 'new name (for rename)');

  groupCmd.action(async (action: string) => {
    const opts = groupCmd.opts() as { name?: string; newName?: string };
    const c = getClient();

    try {
      switch (action) {
        case 'list': {
          const { groups } = await c.listGroups();
          if (isJson()) {
            console.log(toJson(groups));
          } else {
            if (groups.length === 0) {
              console.log(chalk.dim('No groups. Use: portswitch group add --name <name>'));
            } else {
              console.log(chalk.bold('ID'.padEnd(28)) + chalk.bold('NAME'.padEnd(24)) + chalk.bold('MAPPINGS') + '  ' + chalk.bold('ACTIVE'));
              for (const g of groups) {
                const active = g.activeCount > 0 ? chalk.green(String(g.activeCount)) : chalk.dim('0');
                console.log(g.id.padEnd(28) + g.name.padEnd(24) + String(g.mappingCount).padEnd(10) + active);
              }
            }
          }
          break;
        }
        case 'add': {
          if (!opts.name) {
            console.error(chalk.red('Error:'), '--name is required for group add');
            process.exit(ExitCode.BAD_INVOCATION);
          }
          const group = await c.createGroup({ name: opts.name });
          if (isJson()) {
            console.log(toJson(group));
          } else {
            console.log(chalk.green('Group created:'), group.name, chalk.dim(`(${group.id})`));
          }
          break;
        }
        case 'rename': {
          if (!opts.name) {
            console.error(chalk.red('Error:'), '--name is required for group rename');
            process.exit(ExitCode.BAD_INVOCATION);
          }
          const newName = opts.newName;
          if (!newName) {
            console.error(chalk.red('Error:'), '--new-name is required for group rename');
            process.exit(ExitCode.BAD_INVOCATION);
          }
          const { groups: all } = await c.listGroups();
          const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
          if (!match) {
            console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
            process.exit(ExitCode.DAEMON_ERROR);
          }
          const renamed = await c.patchGroup(match.id, { name: newName });
          if (isJson()) {
            console.log(toJson(renamed));
          } else {
            console.log(chalk.green('Renamed:'), match.name, '→', renamed.name, chalk.dim(`(${renamed.id})`));
          }
          break;
        }
        case 'duplicate': {
          if (!opts.name) {
            console.error(chalk.red('Error:'), '--name is required for group duplicate');
            process.exit(ExitCode.BAD_INVOCATION);
          }
          const { groups: all } = await c.listGroups();
          const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
          if (!match) {
            console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
            process.exit(ExitCode.DAEMON_ERROR);
          }
          const result = await c.duplicateGroup(match.id);
          if (isJson()) {
            console.log(toJson(result));
          } else {
            console.log(
              chalk.green('Duplicated:'),
              match.name,
              '→',
              result.group.name,
              chalk.dim(`(${result.mappings.length} mapping(s), all disabled)`),
            );
          }
          break;
        }
        case 'enable': {
          if (!opts.name) {
            console.error(chalk.red('Error:'), '--name is required for group enable');
            process.exit(ExitCode.BAD_INVOCATION);
          }
          const { groups: all } = await c.listGroups();
          const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
          if (!match) {
            console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
            process.exit(ExitCode.DAEMON_ERROR);
          }
          const result = await c.enableGroup(match.id);
          if (isJson()) {
            console.log(toJson(result));
          } else {
            console.log(chalk.green('Enabled:'), result.group.name, chalk.dim(`(${result.mappings.length} mapping(s))`));
          }
          break;
        }
        case 'disable': {
          if (!opts.name) {
            console.error(chalk.red('Error:'), '--name is required for group disable');
            process.exit(ExitCode.BAD_INVOCATION);
          }
          const { groups: all } = await c.listGroups();
          const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
          if (!match) {
            console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
            process.exit(ExitCode.DAEMON_ERROR);
          }
          const result = await c.disableGroup(match.id);
          if (isJson()) {
            console.log(toJson(result));
          } else {
            console.log(chalk.dim('Disabled:'), result.group.name);
          }
          break;
        }
        case 'remove': {
          if (!opts.name) {
            console.error(chalk.red('Error:'), '--name is required for group remove');
            process.exit(ExitCode.BAD_INVOCATION);
          }
          const { groups: all } = await c.listGroups();
          const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
          if (!match) {
            console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
            process.exit(ExitCode.DAEMON_ERROR);
          }
          await c.deleteGroup(match.id);
          if (!isJson()) console.log(chalk.dim('Group removed.'));
          break;
        }
        default: {
          console.error(chalk.red('Error:'), 'Unknown group action: ' + action);
          console.error('  Valid actions: list, add, rename, enable, disable, remove, duplicate');
          process.exit(ExitCode.BAD_INVOCATION);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

  // watch
  program
    .command('watch')
    .description('Stream real-time mapping events via WebSocket')
    .action(async () => {
      try {
        await streamEvents(getClient(), isJson());
      } catch (err) {
        handleError(err);
      }
    });

  // logs
  const logsCmd = program
    .command('logs')
    .description('View daemon log entries')
    .option('-n, --limit <n>', 'number of entries to show', '100')
    .option('-m, --mapping-id <id>', 'filter by mapping ID')
    .option('-f, --follow', 'stream live log entries via WebSocket');

  logsCmd.action(async () => {
    try {
      const opts = logsCmd.opts() as { limit: string; mappingId?: string; follow?: boolean };
      if (opts.follow) {
        await streamLogs(getClient(), isJson());
      } else {
        const result = await getClient().logs({
          limit: Number(opts.limit),
          mappingId: opts.mappingId,
        });
        if (isJson()) {
          console.log(toJson(result.entries));
        } else {
          for (const entry of result.entries) {
            console.log(formatLogEntry(entry));
          }
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

  // doctor
  program
    .command('doctor')
    .description('Check daemon connectivity and print diagnostics')
    .action(async () => {
      try {
        const c = getClient();
        const [health, diag] = await Promise.all([c.health(), c.diagnostics()]);
        if (isJson()) {
          console.log(toJson({ health, diagnostics: diag }));
        } else {
          console.log(
            `${chalk.green('✓')} Daemon reachable  ${chalk.dim('(v' + diag.daemonVersion + ', pid ' + diag.pid + ')')}`,
          );
          console.log(`  Uptime:   ${Math.round(diag.uptimeMs / 1000)}s`);
          console.log(`  Active:   ${diag.listeningMappings} mapping(s) listening`);
          console.log(`  Config:   ${diag.configFilePath}`);
          console.log(`  Logs:     ${diag.logFilePath}`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // service
  const svcCmd = program
    .command('service <action>')
    .description('Manage daemon as a system service  (actions: install uninstall start stop status)')
    .option('--exec <path>', 'daemon binary path (required for install)')
    .option('--dry-run', 'show what would be done without making changes');

  svcCmd.action(async (action: string) => {
    const opts = svcCmd.opts() as { exec?: string; dryRun?: boolean };
    const mgr = createServiceManager();

    try {
      switch (action) {
        case 'install': {
          if (!opts.exec) {
            console.error(chalk.red('Error:'), '--exec <path> is required for service install');
            process.exit(ExitCode.BAD_INVOCATION);
          }
          await mgr.install({ execPath: opts.exec, dryRun: opts.dryRun });
          if (!opts.dryRun) {
            console.log(chalk.green('Service installed.'), chalk.dim('Run: portswitch service start'));
          }
          break;
        }
        case 'uninstall': {
          await mgr.uninstall({ dryRun: opts.dryRun });
          if (!opts.dryRun) console.log(chalk.dim('Service uninstalled.'));
          break;
        }
        case 'start': {
          await mgr.start();
          console.log(chalk.green('Service started.'));
          break;
        }
        case 'stop': {
          await mgr.stop();
          console.log(chalk.dim('Service stopped.'));
          break;
        }
        case 'status': {
          const s = await mgr.status();
          if (isJson()) {
            console.log(toJson(s));
          } else {
            const installedMark = s.installed ? chalk.green('✓') : chalk.red('✗');
            const runningMark = s.running ? chalk.green('running') : chalk.dim('stopped');
            console.log(`  Installed: ${installedMark}`);
            console.log(`  Status:    ${runningMark}${s.pid ? chalk.dim(' (pid ' + s.pid + ')') : ''}`);
            console.log(`  Platform:  ${mgr.platform}`);
          }
          break;
        }
        default: {
          console.error(chalk.red('Error:'), 'Unknown service action: ' + action);
          console.error('  Valid actions: install, uninstall, start, stop, status');
          process.exit(ExitCode.BAD_INVOCATION);
        }
      }
    } catch (err) {
      console.error(chalk.red('Error:'), err instanceof Error ? err.message : String(err));
      process.exit(ExitCode.GENERIC);
    }
  });

  // serve — start daemon + static UI server
  const serveCmd = program
    .command('serve')
    .description('Start the portswitch daemon and web UI server')
    .option('-p, --port <port>', 'port to listen on', String(DEFAULT_DAEMON_PORT));

  serveCmd.action(async () => {
    const opts = serveCmd.opts() as { port: string };
    const { createDaemon } = await import('./serve/server');
    const port = parseInt(opts.port, 10);
    // Derive uiDir relative to the running binary, not the compiled source __dirname
    const uiDir = nodePath.join(nodePath.dirname(process.argv[1] ?? ''), 'ui');
    const daemon = createDaemon({ port, uiDir });

    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled rejection:', reason);
      process.exit(1);
    });
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      process.exit(1);
    });

    await daemon.start();
    console.log(`portswitch daemon listening on http://127.0.0.1:${daemon.port}/api`);
    console.log(`web UI available at http://127.0.0.1:${daemon.port}/ui`);
    console.log(`config: ${daemon.configPath}`);

    const shutdown = () => {
      daemon.stop().then(() => process.exit(0)).catch(() => process.exit(1));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });

  // completion
  program
    .command('completion <shell>')
    .description('Print shell completion script (bash | zsh | fish)')
    .action((shell: string) => {
      const supported = ['bash', 'zsh', 'fish'];
      if (!supported.includes(shell)) {
        console.error(
          chalk.red('Error:'),
          `Unsupported shell "${shell}". Supported: ${supported.join(', ')}`,
        );
        process.exit(ExitCode.BAD_INVOCATION);
      }
      console.log(generateCompletion(shell));
    });

  return program;
}

if (!process.env['VITEST']) {
  createProgram().parse(process.argv);
}
