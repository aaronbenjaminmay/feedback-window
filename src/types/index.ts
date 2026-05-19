export type Comment = {
  id: string;
  message: string;
  author: string;
  email?: string;
  createdAt: string;
  isInternal: boolean;
  isLate: boolean;
};

export type Task = {
  id: string;
  commentId: string;
  title: string;
  authorName: string;
  email: string;
  createdAt: string;
  status: "new" | "in-progress" | "done" | "deferred";
  priority: "low" | "medium" | "high";
  assignee: string;
  notes?: string;
  intakeDecision: "accepted" | "accepted-late" | "deferred-late";
  pageName?: string;
  commentUrl?: string;
  nodeId?: string;
  rootCommentText?: string;
  replies?: TaskReply[];
};

export type TaskReply = {
  id: string;
  authorName: string;
  createdAt: string;
  message: string;
};

export type CommentItem = {
  id: string;
  figmaCommentId?: string;
  authorName: string;
  email: string;
  handle?: string;
  parentId?: string;
  message: string;
  createdAt: string;
  pageName?: string;
  commentUrl?: string;
  nodeId?: string;
};

export type FeedbackSettings = {
  agencyEmails: string;
  feedbackStartDate: string;
  feedbackEndDate: string;
  lateFeedbackMessage: string;
};
