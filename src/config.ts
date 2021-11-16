/**
 * IHLP config interfaces
 *
 * @packageDocumentation
 */

import { HashElementOptions } from "folder-hash";

/** Valid action name */
export type ActionName = "deploy" | "destroy";
/** List of valid action names */
export type ActionNames = ("deploy" | "destroy")[];

/** Base interface for block options */
interface BlockOpts {} // eslint-disable-line @typescript-eslint/no-empty-interface

/** Block definition */
export interface Block {
  /** Optional display name for the block */
  name?: string;
  /** Configuration options */
  options?: BlockOpts | undefined;
  /** Path to directory containing the app/infrastructure's files */
  path?: string;
  /** Block type identifier */
  type: string;
}

/** Resource Group scoped ARM Deployment options */
export interface ArmDeploymentResourceGroupScopeOpts {
  resourceGroupName: string;
}

/** Block options for an ARM Deployment */
export interface ArmDeploymentBlockOpts extends BlockOpts {
  /** Name of Azure Resource Manager deployment */
  deploymentName: string;
  /** Parameters for the ARM template */
  deploymentParameters?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Tags for the deployment */
  deploymentTags?: Record<string, string>;
  /** Resource Group in which to deploy the template (omit to deploy to the Subscription) */
  deployTo?: ArmDeploymentResourceGroupScopeOpts;
  /** Azure Subscription ID for the deployment.
   * Must be provided here or via the ARM_SUBSCRIPTION_ID environment variable.
   */
  subscriptionId?: string;
  /** Path to the ARM JSON template */
  templatePath: string;
}

/** Block definition for ARM Deployment */
export interface ArmDeploymentBlock extends Block {
  name?: string;
  options: ArmDeploymentBlockOpts;
  type: "azure-arm-deployment";
}

/** Block options for deleting Azure Resource Group on destroy */
export interface DeleteResourceGroupOnDestroyOpts {
  /** Resource Groups(s) - commma-separated or regular list */
  resourceGroups: string[] | string;
  /** Azure Subscription ID containing the Resource Group(s).
   * Must be provided here or via the ARM_SUBSCRIPTION_ID environment variable.
   */
  subscriptionId?: string;
}

/** Block definition for deleting Azure Resource Group on destroy */
export interface DeleteResourceGroupOnDestroyBlock extends Block {
  name?: string;
  options: DeleteResourceGroupOnDestroyOpts;
  type: "azure-delete-resource-groups-on-destroy";
}

/** Block options for a CloudFormation stack */
export interface CfnStackOpts {
  /** Name of the CFN stack */
  stackName: string;
  /** Parameters for the CFN stack */
  stackParameters?: Record<string, string>;
  /** Tags for the CFN stack */
  stackTags?: Record<string, string>;
  /** Path to the CFN template */
  templatePath: string;
}

/** Block definition for a CloudFormation stack */
export interface CfnStackBlock extends Block {
  name?: string;
  options: CfnStackOpts;
  type: "aws-cfn-stack";
}

/** Block options for command runner */
export interface CommandBlockOpts extends BlockOpts {
  /** Only run the command during these IHLP actions (omit to run on all actions) */
  actions?: ActionNames;
  /** Command to run (specify as a list, e.g. ["npm", "run", "build"]) */
  command: string[];
  /** Optional environment variables to set when running the command */
  envVars?: Record<string, string>;
}

/** Block definition for a command runner */
export interface CommandBlock extends Block {
  name?: string;
  options: CommandBlockOpts;
  type: "command";
}

/** Block options for Terraform */
export interface TerraformBlockOpts extends BlockOpts {
  /** Variables for Terraform init */
  backendConfig?: Record<string, string>;
  /** Terraform init type (future Terraform Cloud support) */
  initType?: "standard"; // TBD what TF cloud support option will be ("remote"?)
  /** List of Terraform targets to which apply/destroy will be restricted */
  targets?: string[];
  /** Version of Terraform to use (specify here or in .terraform-version file -- omit both to use system-installed Terraform) */
  terraformVersion?: string;
  /** Terraform variables */
  variables?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Block definition for Terraform */
export interface TerraformBlock extends Block {
  name?: string;
  options: TerraformBlockOpts;
  /** Path to directory containing Terraform files */
  path: string;
  type: "terraform";
}

/** Options for persistant caching of archives */
export interface ArchiveCacheAwsOpts {
  /** Name of AWS S3 bucket in which builds will be cached */
  s3Bucket: string;
  /** Prefix to apply before build objects (e.g. `builds/`) */
  s3Prefix: string;
}

/** Block options for building functions via esbuild */
export interface EsbuildFunctionsBlockOpts extends BlockOpts {
  /** Options for caching builds
   *
   * Enabling this allows builds to be bypassed when rolling back a repo.
   */
  archiveCache?: ArchiveCacheAwsOpts;
  /** Filename on which esbuild will run (defaults to `handler.ts`) */
  entryPoint?: string;
  /** Environment variables to set when running esbuild */
  envVars?: Record<string, string>;
  /** Path (relative to the base block path) where function zip files will be placed */
  outDir?: string;
  /** Path (relative to the base block path) containing the function directories */
  srcDir?: string;
  /** esbuild `target` option (e.g. `node14`) */
  target?: string;
  /** Override options for generating a tracking hash of the source files */
  sourceHashOpts?: HashElementOptions; // https://github.com/marc136/node-folder-hash#options
}

/** Block definition for building functions via esbuild */
export interface EsbuildFunctionsBlock extends Block {
  name?: string;
  options?: EsbuildFunctionsBlockOpts;
  /** Path to functions' project directory */
  path: string;
  type: "esbuild-functions";
}

/** Block options for emptying AWS S3 buckets on destroy */
export interface EmptyAwsS3BucketsOpts {
  /** List of AWS S3 buckets to empty (comma-separated or regular array) */
  bucketNames: string[] | string;
}

/** Block definition for emptying AWS S3 buckets on destroy */
export interface EmptyS3BucketsOnDestroyBlock extends Block {
  name?: string;
  options: EmptyAwsS3BucketsOpts;
  type: "aws-empty-s3-buckets-on-destroy";
}

/** Block definition for Serverless Framework */
export interface ServerlessBlock extends Block {
  name?: string;
  /** Path to directory containing the Serverless Framework project */
  path: string;
  type: "serverless-framework";
}

/** Options for build definitions */
export interface BuildOpts {
  /** Optional directory to switch to before running the `command` */
  cwd?: string;
  /** Command to run (specify as a list, e.g. ["npm", "run", "build"]) */
  command: string[];
  /** Optional environment variables to set when running the command */
  envVars?: Record<string, string>;
}

/** CloudFront distribution options for remote storage sync post-deploy */
export interface SyncToRemoteStoragePostSyncCfInvalidationOpts {
  /** CloudFront Distribution ID in which paths should be invalidated post-sync */
  distributionID: string;
}

/** AWS options for remote storage sync post-deploy */
export interface SyncToRemoteStoragePostSyncAwsOpts {
  /** Options for invalidating CloudFront paths post-sync */
  cfInvalidation: SyncToRemoteStoragePostSyncCfInvalidationOpts;
}

/** AWS options for remote storage sync destinations */
export interface SyncToRemoteStorageAwsDestinationOpts {
  /** Name of AWS S3 bucket to which files will be synced */
  s3Bucket: string;
  /** AWS region containing the bucket (omit to use the deployment's location) */
  region?: string;
}

/** AWS options for remote storage sync state tracking */
export interface SyncToRemoteStorageAwsDeployedStateTrackingOpts {
  /** Name of System Manager Parameter which will be used to correlate the repo contents with what has been synced to the remote storage */
  ssmParam: string;
}

/** Block options for sync to remote storage */
export interface SyncToRemoteStorageBlockOpts extends BlockOpts {
  /** Options for caching builds of the syncronized files
   *
   * Enabling this allows builds to be bypassed when rolling back a repo.
   */
  archiveCache?: ArchiveCacheAwsOpts;
  /** When syncing, should objects on the destination be deleted if not present locally? */
  deleteExtraObjects?: boolean;
  /** Destination for the syncing */
  destination: SyncToRemoteStorageAwsDestinationOpts;
  /** Commands to always run (before checking the source hash of files) */
  preBuild?: BuildOpts | BuildOpts[];
  /** Commands to run to generate/setup the files in `outDir` */
  build?: BuildOpts | BuildOpts[];
  /** Sync tracking options (to prevent re-syncing the same files on subsequent deployments) */
  deployedStateTracking?: SyncToRemoteStorageAwsDeployedStateTrackingOpts;
  /** Path (relative to the block's path) to the directory containing the files to sync (omit to use the block's path) */
  outDir?: string;
  /** Options for actions post-syncing (e.g. CDN cache invalidation) */
  postSync?: SyncToRemoteStoragePostSyncAwsOpts;
  /** Override options for generating a tracking hash of the source files */
  sourceHashOpts?: HashElementOptions; // https://github.com/marc136/node-folder-hash#options
}

/** Block definition for remote storage sync (currently only supporting AWS S3) */
export interface SyncToRemoteStorageBlock extends Block {
  name?: string;
  options: SyncToRemoteStorageBlockOpts;
  /** Path to directory containing the app/infrastructure's files */
  path: string;
  type: "sync-to-remote-storage";
}

/** Deployment definition */
export interface Deployment {
  /** List of infrastructure/app blocks to manage */
  blocks: (
    | ArmDeploymentBlock
    | CfnStackBlock
    | CommandBlock
    | DeleteResourceGroupOnDestroyBlock
    | EmptyS3BucketsOnDestroyBlock
    | EsbuildFunctionsBlock
    | ServerlessBlock
    | SyncToRemoteStorageBlock
    | TerraformBlock
  )[];
  /** Locations/regions to which the blocks will be deployed */
  locations: string[];
}

/** IHLP config */
export interface IHLPConfig {
  /** List of IHLP deployments */
  deployments: Deployment[];
}
