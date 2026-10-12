const query = document.querySelector("#query");
const includeLog = document.querySelector("#include-log");
const results = document.querySelector("#search-results");
const status = document.querySelector("#search-status");

const render = () => {
  if (!(query instanceof HTMLInputElement) || !(includeLog instanceof HTMLInputElement) || !(results instanceof HTMLOListElement) || !(status instanceof HTMLParagraphElement)) return;
  const term = query.value.trim().toLocaleLowerCase();
  let matches = 0;
  for (const entry of results.querySelectorAll("li[data-search]")) {
    if (!(entry instanceof HTMLLIElement)) continue;
    const visible = (entry.dataset.kind !== "log" || includeLog.checked) && (term === "" || entry.dataset.search?.includes(term) === true);
    entry.hidden = !visible;
    if (visible) matches += 1;
  }
  status.textContent = `${matches} ${matches === 1 ? "result" : "results"}`;
};

query?.addEventListener("input", render);
includeLog?.addEventListener("change", render);
render();
