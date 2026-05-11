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
  intakeDecision: "accepted" | "accepted-late" | "deferred-late";
};

export type CommentItem = {
  id: string;
  authorName: string;
  email: string;
  handle?: string;
  message: string;
  createdAt: string;
};

export type FeedbackSettings = {
  agencyEmails: string;
  feedbackStartDate: string;
  feedbackEndDate: string;
  lateFeedbackMessage: string;
};
