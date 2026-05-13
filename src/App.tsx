import { FormEvent, useEffect, useState } from "react";
import {
  clearTasks,
  getSettings,
  getTasks,
  saveSettings,
  saveTasks
} from "./lib/storage";
import type { CommentItem, FeedbackSettings, Task } from "./types";

const defaultLateFeedbackMessage =
  "Feedback period closed. Feedback given after the cutoff date cannot be guaranteed and may not be placed in the active backlog.";

const defaultSettings: FeedbackSettings = {
  agencyEmails: "",
  feedbackStartDate: "",
  feedbackEndDate: "",
  lateFeedbackMessage: defaultLateFeedbackMessage
};

const API_BASE_URL = "https://feedback-window.vercel.app";

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

type IntakeDecision = Task["intakeDecision"];
type ConnectionStatus = "unknown" | "connected" | "not-connected";

type FigmaApiComment = {
  id?: string;
  message?: string;
  created_at?: string;
  pageName?: string;
  commentUrl?: string;
  nodeId?: string;
  debugClientMeta?: unknown;
  debugExtractedNodeId?: string;
  debugLookupNodeId?: string;
  debugPageMapHasNode?: boolean;
  debugPageMapSampleKeys?: string[];
  debugFileTreeStatus?: number | string;
  debugFileTreeError?: unknown;
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

const formatCommentDate = (createdAt: string) => {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(createdAt));
};

const formatDebugValue = (value: unknown) => {
  if (value === undefined) {
    return "(not included for this comment)";
  }

  try {
    const serializedValue = JSON.stringify(value);

    if (!serializedValue) {
      return "(empty)";
    }

    return serializedValue.length > 500
      ? `${serializedValue.slice(0, 500)}...`
      : serializedValue;
  } catch {
    return String(value);
  }
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
  pageTitleTerm: string,
  sort: CommentSort
) => {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const normalizedPageTitleTerm = pageTitleTerm.trim().toLowerCase();

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
      if (!normalizedPageTitleTerm) {
        return true;
      }

      return (comment.pageName || "")
        .toLowerCase()
        .includes(normalizedPageTitleTerm);
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

      return [task.title, task.authorName, task.email, task.assignee]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearchTerm);
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

const getIntakeDecisionLabel = (intakeDecision: IntakeDecision) => {
  if (intakeDecision === "accepted-late") {
    return "Accepted Late";
  }

  if (intakeDecision === "deferred-late") {
    return "Deferred Late";
  }

  return "Accepted";
};

const escapeCsvValue = (value: string) => {
  return `"${value.replace(/"/g, '""')}"`;
};

const buildTasksCsv = (tasksToExport: Task[]) => {
  const headers = [
    "Task ID",
    "Title",
    "Original Comment ID",
    "Original Commenter",
    "Email",
    "Comment Date",
    "Page Name",
    "Comment URL",
    "Status",
    "Priority",
    "Assignee",
    "Intake Decision"
  ];

  const rows = tasksToExport.map((task) => [
    task.id,
    task.title,
    task.commentId,
    task.authorName,
    task.email,
    task.createdAt,
    task.pageName || "",
    task.commentUrl || "",
    task.status,
    task.priority,
    task.assignee,
    getIntakeDecisionLabel(task.intakeDecision)
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
};

const createTaskFromComment = (
  comment: CommentItem,
  intakeDecision: IntakeDecision
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
    intakeDecision
  };
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [settings, setSettings] = useState<FeedbackSettings>(defaultSettings);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [figmaComments, setFigmaComments] = useState<CommentItem[]>([]);
  const [currentFileKey, setCurrentFileKey] = useState("");
  const [manualFileKey, setManualFileKey] = useState("");
  const [connectionCode, setConnectionCode] = useState("");
  const [claimedConnectionId, setClaimedConnectionId] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("unknown");
  const [isFetchingFigmaComments, setIsFetchingFigmaComments] = useState(false);
  const [figmaFetchStatus, setFigmaFetchStatus] = useState("");
  const [figmaFetchError, setFigmaFetchError] = useState("");
  const [commentFilter, setCommentFilter] = useState<CommentFilter>("all");
  const [commentSearch, setCommentSearch] = useState("");
  const [commentPageTitleFilter, setCommentPageTitleFilter] = useState("");
  const [commentSort, setCommentSort] = useState<CommentSort>("newest");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskSort, setTaskSort] = useState<TaskSort>("newest");
  const [saveMessage, setSaveMessage] = useState("");
  const [isCommentFiltersOpen, setIsCommentFiltersOpen] = useState(false);
  const [isTaskFiltersOpen, setIsTaskFiltersOpen] = useState(false);

  const loadSettings = () => {
    getSettings().then((savedSettings) => {
      setSettings({
        ...defaultSettings,
        ...savedSettings
      });
    });
  };

  const loadTasks = () => {
    getTasks().then((savedTasks) => {
      setTasks(
        savedTasks.map((task) => ({
          ...task,
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
    intakeDecision: IntakeDecision
  ) => {
    const taskAlreadyExists = tasks.some((task) => task.commentId === comment.id);

    if (taskAlreadyExists) {
      return;
    }

    const updatedTasks = [
      ...tasks,
      createTaskFromComment(comment, intakeDecision)
    ];
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

  const deleteTask = (taskId: string) => {
    const updatedTasks = tasks.filter((task) => task.id !== taskId);

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
        setFigmaFetchStatus("");
        setFigmaFetchError(
          "Not connected to Figma. Click Connect to Figma first, then paste the connection code."
        );
        return;
      }

      if (response.status === 403) {
        setFigmaComments([]);
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

          return {
            id: `figma-${comment.id || index}`,
            authorName:
              author?.name || author?.handle || "Unknown Figma user",
            email: author?.email || "",
            handle: author?.handle,
            message: comment.message || "",
            createdAt: comment.created_at || new Date().toISOString(),
            pageName: comment.pageName || "Unknown page",
            commentUrl: comment.commentUrl,
            nodeId: comment.nodeId,
            debugClientMeta: comment.debugClientMeta,
            debugExtractedNodeId: comment.debugExtractedNodeId,
            debugLookupNodeId: comment.debugLookupNodeId,
            debugPageMapHasNode: comment.debugPageMapHasNode,
            debugPageMapSampleKeys: comment.debugPageMapSampleKeys,
            debugFileTreeStatus: comment.debugFileTreeStatus,
            debugFileTreeError: comment.debugFileTreeError
          };
        }
      );

      setFigmaComments(normalizedComments);
      setFigmaFetchStatus("");
    } catch {
      setFigmaComments([]);
      setFigmaFetchStatus("");
      setFigmaFetchError("The OAuth helper could not be reached.");
    } finally {
      setIsFetchingFigmaComments(false);
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

    const csv = buildTasksCsv(tasks);
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
    commentPageTitleFilter,
    commentSort
  );
  const visibleTasks = filterAndSortTasks(tasks, taskFilter, taskSearch, taskSort);
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
          <h1>Feedback Window</h1>
          <p>Review governance</p>
        </div>

        <nav className="sidebar-nav" aria-label="Feedback Window sections">
          <button
            className={activeTab === "dashboard" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => openTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={activeTab === "setup" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => openTab("setup")}
          >
            Setup
          </button>
          <button
            className={activeTab === "comments" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => openTab("comments")}
          >
            Comments
          </button>
          <button
            className={activeTab === "tasks" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => openTab("tasks")}
          >
            Tasks
          </button>
        </nav>
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

              {figmaFetchStatus && (
                <p className="helper-text">{figmaFetchStatus}</p>
              )}

              {figmaFetchError && (
                <p className="error-message">{figmaFetchError}</p>
              )}
            </div>
          </section>

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
                  <input
                    type="search"
                    value={commentPageTitleFilter}
                    onChange={(event) =>
                      setCommentPageTitleFilter(event.target.value)
                    }
                    placeholder="Filter by page name"
                  />
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
            {visibleComments.length === 0 ? (
              <p className="empty-message">No comments match these controls.</p>
            ) : (
              visibleComments.map((comment) => {
                const taskAlreadyExists = taskCommentIds.includes(comment.id);
                const isClientLate =
                  comment.audience === "Client" && comment.timing === "Late";

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
                        {comment.handle && <p>Handle: {comment.handle}</p>}
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
                        {comment.pageName === "Unknown page" && (
                          <div>
                            <p>
                              Debug client_meta:{" "}
                              {formatDebugValue(comment.debugClientMeta)}
                            </p>
                            <p>
                              Debug extracted nodeId:{" "}
                              {comment.debugExtractedNodeId || "(none)"}
                            </p>
                            <p>
                              Debug lookup nodeId:{" "}
                              {comment.debugLookupNodeId || "(none)"}
                            </p>
                            <p>
                              Debug page map has node:{" "}
                              {comment.debugPageMapHasNode === undefined
                                ? "(not included for this comment)"
                                : String(comment.debugPageMapHasNode)}
                            </p>
                            <p>
                              Debug page map sample keys:{" "}
                              {comment.debugPageMapSampleKeys?.join(", ") ||
                                "(none)"}
                            </p>
                            <p>
                              Debug file tree status:{" "}
                              {comment.debugFileTreeStatus ??
                                "(not included for this comment)"}
                            </p>
                            <p>
                              Debug file tree error:{" "}
                              {formatDebugValue(comment.debugFileTreeError)}
                            </p>
                          </div>
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
                    </div>

                    {isClientLate && (
                      <div className="late-feedback-warning">
                        <strong>Late client feedback</strong>
                        <p>{settings.lateFeedbackMessage}</p>
                      </div>
                    )}

                    {taskAlreadyExists ? (
                      <p className="task-created">Task Created</p>
                    ) : isClientLate ? (
                      <div className="late-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            convertCommentToTask(comment, "accepted-late")
                          }
                        >
                          Accept Anyway
                        </button>
                        <button
                          className="secondary-button defer-button"
                          type="button"
                          onClick={() =>
                            convertCommentToTask(comment, "deferred-late")
                          }
                        >
                          Defer
                        </button>
                      </div>
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => convertCommentToTask(comment, "accepted")}
                      >
                        Convert to Task
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
                    placeholder="Search title, commenter, email, or assignee"
                  />
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
            <p className="empty-message">No tasks created yet.</p>
          ) : (
            <div className="task-list">
              {visibleTasks.length === 0 ? (
                <p className="empty-message">No tasks match these controls.</p>
              ) : (
                visibleTasks.map((task) => (
                  <article className="task-card" key={task.id}>
                    <div className="task-card-header">
                      <h3>{task.title}</h3>
                      <p>{formatCommentDate(task.createdAt)}</p>
                    </div>

                    <p className="task-commenter">
                      Original commenter: {task.authorName} ({task.email})
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
                      <span className={`badge intake-${task.intakeDecision}`}>
                        {getIntakeDecisionLabel(task.intakeDecision)}
                      </span>
                    </div>

                    <div className="task-fields">
                      <label className="field">
                        <span>Status</span>
                        <select
                          value={task.status}
                          onChange={(event) =>
                            updateTask(task.id, {
                              status: event.target.value as Task["status"]
                            })
                          }
                        >
                          <option value="new">new</option>
                          <option value="in-progress">in-progress</option>
                          <option value="done">done</option>
                          <option value="deferred">deferred</option>
                        </select>
                      </label>

                      <label className="field">
                        <span>Priority</span>
                        <select
                          value={task.priority}
                          onChange={(event) =>
                            updateTask(task.id, {
                              priority: event.target.value as Task["priority"]
                            })
                          }
                        >
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </label>

                      <label className="field">
                        <span>Assignee</span>
                        <input
                          type="text"
                          value={task.assignee}
                          onChange={(event) =>
                            updateTask(task.id, {
                              assignee: event.target.value
                            })
                          }
                          placeholder="Name or email"
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
                ))
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
