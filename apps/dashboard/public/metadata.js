import { api } from "/api.js";

function control(form, name) {
  return form.elements.namedItem(name);
}

function commaList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function initializeMetadataEditor(options) {
  const dialog = document.querySelector("#metadata-dialog");
  const form = document.querySelector("#metadata-form");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      dialog.close();
      return;
    }
    const submit = event.submitter;
    submit.disabled = true;
    try {
      await api.updateMetadata(
        control(form, "publicId").value,
        control(form, "expectedHash").value,
        {
          title: control(form, "title").value.trim(),
          slug: control(form, "slug").value.trim(),
          summary: control(form, "summary").value.trim(),
          tags: commaList(control(form, "tags").value),
          listed: control(form, "listed").checked,
          index: control(form, "index").checked,
          feed: control(form, "feed").checked,
        },
      );
      dialog.close();
      options.notify("Source metadata updated. Review the new exposure hash before approval.");
      await options.onSaved();
    } catch (error) {
      options.notify(error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  return {
    open(detail) {
      const working = detail?.working;
      if (!working?.sourceHash) return;
      const metadata = working.metadata;
      control(form, "publicId").value = working.publicId;
      control(form, "expectedHash").value = working.sourceHash;
      control(form, "title").value = metadata.title || "";
      control(form, "slug").value = metadata.slug || "";
      control(form, "summary").value = metadata.summary || "";
      control(form, "tags").value = (metadata.tags || []).join(", ");
      control(form, "listed").checked = Boolean(metadata.listed);
      control(form, "index").checked = Boolean(metadata.index);
      control(form, "feed").checked = Boolean(metadata.feed);
      dialog.showModal();
    },
  };
}
