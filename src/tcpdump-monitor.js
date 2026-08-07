import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const STOP_TIMEOUT_MS = 3000;
const RESTART_DELAY_MS = 1000;

function normalizeIp(ip) {
  if (!ip) {
    return '';
  }

  let normalized =
    String(ip).trim().toLowerCase();

  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }

  const zoneIndex =
    normalized.indexOf('%');

  if (zoneIndex !== -1) {
    normalized =
      normalized.slice(0, zoneIndex);
  }

  return normalized;
}

export function getLocalAddresses() {
  const addresses =
    new Set([
      '127.0.0.1',
      '::1'
    ]);

  const interfaces =
    os.networkInterfaces();

  for (
    const entries
    of Object.values(interfaces)
  ) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (!entry?.address) {
        continue;
      }

      addresses.add(
        normalizeIp(entry.address)
      );
    }
  }

  return addresses;
}

export function parseEndpoint(value) {
  const cleaned =
    String(value || '')
      .trim()
      .replace(/^[\[\]()]+/, '')
      .replace(/[\[\](),:]+$/, '');

  const lastDot =
    cleaned.lastIndexOf('.');

  if (lastDot === -1) {
    return null;
  }

  const ip =
    normalizeIp(
      cleaned.slice(0, lastDot)
    );

  const port =
    Number(
      cleaned.slice(lastDot + 1)
    );

  if (
    !ip ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  ) {
    return null;
  }

  return {
    ip,
    port
  };
}

export function extractPayloadBytes(line) {
  const tcpMatch =
    line.match(/\btcp\s+(\d+)\b/i);

  if (tcpMatch) {
    return Number(tcpMatch[1]) || 0;
  }

  const lengthMatch =
    line.match(/\blength\s+(\d+)\b/i);

  if (lengthMatch) {
    return Number(lengthMatch[1]) || 0;
  }

  return 0;
}

export function extractProtocol(line) {
  if (/\bUDP\b/i.test(line)) return 'udp';
  if (/\btcp\b/i.test(line)) return 'tcp';
  if (/\bIP6?\s/.test(line)) return 'tcp';
  return null;
}

export function parseTcpdumpLine(
  line,
  localAddresses
) {
  const separatorIndex =
    line.indexOf(' > ');

  if (separatorIndex === -1) {
    return null;
  }

  const sourcePart =
    line
      .slice(0, separatorIndex)
      .trim();

  const destinationPart =
    line.slice(separatorIndex + 3);

  const sourceTokens =
    sourcePart.split(/\s+/);

  const sourceEndpointText =
    sourceTokens[
      sourceTokens.length - 1
    ];

  const destinationEndpointText =
    destinationPart
      .split(/:\s/, 1)[0]
      .trim();

  const source =
    parseEndpoint(
      sourceEndpointText
    );

  const destination =
    parseEndpoint(
      destinationEndpointText
    );

  if (!source || !destination) {
    return null;
  }

  const bytes =
    extractPayloadBytes(line);

  const protocol =
    extractProtocol(line);

  /*
   * Do not display pure ACK packets or packets
   * without a TCP payload.
   */
  if (!protocol || bytes <= 0) {
    return null;
  }

  const sourceIsLocal =
    localAddresses.has(source.ip);

  const destinationIsLocal =
    localAddresses.has(destination.ip);

  /*
   * Packet received by the server.
   *
   * client:ephemeralPort -> server:localPort
   */
  if (
    destinationIsLocal &&
    !sourceIsLocal
  ) {
    return {
      clientIp: source.ip,
      localPort: destination.port,
      remotePort: source.port,
      direction: 'in',
      protocol,
      bytes
    };
  }

  /*
   * Packet sent by the server.
   *
   * server:localPort -> client:ephemeralPort
   */
  if (
    sourceIsLocal &&
    !destinationIsLocal
  ) {
    return {
      clientIp: destination.ip,
      localPort: source.port,
      remotePort: destination.port,
      direction: 'out',
      protocol,
      bytes
    };
  }

  return null;
}

export class TcpdumpMonitor {
  constructor(config, onPacket) {
    this.config = config;
    this.onPacket = onPacket;

    this.child = null;
    this.lineReader = null;

    this.desiredRunning = false;

    this.startPromise = null;
    this.stopPromise = null;

    this.restartTimer = null;
    this.stopKillTimer = null;

    this.localAddresses =
      getLocalAddresses();

    console.log(
      `[capture] local addresses: ${
        [...this.localAddresses].join(', ')
      }`
    );
  }

  buildCommand() {
    const tcpdumpPath =
      this.config.tcpdumpPath ||
      '/usr/bin/tcpdump';

    const networkInterface =
      this.config.interface ||
      'any';

    const argumentsList = [
      '-i',
      networkInterface,

      /*
       * Do not resolve host or service names.
       */
      '-n',

      /*
       * Output line-buffered.
       */
      '-l',

      /*
       * Compact output with TCP length.
       */
      '-q',

      /*
       * Capture a single global TCP and UDP stream.
       * Port filtering is performed by the agent.
       */
      'tcp',
      'or',
      'udp'
    ];

    if (this.config.sudo) {
      return {
        command: 'sudo',

        arguments: [
          '-n',
          tcpdumpPath,
          ...argumentsList
        ]
      };
    }

    return {
      command: tcpdumpPath,
      arguments: argumentsList
    };
  }

  async start() {
    this.desiredRunning = true;

    if (
      this.child &&
      this.child.exitCode === null &&
      !this.child.killed
    ) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    if (this.stopPromise) {
      await this.stopPromise;
    }

    if (!this.desiredRunning) {
      return;
    }

    this.clearRestartTimer();

    this.startPromise =
      this.spawnProcess();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async spawnProcess() {
    const {
      command,
      arguments: args
    } = this.buildCommand();

    console.log(
      `[capture] starting: ${command} ${args.join(' ')}`
    );

    const child =
      spawn(
        command,
        args,
        {
          stdio: [
            'ignore',
            'pipe',
            'pipe'
          ]
        }
      );

    this.child = child;

    const lineReader =
      readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity
      });

    this.lineReader = lineReader;

    lineReader.on(
      'line',
      (line) => {
        if (this.child !== child) {
          return;
        }

        const packet =
          parseTcpdumpLine(
            line,
            this.localAddresses
          );

        if (!packet) {
          return;
        }

        try {
          this.onPacket(packet);
        } catch (error) {
          console.error(
            `[capture] packet callback failed: ${error.message}`
          );
        }
      }
    );

    child.stderr.on(
      'data',
      (chunk) => {
        const message =
          chunk.toString().trim();

        if (!message) {
          return;
        }

        console.log(
          `[capture] ${message}`
        );
      }
    );

    child.once(
      'error',
      (error) => {
        if (this.child === child) {
          this.child = null;
        }

        try {
          lineReader.close();
        } catch {
          // Already closed.
        }

        console.error(
          `[capture] start failed: ${error.message}`
        );
      }
    );

    child.once(
      'exit',
      (code, signal) => {
        const wasCurrentChild =
          this.child === child;

        if (wasCurrentChild) {
          this.child = null;
        }

        if (
          this.lineReader ===
          lineReader
        ) {
          this.lineReader = null;
        }

        try {
          lineReader.close();
        } catch {
          // Already closed.
        }

        console.log(
          `[capture] exited code=${code} signal=${signal}`
        );

        if (
          wasCurrentChild &&
          this.desiredRunning
        ) {
          this.scheduleRestart();
        }
      }
    );

    await new Promise(
      (resolve, reject) => {
        let settled = false;

        child.once(
          'spawn',
          () => {
            if (settled) {
              return;
            }

            settled = true;

            console.log(
              `[capture] started pid=${child.pid}`
            );

            resolve();
          }
        );

        child.once(
          'error',
          (error) => {
            if (settled) {
              return;
            }

            settled = true;
            reject(error);
          }
        );
      }
    );
  }

  scheduleRestart() {
    if (
      !this.desiredRunning ||
      this.restartTimer
    ) {
      return;
    }

    console.log(
      `[capture] unexpected exit; restart in ${RESTART_DELAY_MS} ms`
    );

    this.restartTimer =
      setTimeout(
        () => {
          this.restartTimer = null;

          if (!this.desiredRunning) {
            return;
          }

          this.start().catch(
            (error) => {
              console.error(
                `[capture] restart failed: ${error.message}`
              );

              this.scheduleRestart();
            }
          );
        },
        RESTART_DELAY_MS
      );

    this.restartTimer.unref?.();
  }

  clearRestartTimer() {
    if (!this.restartTimer) {
      return;
    }

    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  async stop() {
    this.desiredRunning = false;
    this.clearRestartTimer();

    if (this.stopPromise) {
      await this.stopPromise;
      return;
    }

    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // The process did not start.
      }
    }

    const child =
      this.child;

    if (
      !child ||
      child.exitCode !== null
    ) {
      this.child = null;
      return;
    }

    this.stopPromise =
      this.stopProcess(child);

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async stopProcess(child) {
    console.log(
      `[capture] stopping pid=${child.pid}`
    );

    const exited =
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }

        child.once('exit', resolve);
      });

    try {
      child.kill('SIGTERM');
    } catch (error) {
      console.error(
        `[capture] SIGTERM failed: ${error.message}`
      );
    }

    this.stopKillTimer =
      setTimeout(
        () => {
          if (child.exitCode !== null) {
            return;
          }

          console.warn(
            `[capture] forcing stop pid=${child.pid}`
          );

          try {
            child.kill('SIGKILL');
          } catch (error) {
            console.error(
              `[capture] SIGKILL failed: ${error.message}`
            );
          }
        },
        STOP_TIMEOUT_MS
      );

    this.stopKillTimer.unref?.();

    await exited;

    if (this.stopKillTimer) {
      clearTimeout(
        this.stopKillTimer
      );

      this.stopKillTimer = null;
    }

    if (this.child === child) {
      this.child = null;
    }
  }

  isRunning() {
    return Boolean(
      this.child &&
      this.child.exitCode === null &&
      !this.child.killed
    );
  }
}
