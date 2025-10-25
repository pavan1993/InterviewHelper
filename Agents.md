## 🧠 Agents.md

### 🎯 Purpose
This file defines the collaborating AI agents for building the Adaptive Interview App.

---

### 👷 Agent Roles

**Architect Agent**
- Designs overall workflow, data schema, and adaptive logic.
- Ensures scalability and vendor-neutral question structure.
- Defines JSON schema and scoring model.

**Frontend Agent**
- Builds HTML/CSS/JS interface.
- Ensures accessibility, keyboard shortcuts, and localStorage persistence.
- Integrates JSON loading, grading, and adaptive navigation.

**Evaluator Agent**
- Validates logic for fairness, scoring, and consistency.
- Tests rubric clarity and grading flow.
- Simulates demo sessions for QA.

**Deployment Agent**
- Prepares README and deployment steps.
- Configures GitHub Pages / Netlify hosting and SharePoint embed code.
- Verifies static-site compatibility.

---

### 🪄 Collaboration Workflow
1. Architect Agent defines schema and logic.
2. Frontend Agent scaffolds UI and flow.
3. Evaluator Agent validates and simulates interview runs.
4. Deployment Agent finalizes hosting & documentation.

Each agent commits modular, readable code with comments.

---

### ✅ Output Goals
- A working, framework-free static web app: `adaptive-interview-app`
- Compatible with GitHub Pages, Netlify, and SharePoint iframe embeds.
- Clear rubric-based grading UX.
- Readable, minimal codebase ready for Codex iterations.
