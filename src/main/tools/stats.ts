import os from 'os';
import fs from 'fs';
import { execFile } from 'child_process';
import { EventEmitter } from 'events';
import type { StatsSnapshot } from '../../types';

/**
 * CPU, memory, disk, battery and network, sampled with nothing beyond Node
 * and the platform's own command-line tools -- no native module to build
 * per architecture for a panel that only ever shows five numbers.
 *
 * CPU and network are both rates, so both need two points in time. The first
 * sample after `subscribe()` reports them as `null` rather than guessing;
 * the one after that has something to subtract from.
 *
 * Disk, battery and network are macOS/Linux only for now, each read through
 * a single external command with a hard timeout, so a command that hangs
 * degrades to "not shown" instead of freezing the sample loop. Reported
 * through `supported`, in the same spirit as a capture source that says
 * plainly when it isn't built: a missing number here is a known gap, not a
 * silent failure.
 */

const SAMPLE_MS = 2000;
const CMD_TIMEOUT_MS = 3000;

interface CpuTimes {
  idle: number;
  total: number;
}

function cpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    for (const v of Object.values(c.times)) total += v;
  }
  return { idle, total };
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: CMD_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function readDisk(): Promise<StatsSnapshot['disk']> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return null;
  try {
    const out = await run('df', ['-k', '/']);
    const line = out.trim().split('\n').pop() ?? '';
    const cols = line.split(/\s+/);
    // Filesystem, 1024-blocks, Used, Available, Capacity, ... -- the same
    // six leading columns on both macOS and Linux.
    const totalKb = Number(cols[1]);
    const usedKb = Number(cols[2]);
    if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb) || totalKb <= 0) return null;
    return {
      totalBytes: totalKb * 1024,
      usedBytes: usedKb * 1024,
      percent: (usedKb / totalKb) * 100,
    };
  } catch {
    return null;
  }
}

async function readBattery(): Promise<StatsSnapshot['battery']> {
  if (process.platform === 'darwin') {
    try {
      const out = await run('pmset', ['-g', 'batt']);
      const m = /(\d+)%/.exec(out);
      if (!m) return null;
      return { percent: Number(m[1]), charging: /AC Power/.test(out) };
    } catch {
      return null;
    }
  }
  if (process.platform === 'linux') {
    try {
      const base = '/sys/class/power_supply/BAT0';
      const percent = Number(fs.readFileSync(`${base}/capacity`, 'utf8').trim());
      const status = fs.readFileSync(`${base}/status`, 'utf8').trim().toLowerCase();
      if (!Number.isFinite(percent)) return null;
      return { percent, charging: status === 'charging' || status === 'full' };
    } catch {
      return null;
    }
  }
  return null;
}

/** Cumulative bytes in/out on whichever interface actually has traffic. */
async function readNetTotals(): Promise<{ iface: string; rx: number; tx: number } | null> {
  if (process.platform === 'darwin') {
    try {
      const out = await run('netstat', ['-ib']);
      let best: { iface: string; rx: number; tx: number } | null = null;
      for (const line of out.trim().split('\n').slice(1)) {
        const c = line.split(/\s+/);
        // Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
        if (!/^en\d+$/.test(c[0]) || !c[2]?.startsWith('<Link')) continue;
        const rx = Number(c[6]);
        const tx = Number(c[9]);
        if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
        if (!best || rx + tx > best.rx + best.tx) best = { iface: c[0], rx, tx };
      }
      return best;
    } catch {
      return null;
    }
  }
  if (process.platform === 'linux') {
    try {
      const out = fs.readFileSync('/proc/net/dev', 'utf8');
      let best: { iface: string; rx: number; tx: number } | null = null;
      for (const line of out.trim().split('\n').slice(2)) {
        const [name, rest] = line.split(':');
        if (!rest || name.trim() === 'lo') continue;
        const c = rest.trim().split(/\s+/);
        const rx = Number(c[0]);
        const tx = Number(c[8]);
        if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
        if (!best || rx + tx > best.rx + best.tx) best = { iface: name.trim(), rx, tx };
      }
      return best;
    } catch {
      return null;
    }
  }
  return null;
}

interface StatsEvents {
  tick: [StatsSnapshot];
}

export class StatsEngine extends EventEmitter<StatsEvents> {
  private timer: NodeJS.Timeout | null = null;
  private subscribers = 0;
  private lastCpu: CpuTimes | null = null;
  private lastNet: { iface: string; rx: number; tx: number; at: number } | null = null;

  supported(): { disk: boolean; battery: boolean; network: boolean } {
    const platform = process.platform === 'darwin' || process.platform === 'linux';
    return { disk: platform, battery: platform, network: platform };
  }

  /** Starts the sample loop if it isn't already running, and returns one reading right away. */
  subscribe(): Promise<StatsSnapshot> {
    this.subscribers += 1;
    if (!this.timer) {
      this.lastCpu = null;
      this.lastNet = null;
      this.timer = setInterval(() => void this.sample(), SAMPLE_MS);
    }
    return this.sample();
  }

  unsubscribe(): void {
    this.subscribers = Math.max(0, this.subscribers - 1);
    if (this.subscribers > 0) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sample(): Promise<StatsSnapshot> {
    const cpu = cpuTimes();
    let cpuPercent: number | null = null;
    if (this.lastCpu) {
      const idleDelta = cpu.idle - this.lastCpu.idle;
      const totalDelta = cpu.total - this.lastCpu.total;
      if (totalDelta > 0) cpuPercent = Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta)));
    }
    this.lastCpu = cpu;

    const totalBytes = os.totalmem();
    const usedBytes = totalBytes - os.freemem();

    const [disk, battery, netTotals] = await Promise.all([
      readDisk(),
      readBattery(),
      readNetTotals(),
    ]);

    let network: StatsSnapshot['network'] = null;
    const now = Date.now();
    if (netTotals) {
      if (this.lastNet && this.lastNet.iface === netTotals.iface) {
        const secs = (now - this.lastNet.at) / 1000;
        if (secs > 0) {
          network = {
            downBytesPerSec: Math.max(0, (netTotals.rx - this.lastNet.rx) / secs),
            upBytesPerSec: Math.max(0, (netTotals.tx - this.lastNet.tx) / secs),
            iface: netTotals.iface,
          };
        }
      }
      this.lastNet = { ...netTotals, at: now };
    }

    const snapshot: StatsSnapshot = {
      cpuPercent,
      memPercent: (usedBytes / totalBytes) * 100,
      memUsedBytes: usedBytes,
      memTotalBytes: totalBytes,
      disk,
      battery,
      network,
      supported: this.supported(),
    };
    this.emit('tick', snapshot);
    return snapshot;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.subscribers = 0;
  }
}
