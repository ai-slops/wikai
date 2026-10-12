import { ApiError, api } from "/api.js";

const element = (id) => document.querySelector(`#${id}`);

function listItems(container, items, description) {
  container.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = item.publicId;
    detail.textContent = description(item);
    row.append(title, detail);
    container.append(row);
  }
  if (items.length === 0) {
    const row = document.createElement("li");
    row.textContent = "None";
    container.append(row);
  }
}

export function initializeComponentApproval(options) {
  const dialog = element("components-dialog");
  const state = element("components-state");
  const confirm = element("components-confirm");
  const apply = element("components-apply");
  let reviewedPlan = null;

  async function loadPlan() {
    reviewedPlan = null;
    confirm.checked = false;
    apply.disabled = true;
    state.dataset.state = "loading";
    state.textContent = "Computing component-only update eligibility…";
    try {
      const plan = await api.componentUpdatePlan();
      reviewedPlan = plan;
      element("components-eligible-count").textContent = String(plan.eligible.length);
      listItems(
        element("components-eligible"),
        plan.eligible,
        (item) => `${item.activeProfileDigest} → ${item.desiredProfileDigest}`,
      );
      listItems(element("components-skipped"), plan.skipped, (item) =>
        item.reasons.join(", ").replaceAll("-", " "),
      );
      element("components-plan-hash").textContent = `Plan hash: ${plan.planHash}`;
      state.dataset.state = plan.eligible.length > 0 ? "complete" : "warning";
      state.textContent =
        plan.eligible.length > 0
          ? "Review both lists, then confirm this exact plan."
          : "No component-only updates are eligible.";
    } catch (error) {
      state.dataset.state = "error";
      state.textContent = error.message;
      options.notify(error.message, true);
    }
  }

  async function applyPlan() {
    if (!reviewedPlan || !confirm.checked) return;
    apply.disabled = true;
    state.dataset.state = "loading";
    state.textContent = "Applying the pinned eligible batch…";
    try {
      const result = await api.applyComponentUpdates(reviewedPlan.planHash);
      options.notify(`${result.approved.length} component updates approved.`);
      await options.onApplied();
      await loadPlan();
    } catch (error) {
      const stale = error instanceof ApiError && error.code === "STALE_COMPONENT_PLAN";
      state.dataset.state = stale ? "stale" : "error";
      state.textContent = stale
        ? `${error.message} Refresh and review the new plan.`
        : error.message;
      if (stale) reviewedPlan = null;
      options.notify(error.message, true);
    }
  }

  confirm.addEventListener("change", () => {
    apply.disabled = !confirm.checked || !reviewedPlan || reviewedPlan.eligible.length === 0;
  });
  apply.addEventListener("click", applyPlan);
  element("components-refresh").addEventListener("click", loadPlan);
  dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
  return {
    open: async () => {
      dialog.showModal();
      await loadPlan();
    },
  };
}
