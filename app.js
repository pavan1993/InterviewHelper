(() => {
  const STORAGE_KEY = "adaptive-interview-session";
  const appEl = document.getElementById("app");
  const introPanel = document.getElementById("intro-panel");
  const questionPanel = document.getElementById("question-panel");
  const summaryPanel = document.getElementById("summary-panel");
  const startButton = document.getElementById("start-interview");
  const resumeButton = document.getElementById("resume-interview");
  const resumeHint = document.getElementById("resume-hint");
  const backButton = document.getElementById("back-track");
  const nextButton = document.getElementById("next-question");
  const restartButton = document.getElementById("restart-session");
  const exportJsonButton = document.getElementById("export-json");
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsMenu = document.getElementById("settings-menu");
  const clearSavedSessionButton = document.getElementById("clear-saved-session");
  const topicSelect = document.getElementById("topic-select");
  const topicError = document.getElementById("topic-error");
  const questionTitle = document.getElementById("question-title");
  const questionCategory = document.getElementById("question-category");
  const notesInput = document.getElementById("notes-input");
  const expectedList = document.getElementById("expected-responses");
  const summaryList = document.getElementById("summary-list");
  const summaryTotal = document.getElementById("summary-total");
  const summaryAverage = document.getElementById("summary-average");
  const summaryConsistency = document.getElementById("summary-consistency");
  const summaryTopicList = document.getElementById("summary-topic-averages");
  const summaryJson = document.getElementById("summary-json");
  const gradeButtons = Array.from(document.querySelectorAll(".grade-option"));
  const ALL_TOPICS_VALUE = "__all__";
  const CONSISTENCY_WINDOW = 5;

  const panels = [introPanel, questionPanel, summaryPanel];

  const state = {
    meta: null,
    questions: new Map(),
    topics: [],
    currentId: null,
    history: [],
    responses: [],
    selectedGrade: null,
    selectedTopics: [],
    selectAllTopics: true,
    lastSavedAt: null,
  };

  const safeLocalStorage = (() => {
    try {
      const testKey = "__storage_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    } catch (error) {
      console.warn("localStorage unavailable", error);
      return null;
    }
  })();

  function showPanel(panel) {
    panels.forEach((p) => {
      if (p === panel) {
        p.hidden = false;
        p.classList.add("active");
        p.setAttribute("tabindex", "-1");
        requestAnimationFrame(() => p.focus());
      } else {
        p.hidden = true;
        p.classList.remove("active");
        p.removeAttribute("tabindex");
      }
    });
  }

  function buildExpectedResponses(descriptors = {}) {
    if (!expectedList) return;
    expectedList.innerHTML = "";
    const entries = Object.entries(descriptors)
      .map(([grade, description]) => ({ grade: Number(grade), description }))
      .filter((entry) => !Number.isNaN(entry.grade))
      .sort((a, b) => b.grade - a.grade);

    if (!entries.length) {
      const empty = document.createElement("li");
      empty.textContent = "No descriptors available for this question.";
      expectedList.appendChild(empty);
      return;
    }

    entries.forEach(({ grade, description }) => {
      const li = document.createElement("li");
      const badge = document.createElement("span");
      badge.className = "grade-chip";
      badge.textContent = String(grade);
      const text = document.createElement("p");
      text.textContent = description;
      li.append(badge, text);
      expectedList.appendChild(li);
    });
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function getQuestion(id) {
    return state.questions.get(id) || null;
  }

  function setGrade(grade) {
    state.selectedGrade = grade;
    gradeButtons.forEach((btn) => {
      const isActive = btn.dataset.grade === grade;
      btn.dataset.active = String(isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  function resetGrade() {
    state.selectedGrade = null;
    gradeButtons.forEach((btn) => {
      btn.dataset.active = "false";
      btn.setAttribute("aria-pressed", "false");
    });
  }

  function extractGradeValue(response) {
    if (!response || typeof response !== "object") return null;

    if (response.grade !== undefined && response.grade !== null) {
      const numeric = Number(response.grade);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }

    if (response.rating) {
      const map = {
        strong: 4,
        competent: 3,
        developing: 2,
      };
      const lookup = map[String(response.rating).toLowerCase()];
      if (lookup !== undefined) {
        return lookup;
      }
    }

    return null;
  }

  function upgradeLegacyResponses(responses = []) {
    if (!Array.isArray(responses)) return [];
    return responses
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const { rating, ...rest } = entry;
        const grade = extractGradeValue(entry);
        return {
          ...rest,
          topic: rest.topic ?? rest.category ?? null,
          grade: grade !== null ? grade : null,
        };
      });
  }

  function extractTopics(questions = []) {
    const topics = new Set();
    questions.forEach((question) => {
      if (question?.category) {
        topics.add(question.category);
      }
    });
    return Array.from(topics).sort((a, b) => a.localeCompare(b));
  }

  function createTopicOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function syncTopicSelect(selection = { topics: state.selectedTopics, selectAll: state.selectAllTopics }) {
    if (!topicSelect) return;
    const { topics, selectAll } = selection;

    Array.from(topicSelect.options).forEach((option) => {
      if (option.value === ALL_TOPICS_VALUE) {
        option.selected = selectAll;
        return;
      }
      option.selected = selectAll ? false : topics.includes(option.value);
    });

    if (selectAll && topicSelect.options.length) {
      topicSelect.selectedIndex = 0;
    }
  }

  function populateTopicSelect(topics, selection = { topics, selectAll: true }) {
    if (!topicSelect) return;
    topicSelect.innerHTML = "";

    const fragment = document.createDocumentFragment();
    fragment.appendChild(createTopicOption(ALL_TOPICS_VALUE, "All Topics"));
    topics.forEach((topic) => {
      fragment.appendChild(createTopicOption(topic, topic));
    });

    topicSelect.appendChild(fragment);
    syncTopicSelect(selection);
  }

  function readSelectedTopics() {
    if (!topicSelect) {
      return { topics: [], selectAll: false };
    }

    const selectedOptions = Array.from(topicSelect.selectedOptions);
    if (!selectedOptions.length) {
      return { topics: [], selectAll: false };
    }

    const selectAll = selectedOptions.some((option) => option.value === ALL_TOPICS_VALUE);
    if (selectAll) {
      return { topics: [...state.topics], selectAll: true };
    }

    return {
      topics: selectedOptions.map((option) => option.value),
      selectAll: false,
    };
  }

  function showTopicError(message) {
    if (topicError) {
      topicError.textContent = message;
      topicError.hidden = false;
    }
    if (topicSelect) {
      topicSelect.setAttribute("aria-invalid", "true");
    }
    announce(message);
  }

  function clearTopicError() {
    if (topicError) {
      topicError.textContent = "";
      topicError.hidden = true;
    }
    if (topicSelect) {
      topicSelect.removeAttribute("aria-invalid");
    }
  }

  function handleStartButtonClick() {
    const selection = readSelectedTopics();
    if (!selection.topics.length) {
      showTopicError("Select at least one topic or choose All Topics to begin.");
      if (topicSelect) {
        topicSelect.focus();
      }
      return;
    }

    clearTopicError();
    state.selectedTopics = selection.topics;
    state.selectAllTopics = selection.selectAll;
    syncTopicSelect(selection);
    startInterview({ reset: true });
  }

  function renderQuestion(question) {
    if (!question) {
      renderSummary();
      return;
    }

    recordHistoryVisit(question.id);

    questionTitle.textContent = question.prompt;
    questionCategory.textContent = `${question.category} • ${capitalize(question.difficulty)}`;
    buildExpectedResponses(question.scoreDescriptors || {});

    const existingResponse = state.responses.find((entry) => entry.id === question.id);
    if (existingResponse) {
      const grade = extractGradeValue(existingResponse);
      if (grade !== null) {
        setGrade(String(grade));
      } else {
        resetGrade();
      }
      if (notesInput) {
        notesInput.value = existingResponse.notes || "";
      }
    } else {
      resetGrade();
      if (notesInput) {
        notesInput.value = "";
      }
    }

    showPanel(questionPanel);
  }

  function recordHistoryVisit(id) {
    if (!id) return;
    const lastId = state.history[state.history.length - 1];
    if (lastId === id) return;
    state.history.push(id);
  }

  function persistState() {
    if (!safeLocalStorage) {
      updateResumeAvailability(null);
      return null;
    }
    const payload = {
      meta: state.meta,
      currentId: state.currentId,
      history: state.history,
      responses: state.responses,
      selectedTopics: state.selectedTopics,
      selectAllTopics: state.selectAllTopics,
      lastSavedAt: new Date().toISOString(),
    };
    state.lastSavedAt = payload.lastSavedAt;
    safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    updateResumeAvailability(payload);
    return payload;
  }

  function loadPersistedState() {
    if (!safeLocalStorage) return null;
    const raw = safeLocalStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("Failed to parse persisted state", error);
      return null;
    }
  }

  function clearPersistedState() {
    if (!safeLocalStorage) {
      state.lastSavedAt = null;
      updateResumeAvailability(null);
      return;
    }
    safeLocalStorage.removeItem(STORAGE_KEY);
    state.lastSavedAt = null;
    updateResumeAvailability(null);
  }

  function startInterview({ reset = false } = {}) {
    if (!state.questions.size) {
      announce("Questions are still loading. Try again in a moment.");
      return;
    }
    if (reset) {
      state.history = [];
      state.responses = [];
      state.selectedGrade = null;
      state.currentId = state.meta?.startQuestion ?? null;
      clearPersistedState();
    }

    if (!state.currentId) {
      state.currentId = state.meta?.startQuestion ?? null;
    }
    const question = getQuestion(state.currentId);
    renderQuestion(question);
  }

  function resumeInterview() {
    if (!state.questions.size) {
      announce("Questions are still loading. Try again in a moment.");
      return;
    }
    setSettingsMenuOpen(false);
    const stored = loadPersistedState();
    if (!stored) return;
    state.meta = stored.meta;
    state.history = stored.history || [];
    state.responses = upgradeLegacyResponses(stored.responses);
    state.currentId = stored.currentId;
    state.selectedTopics = Array.isArray(stored.selectedTopics) ? stored.selectedTopics : [...state.topics];
    state.selectAllTopics = typeof stored.selectAllTopics === "boolean" ? stored.selectAllTopics : true;
    state.lastSavedAt = stored.lastSavedAt || null;
    syncTopicSelect({ topics: state.selectedTopics, selectAll: state.selectAllTopics });
    clearTopicError();
    updateResumeAvailability(stored);
    renderQuestion(getQuestion(state.currentId));
  }

  function handleNext() {
    if (state.selectedGrade === null) {
      announce("Select a grade before continuing.");
      return;
    }

    const question = getQuestion(state.currentId);
    if (!question) {
      renderSummary();
      return;
    }

    const nextId = resolveNextQuestion(question, state.selectedGrade);
    const notes = notesInput ? notesInput.value.trim() : "";
    const existingIndex = state.responses.findIndex((entry) => entry.id === question.id);
    const payload = {
      id: question.id,
      grade: Number(state.selectedGrade),
      notes,
      topic: question.category,
      category: question.category,
      prompt: question.prompt,
      difficulty: question.difficulty,
      timestamp: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      state.responses.splice(existingIndex, 1, payload);
    } else {
      state.responses.push(payload);
    }

    state.currentId = nextId;

    if (!nextId) {
      persistState();
      renderSummary();
      return;
    }

    const nextQuestion = getQuestion(nextId);
    if (!nextQuestion) {
      console.warn(`Question with id "${nextId}" missing. Ending interview.`);
      state.currentId = null;
      persistState();
      renderSummary();
      return;
    }

    resetGrade();
    if (notesInput) {
      notesInput.value = "";
    }
    renderQuestion(nextQuestion);
    persistState();
  }

  function resolveNextQuestion(question, grade) {
    const map = question.followUps || {};
    const key = String(grade);
    return map[key] ?? map.default ?? null;
  }

  function goBack() {
    if (state.history.length === 0) {
      showPanel(introPanel);
      return;
    }
    state.history.pop();
    const previousId = state.history[state.history.length - 1];
    state.currentId = previousId ?? state.meta?.startQuestion ?? null;
    persistState();
    const question = getQuestion(state.currentId);
    if (question) {
      renderQuestion(question);
    } else {
      showPanel(introPanel);
    }
  }

  let lastSessionSnapshot = null;

  function calculateSummaryMetrics(responses = []) {
    const gradedResponses = responses
      .map((entry) => ({ ...entry, grade: extractGradeValue(entry) }))
      .filter((entry) => entry.grade !== null && !Number.isNaN(entry.grade));

    const totalQuestions = gradedResponses.length;
    const averageScore = totalQuestions
      ? gradedResponses.reduce((sum, entry) => sum + entry.grade, 0) / totalQuestions
      : null;

    const topicMap = new Map();
    gradedResponses.forEach((entry) => {
      const topic = entry.topic || entry.category || "Uncategorized";
      const record = topicMap.get(topic) || { total: 0, count: 0 };
      record.total += entry.grade;
      record.count += 1;
      topicMap.set(topic, record);
    });

    const topicAverages = Array.from(topicMap.entries())
      .map(([topic, { total, count }]) => ({
        topic,
        average: count ? total / count : null,
      }))
      .sort((a, b) => a.topic.localeCompare(b.topic));

    const consistencyGrades = gradedResponses
      .slice(-CONSISTENCY_WINDOW)
      .map((entry) => entry.grade)
      .filter((grade) => grade !== null && !Number.isNaN(grade));

    let consistency = {
      value: null,
      label: "Not enough data",
      count: consistencyGrades.length,
    };

    if (consistencyGrades.length >= 2) {
      const mean = consistencyGrades.reduce((sum, grade) => sum + grade, 0) / consistencyGrades.length;
      const variance =
        consistencyGrades.reduce((sum, grade) => sum + (grade - mean) ** 2, 0) / consistencyGrades.length;
      const stdDev = Math.sqrt(variance);
      consistency = {
        value: stdDev,
        label: interpretConsistency(stdDev),
        count: consistencyGrades.length,
      };
    }

    return {
      totalQuestions,
      averageScore,
      topicAverages,
      consistency,
    };
  }

  function interpretConsistency(stdDev) {
    if (stdDev === null || Number.isNaN(stdDev)) {
      return "Not enough data";
    }
    if (stdDev < 0.4) {
      return "Highly consistent";
    }
    if (stdDev < 0.8) {
      return "Moderately consistent";
    }
    return "Variable scoring";
  }

  function formatScore(value) {
    if (value === null || Number.isNaN(value)) {
      return "—";
    }
    return value.toFixed(2);
  }

  function buildSessionSnapshot(metrics) {
    return {
      generatedAt: new Date().toISOString(),
      meta: state.meta,
      history: state.history,
      selectedTopics: state.selectedTopics,
      selectAllTopics: state.selectAllTopics,
      metrics: {
        totalQuestions: metrics.totalQuestions,
        averageScore: metrics.averageScore,
        consistency: {
          value: metrics.consistency.value,
          label: metrics.consistency.label,
          sampleSize: metrics.consistency.count,
          window: CONSISTENCY_WINDOW,
        },
        topicAverages: metrics.topicAverages,
      },
      responses: state.responses,
    };
  }

  function renderSummary() {
    summaryList.innerHTML = "";
    const template = document.getElementById("summary-item-template");

    if (!state.responses.length) {
      const empty = document.createElement("li");
      empty.textContent = "No responses recorded yet.";
      summaryList.appendChild(empty);
    } else {
      state.responses.forEach((entry) => {
        const fragment = template.content.cloneNode(true);
        fragment.querySelector("h3").textContent = entry.prompt;
        const gradeLabel = entry.grade !== null && entry.grade !== undefined && !Number.isNaN(entry.grade)
          ? entry.grade
          : "—";
        fragment.querySelector(".summary-rating").textContent = `Grade: ${gradeLabel}`;
        fragment.querySelector(".summary-notes").textContent = entry.notes || "No notes captured.";
        summaryList.appendChild(fragment);
      });
    }

    const metrics = calculateSummaryMetrics(state.responses);

    if (summaryTotal) {
      summaryTotal.textContent = String(metrics.totalQuestions);
    }

    if (summaryAverage) {
      summaryAverage.textContent = formatScore(metrics.averageScore);
    }

    if (summaryConsistency) {
      const valueText = formatScore(metrics.consistency.value);
      if (metrics.consistency.value === null || metrics.consistency.count < 2) {
        summaryConsistency.textContent = metrics.consistency.label;
      } else {
        summaryConsistency.textContent = `${valueText} • ${metrics.consistency.label}`;
      }
    }

    if (summaryTopicList) {
      summaryTopicList.innerHTML = "";
      if (!metrics.topicAverages.length) {
        const emptyTopic = document.createElement("li");
        emptyTopic.textContent = "No graded topics yet.";
        summaryTopicList.appendChild(emptyTopic);
      } else {
        metrics.topicAverages.forEach((item) => {
          const li = document.createElement("li");
          const topicLabel = document.createElement("span");
          topicLabel.className = "summary-topic-label";
          topicLabel.textContent = item.topic;
          const topicScore = document.createElement("span");
          topicScore.className = "summary-topic-score";
          topicScore.textContent = formatScore(item.average);
          li.append(topicLabel, topicScore);
          summaryTopicList.appendChild(li);
        });
      }
    }

    const snapshot = buildSessionSnapshot(metrics);
    lastSessionSnapshot = snapshot;
    if (summaryJson) {
      summaryJson.value = JSON.stringify(snapshot, null, 2);
      summaryJson.scrollTop = 0;
    }

    persistState();
    showPanel(summaryPanel);
  }

  function exportSessionJson() {
    if (!lastSessionSnapshot) {
      const metrics = calculateSummaryMetrics(state.responses);
      lastSessionSnapshot = buildSessionSnapshot(metrics);
    }
    const blob = new Blob([JSON.stringify(lastSessionSnapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `adaptive-interview-session-${new Date().toISOString()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function resetInterview() {
    state.currentId = state.meta?.startQuestion ?? null;
    state.history = [];
    state.responses = [];
    state.selectedGrade = null;
    state.selectedTopics = [...state.topics];
    state.selectAllTopics = true;
    state.lastSavedAt = null;
    lastSessionSnapshot = null;
    if (notesInput) {
      notesInput.value = "";
    }
    syncTopicSelect();
    clearTopicError();
    clearPersistedState();
    showPanel(introPanel);
  }

  function announce(message) {
    let liveRegion = document.getElementById("live-region");
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.id = "live-region";
      liveRegion.className = "sr-only";
      liveRegion.setAttribute("aria-live", "assertive");
      appEl.appendChild(liveRegion);
    }
    liveRegion.textContent = message;
  }

  function hasStoredProgress(snapshot) {
    if (!snapshot) return false;
    const hasResponses = Array.isArray(snapshot.responses) && snapshot.responses.length > 0;
    return hasResponses || Boolean(snapshot.currentId);
  }

  function formatSavedTimestamp(timestamp) {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch (error) {
      console.warn("Unable to format saved timestamp", error);
      return null;
    }
  }

  function updateResumeAvailability(snapshot = loadPersistedState()) {
    const hasSession = hasStoredProgress(snapshot);
    if (resumeButton) {
      resumeButton.hidden = !hasSession;
    }
    if (resumeHint) {
      if (hasSession) {
        const formatted = formatSavedTimestamp(snapshot?.lastSavedAt);
        const suffix = formatted
          ? ` Resume where you left off (last saved ${formatted}) or start a new session.`
          : " Resume where you left off or start a new session.";
        resumeHint.hidden = false;
        resumeHint.textContent = "";
        const strong = document.createElement("strong");
        strong.textContent = "Saved progress found.";
        resumeHint.append(strong, document.createTextNode(suffix));
      } else {
        resumeHint.hidden = true;
        resumeHint.textContent = "";
      }
    }
    return hasSession;
  }

  const handleSettingsDocumentClick = (event) => {
    if (!settingsMenu || settingsMenu.hidden) return;
    if (settingsMenu.contains(event.target) || (settingsToggle && settingsToggle.contains(event.target))) {
      return;
    }
    setSettingsMenuOpen(false);
  };

  const handleSettingsKeydown = (event) => {
    if (event.key === "Escape") {
      setSettingsMenuOpen(false);
      if (settingsToggle) {
        settingsToggle.focus();
      }
    }
  };

  function setSettingsMenuOpen(open) {
    if (!settingsMenu || !settingsToggle) return;
    const shouldOpen = Boolean(open);
    settingsMenu.hidden = !shouldOpen;
    settingsToggle.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      document.addEventListener("click", handleSettingsDocumentClick);
      document.addEventListener("keydown", handleSettingsKeydown);
    } else {
      document.removeEventListener("click", handleSettingsDocumentClick);
      document.removeEventListener("keydown", handleSettingsKeydown);
    }
  }

  function registerEvents() {
    startButton.addEventListener("click", handleStartButtonClick);
    if (resumeButton) {
      resumeButton.addEventListener("click", resumeInterview);
    }
    if (nextButton) {
      nextButton.addEventListener("click", handleNext);
    }
    backButton.addEventListener("click", goBack);
    if (restartButton) {
      restartButton.addEventListener("click", resetInterview);
    }
    if (exportJsonButton) {
      exportJsonButton.addEventListener("click", exportSessionJson);
    }

    if (settingsToggle && settingsMenu) {
      settingsToggle.addEventListener("click", () => {
        const shouldOpen = settingsMenu.hidden;
        setSettingsMenuOpen(shouldOpen);
      });
    }

    if (clearSavedSessionButton) {
      clearSavedSessionButton.addEventListener("click", () => {
        clearPersistedState();
        announce("Saved session cleared.");
        setSettingsMenuOpen(false);
      });
    }

    if (topicSelect) {
      topicSelect.addEventListener("change", () => {
        const selection = readSelectedTopics();
        state.selectedTopics = selection.topics;
        state.selectAllTopics = selection.selectAll;
        if (selection.topics.length) {
          clearTopicError();
        }
        syncTopicSelect(selection);
      });
    }

    gradeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        setGrade(btn.dataset.grade);
        announce(`Grade ${btn.dataset.grade} selected`);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (questionPanel.hidden) return;
      const target = event.target;
      const isTypingContext = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (!isTypingContext && ["0", "1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        setGrade(event.key);
        announce(`Grade ${event.key} selected`);
      }
      if (event.key === "Enter" && !event.shiftKey && !isTypingContext) {
        event.preventDefault();
        handleNext();
      }
    });
  }

  async function bootstrap() {
    registerEvents();
    updateResumeAvailability();

    try {
      const response = await fetch("questions.json", { cache: "no-store" });
      const data = await response.json();
      const questions = Array.isArray(data.questions) ? data.questions : [];
      state.meta = data.meta || {};
      questions.forEach((question) => {
        state.questions.set(question.id, question);
      });
      state.topics = extractTopics(questions);

      const persisted = loadPersistedState();
      if (persisted) {
        state.meta = persisted.meta || state.meta;
        state.currentId = persisted.currentId || state.meta.startQuestion;
        state.history = persisted.history || [];
        state.responses = upgradeLegacyResponses(persisted.responses);
        state.selectedTopics = Array.isArray(persisted.selectedTopics)
          ? [...persisted.selectedTopics]
          : [...state.topics];
        state.selectAllTopics = typeof persisted.selectAllTopics === "boolean" ? persisted.selectAllTopics : true;
        state.lastSavedAt = persisted.lastSavedAt || null;
      } else {
        state.selectedTopics = [...state.topics];
        state.selectAllTopics = true;
        state.lastSavedAt = null;
      }

      populateTopicSelect(state.topics, {
        topics: state.selectedTopics,
        selectAll: state.selectAllTopics,
      });

      updateResumeAvailability(persisted);
    } catch (error) {
      console.error("Failed to load questions", error);
      announce("Unable to load questions. Check your connection or file path.");
    }
  }

  bootstrap();
})();
