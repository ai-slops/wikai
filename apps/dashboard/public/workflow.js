import { api } from "/api.js";

function configure(actionElement) {
  const action = actionElement.value;
  const isCandidate = action === "candidates";
  const isExtract = action === "extractions";
  document.querySelector(".candidate-only").hidden = !isCandidate;
  document.querySelector(".advanced-only").hidden = isCandidate;
  document.querySelector(".extract-only").hidden = !isExtract;
  document.querySelector("#workflow-title").textContent = isCandidate
    ? "New candidate"
    : isExtract
      ? "Extract public view"
      : "Create projection";
}

function payload(action, formData) {
  const expectedHash = String(formData.get("expectedHash") || "");
  const base = {
    path: formData.get("path"),
    kind: formData.get("kind"),
    ...(expectedHash ? { expectedHash } : {}),
  };
  if (action === "candidates") return { ...base, mode: formData.get("mode") };
  const advanced = { ...base, to: formData.get("to") };
  if (action === "projects") return advanced;
  const selector = ["heading", "block", "lines"].find((key) =>
    String(formData.get(key) || "").trim(),
  );
  return selector ? { ...advanced, [selector]: formData.get(selector) } : advanced;
}

export function initializeWorkflow(options) {
  const dialog = document.querySelector("#workflow-dialog");
  const form = document.querySelector("#workflow-form");
  const action = document.querySelector("#workflow-action");
  action.addEventListener("change", () => configure(action));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      dialog.close();
      return;
    }
    const submit = event.submitter;
    submit.disabled = true;
    try {
      await api.create(action.value, payload(action.value, new FormData(form)));
      dialog.close();
      form.reset();
      configure(action);
      await options.onCreated();
      options.notify("Candidate workflow created.");
    } catch (error) {
      options.notify(error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
  configure(action);
  return {
    open() {
      form.reset();
      configure(action);
      dialog.showModal();
    },
  };
}
