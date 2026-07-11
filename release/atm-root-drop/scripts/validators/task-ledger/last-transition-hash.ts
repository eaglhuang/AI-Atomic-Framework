export { assertLastTransitionHashMatchesDisk } from './suite-impl.ts';
export async function run(tempRoot: string) {
  // exercised via suite; registry callable smoke uses a no-op when no repo provided
  void tempRoot;
}
