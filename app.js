(() => {
  const STORAGE_KEY = "adaptive-interview-session";
  const appEl = document.getElementById("app");
  const introPanel = document.getElementById("intro-panel");
  const questionPanel = document.getElementById("question-panel");
  const summaryPanel = document.getElementById("summary-panel");
  const startButton = document.getElementById("start-interview");
  const resumeButton = document.getElementById("resume-interview");
  const backButton = document.getElementById("back-track");
  const nextButton = document.getElementById("next-question");
  const resetButton = document.getElementById("reset-session");
  const downloadButton = document.getElementById("download-summary");
  const topicSelect = document.getElementById("topic-select");
  const topicError = document.getElementById("topic-error");
  const questionTitle = document.getElementById("question-title");
  const questionCategory = document.getElementById("question-category");
  const notesInput = document.getElementById("notes-input");
  const expectedList = document.getElementById("expected-responses");
  const summaryList = document.getElementById("summary-list");
  const gradeButtons = Array.from(document.querySelectorAll(".grade-option"));
  const ALL_TOPICS_VALUE = "__all__";

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
    if (!safeLocalStorage) return;
    const payload = {
      meta: state.meta,
      currentId: state.currentId,
      history: state.history,
      responses: state.responses,
      selectedTopics: state.selectedTopics,
      selectAllTopics: state.selectAllTopics,
    };
    safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
    if (!safeLocalStorage) return;
    safeLocalStorage.removeItem(STORAGE_KEY);
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
    const stored = loadPersistedState();
    if (!stored) return;
    state.meta = stored.meta;
    state.history = stored.history || [];
    state.responses = upgradeLegacyResponses(stored.responses);
    state.currentId = stored.currentId;
    state.selectedTopics = Array.isArray(stored.selectedTopics) ? stored.selectedTopics : [...state.topics];
    state.selectAllTopics = typeof stored.selectAllTopics === "boolean" ? stored.selectAllTopics : true;
    syncTopicSelect({ topics: state.selectedTopics, selectAll: state.selectAllTopics });
    clearTopicError();
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

    persistState();
    showPanel(summaryPanel);
  }

  function downloadSummary() {
    if (!state.responses.length) return;
    const lines = [
      `Adaptive Interview Summary - ${new Date().toLocaleString()}`,
      "",
      ...state.responses.map((entry, index) => {
        return [
          `${index + 1}. ${entry.prompt} (${entry.topic ?? entry.category}, ${capitalize(entry.difficulty)})`,
          `   Grade: ${entry.grade !== null && entry.grade !== undefined && !Number.isNaN(entry.grade) ? entry.grade : "—"}`,
          `   Notes: ${entry.notes || "(none)"}`,
          "",
        ].join("\n");
      }),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "adaptive-interview-summary.txt";
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
    if (notesInput) {
      notesInput.value = "";
    }
    syncTopicSelect();
    clearTopicError();
    clearPersistedState();
    showPanel(introPanel);
    updateResumeButton();
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

  function updateResumeButton() {
    const hasSession = Boolean(loadPersistedState());
    resumeButton.hidden = !hasSession;
  }

  function registerEvents() {
    startButton.addEventListener("click", handleStartButtonClick);
    resumeButton.addEventListener("click", resumeInterview);
    if (nextButton) {
      nextButton.addEventListener("click", handleNext);
    }
    backButton.addEventListener("click", goBack);
    resetButton.addEventListener("click", resetInterview);
    downloadButton.addEventListener("click", downloadSummary);

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
    updateResumeButton();

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
      } else {
        state.selectedTopics = [...state.topics];
        state.selectAllTopics = true;
      }

      populateTopicSelect(state.topics, {
        topics: state.selectedTopics,
        selectAll: state.selectAllTopics,
      });

      updateResumeButton();
    } catch (error) {
      console.error("Failed to load questions", error);
      announce("Unable to load questions. Check your connection or file path.");
    }
  }

  bootstrap();
})();
