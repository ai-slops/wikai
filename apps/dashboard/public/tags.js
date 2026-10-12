import { ApiError, api } from "/api.js";

function element(id) {
  return document.querySelector(`#${id}`);
}

function appendTagNodes(container, nodes, onSelect) {
  const list = document.createElement("ul");
  for (const node of nodes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const count = document.createElement("span");
    button.type = "button";
    button.className = "tag-path";
    button.textContent = node.path;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => onSelect(node.path));
    count.textContent = String(node.descendantCount);
    count.className = "tag-count";
    item.append(button, count);
    if (node.children.length > 0) appendTagNodes(item, node.children, onSelect);
    list.append(item);
  }
  container.append(list);
}

export function initializeTagManager(options) {
  const dialog = element("tags-dialog");
  const tree = element("tag-tree");
  const filterState = element("tag-filter-state");
  const renameState = element("tag-rename-state");
  const review = element("tag-rename-review");
  const changes = element("tag-rename-changes");
  const planHash = element("tag-rename-hash");
  const confirm = element("tag-rename-confirm");
  const apply = element("tag-rename-apply");
  let reviewedPlan = null;
  let activeFilterPath = null;

  function renderActiveFilter() {
    for (const button of tree.querySelectorAll(".tag-path")) {
      button.setAttribute("aria-pressed", String(button.textContent === activeFilterPath));
    }
  }

  async function applyFilter(path) {
    filterState.dataset.state = "loading";
    filterState.textContent = `Filtering by ${path}…`;
    try {
      const mode = element("tag-filter-mode").value;
      const documents = await api.filterByTags([path], mode);
      activeFilterPath = path;
      renderActiveFilter();
      options.onFilter(documents);
      filterState.dataset.state = "complete";
      filterState.textContent = `${documents.length} publications match ${path} (${mode}).`;
    } catch (error) {
      filterState.dataset.state = "error";
      filterState.textContent = error.message;
      options.notify(error.message, true);
    }
  }

  async function loadTree() {
    tree.replaceChildren();
    filterState.dataset.state = "loading";
    filterState.textContent = "Loading the current tag hierarchy…";
    try {
      const nodes = await api.tagTree();
      appendTagNodes(tree, nodes, applyFilter);
      renderActiveFilter();
      filterState.dataset.state = "complete";
      filterState.textContent =
        nodes.length === 0 ? "No public tags exist." : "Choose a path to filter the queue.";
    } catch (error) {
      filterState.dataset.state = "error";
      filterState.textContent = error.message;
      options.notify(error.message, true);
    }
  }

  function invalidatePlan(message) {
    reviewedPlan = null;
    review.hidden = true;
    confirm.checked = false;
    apply.disabled = true;
    renameState.textContent = message;
    renameState.dataset.state = "idle";
  }

  async function planRename() {
    const input = {
      from: element("tag-rename-from").value.trim(),
      to: element("tag-rename-to").value.trim(),
      mode: element("tag-rename-mode").value,
    };
    renameState.dataset.state = "loading";
    renameState.textContent = "Computing the affected publications…";
    try {
      reviewedPlan = await api.planTagRename(input);
      changes.replaceChildren();
      for (const change of reviewedPlan.changes) {
        const item = document.createElement("li");
        const title = document.createElement("strong");
        const detail = document.createElement("span");
        title.textContent = change.title || change.publicId;
        detail.textContent = `${change.tagsBefore.join(", ")} → ${change.tagsAfter.join(", ")}`;
        item.append(title, detail);
        changes.append(item);
      }
      planHash.textContent = `Plan hash: ${reviewedPlan.expectedHash}`;
      review.hidden = false;
      confirm.checked = false;
      apply.disabled = true;
      renameState.dataset.state = reviewedPlan.canApply ? "complete" : "warning";
      renameState.textContent = reviewedPlan.canApply
        ? `${reviewedPlan.changes.length} publications will change.`
        : "No current public tags match this rename.";
    } catch (error) {
      invalidatePlan(error.message);
      renameState.dataset.state = "error";
      options.notify(error.message, true);
    }
  }

  async function applyRename() {
    if (!reviewedPlan || !confirm.checked) return;
    apply.disabled = true;
    renameState.dataset.state = "loading";
    renameState.textContent = "Applying the reviewed rename…";
    try {
      await api.applyTagRename({
        from: reviewedPlan.from,
        to: reviewedPlan.to,
        mode: reviewedPlan.mode,
        expectedHash: reviewedPlan.expectedHash,
      });
      options.notify("Reviewed tag rename applied.");
      invalidatePlan("Rename applied. Load a new plan for another change.");
      await options.onApplied();
      activeFilterPath = null;
      options.onFilter(null);
      await loadTree();
    } catch (error) {
      const stale = error instanceof ApiError && error.code === "STALE_TAG_RENAME";
      renameState.dataset.state = stale ? "stale" : "error";
      renameState.textContent = stale ? `${error.message} Review a new plan.` : error.message;
      if (stale) reviewedPlan = null;
      options.notify(error.message, true);
    }
  }

  element("tag-filter-clear").addEventListener("click", () => {
    activeFilterPath = null;
    renderActiveFilter();
    options.onFilter(null);
    filterState.textContent = "Queue tag filter cleared.";
  });
  element("tag-rename-plan").addEventListener("click", planRename);
  confirm.addEventListener("change", () => {
    apply.disabled = !confirm.checked || !reviewedPlan?.canApply;
  });
  apply.addEventListener("click", applyRename);
  for (const id of ["tag-rename-from", "tag-rename-to", "tag-rename-mode"]) {
    element(id).addEventListener("input", () =>
      invalidatePlan("Rename changed. Review a new plan."),
    );
  }
  dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
  return {
    open: async () => {
      dialog.showModal();
      await loadTree();
    },
  };
}
