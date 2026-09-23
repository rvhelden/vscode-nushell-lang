import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

import { assetName, parseSha256Sums, releaseTarget } from './release';

const execFileAsync = promisify(execFile);

const LATEST_RELEASE_URL =
  'https://api.github.com/repos/nushell/nushell/releases/latest';

/** Written next to the downloaded versions; points at the one in use. */
const CURRENT_FILE = 'current.json';

interface CurrentMarker {
  version: string;
  /** Path of the `nu` binary, relative to the storage folder. */
  binary: string;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

function storageDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'nushell');
}

function binaryName(): string {
  return process.platform === 'win32' ? 'nu.exe' : 'nu';
}

/** The previously downloaded `nu`, if there is one and it still exists. */
export function downloadedNushell(
  context: vscode.ExtensionContext,
): { path: string; version: string } | undefined {
  const dir = storageDir(context);
  try {
    const marker = JSON.parse(
      fs.readFileSync(path.join(dir, CURRENT_FILE), 'utf8'),
    ) as CurrentMarker;
    const binary = path.join(dir, marker.binary);
    if (fs.existsSync(binary)) {
      return { path: binary, version: marker.version };
    }
  } catch {
    // no marker yet, or unreadable
  }
  return undefined;
}

async function fetchOk(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': 'vscode-nushell-lang' },
  });
  if (!response.ok) {
    throw new Error(
      `GET ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
  return response;
}

/** Latest nushell release version and the asset for this platform. */
export async function latestRelease(): Promise<{
  version: string;
  asset: ReleaseAsset;
  sums?: ReleaseAsset;
}> {
  const target = releaseTarget(process.platform, process.arch);
  if (!target) {
    throw new Error(
      `No prebuilt Nushell is published for ${process.platform}-${process.arch}. Install it from https://www.nushell.sh/ instead.`,
    );
  }

  const release = (await (
    await fetchOk(LATEST_RELEASE_URL, 'application/vnd.github+json')
  ).json()) as Release;
  const version = release.tag_name.replace(/^v/, '');
  const name = assetName(version, target);
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) {
    throw new Error(`Nushell ${version} has no release asset named ${name}.`);
  }

  const sums = release.assets.find((a) => a.name === 'SHA256SUMS');
  return { version, asset, sums };
}

async function findFile(
  dir: string,
  name: string,
): Promise<string | undefined> {
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) {
      return full;
    }
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Download the latest Nushell release for this platform into the extension's
 * global storage and make it the downloaded `nu`. Returns the binary path.
 *
 * Archives are extracted with the system `tar` (bsdtar on macOS and
 * Windows 10+ also reads .zip), so no extra npm dependency is needed.
 */
export async function downloadLatestNushell(
  context: vscode.ExtensionContext,
): Promise<string> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Nushell',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Looking up the latest release…' });
      const { version, asset, sums } = await latestRelease();

      const dir = storageDir(context);
      await fs.promises.mkdir(dir, { recursive: true });
      const work = await fs.promises.mkdtemp(path.join(dir, 'tmp-'));

      try {
        progress.report({ message: `Downloading ${asset.name}…` });
        const archive = path.join(work, asset.name);
        const data = Buffer.from(
          await (
            await fetchOk(
              asset.browser_download_url,
              'application/octet-stream',
            )
          ).arrayBuffer(),
        );

        if (sums) {
          const text = await (
            await fetchOk(sums.browser_download_url, 'text/plain')
          ).text();
          const expected = parseSha256Sums(text).get(asset.name);
          const actual = crypto.createHash('sha256').update(data).digest('hex');
          if (expected && expected !== actual) {
            throw new Error(
              `Checksum mismatch for ${asset.name} (expected ${expected}, got ${actual}).`,
            );
          }
        }

        await fs.promises.writeFile(archive, data);

        progress.report({ message: `Extracting Nushell ${version}…` });
        const extracted = path.join(work, 'extracted');
        await fs.promises.mkdir(extracted);
        await execFileAsync('tar', ['-xf', archive, '-C', extracted]);

        const binary = await findFile(extracted, binaryName());
        if (!binary) {
          throw new Error(`${asset.name} does not contain ${binaryName()}.`);
        }
        if (process.platform !== 'win32') {
          await fs.promises.chmod(binary, 0o755);
        }

        const target = path.join(dir, version);
        await fs.promises.rm(target, { recursive: true, force: true });
        await fs.promises.rename(extracted, target);

        const marker: CurrentMarker = {
          version,
          binary: path.join(version, path.relative(extracted, binary)),
        };
        await fs.promises.writeFile(
          path.join(dir, CURRENT_FILE),
          JSON.stringify(marker, null, 2),
        );

        await removeOtherVersions(dir, version);
        return path.join(dir, marker.binary);
      } finally {
        await fs.promises.rm(work, { recursive: true, force: true });
      }
    },
  );
}

async function removeOtherVersions(dir: string, keep: string): Promise<void> {
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keep) {
      continue;
    }
    try {
      await fs.promises.rm(path.join(dir, entry.name), {
        recursive: true,
        force: true,
      });
    } catch {
      // still in use (e.g. a running language server on Windows); retry next time
    }
  }
}
