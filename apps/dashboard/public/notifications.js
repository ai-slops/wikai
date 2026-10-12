export function createToast(element) {
  let timer = 0;
  return (message, error = false) => {
    window.clearTimeout(timer);
    element.textContent = message;
    element.classList.toggle("toast--error", error);
    element.hidden = false;
    timer = window.setTimeout(() => {
      element.hidden = true;
    }, 4500);
  };
}
