import { FormEvent, useEffect, useState } from "react";
import {
  clearTasks,
  getSettings,
  getTasks,
  saveSettings,
  saveTasks
} from "./lib/storage";
import type { CommentItem, FeedbackSettings, Task } from "./types";
import fwIconSvg from "../public/FW-icon.svg?raw";

const defaultLateFeedbackMessage =
  "Feedback period closed. Feedback given after the cutoff date cannot be guaranteed and may not be placed in the active backlog.";

const defaultSettings: FeedbackSettings = {
  agencyEmails: "",
  feedbackStartDate: "",
  feedbackEndDate: "",
  lateFeedbackMessage: defaultLateFeedbackMessage
};

const API_BASE_URL = "https://feedback-window.vercel.app";
const APP_VERSION = "1.0.2";

type ActiveTab = "dashboard" | "setup" | "comments" | "tasks";
type ReviewWindowStatus = "Not configured" | "Open" | "Closed" | "Upcoming";
type CommentFilter =
  | "all"
  | "client"
  | "internal"
  | "late"
  | "on-time";
type CommentSort = "newest" | "oldest";
type TaskFilter =
  | "all"
  | "new"
  | "in-progress"
  | "done"
  | "deferred"
  | "accepted-late"
  | "deferred-late";
type TaskSort = "newest" | "oldest" | "priority-high";

type ClassifiedComment = CommentItem & {
  audience: "Internal" | "Client";
  timing: "Late" | "On-time" | "No cutoff set";
};

type CommentThread = {
  root: ClassifiedComment;
  replies: ClassifiedComment[];
};

type IntakeDecision = Task["intakeDecision"];
type ConnectionStatus = "unknown" | "connected" | "not-connected";

type FigmaApiComment = {
  id?: string;
  message?: string;
  created_at?: string;
  parent_id?: string;
  pageName?: string;
  commentUrl?: string;
  nodeId?: string;
  author?: {
    handle?: string;
    name?: string;
    email?: string;
  };
  user?: {
    handle?: string;
    name?: string;
    email?: string;
  };
};

type FigmaCommentsResponse = {
  comments?: FigmaApiComment[];
  pages?: string[];
};

type CurrentFileKeyMessage = {
  type: "current-file-key";
  data?: {
    fileKey?: string;
  };
};

type OAuthStatusResponse = {
  connected?: boolean;
};

type OAuthClaimResponse = {
  connected?: boolean;
  connectionId?: string;
  error?: string;
};

type FigmaProxyError = {
  message?: string;
  upstreamStatus?: number;
  upstreamBody?: unknown;
  error?: string;
};

type ReplyLateCommentsResponse = {
  repliedCommentIds?: string[];
  skippedCommentIds?: string[];
  failedCommentIds?: {
    commentId: string;
    upstreamStatus: number;
    upstreamBody: unknown;
  }[];
  error?: string;
  message?: string;
};

const commentFilterOptions: { label: string; value: CommentFilter }[] = [
  { label: "All comments", value: "all" },
  { label: "Client only", value: "client" },
  { label: "Internal only", value: "internal" },
  { label: "Late only", value: "late" },
  { label: "On-time only", value: "on-time" }
];

const taskFilterOptions: { label: string; value: TaskFilter }[] = [
  { label: "All tasks", value: "all" },
  { label: "New", value: "new" },
  { label: "In Progress", value: "in-progress" },
  { label: "Done", value: "done" },
  { label: "Deferred", value: "deferred" },
  { label: "Accepted Late", value: "accepted-late" },
  { label: "Deferred Late", value: "deferred-late" }
];

const priorityRank: Record<Task["priority"], number> = {
  high: 3,
  medium: 2,
  low: 1
};

const renderNavIcon = (tab: ActiveTab) => {
  if (tab === "dashboard") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="2.5" width="4" height="4" rx="0.75" />
        <rect x="9.5" y="2.5" width="4" height="4" rx="0.75" />
        <rect x="2.5" y="9.5" width="4" height="4" rx="0.75" />
        <rect x="9.5" y="9.5" width="4" height="4" rx="0.75" />
      </svg>
    );
  }

  if (tab === "setup") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2.25" />
        <path d="M8 1.75v1.5M8 12.75v1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M1.75 8h1.5M12.75 8h1.5M3.58 12.42l1.06-1.06M11.36 4.64l1.06-1.06" />
      </svg>
    );
  }

  if (tab === "comments") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.25 3.5h9.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7.25L4 14v-2H3.25a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.25 4h7M6.25 8h7M6.25 12h7" />
      <path d="m2.25 4 1 1 1.75-2M2.25 8l1 1 1.75-2M2.25 12l1 1 1.75-2" />
    </svg>
  );
};

const normalizeSettings = (
  savedSettings: Partial<FeedbackSettings> & { pageScope?: string }
): FeedbackSettings => {
  return {
    ...defaultSettings,
    agencyEmails: savedSettings.agencyEmails || "",
    feedbackStartDate: savedSettings.feedbackStartDate || "",
    feedbackEndDate: savedSettings.feedbackEndDate || "",
    lateFeedbackMessage:
      savedSettings.lateFeedbackMessage || defaultLateFeedbackMessage
  };
};

const parseAgencyTeamMembers = (agencyTeamMembers: string) => {
  return agencyTeamMembers
    .split("\n")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

const isCommentAfterEndDate = (createdAt: string, feedbackEndDate: string) => {
  if (!feedbackEndDate) {
    return false;
  }

  return createdAt.slice(0, 10) > feedbackEndDate;
};

const isRootCommentBeforeStartDate = (
  comment: CommentItem,
  feedbackStartDate: string
) => {
  if (!feedbackStartDate || comment.parentId) {
    return false;
  }

  return comment.createdAt.slice(0, 10) < feedbackStartDate;
};

const formatCommentDate = (createdAt: string) => {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(createdAt));
};

const getTodayDate = () => {
  return new Date().toISOString().slice(0, 10);
};

const getReviewWindowStatus = (
  feedbackStartDate: string,
  feedbackEndDate: string
): ReviewWindowStatus => {
  if (!feedbackStartDate || !feedbackEndDate) {
    return "Not configured";
  }

  const today = getTodayDate();

  if (today < feedbackStartDate) {
    return "Upcoming";
  }

  if (today > feedbackEndDate) {
    return "Closed";
  }

  return "Open";
};

const classifyComments = (
  comments: CommentItem[],
  currentSettings: FeedbackSettings
): ClassifiedComment[] => {
  const agencyTeamList = parseAgencyTeamMembers(currentSettings.agencyEmails);

  return comments.map((comment) => {
    const email = comment.email.trim().toLowerCase();
    const authorName = comment.authorName.trim().toLowerCase();
    const handle = comment.handle?.trim().toLowerCase() || "";
    const commentIdentifiers = [email, authorName, handle].filter(Boolean);
    const isInternal = agencyTeamList.some((agencyTeamMember) =>
      commentIdentifiers.includes(agencyTeamMember)
    );
    const hasCutoff = Boolean(currentSettings.feedbackEndDate);
    const isLate = isCommentAfterEndDate(
      comment.createdAt,
      currentSettings.feedbackEndDate
    );

    return {
      ...comment,
      audience: isInternal ? "Internal" : "Client",
      timing: hasCutoff ? (isLate ? "Late" : "On-time") : "No cutoff set"
    };
  });
};

const filterAndSortComments = (
  comments: ClassifiedComment[],
  filter: CommentFilter,
  searchTerm: string,
  pageFilter: string,
  sort: CommentSort
) => {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  return comments
    .filter((comment) => {
      if (filter === "client") {
        return comment.audience === "Client";
      }

      if (filter === "internal") {
        return comment.audience === "Internal";
      }

      if (filter === "late") {
        return comment.timing === "Late";
      }

      if (filter === "on-time") {
        return comment.timing === "On-time";
      }

      return true;
    })
    .filter((comment) => {
      if (!normalizedSearchTerm) {
        return true;
      }

      return [comment.authorName, comment.email, comment.handle, comment.message]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearchTerm);
    })
    .filter((comment) => {
      if (!pageFilter) {
        return true;
      }

      return comment.pageName === pageFilter;
    })
    .sort((firstComment, secondComment) => {
      const firstTime = new Date(firstComment.createdAt).getTime();
      const secondTime = new Date(secondComment.createdAt).getTime();

      return sort === "newest"
        ? secondTime - firstTime
        : firstTime - secondTime;
    });
};

const filterAndSortTasks = (
  tasksToFilter: Task[],
  filter: TaskFilter,
  searchTerm: string,
  pageFilter: string,
  sort: TaskSort
) => {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  return tasksToFilter
    .filter((task) => {
      if (filter === "accepted-late" || filter === "deferred-late") {
        return task.intakeDecision === filter;
      }

      if (filter !== "all") {
        return task.status === filter;
      }

      return true;
    })
    .filter((task) => {
      if (!normalizedSearchTerm) {
        return true;
      }

      return [task.title, task.authorName, task.email, task.assignee, task.notes]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearchTerm);
    })
    .filter((task) => {
      if (!pageFilter) {
        return true;
      }

      return task.pageName === pageFilter;
    })
    .sort((firstTask, secondTask) => {
      if (sort === "priority-high") {
        return (
          priorityRank[secondTask.priority] - priorityRank[firstTask.priority]
        );
      }

      const firstTime = new Date(firstTask.createdAt).getTime();
      const secondTime = new Date(secondTask.createdAt).getTime();

      return sort === "newest" ? secondTime - firstTime : firstTime - secondTime;
    });
};

const getTaskAudience = (task: Task, currentSettings: FeedbackSettings) => {
  const agencyTeamList = parseAgencyTeamMembers(currentSettings.agencyEmails);
  const taskIdentifiers = [task.email, task.authorName]
    .map((identifier) => identifier.trim().toLowerCase())
    .filter(Boolean);
  const isInternal = agencyTeamList.some((agencyTeamMember) =>
    taskIdentifiers.includes(agencyTeamMember)
  );

  return isInternal ? "Internal" : "Client";
};

const getTaskTiming = (task: Task, currentSettings: FeedbackSettings) => {
  return isCommentAfterEndDate(task.createdAt, currentSettings.feedbackEndDate)
    ? "Late"
    : "On Time";
};

const escapeCsvValue = (value: string) => {
  return `"${value.replace(/"/g, '""')}"`;
};

const buildTasksCsv = (
  tasksToExport: Task[],
  currentSettings: FeedbackSettings
) => {
  const headers = [
    "Name",
    "Description",
    "Original Commenter",
    "Comment Date",
    "Page Name",
    "Figma Comment Link",
    "Feedback Timing",
    "Type",
    "Client-facing?",
    "Owner",
    "Notes"
  ];

  const rows = tasksToExport.map((task) => {
    const audience = getTaskAudience(task, currentSettings);

    return [
      "",
      task.title,
      task.authorName,
      formatCommentDate(task.createdAt),
      task.pageName || "",
      task.commentUrl || "",
      getTaskTiming(task, currentSettings),
      "Task",
      audience === "Client" ? "checked" : "",
      task.assignee,
      task.notes || ""
    ];
  });

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
};

const createTaskFromComment = (
  comment: CommentItem,
  intakeDecision: IntakeDecision,
  replies: CommentItem[] = []
): Task => {
  return {
    id: `task-${comment.id}`,
    commentId: comment.id,
    title: comment.message,
    authorName: comment.authorName,
    email: comment.email,
    createdAt: comment.createdAt,
    pageName: comment.pageName,
    commentUrl: comment.commentUrl,
    nodeId: comment.nodeId,
    status: intakeDecision === "deferred-late" ? "deferred" : "new",
    priority: "medium",
    assignee: "",
    notes: "",
    rootCommentText: comment.message,
    replies: replies.map((reply) => ({
      id: reply.id,
      authorName: reply.authorName,
      createdAt: reply.createdAt,
      message: reply.message
    })),
    intakeDecision
  };
};

const findRootComment = (
  comment: ClassifiedComment,
  comments: ClassifiedComment[]
) => {
  if (!comment.parentId) {
    return comment;
  }

  return (
    comments.find(
      (possibleRoot) =>
        possibleRoot.figmaCommentId === comment.parentId ||
        possibleRoot.id === comment.parentId ||
        possibleRoot.id === `figma-${comment.parentId}`
    ) || comment
  );
};

const getThreadReplies = (
  rootComment: ClassifiedComment,
  comments: ClassifiedComment[]
) => {
  return comments
    .filter(
      (comment) =>
        comment.parentId &&
        (comment.parentId === rootComment.figmaCommentId ||
          comment.parentId === rootComment.id ||
          `figma-${comment.parentId}` === rootComment.id)
    )
    .sort(
      (firstReply, secondReply) =>
        new Date(firstReply.createdAt).getTime() -
        new Date(secondReply.createdAt).getTime()
    );
};

const buildVisibleCommentThreads = (
  comments: ClassifiedComment[],
  visibleFilteredComments: ClassifiedComment[]
) => {
  const threadMap = new Map<string, CommentThread>();

  visibleFilteredComments.forEach((comment) => {
    const root = findRootComment(comment, comments);

    if (!threadMap.has(root.id)) {
      threadMap.set(root.id, {
        root,
        replies: getThreadReplies(root, comments)
      });
    }
  });

  return Array.from(threadMap.values());
};

const getCommentPageNames = (comments: CommentItem[]) => {
  return Array.from(
    new Set(
      comments
        .map((comment) => comment.pageName || "")
        .filter((pageName) => pageName && pageName !== "Unknown page")
    )
  ).sort((firstPageName, secondPageName) =>
    firstPageName.localeCompare(secondPageName)
  );
};

const getPageOptions = (apiPages: string[], comments: CommentItem[]) => {
  const pageNames = new Set<string>();

  apiPages.forEach((pageName) => {
    if (pageName && pageName !== "Unknown page") {
      pageNames.add(pageName);
    }
  });

  getCommentPageNames(comments).forEach((pageName) => pageNames.add(pageName));

  return Array.from(pageNames);
};

const getTaskPageNames = (tasks: Task[]) => {
  return Array.from(
    new Set(
      tasks
        .map((task) => task.pageName || "")
        .filter((pageName) => pageName && pageName !== "Unknown page")
    )
  ).sort((firstPageName, secondPageName) =>
    firstPageName.localeCompare(secondPageName)
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [settings, setSettings] = useState<FeedbackSettings>(defaultSettings);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [figmaComments, setFigmaComments] = useState<CommentItem[]>([]);
  const [figmaPageNames, setFigmaPageNames] = useState<string[]>([]);
  const [currentFileKey, setCurrentFileKey] = useState("");
  const [manualFileKey, setManualFileKey] = useState("");
  const [connectionCode, setConnectionCode] = useState("");
  const [claimedConnectionId, setClaimedConnectionId] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("unknown");
  const [isFetchingFigmaComments, setIsFetchingFigmaComments] = useState(false);
  const [figmaFetchStatus, setFigmaFetchStatus] = useState("");
  const [figmaFetchError, setFigmaFetchError] = useState("");
  const [olderCommentsExcludedCount, setOlderCommentsExcludedCount] =
    useState(0);
  const [lateReplyStatus, setLateReplyStatus] = useState("");
  const [lateReplyError, setLateReplyError] = useState("");
  const [repliedLateCommentIds, setRepliedLateCommentIds] = useState<string[]>(
    []
  );
  const [commentFilter, setCommentFilter] = useState<CommentFilter>("all");
  const [commentSearch, setCommentSearch] = useState("");
  const [commentPageFilter, setCommentPageFilter] = useState("");
  const [commentSort, setCommentSort] = useState<CommentSort>("newest");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskPageFilter, setTaskPageFilter] = useState("");
  const [taskSort, setTaskSort] = useState<TaskSort>("newest");
  const [saveMessage, setSaveMessage] = useState("");
  const [isCommentFiltersOpen, setIsCommentFiltersOpen] = useState(false);
  const [isTaskFiltersOpen, setIsTaskFiltersOpen] = useState(false);

  const loadSettings = () => {
    getSettings().then((savedSettings) => {
      setSettings(normalizeSettings(savedSettings));
    });
  };

  const loadTasks = () => {
    getTasks().then((savedTasks) => {
      setTasks(
        savedTasks.map((task) => ({
          ...task,
          assignee: task.assignee || "",
          notes: task.notes || "",
          rootCommentText: task.rootCommentText || task.title,
          replies: task.replies || [],
          intakeDecision: task.intakeDecision || "accepted"
        }))
      );
    });
  };

  useEffect(() => {
    loadSettings();
    loadTasks();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data.pluginMessage as CurrentFileKeyMessage;

      if (message?.type === "current-file-key") {
        setCurrentFileKey(message.data?.fileKey || "");
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const updateSetting = (key: keyof FeedbackSettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      [key]: value
    }));
    setSaveMessage("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveSettings(settings);
    setSaveMessage("Settings saved.");
  };

  const openTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setSaveMessage("");

    if (tab === "dashboard") {
      loadSettings();
      loadTasks();
    }

    if (tab === "comments") {
      loadSettings();
    }

    if (tab === "tasks") {
      loadTasks();
    }
  };

  const convertCommentToTask = (
    comment: CommentItem,
    intakeDecision: IntakeDecision,
    replies: CommentItem[] = []
  ) => {
    const taskAlreadyExists = tasks.some((task) => task.commentId === comment.id);

    if (taskAlreadyExists) {
      return;
    }

    const updatedTasks = [
      ...tasks,
      createTaskFromComment(comment, intakeDecision, replies)
    ];
    setTasks(updatedTasks);
    saveTasks(updatedTasks);
  };

  const deleteTask = (taskId: string) => {
    const updatedTasks = tasks.filter((task) => task.id !== taskId);

    setTasks(updatedTasks);
    saveTasks(updatedTasks);
  };

  const updateTask = (taskId: string, updates: Partial<Task>) => {
    const updatedTasks = tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }

      return {
        ...task,
        ...updates
      };
    });

    setTasks(updatedTasks);
    saveTasks(updatedTasks);
  };

  const updateManualFileKey = (value: string) => {
    setManualFileKey(value);
    setFigmaFetchError("");
    setFigmaFetchStatus("");
  };

  const updateConnectionCode = (value: string) => {
    setConnectionCode(value);
    setFigmaFetchError("");
    setFigmaFetchStatus("");
  };

  const connectToFigma = () => {
    window.open(`${API_BASE_URL}/api/auth/figma/start`, "_blank");
  };

  const claimFigmaConnection = async () => {
    const trimmedCode = connectionCode.trim();

    if (!trimmedCode) {
      setConnectionStatus("not-connected");
      setFigmaFetchStatus("");
      setFigmaFetchError("Paste the connection code from the OAuth success page.");
      return;
    }

    setFigmaFetchError("");
    setFigmaFetchStatus("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/claim?code=${encodeURIComponent(trimmedCode)}`
      );
      const data = (await response.json().catch(() => ({}))) as
        OAuthClaimResponse;

      if (!response.ok || !data.connected || !data.connectionId) {
        setClaimedConnectionId("");
        setConnectionStatus("not-connected");
        setFigmaFetchStatus("");
        setFigmaFetchError(
          data.error || "Connection code was not found or has expired."
        );
        return;
      }

      setClaimedConnectionId(data.connectionId);
      setConnectionCode(data.connectionId);
      setConnectionStatus("connected");
      setFigmaFetchStatus("");
    } catch {
      setFigmaFetchStatus("");
      setConnectionStatus("unknown");
      setFigmaFetchError("The OAuth helper could not be reached.");
    }
  };

  const checkFigmaConnection = async () => {
    setFigmaFetchError("");
    setFigmaFetchStatus("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/status?connectionId=${encodeURIComponent(
          claimedConnectionId
        )}`
      );
      const data = (await response.json()) as OAuthStatusResponse;

      setConnectionStatus(data.connected ? "connected" : "not-connected");
      setFigmaFetchStatus("");

      if (!data.connected) {
        setClaimedConnectionId("");
        setFigmaFetchError(
          "Not connected to Figma. Click Connect to Figma first, then paste the connection code."
        );
      }
    } catch {
      setFigmaFetchStatus("");
      setConnectionStatus("unknown");
      setFigmaFetchError("The OAuth helper could not be reached.");
    }
  };

  const fetchRealFigmaComments = async () => {
    const activeFileKey = currentFileKey || manualFileKey.trim();

    if (!activeFileKey) {
      setFigmaFetchError("No Figma file key is available for this file.");
      setFigmaFetchStatus("");
      return;
    }

    if (!claimedConnectionId) {
      setFigmaFetchError(
        "Not connected to Figma. Click Connect to Figma first, then paste the connection code."
      );
      setFigmaFetchStatus("");
      return;
    }

    setFigmaFetchError("");
    setFigmaFetchStatus("Loading Figma comments...");
    setIsFetchingFigmaComments(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/figma/comments?fileKey=${encodeURIComponent(
          activeFileKey
        )}&connectionId=${encodeURIComponent(claimedConnectionId)}`
      );

      if (response.status === 401) {
        setFigmaComments([]);
        setFigmaPageNames([]);
        setOlderCommentsExcludedCount(0);
        setFigmaFetchStatus("");
        setFigmaFetchError(
          "Not connected to Figma. Click Connect to Figma first, then paste the connection code."
        );
        return;
      }

      if (response.status === 403) {
        setFigmaComments([]);
        setFigmaPageNames([]);
        setOlderCommentsExcludedCount(0);
        setFigmaFetchStatus("");
        setFigmaFetchError(
          "Figma denied API access to this file. You may be able to view it in Figma, but this OAuth app does not have API access to the file."
        );
        return;
      }

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as
          FigmaProxyError;
        setFigmaComments([]);
        setFigmaPageNames([]);
        setOlderCommentsExcludedCount(0);
        setFigmaFetchStatus("");
        setFigmaFetchError(
          errorData.message ||
            errorData.error ||
            "Figma could not return comments for that file."
        );
        return;
      }

      const data = (await response.json()) as FigmaCommentsResponse;
      const normalizedComments: CommentItem[] = (data.comments || []).map(
        (comment, index) => {
          const author = comment.author || comment.user;
          const figmaCommentId = comment.id || "";

          return {
            id: `figma-${figmaCommentId || index}`,
            figmaCommentId,
            authorName:
              author?.name || author?.handle || "Unknown Figma user",
            email: author?.email || "",
            handle: author?.handle,
            parentId: comment.parent_id || undefined,
            message: comment.message || "",
            createdAt: comment.created_at || new Date().toISOString(),
            pageName: comment.pageName || "Unknown page",
            commentUrl: comment.commentUrl,
            nodeId: comment.nodeId
          };
        }
      );
      const excludedOlderRootComments = normalizedComments.filter((comment) =>
        isRootCommentBeforeStartDate(comment, settings.feedbackStartDate)
      );
      const excludedRootCommentIds = new Set(
        excludedOlderRootComments.flatMap((comment) =>
          [comment.figmaCommentId, comment.id].filter(
            (commentId): commentId is string => Boolean(commentId)
          )
        )
      );
      const startDateFilteredComments = normalizedComments.filter((comment) => {
        if (isRootCommentBeforeStartDate(comment, settings.feedbackStartDate)) {
          return false;
        }

        if (
          comment.parentId &&
          (excludedRootCommentIds.has(comment.parentId) ||
            excludedRootCommentIds.has(`figma-${comment.parentId}`))
        ) {
          return false;
        }

        return true;
      });

      setFigmaPageNames(getPageOptions(data.pages || [], normalizedComments));
      setFigmaComments(startDateFilteredComments);
      setOlderCommentsExcludedCount(excludedOlderRootComments.length);
      setFigmaFetchStatus("");
    } catch {
      setFigmaComments([]);
      setFigmaPageNames([]);
      setOlderCommentsExcludedCount(0);
      setFigmaFetchStatus("");
      setFigmaFetchError("The OAuth helper could not be reached.");
    } finally {
      setIsFetchingFigmaComments(false);
    }
  };

  const replyToLateComments = async () => {
    const activeFileKey = currentFileKey || manualFileKey.trim();
    const commentIdsToReplyTo = lateRootCommentsAwaitingReply
      .map((comment) => comment.figmaCommentId)
      .filter((commentId): commentId is string => Boolean(commentId));

    if (!activeFileKey) {
      setLateReplyStatus("");
      setLateReplyError("No Figma file key is available for this file.");
      return;
    }

    if (!claimedConnectionId) {
      setLateReplyStatus("");
      setLateReplyError(
        "Not connected to Figma. Click Connect to Figma first, then paste the connection code."
      );
      return;
    }

    if (commentIdsToReplyTo.length === 0) {
      setLateReplyStatus("No unreplied late root comments are available.");
      setLateReplyError("");
      return;
    }

    const confirmed = window.confirm(
      `Post the saved late feedback message to ${commentIdsToReplyTo.length} late comment${
        commentIdsToReplyTo.length === 1 ? "" : "s"
      }?`
    );

    if (!confirmed) {
      return;
    }

    setLateReplyStatus("Posting late-feedback replies...");
    setLateReplyError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/figma/reply-late-comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          connectionId: claimedConnectionId,
          fileKey: activeFileKey,
          commentIds: commentIdsToReplyTo,
          message: settings.lateFeedbackMessage
        })
      });
      const data = (await response.json().catch(() => ({}))) as
        ReplyLateCommentsResponse;

      if (response.status === 401) {
        setLateReplyStatus("");
        setLateReplyError(
          "Not connected to Figma. Click Connect to Figma first, then paste the connection code."
        );
        return;
      }

      if (response.status === 403) {
        setLateReplyStatus("");
        setLateReplyError(
          "Figma denied permission to post comment replies. Confirm the OAuth app has file_comments:write."
        );
        return;
      }

      if (!response.ok) {
        setLateReplyStatus("");
        setLateReplyError(
          data.message || data.error || "Could not post late-feedback replies."
        );
        return;
      }

      const repliedCommentIds = data.repliedCommentIds || [];
      const failedCount = data.failedCommentIds?.length || 0;
      const skippedCount = data.skippedCommentIds?.length || 0;

      setRepliedLateCommentIds((currentIds) =>
        Array.from(new Set([...currentIds, ...repliedCommentIds]))
      );

      if (repliedCommentIds.length === 0 && failedCount > 0) {
        setLateReplyStatus("");
        setLateReplyError("Figma could not post the late-feedback replies.");
        return;
      }

      setLateReplyStatus(
        `Posted ${repliedCommentIds.length} late-feedback repl${
          repliedCommentIds.length === 1 ? "y" : "ies"
        }${
          skippedCount > 0
            ? `; skipped ${skippedCount} non-root comment${
                skippedCount === 1 ? "" : "s"
              }`
            : ""
        }${
          failedCount > 0
            ? `; ${failedCount} failed in Figma`
            : ""
        }.`
      );
      setLateReplyError("");
    } catch {
      setLateReplyStatus("");
      setLateReplyError("The OAuth helper could not be reached.");
    }
  };

  const replyToLateComment = async (comment: ClassifiedComment) => {
    const activeFileKey = currentFileKey || manualFileKey.trim();

    if (!comment.figmaCommentId) {
      setLateReplyStatus("");
      setLateReplyError("This comment cannot be replied to from Figma.");
      return;
    }

    if (!activeFileKey) {
      setLateReplyStatus("");
      setLateReplyError("No Figma file key is available for this file.");
      return;
    }

    if (!claimedConnectionId) {
      setLateReplyStatus("");
      setLateReplyError(
        "Not connected to Figma. Click Connect to Figma first, then paste the connection code."
      );
      return;
    }

    const confirmed = window.confirm(
      "Post the saved late feedback message to this comment?"
    );

    if (!confirmed) {
      return;
    }

    setLateReplyStatus("Posting late-feedback reply...");
    setLateReplyError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/figma/reply-late-comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          connectionId: claimedConnectionId,
          fileKey: activeFileKey,
          commentIds: [comment.figmaCommentId],
          message: settings.lateFeedbackMessage
        })
      });
      const data = (await response.json().catch(() => ({}))) as
        ReplyLateCommentsResponse;

      if (response.status === 401) {
        setLateReplyStatus("");
        setLateReplyError(
          "Not connected to Figma. Click Connect to Figma first, then paste the connection code."
        );
        return;
      }

      if (response.status === 403) {
        setLateReplyStatus("");
        setLateReplyError(
          "Figma denied permission to post comment replies. Confirm the OAuth app has file_comments:write."
        );
        return;
      }

      if (!response.ok) {
        setLateReplyStatus("");
        setLateReplyError(
          data.message || data.error || "Could not post the late-feedback reply."
        );
        return;
      }

      const repliedCommentIds = data.repliedCommentIds || [];

      if (!repliedCommentIds.includes(comment.figmaCommentId)) {
        setLateReplyStatus("");
        setLateReplyError("Figma could not post the late-feedback reply.");
        return;
      }

      setRepliedLateCommentIds((currentIds) =>
        Array.from(new Set([...currentIds, ...repliedCommentIds]))
      );
      setLateReplyStatus("Late reply sent.");
      setLateReplyError("");
    } catch {
      setLateReplyStatus("");
      setLateReplyError("The OAuth helper could not be reached.");
    }
  };

  const clearSavedTasks = () => {
    const confirmed = window.confirm("Clear all saved tasks?");

    if (!confirmed) {
      return;
    }

    clearTasks();
    setTasks([]);
  };

  const exportTasksCsv = () => {
    if (tasks.length === 0) {
      return;
    }

    const csv = buildTasksCsv(tasks, settings);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "feedback-window-tasks.csv";
    link.click();

    URL.revokeObjectURL(url);
  };

  const classifiedComments = classifyComments(figmaComments, settings);
  const activeFileKey = currentFileKey || manualFileKey.trim();
  const activeCommentFilterLabel =
    commentFilterOptions.find((option) => option.value === commentFilter)
      ?.label || "All comments";
  const activeCommentSortLabel =
    commentSort === "newest" ? "Newest first" : "Oldest first";
  const activeTaskFilterLabel =
    taskFilterOptions.find((option) => option.value === taskFilter)?.label ||
    "All tasks";
  const activeTaskSortLabel =
    taskSort === "newest"
      ? "Newest first"
      : taskSort === "oldest"
        ? "Oldest first"
        : "Priority high to low";
  const visibleComments = filterAndSortComments(
    classifiedComments,
    commentFilter,
    commentSearch,
    commentPageFilter,
    commentSort
  );
  const commentPageOptions =
    figmaPageNames.length > 0 ? figmaPageNames : getCommentPageNames(figmaComments);
  const taskPageOptions = Array.from(
    new Set([...commentPageOptions, ...getTaskPageNames(tasks)])
  ).sort((firstPageName, secondPageName) =>
    firstPageName.localeCompare(secondPageName)
  );
  const allVisibleCommentThreads = buildVisibleCommentThreads(
    classifiedComments,
    visibleComments
  );
  const visibleCommentThreads = allVisibleCommentThreads;
  const lateClientComments = classifiedComments.filter(
    (comment) => comment.audience === "Client" && comment.timing === "Late"
  );
  const lateRootCommentsAwaitingReply = lateClientComments.filter(
    (comment) =>
      !comment.parentId &&
      comment.figmaCommentId &&
      !repliedLateCommentIds.includes(comment.figmaCommentId)
  );
  const visibleTasks = filterAndSortTasks(
    tasks,
    taskFilter,
    taskSearch,
    taskPageFilter,
    taskSort
  );
  const taskCommentIds = tasks.map((task) => task.commentId);
  const reviewWindowStatus = getReviewWindowStatus(
    settings.feedbackStartDate,
    settings.feedbackEndDate
  );
  const dashboardCards = [
    {
      label: "Total comments",
      value: classifiedComments.length
    },
    {
      label: "Client comments",
      value: classifiedComments.filter((comment) => comment.audience === "Client")
        .length
    },
    {
      label: "Internal comments",
      value: classifiedComments.filter(
        (comment) => comment.audience === "Internal"
      ).length
    },
    {
      label: "Late client comments",
      value: classifiedComments.filter(
        (comment) =>
          comment.audience === "Client" && comment.timing === "Late"
      ).length
    },
    {
      label: "Total tasks",
      value: tasks.length
    },
    {
      label: "Open tasks",
      value: tasks.filter(
        (task) => task.status === "new" || task.status === "in-progress"
      ).length
    },
    {
      label: "Deferred tasks",
      value: tasks.filter((task) => task.status === "deferred").length
    },
    {
      label: "Done tasks",
      value: tasks.filter((task) => task.status === "done").length
    }
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span
            className="sidebar-icon"
            aria-label="Feedback Window"
            role="img"
            dangerouslySetInnerHTML={{ __html: fwIconSvg }}
          />
        </div>

        <nav className="sidebar-nav" aria-label="Feedback Window sections">
          <button
            className={activeTab === "dashboard" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => openTab("dashboard")}
          >
            <span className="nav-icon">{renderNavIcon("dashboard")}</span>
            <span className="nav-label">Dashboard</span>
          </button>
          <button
            className={activeTab === "setup" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => openTab("setup")}
          >
            <span className="nav-icon">{renderNavIcon("setup")}</span>
            <span className="nav-label">Setup</span>
          </button>
          <button
            className={activeTab === "comments" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => openTab("comments")}
          >
            <span className="nav-icon">{renderNavIcon("comments")}</span>
            <span className="nav-label">Comments</span>
          </button>
          <button
            className={activeTab === "tasks" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => openTab("tasks")}
          >
            <span className="nav-icon">{renderNavIcon("tasks")}</span>
            <span className="nav-label">Tasks</span>
          </button>
        </nav>

        <p className="sidebar-version">v{APP_VERSION}</p>
      </aside>

      <main className="main-content">
        <div className="content-panel">

      {activeTab === "dashboard" && (
        <section className="dashboard-view">
          <div className="section-summary">
            <h2>Dashboard</h2>
            <p>Current review window, comment mix, and task progress.</p>
          </div>

          <div className="summary-grid">
            {dashboardCards.map((card) => (
              <article className="summary-card" key={card.label}>
                <p>{card.label}</p>
                <strong>{card.value}</strong>
              </article>
            ))}
          </div>

          <section className="review-window-card">
            <div className="section-summary">
              <h2>Review Window</h2>
            </div>

            <div className="review-window-details">
              <p>
                <span>Start date</span>
                <strong>{settings.feedbackStartDate || "Not set"}</strong>
              </p>
              <p>
                <span>End date</span>
                <strong>{settings.feedbackEndDate || "Not set"}</strong>
              </p>
              <p>
                <span>Status</span>
                <strong>{reviewWindowStatus}</strong>
              </p>
            </div>

            {reviewWindowStatus === "Closed" && (
              <div className="late-feedback-warning">
                <strong>Review window closed</strong>
                <p>{settings.lateFeedbackMessage}</p>
              </div>
            )}
          </section>
        </section>
      )}

      {activeTab === "setup" && (
        <form className="setup-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Agency Team Members</span>
            <textarea
              value={settings.agencyEmails}
              onChange={(event) =>
                updateSetting("agencyEmails", event.target.value)
              }
              placeholder="One email, name, or Figma handle per line"
              rows={5}
            />
          </label>

          <label className="field">
            <span>Feedback Start Date</span>
            <input
              type="date"
              value={settings.feedbackStartDate}
              onChange={(event) =>
                updateSetting("feedbackStartDate", event.target.value)
              }
            />
          </label>

          <label className="field">
            <span>Feedback End Date</span>
            <input
              type="date"
              value={settings.feedbackEndDate}
              onChange={(event) =>
                updateSetting("feedbackEndDate", event.target.value)
              }
            />
          </label>

          <label className="field">
            <span>Late Feedback Message</span>
            <textarea
              value={settings.lateFeedbackMessage}
              onChange={(event) =>
                updateSetting("lateFeedbackMessage", event.target.value)
              }
              rows={5}
            />
          </label>

          <button type="submit">Save Settings</button>

          {saveMessage && <p className="save-message">{saveMessage}</p>}
        </form>
      )}

      {activeTab === "comments" && (
        <section className="comments-view">
          <div className="section-summary">
            <h2>Comments</h2>
            <p>
              Classification is based on the saved agency members and feedback
              end date.
            </p>
          </div>

          <section className="figma-comments-card">
            <div className="section-summary">
              <h2>Load Figma Comments</h2>
              <p>
                Connect through the OAuth helper, then load comments from
                the current Figma file.
              </p>
            </div>

            <div className="figma-comments-form">
              {currentFileKey ? (
                <div className="connection-state">
                  <strong>Current file detected</strong>
                </div>
              ) : (
                <div className="manual-file-key">
                  <label className="field">
                    <span>Figma file key</span>
                    <input
                      type="text"
                      value={manualFileKey}
                      onChange={(event) =>
                        updateManualFileKey(event.target.value)
                      }
                      placeholder="Paste the file key"
                    />
                  </label>

                  <p className="helper-text">
                    Paste the key from the Figma URL if this file cannot be
                    detected automatically.
                  </p>
                </div>
              )}

              <div className="connection-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={connectToFigma}
                >
                  Connect to Figma
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={checkFigmaConnection}
                >
                  Check Connection
                </button>
              </div>

              {connectionStatus === "connected" ? (
                <div className="connection-state success">
                  <strong>Connected to Figma</strong>
                </div>
              ) : (
                <>
                  <label className="field">
                    <span>Connection Code</span>
                    <input
                      type="text"
                      value={connectionCode}
                      onChange={(event) =>
                        updateConnectionCode(event.target.value)
                      }
                      placeholder="FW-123456"
                    />
                  </label>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={claimFigmaConnection}
                  >
                    Use Connection Code
                  </button>
                </>
              )}

              <button
                className={
                  connectionStatus === "connected" ? "primary-action" : ""
                }
                type="button"
                onClick={fetchRealFigmaComments}
                disabled={
                  isFetchingFigmaComments ||
                  !activeFileKey ||
                  !claimedConnectionId
                }
              >
                Load Comments from This File
              </button>

              <p className="helper-text">
                Only comments from the feedback start date onward will be
                imported.
              </p>

              {olderCommentsExcludedCount > 0 && (
                <p className="helper-text">
                  {olderCommentsExcludedCount} older comment
                  {olderCommentsExcludedCount === 1 ? " was" : "s were"}{" "}
                  excluded based on the feedback start date.
                </p>
              )}

              {figmaFetchStatus && (
                <p className="helper-text">{figmaFetchStatus}</p>
              )}

              {figmaFetchError && (
                <p className="error-message">{figmaFetchError}</p>
              )}
            </div>
          </section>

          {lateClientComments.length > 0 && (
            <section className="late-feedback-warning">
              <strong>Late feedback summary</strong>
              <p>{settings.lateFeedbackMessage}</p>
              <p>
                {lateRootCommentsAwaitingReply.length} late root comment
                {lateRootCommentsAwaitingReply.length === 1 ? "" : "s"} ready
                for reply.
              </p>
              <button
                className="secondary-button"
                type="button"
                onClick={replyToLateComments}
                disabled={lateRootCommentsAwaitingReply.length === 0}
              >
                Reply to late comments
              </button>

              {lateReplyStatus && (
                <p className="helper-text">{lateReplyStatus}</p>
              )}

              {lateReplyError && (
                <p className="error-message">{lateReplyError}</p>
              )}
            </section>
          )}

          <section className="accordion-card">
            <button
              className="accordion-trigger"
              type="button"
              onClick={() => setIsCommentFiltersOpen((isOpen) => !isOpen)}
              aria-expanded={isCommentFiltersOpen}
            >
              <span>Filters & Sort</span>
              <strong>
                {activeCommentFilterLabel} · {activeCommentSortLabel}
              </strong>
            </button>

            {isCommentFiltersOpen && (
              <div className="accordion-content comment-controls">
                <label className="field">
                  <span>Filter</span>
                  <select
                    value={commentFilter}
                    onChange={(event) =>
                      setCommentFilter(event.target.value as CommentFilter)
                    }
                  >
                    {commentFilterOptions.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Search</span>
                  <input
                    type="search"
                    value={commentSearch}
                    onChange={(event) => setCommentSearch(event.target.value)}
                    placeholder="Search author, email, or message"
                  />
                </label>

                <label className="field">
                  <span>Page title</span>
                  <select
                    value={commentPageFilter}
                    onChange={(event) => setCommentPageFilter(event.target.value)}
                  >
                    <option value="">All pages</option>
                    {commentPageOptions.map((pageName) => (
                      <option value={pageName} key={pageName}>
                        {pageName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Sort</span>
                  <select
                    value={commentSort}
                    onChange={(event) =>
                      setCommentSort(event.target.value as CommentSort)
                    }
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </select>
                </label>

                <p className="comment-count">
                  Showing {visibleComments.length} of {classifiedComments.length}{" "}
                  comments
                </p>
              </div>
            )}
          </section>

          <div className="comment-list">
            {visibleCommentThreads.length === 0 ? (
              <p className="empty-message">
                No comments match the current filters.
              </p>
            ) : (
              visibleCommentThreads.map((thread) => {
                const comment = thread.root;
                const taskAlreadyExists = taskCommentIds.includes(comment.id);
                const isClientLate =
                  comment.audience === "Client" && comment.timing === "Late";
                const canReplyWithLateMessage =
                  isClientLate && !comment.parentId && Boolean(comment.figmaCommentId);
                const lateReplyAlreadySent = Boolean(
                  comment.figmaCommentId &&
                    repliedLateCommentIds.includes(comment.figmaCommentId)
                );

                return (
                  <article
                    className={
                      isClientLate
                        ? "comment-card late-warning-card"
                        : "comment-card"
                    }
                    key={comment.id}
                  >
                    <div className="comment-card-header">
                      <div>
                        <h3>{comment.authorName}</h3>
                        {comment.email && <p>{comment.email}</p>}
                        {comment.pageName && <p>Page: {comment.pageName}</p>}
                        {comment.commentUrl && (
                          <a
                            className="source-link"
                            href={comment.commentUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View in Figma
                          </a>
                        )}
                      </div>
                      <p className="comment-date">
                        {formatCommentDate(comment.createdAt)}
                      </p>
                    </div>

                    <p className="comment-message">{comment.message}</p>

                    <div className="badges">
                      <span
                        className={
                          comment.audience === "Internal"
                            ? "badge internal"
                            : "badge client"
                        }
                      >
                        {comment.audience}
                      </span>
                      <span
                        className={
                          comment.timing === "Late"
                            ? "badge late"
                            : "badge on-time"
                        }
                      >
                        {comment.timing}
                      </span>
                      {taskAlreadyExists && (
                        <span className="badge task-created">Task Created</span>
                      )}
                    </div>

                    {isClientLate && (
                      <div className="late-feedback-warning">
                        <strong>Late client feedback</strong>
                        <p>{settings.lateFeedbackMessage}</p>
                      </div>
                    )}

                    {thread.replies.length > 0 && (
                      <details className="thread-accordion">
                        <summary>
                          View thread ({thread.replies.length}{" "}
                          {thread.replies.length === 1 ? "reply" : "replies"})
                        </summary>
                        <div className="thread-replies">
                          {thread.replies.map((reply) => (
                            <div className="thread-reply" key={reply.id}>
                              <div className="thread-reply-header">
                                <strong>{reply.authorName}</strong>
                                <span>{formatCommentDate(reply.createdAt)}</span>
                              </div>
                              <p>{reply.message}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {!taskAlreadyExists && (
                      isClientLate ? (
                        <div className="late-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() =>
                              convertCommentToTask(
                                comment,
                                "accepted-late",
                                thread.replies
                              )
                            }
                          >
                            Accept Anyway
                          </button>
                          <button
                            className="secondary-button defer-button"
                            type="button"
                            onClick={() =>
                              convertCommentToTask(
                                comment,
                                "deferred-late",
                                thread.replies
                              )
                            }
                          >
                            Defer
                          </button>
                        </div>
                      ) : (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            convertCommentToTask(
                              comment,
                              "accepted",
                              thread.replies
                            )
                          }
                        >
                          Convert to Task
                        </button>
                      )
                    )}

                    {canReplyWithLateMessage && (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => replyToLateComment(comment)}
                        disabled={lateReplyAlreadySent}
                      >
                        {lateReplyAlreadySent
                          ? "Late reply sent"
                          : "Reply with late message"}
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}

      {activeTab === "tasks" && (
        <section className="tasks-view">
          <div className="section-summary">
            <h2>Tasks</h2>
            <p>Converted comments appear here as editable backlog items.</p>
          </div>

          <div className="export-actions">
            <button
              type="button"
              onClick={exportTasksCsv}
              disabled={tasks.length === 0}
            >
              Export CSV
            </button>

            <div className="secondary-action-area">
              <button
                className="secondary-button delete-button"
                type="button"
                onClick={clearSavedTasks}
                disabled={tasks.length === 0}
              >
                Clear All Tasks
              </button>
            </div>

            {tasks.length === 0 && (
              <p className="helper-text">
                Create at least one task before exporting.
              </p>
            )}
          </div>

          <section className="accordion-card">
            <button
              className="accordion-trigger"
              type="button"
              onClick={() => setIsTaskFiltersOpen((isOpen) => !isOpen)}
              aria-expanded={isTaskFiltersOpen}
            >
              <span>Filters & Sort</span>
              <strong>
                {activeTaskFilterLabel} · {activeTaskSortLabel}
              </strong>
            </button>

            {isTaskFiltersOpen && (
              <div className="accordion-content task-controls">
                <label className="field">
                  <span>Filter</span>
                  <select
                    value={taskFilter}
                    onChange={(event) =>
                      setTaskFilter(event.target.value as TaskFilter)
                    }
                  >
                    {taskFilterOptions.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Search</span>
                  <input
                    type="search"
                    value={taskSearch}
                    onChange={(event) => setTaskSearch(event.target.value)}
                    placeholder="Search title, commenter, owner, or notes"
                  />
                </label>

                <label className="field">
                  <span>Page title</span>
                  <select
                    value={taskPageFilter}
                    onChange={(event) => setTaskPageFilter(event.target.value)}
                  >
                    <option value="">All pages</option>
                    {taskPageOptions.map((pageName) => (
                      <option value={pageName} key={pageName}>
                        {pageName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Sort</span>
                  <select
                    value={taskSort}
                    onChange={(event) =>
                      setTaskSort(event.target.value as TaskSort)
                    }
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="priority-high">Priority high to low</option>
                  </select>
                </label>

                <p className="task-count">
                  Showing {visibleTasks.length} of {tasks.length} tasks
                </p>
              </div>
            )}
          </section>

          {tasks.length === 0 ? (
            <p className="empty-message">
              No tasks yet — convert a comment to get started
            </p>
          ) : (
            <div className="task-list">
              {visibleTasks.length === 0 ? (
                <p className="empty-message">
                  No tasks match the current filters.
                </p>
              ) : (
                visibleTasks.map((task) => {
                  const taskAudience = getTaskAudience(task, settings);
                  const taskTiming = getTaskTiming(task, settings);

                  return (
                    <article className="task-card" key={task.id}>
                      <div className="task-card-header">
                        <h3>{task.title}</h3>
                        <p>{formatCommentDate(task.createdAt)}</p>
                      </div>

                      <p className="task-commenter">
                        Original commenter: {task.authorName}
                      </p>
                      {task.pageName && (
                        <p className="task-commenter">Page: {task.pageName}</p>
                      )}
                      {task.commentUrl && (
                        <a
                          className="source-link"
                          href={task.commentUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View in Figma
                        </a>
                      )}

                      <div className="badges">
                        <span className="badge task-created">Task Created</span>
                        <span
                          className={
                            taskAudience === "Internal"
                              ? "badge internal"
                              : "badge client"
                          }
                        >
                          {taskAudience}
                        </span>
                        <span
                          className={
                            taskTiming === "Late"
                              ? "badge late"
                              : "badge on-time"
                          }
                        >
                          {taskTiming}
                        </span>
                      </div>

                      {task.replies && task.replies.length > 0 && (
                        <details className="thread-accordion">
                          <summary>
                            View original thread ({task.replies.length}{" "}
                            {task.replies.length === 1 ? "reply" : "replies"})
                          </summary>
                          <div className="thread-replies">
                            <div className="thread-reply root-thread-comment">
                              <div className="thread-reply-header">
                                <strong>{task.authorName}</strong>
                                <span>{formatCommentDate(task.createdAt)}</span>
                              </div>
                              <p>{task.rootCommentText || task.title}</p>
                            </div>

                            {task.replies.map((reply) => (
                              <div className="thread-reply" key={reply.id}>
                                <div className="thread-reply-header">
                                  <strong>{reply.authorName}</strong>
                                  <span>{formatCommentDate(reply.createdAt)}</span>
                                </div>
                                <p>{reply.message}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      <div className="task-edit-fields">
                        <label className="field">
                          <span>Owner</span>
                          <input
                            type="text"
                            value={task.assignee}
                            onChange={(event) =>
                              updateTask(task.id, {
                                assignee: event.target.value
                              })
                            }
                            placeholder="Add owner"
                          />
                        </label>

                        <label className="field">
                          <span>Notes</span>
                          <textarea
                            value={task.notes || ""}
                            onChange={(event) =>
                              updateTask(task.id, {
                                notes: event.target.value
                              })
                            }
                            placeholder="Add notes or context"
                            rows={3}
                          />
                        </label>
                      </div>

                      <button
                        className="secondary-button delete-button"
                        type="button"
                        onClick={() => deleteTask(task.id)}
                      >
                        Delete Task
                      </button>
                    </article>
                  );
                })
              )}
            </div>
          )}
        </section>
      )}
        </div>
      </main>
    </div>
  );
}
