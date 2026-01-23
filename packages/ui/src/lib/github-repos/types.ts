export type BoardColumnType =
  | 'branches'
  | 'behind-prs'
  | 'draft-prs'
  | 'pending-prs'
  | 'failing-prs'
  | 'changes-requested-prs'
  | 'in-review-prs'
  | 'ready-to-merge-prs'
  | 'merged-prs';

export type PullRequest = {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  author: string;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  statusCheckRollup?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NEUTRAL' | null;
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
};

export type BranchInfo = {
  name: string;
  commit: string;
};

export type BoardItem =
  | { type: 'pr'; data: PullRequest }
  | { type: 'branch'; data: BranchInfo };

export type BoardColumn = {
  id: BoardColumnType;
  label: string;
  color: string;
  items: BoardItem[];
};
