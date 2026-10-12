import { initializeComponentApproval } from "/component-approval.js";
import { initializeTagManager } from "/tags.js";

export function initializeManagement(options) {
  const tagManager = initializeTagManager(options);
  const componentApproval = initializeComponentApproval({
    notify: options.notify,
    onApplied: options.onApplied,
  });
  document.querySelector("#tags-button").addEventListener("click", tagManager.open);
  document.querySelector("#components-button").addEventListener("click", componentApproval.open);
}
