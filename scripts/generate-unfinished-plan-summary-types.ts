export type NormalizedTaskStatus =
  | 'planned'
  | 'open'
  | 'in_progress'
  | 'reserved'
  | 'ready'
  | 'running'
  | 'review'
  | 'blocked'
  | 'abandoned'
  | 'done';

export interface Options {
  readonly planningRoot: string;
  readonly handoffPath: string | null;
  readonly outPath: string;
  readonly overlayPath: string | null;
}

export interface TaskCardEntry {
  readonly taskId: string;
  readonly title: string;
  readonly rawStatus: string;
  readonly normalizedStatus: NormalizedTaskStatus;
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly filePath: string;
  readonly planningRepo: string | null;
  readonly targetRepo: string | null;
  readonly relatedPlan: string | null;
}

export interface ReadmeRowEntry {
  readonly taskId: string;
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly sourcePath: string;
  readonly rawStatus: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  readonly rowKind: 'roster' | 'future-queue' | 'other';
  readonly relatedPlan: string | null;
}

export interface LaneSummary {
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly taskCards: readonly TaskCardEntry[];
  readonly readmeOnly: readonly ReadmeRowEntry[];
  readonly overlayItems: readonly OverlayEntry[];
}

export interface LaneMetadata {
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly relatedPlan: string | null;
}

export interface OverlayEntry {
  readonly taskId: string;
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly status: string | null;
  readonly title: string | null;
  readonly relatedPlan: string | null;
  readonly gapType: string | null;
  readonly notes: string | null;
  readonly sourceThreadId: string | null;
  readonly sourceThreadTitle: string | null;
}

export interface OverlaySource {
  readonly threadId: string;
  readonly title: string;
  readonly status: string;
  readonly unfinishedTaskIds: readonly string[];
  readonly note: string | null;
}
