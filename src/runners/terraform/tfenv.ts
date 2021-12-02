/**
 * Terraform version management
 *
 * @packageDocumentation
 */

import * as admzip from "adm-zip";
import compareVersions from "compare-versions";
import { FollowOptions } from "follow-redirects";
import * as fs from "fs";
import { RequestOptions } from "https";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import * as tmp from "tmp-promise";
import { URL } from "url";

import {
  getFileHash,
  httpsRequest,
  httpsGetToFile,
  logErrorRed,
  logGreen,
  pathExists,
} from "../../util";

/** Read file containing a list of file hashes and return the hash listed for filename */
async function getFileHashFromShaSumsFile(
  filename: string,
  sha256SumsFilename: string,
): Promise<string> {
  let sha256Sum = "";

  const fileStream = fs.createReadStream(sha256SumsFilename);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim().endsWith(filename)) {
      const sha256SumMatch = line.match(/^[A-Za-z0-9]*/);
      if (!sha256SumMatch) {
        logErrorRed("Malformed shasum file");
        process.exit(1);
      }
      sha256Sum = sha256SumMatch[0];
      break;
    }
  }
  if (sha256Sum) {
    return sha256Sum;
  }
  logErrorRed("unable to find matching sha256sume for file: " + filename);
  process.exit(1);
}

/** Download Terraform executable for given version */
async function downloadVersion(
  version: string,
  fileSuffix: string,
  versionsDir: string,
): Promise<void> {
  let tfArch =
    process.arch == "x64"
      ? "amd64"
      : process.arch == "x32"
      ? "386"
      : process.arch;
  if (process.env.TFENV_ARCH) {
    tfArch = process.env.TFENV_ARCH;
  }

  const tfPlatform =
    process.platform === "win32"
      ? `windows_${tfArch}`
      : `${process.platform}_${tfArch}`;

  const tfExecutable = "terraform" + fileSuffix;

  const tmpDir = await tmp.dir({ unsafeCleanup: true });
  try {
    const downloadFilename = `terraform_${version}_${tfPlatform}.zip`;
    const sha256sumsFilename = `terraform_${version}_SHA256SUMS`;
    const baseDownloadUrl = `${
      process.env.TFENV_REMOTE
        ? process.env.TFENV_REMOTE
        : "https://releases.hashicorp.com"
    }/terraform/${version}/`;

    const downloadArchiveFullPath = path.join(tmpDir.path, downloadFilename);
    const archiveDownloadOpts = new URL(
      baseDownloadUrl + downloadFilename,
    ) as FollowOptions<RequestOptions>;
    archiveDownloadOpts.maxBodyLength = 50 * 1024 * 1024;
    await httpsGetToFile(archiveDownloadOpts, downloadArchiveFullPath);
    const downloadSha256sumsFullPath = path.join(
      tmpDir.path,
      sha256sumsFilename,
    );
    await httpsGetToFile(
      baseDownloadUrl + sha256sumsFilename,
      downloadSha256sumsFullPath,
    );

    const expectedDownloadFileSha256Hash = await getFileHashFromShaSumsFile(
      downloadFilename,
      downloadSha256sumsFullPath,
    );
    const actualDownloadFileSha256Hash = await getFileHash(
      downloadArchiveFullPath,
      "sha256",
    );

    if (actualDownloadFileSha256Hash != expectedDownloadFileSha256Hash) {
      logErrorRed(
        `TF download hash mismatch: ${actualDownloadFileSha256Hash} does not match expected ${expectedDownloadFileSha256Hash}`,
      );
      process.exit(1);
    }

    const zip = new admzip(downloadArchiveFullPath);
    zip.extractAllTo(tmpDir.path);

    await fs.promises.mkdir(path.join(versionsDir, version));
    await fs.promises.rename(
      path.join(tmpDir.path, tfExecutable),
      path.join(versionsDir, version, tfExecutable),
    );
    if (process.platform != "win32") {
      // Darwin builds don't appear to have executable permission set
      await fs.promises.chmod(
        path.join(versionsDir, version, tfExecutable),
        0o755,
      );
    }
  } finally {
    await tmpDir.cleanup();
  }
}

/** Ensure versions directory exists (creating it if missing) and return its path */
async function getTfEnvVersionsDir(): Promise<string> {
  const dirs = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA) {
      dirs["tfEnvVersionsDir"] = path.join(
        process.env.APPDATA,
        "tfenv",
        "versions",
      );
    } else {
      dirs["tfEnvVersionsDir"] = path.join(
        os.homedir(),
        "AppData",
        "Roaming",
        "tfenv",
        "versions",
      );
    }
  } else {
    // Posix
    dirs["tfEnvVersionsDir"] = path.join(os.homedir(), ".tfenv", "versions");
  }
  await fs.promises.mkdir(dirs["tfEnvVersionsDir"], { recursive: true });
  return dirs["tfEnvVersionsDir"];
}

interface TFEnvInstallResult {
  directory: string;
  fullPath: string;
}

/** Terraform version management */
export class TFEnv {
  /** Install a version of Terraform */
  async install(version: string | undefined): Promise<TFEnvInstallResult> {
    const tfEnvVersionsDir = await getTfEnvVersionsDir();
    const fileSuffix = process.platform === "win32" ? ".exe" : "";

    if (
      !version &&
      (await pathExists(path.join(process.cwd(), ".terraform-version")))
    ) {
      version = (
        await fs.promises.readFile(
          path.join(process.cwd(), ".terraform-version"),
          "utf8",
        )
      ).trim();
    }

    if (version && version.match(/^min-required$/)) {
      logErrorRed("TF min-required option not currently supported");
      process.exit(1);
    }
    if (version && version.match(/^latest:.*$/)) {
      logErrorRed(
        "Latest TF minor/patch release option not currently supported",
      );
      process.exit(1);
    }
    if (version && version.match(/^latest$/)) {
      version = (await this.getReleasedTerraformVersions())[0];
    }
    logGreen(`TF version is ${version}`);

    if (!version) {
      logErrorRed(
        "No TF version provided and no .terraform-version file found",
      );
      process.exit(1);
    }

    const tfBinDir = path.join(tfEnvVersionsDir, version);

    if (!(await pathExists(tfBinDir))) {
      await downloadVersion(version, fileSuffix, tfEnvVersionsDir);
    }

    return {
      directory: tfBinDir,
      fullPath: path.join(tfBinDir, "terraform" + fileSuffix),
    };
  }

  /** Retrieve list of released Terraform versions */
  async getReleasedTerraformVersions(
    includePrelease = false,
  ): Promise<string[]> {
    const parsedUrl = new URL(
      process.env.TFENV_REMOTE
        ? process.env.TFENV_REMOTE
        : "https://releases.hashicorp.com",
    );
    if (parsedUrl.protocol != "https:") {
      logErrorRed("TFENV_REMOTE must be set to a https URL");
      process.exit(1);
    }

    const releases = JSON.parse(
      await httpsRequest({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? parsedUrl.port : 443,
        path: "/index.json",
        method: "GET",
      }),
    );
    const descendingVersions = Object.keys(releases.terraform.versions)
      .sort(compareVersions)
      .reverse();
    if (includePrelease) {
      return descendingVersions;
    }
    return descendingVersions.filter((e) => !e.includes("-"));
  }
}
