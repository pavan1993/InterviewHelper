(() => {
  const STORAGE_KEY = "adaptive-interview-session";
  const appEl = document.getElementById("app");
  const introPanel = document.getElementById("intro-panel");
  const questionPanel = document.getElementById("question-panel");
  const summaryPanel = document.getElementById("summary-panel");
  const startButton = document.getElementById("start-interview");
  const resumeButton = document.getElementById("resume-interview");
  const backButton = document.getElementById("back-track");
  const saveButton = document.getElementById("save-response");
  const resetButton = document.getElementById("reset-session");
  const downloadButton = document.getElementById("download-summary");
  const questionTitle = document.getElementById("question-title");
  const questionCategory = document.getElementById("question-category");
  const notesInput = document.getElementById("notes-input");
  const rubricList = document.getElementById("rubric-content");
  const summaryList = document.getElementById("summary-list");
  const ratingButtons = Array.from(document.querySelectorAll(".rating"));

  const panels = [introPanel, questionPanel, summaryPanel];

  const state = {
    meta: null,
    questions: new Map(),
    currentId: null,
    history: [],
    responses: [],
    selectedRating: null,
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

  function buildRubric(rubric) {
    rubricList.innerHTML = "";
    Object.entries(rubric).forEach(([level, description]) => {
      const dt = document.createElement("dt");
      dt.textContent = capitalize(level);
      const dd = document.createElement("dd");
      dd.textContent = description;
      rubricList.append(dt, dd);
    });
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function getQuestion(id) {
    return state.questions.get(id) || null;
  }

  function setRating(rating) {
    state.selectedRating = rating;
    ratingButtons.forEach((btn) => {
      const isActive = btn.dataset.rating === rating;
      btn.dataset.active = String(isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  function resetRating() {
    state.selectedRating = null;
    ratingButtons.forEach((btn) => {
      btn.dataset.active = "false";
      btn.setAttribute("aria-pressed", "false");
    });
  }

  function renderQuestion(question) {
    if (!question) {
      renderSummary();
      return;
    }

    recordHistoryVisit(question.id);

    questionTitle.textContent = question.prompt;
    questionCategory.textContent = `${question.category} • ${capitalize(question.difficulty)}`;
    buildRubric(question.rubric);

    const existingResponse = state.responses.find((entry) => entry.id === question.id);
    if (existingResponse) {
      setRating(existingResponse.rating);
      notesInput.value = existingResponse.notes || "";
    } else {
      resetRating();
      notesInput.value = "";
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
      state.selectedRating = null;
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
    state.responses = stored.responses || [];
    state.currentId = stored.currentId;
    renderQuestion(getQuestion(state.currentId));
  }

  function handleSave() {
    if (!state.selectedRating) {
      announce("Select a rating before continuing.");
      return;
    }

    const question = getQuestion(state.currentId);
    if (!question) {
      renderSummary();
      return;
    }

    const nextId = resolveNextQuestion(question, state.selectedRating);
    const notes = notesInput.value.trim();
    const existingIndex = state.responses.findIndex((entry) => entry.id === question.id);
    const payload = {
      id: question.id,
      rating: state.selectedRating,
      notes,
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

    resetRating();
    notesInput.value = "";
    renderQuestion(nextQuestion);
    persistState();
  }

  function resolveNextQuestion(question, rating) {
    const map = question.followUps || {};
    return map[rating] ?? map.default ?? null;
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
        fragment.querySelector(".summary-rating").textContent = `Outcome: ${capitalize(entry.rating)}`;
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
          `${index + 1}. ${entry.prompt} (${entry.category}, ${capitalize(entry.difficulty)})`,
          `   Rating: ${capitalize(entry.rating)}`,
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
    state.selectedRating = null;
    notesInput.value = "";
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
    startButton.addEventListener("click", () => startInterview({ reset: true }));
    resumeButton.addEventListener("click", resumeInterview);
    saveButton.addEventListener("click", handleSave);
    backButton.addEventListener("click", goBack);
    resetButton.addEventListener("click", resetInterview);
    downloadButton.addEventListener("click", downloadSummary);

    ratingButtons.forEach((btn) => {
      btn.addEventListener("click", () => setRating(btn.dataset.rating));
    });

    document.addEventListener("keydown", (event) => {
      if (questionPanel.hidden) return;
      if (["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        const rating = keyToRating(event.key);
        if (rating) {
          setRating(rating);
          announce(`${capitalize(rating)} selected`);
        }
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleSave();
      }
    });
  }

  function keyToRating(key) {
    switch (key) {
      case "3":
        return "strong";
      case "2":
        return "competent";
      case "1":
        return "developing";
      default:
        return null;
    }
  }

  async function bootstrap() {
    registerEvents();
    updateResumeButton();

    try {
      const response = await fetch("questions.json", { cache: "no-store" });
      const data = await response.json();
      state.meta = data.meta || {};
      data.questions.forEach((question) => {
        state.questions.set(question.id, question);
      });

      const persisted = loadPersistedState();
      if (persisted) {
        state.meta = persisted.meta || state.meta;
        state.currentId = persisted.currentId || state.meta.startQuestion;
        state.history = persisted.history || [];
        state.responses = persisted.responses || [];
      }

      updateResumeButton();
    } catch (error) {
      console.error("Failed to load questions", error);
      announce("Unable to load questions. Check your connection or file path.");
    }
  }

  bootstrap();
})();
